import express from 'express'
import { query } from '../db.js'
import { requireAuth, requireManager } from '../auth.js'
import { checkAll, readHealth, refreshIfStale } from '../google-form-health.js'
import { isIsoDate } from '../validation.js'
import { readLocation } from './chart.js'
import { chartIds } from './drug-requests.js'
import { wardKeyOf } from '../meropenem.js'
import { DRUG_REQUESTS, cleanFields, cleanTicks } from '../../shared/drug-requests.js'
import { formProblems, needsFollowUp, GOOGLE_KINDS } from '../../shared/form-problems.js'

const router = express.Router()

// The follow-up of the request forms (shared/form-problems.js), for managers across every ward and for a floor user on their
// own ward. Both are read on demand — nothing here is polled — and answer only what needs following up, in short keys, so a
// quiet week is a few hundred bytes. Dates are capped; the lists are capped (`more` says so).
const MAX_DAYS = 31
const MAX_ROWS = 300
// What the database is asked for (Meropenem forms are judged here, so complete ones are read too): a ceiling on what leaves Neon.
const DB_ROWS = 1500
const DAY_MS = 86400000
const toDay = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)
const isManagerUser = (user) => user.role === 'admin' || user.role === 'supervisor'
const rangeOf = (source) => {
  const { from, to } = source
  if (!isIsoDate(from) || !isIsoDate(to)) return { status: 400, message: 'التاريخ مطلوب' }
  if (from > to) return { status: 400, message: 'تاريخ البداية بعد تاريخ النهاية' }
  if (toDay(to) - toDay(from) + 1 > MAX_DAYS) return { status: 400, message: `المدة القصوى ${MAX_DAYS} يومًا` }
  return { from, to }
}

// Forms that need following up in [from, to], any ward (a Google form already sent is not read at all, unless it is unconfirmed): a Google form not sent / not confirmed, or any form still lacking what
// it needs. { rows: [{ id, kind, date, ward: «floor|name», name, patientId, state, problems, by, error }], more }.
// `state`: unsent | unconfirmed | refused | incomplete (Meropenem is sent nowhere, so only incomplete).
router.get('/drug-requests/followup', requireAuth, async (request, response) => {
  if (!isManagerUser(request.session.user)) return response.status(403).json({ message: 'صلاحية إدارية مطلوبة' })
  const range = rangeOf(request.query)
  if (range.status) return response.status(range.status).json({ message: range.message })
  const kind = Object.hasOwn(DRUG_REQUESTS, request.query.kind) ? request.query.kind : null
  const result = await query(
    `SELECT r.id, r.kind, r.ward_key, r.request_date::text AS date, r.patient_name, r.patient_id, r.fields, r.ticks, r.note,
            r.google_sent_at, r.google_sent_by_name, r.google_error
     FROM drug_requests r
     WHERE r.request_date BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR r.kind = $3)
       AND (r.kind <> ALL($4::text[]) OR r.google_sent_at IS NULL OR r.google_error <> '')
     ORDER BY r.request_date DESC, r.id DESC LIMIT ${DB_ROWS}`,
    [range.from, range.to, kind, GOOGLE_KINDS],
  )
  // A form with no رقم الطبلة of its own takes the chart's of that day, as its screen and the send do: one small read for all.
  const lacking = result.rows.filter((row) => !row.patient_id)
  const charted = new Map()
  if (lacking.length) {
    const names = [...new Set(lacking.map((row) => row.patient_name))]
    ;(await query(
      `SELECT DISTINCT ON (dc.chart_date, w.floor_number, w.name, nm) dc.chart_date::text AS date, w.floor_number AS floor, w.name AS ward,
              regexp_replace(btrim(cp.patient_name), '\\s+', ' ', 'g') AS nm, cp.patient_id
       FROM daily_charts dc JOIN wards w ON w.id = dc.ward_id JOIN chart_patients cp ON cp.chart_id = dc.id
       WHERE dc.chart_date BETWEEN $1::date AND $2::date AND cp.patient_id <> '' AND regexp_replace(btrim(cp.patient_name), '\\s+', ' ', 'g') = ANY($3)
       ORDER BY dc.chart_date, w.floor_number, w.name, nm, (dc.slot = 'main') DESC, cp.row_number`,
      [range.from, range.to, names],
    )).rows.forEach((row) => charted.set(`${row.date}|${wardKeyOf(row.floor, row.ward)}|${row.nm}`, row.patient_id))
  }
  const rows = []
  for (const row of result.rows) {
    const fields = cleanFields(row.kind, row.fields)
    const patientId = row.patient_id || charted.get(`${row.date}|${row.ward_key}|${row.patient_name}`) || ''
    const form = { name: row.patient_name, patientId, date: row.date, fields, ticks: cleanTicks(row.kind, row.ticks), note: row.note, googleSentAt: row.google_sent_at, googleError: row.google_error }
    if (!needsFollowUp(row.kind, form)) continue
    const google = GOOGLE_KINDS.includes(row.kind)
    const state = !google ? 'incomplete' : row.google_sent_at ? 'unconfirmed' : row.google_error ? 'refused' : 'unsent'
    const problems = formProblems(row.kind, form)
    rows.push({
      id: row.id, kind: row.kind, date: row.date, ward: row.ward_key, name: row.patient_name, patientId, state,
      ...(problems.length ? { problems } : {}), ...(row.google_sent_by_name && state === 'unconfirmed' ? { by: row.google_sent_by_name } : {}), ...(row.google_error ? { error: row.google_error } : {}),
    })
  }
  // The Google Forms' health, as kept (a few bytes); an old verdict is refreshed in the background, for the next time.
  const health = await readHealth()
  refreshIfStale(health)
  response.json({ from: range.from, to: range.to, rows: rows.slice(0, MAX_ROWS), more: rows.length > MAX_ROWS || result.rows.length >= DB_ROWS, health })
})

