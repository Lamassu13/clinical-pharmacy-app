import express from 'express'
import { query } from '../db.js'
import { requireManager } from '../auth.js'
import { memoizeByKey } from '../cache.js'
import { isIsoDate } from '../validation.js'
import { buildMeropenemForm, monthStart, windowStart, MEROPENEM_SQL_PATTERN } from '../meropenem.js'
import { loadCourseRows } from './chart.js'
import { monthDates, startDates, courseMg, stayRun, formFor, reportRow, sortRows, dedupeStarts, nextStartOf, seenDatesIndex, FORM_GRACE_DAYS } from '../ward-positions.js'

const router = express.Router()

// «مواقف القسم»: every Meropenem course that began between two dates, hospital-wide. On demand only.
// The range is capped so one request reads at most four calendar months of course history.
export const MAX_POSITION_DAYS = 62
const DAY_MS = 86400000
const toDay = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)
const plusDays = (iso, days) => new Date((toDay(iso) + days) * DAY_MS).toISOString().slice(0, 10)

// The courses of one month (up to `date`), built from the same rows and rules as «متابعة الميروبينيم»
// so a start here is a D1 there. Kept 5 minutes per date; a form is read fresh on every request.
// ponytail: per-process memory, so a restart empties it.
const monthCache = memoizeByKey((date) => computeMonth(date), { ttlMs: 5 * 60_000, max: 6 })
export const clearWardPositions = () => monthCache.clear()
const computeMonth = async (date) => {
  const rows = await loadCourseRows({ floor: null, wardName: '', chartDate: date }, { pattern: MEROPENEM_SQL_PATTERN, allWards: true })
  const first = monthStart(date)
  const readFrom = windowStart(date)
  const seenDates = seenDatesIndex(rows.presence)
  const wards = new Map()
  rows.cells.filter((cell) => cell.date >= first).forEach((cell) => {
    const key = `${cell.floor ?? ''}|${cell.ward}`
    if (!wards.has(key)) wards.set(key, { floor: cell.floor, ward: cell.ward, ids: new Set() })
    if (cell.patientId) wards.get(key).ids.add(cell.patientId)
  })
  const courses = []
  wards.forEach(({ floor, ward, ids }) => {
    // Only what can change this ward's patients: rows on this ward, or carrying one of their IDs (a transfer).
    const mine = (row) => (row.floor === floor && row.ward === ward) || (row.patientId && ids.has(row.patientId))
    const cells = rows.cells.filter(mine)
    // No typed course days: those relabel a course's first shown day (D4 on admission, say), and a
    // report of starts counts the first dose day of every course, whatever number it was typed as.
    buildMeropenemForm({ ...rows, floor, ward, cells, presence: rows.presence.filter(mine), overrides: [] }).patients.forEach((patient) => {
      const course = { key: patient.key, floor, ward, name: patient.name, patientId: patient.patientId }
      startDates(patient, first, date).forEach((startDate) => {
        const stay = stayRun(seenDates(course), startDate, readFrom)
        courses.push({ ...course, startDate, totalMg: courseMg(cells, course, startDate), stayDays: stay.days, stayCapped: stay.capped })
      })
    })
  })
  return courses
}

router.get('/ward-positions', requireManager, async (request, response) => {
  const { from, to } = request.query
  if (!isIsoDate(from) || !isIsoDate(to)) return response.status(400).json({ message: 'التاريخ مطلوب' })
  if (from > to) return response.status(400).json({ message: 'تاريخ البداية بعد تاريخ النهاية' })
  if (toDay(to) - toDay(from) + 1 > MAX_POSITION_DAYS) return response.status(400).json({ message: `المدة القصوى ${MAX_POSITION_DAYS} يومًا` })

  const starts = dedupeStarts((await Promise.all(monthDates(from, to).map((date) => monthCache.get(date, date)))).flat())
  const courses = starts.filter((course) => course.startDate >= from && course.startDate <= to)

  // Forms: saved on a start day or shortly after it.
  const forms = (await query(
    `SELECT patient_name, patient_id, ward_key, request_date::text AS request_date, fields, ticks, note
     FROM drug_requests WHERE kind = 'meropenem' AND request_date BETWEEN $1::date AND $2::date`,
    [from, plusDays(to, FORM_GRACE_DAYS)],
  )).rows.map((row) => ({ name: row.patient_name, patientId: row.patient_id, wardKey: row.ward_key, requestDate: row.request_date, fields: row.fields, ticks: row.ticks, note: row.note }))

  const patients = sortRows(courses.map((course) => reportRow(course, formFor(forms, course, course.startDate, nextStartOf(starts, course)))))
  response.json({ range: { from, to }, patients })
})

export default router