// «فحص النماذج الآن»: the Google Forms are read now and compared (google-form-health.js); at most once a minute, whoever asks.
router.post('/drug-requests/health/check', requireManager, async (_request, response) => {
  await checkAll()
  response.json({ health: await readHealth() })
})

// Patients given a first-day medicine (Meropenem, Tigecycline, Colistin, IVIG) in the range with no form of that kind for them:
// none from 30 days before their first charted dose to 14 days after the first one in the range (the popup can be skipped and the
// form completed later). A course that began before the form went live (`formsSince`) is not asked for, and one that began up
// to 30 days before the range is still told from a new one. Read from the charts only — the course engine is not run, so it is
// a light query; the price is that a course restarting within 30 days of an earlier form is not caught. A manager asks for any
// range across all wards; a floor user for one day of their own ward (`floor`, `ward`, `date`).
// { patients: [{ floor, ward, date, name, patientId }], more }.
router.get('/drug-requests/missing', requireAuth, async (request, response) => {
  const kind = Object.hasOwn(DRUG_REQUESTS, request.query.kind) && DRUG_REQUESTS[request.query.kind].firstDayOnly ? request.query.kind : null
  if (!kind) return response.status(400).json({ message: 'نوع الاستمارة غير معروف' })
  const user = request.session.user
  let range
  let ward = [null, null]
  if (request.query.ward) {
    const location = readLocation(request.query, user)
    if (location.status) return response.status(location.status).json({ message: location.message })
    range = { from: location.chartDate, to: location.chartDate }
    ward = [location.floor, location.wardName]
  } else {
    if (!isManagerUser(user)) return response.status(403).json({ message: 'صلاحية إدارية مطلوبة' })
    range = rangeOf(request.query)
    if (range.status) return response.status(range.status).json({ message: range.message })
  }
  const result = await query(
    `WITH given AS (
       SELECT w.floor_number AS floor, w.name AS ward, MIN(dc.chart_date) AS first,
              MIN(dc.chart_date) FILTER (WHERE dc.chart_date >= $1::date) AS date,
              regexp_replace(btrim(cp.patient_name), '\\s+', ' ', 'g') AS name, cp.patient_id
       FROM daily_charts dc
       JOIN wards w ON w.id = dc.ward_id
       JOIN chart_patients cp ON cp.chart_id = dc.id
       JOIN chart_quantities cq ON cq.chart_id = dc.id AND cq.row_number = cp.row_number
       JOIN chart_columns cc ON cc.chart_id = dc.id AND cc.column_number = cq.column_number
       LEFT JOIN medicines m ON m.id = cc.medicine_id
       WHERE dc.chart_date BETWEEN $1::date - 30 AND $2::date AND cq.quantity > 0 AND COALESCE(m.name, cc.custom_name) ~* $3
         AND (btrim(cp.patient_name) <> '' OR cp.patient_id <> '')
         AND ($4::text IS NULL OR (w.floor_number IS NOT DISTINCT FROM $5::int AND w.name = $4))
       GROUP BY w.floor_number, w.name, regexp_replace(btrim(cp.patient_name), '\\s+', ' ', 'g'), cp.patient_id
       HAVING MAX(dc.chart_date) >= $1::date AND MIN(dc.chart_date) >= $8::date)
     SELECT g.floor, g.ward, g.date::text AS date, g.name, g.patient_id FROM given g
     WHERE NOT EXISTS (
       SELECT 1 FROM drug_requests r
       WHERE r.kind = $6 AND r.request_date BETWEEN g.first - 30 AND g.date + 14 AND r.ward_key = COALESCE(g.floor::text, '') || '|' || g.ward AND r.patient_name = g.name)
       AND NOT EXISTS (
       SELECT 1 FROM drug_requests r
       WHERE g.patient_id <> '' AND r.kind = $6 AND r.patient_id = g.patient_id AND r.request_date BETWEEN g.first - 30 AND g.date + 14)
     ORDER BY g.date, g.floor, g.ward, g.name LIMIT $7`,
    [range.from, range.to, DRUG_REQUESTS[kind].sqlPattern, ward[1], ward[0], kind, MAX_ROWS + 1, DRUG_REQUESTS[kind].formsSince],
  )
  response.json({ patients: result.rows.slice(0, MAX_ROWS).map((row) => ({ floor: row.floor, ward: row.ward, date: row.date, name: row.name, patientId: row.patient_id })), more: result.rows.length > MAX_ROWS })
})

// A floor user's own pending forms for `date` (today, in practice): how many need following up on each ward they can open — a Google form not
// sent / not confirmed, or any form still lacking what it needs (the same rule as the ward page's counts, shared/form-problems.js).
// Read from the one small set of today's forms; added to the dashboard answer the floor page already loads, so it costs no request.
// { total, wards: [{ floor, ward, n }] } — wards with nothing pending are left out.
export const pendingFormsFor = async (user, date) => {
  const floor = Number.isInteger(user.assignedFloor) ? user.assignedFloor : null
  const wards = floor === null && Array.isArray(user.assignedWards) ? user.assignedWards : []
  if (floor === null && !wards.length) return { total: 0, wards: [] }
  const rows = (await query(
    `SELECT kind, ward_key, patient_name, patient_id, fields, ticks, note, google_sent_at, google_error FROM drug_requests
     WHERE request_date = $1::date AND ${floor !== null ? 'ward_key LIKE $2' : 'ward_key = ANY($2::text[])'}`,
    [date, floor !== null ? `${floor}|%` : wards.map((ward) => `|${ward}`)],
  )).rows
  const ids = new Map() // a form with no رقم الطبلة of its own takes the chart's, ward by ward
  for (const key of new Set(rows.filter((row) => !row.patient_id).map((row) => row.ward_key))) {
    const [floorText, ...ward] = key.split('|')
    ids.set(key, await chartIds(floorText ? Number(floorText) : null, ward.join('|'), date))
  }
  const counts = new Map()
  for (const row of rows) {
    const form = { name: row.patient_name, patientId: row.patient_id || ids.get(row.ward_key)?.get(row.patient_name) || '', date, fields: cleanFields(row.kind, row.fields), ticks: cleanTicks(row.kind, row.ticks), note: row.note, googleSentAt: row.google_sent_at, googleError: row.google_error }
    if (needsFollowUp(row.kind, form)) counts.set(row.ward_key, (counts.get(row.ward_key) || 0) + 1)
  }
  const list = [...counts].map(([key, n]) => { const [floorText, ...ward] = key.split('|'); return { floor: floorText ? Number(floorText) : null, ward: ward.join('|'), n } })
    .sort((a, b) => (a.floor ?? 99) - (b.floor ?? 99) || a.ward.localeCompare(b.ward, 'ar'))
  return { total: list.reduce((sum, item) => sum + item.n, 0), wards: list }
}

export default router
