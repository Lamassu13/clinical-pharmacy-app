import express from 'express'
import { query } from '../db.js'
import { requireAuth } from '../auth.js'
import { canAccessLocation, cleanText } from '../validation.js'
import { readLocation, readWritableLocation, refuse, loadCourseRows, loadOverrides } from './chart.js'
import { DAY_LOCKED, isDayLocked } from '../day-lock.js'
import { buildMeropenemForm, wardKeyOf } from '../meropenem.js'
import { numberToArabicWords } from '../arabic-number.js'
import { DRUG_REQUESTS, MAX_REQUEST_NOTE, cleanFields, cleanTicks } from '../../shared/drug-requests.js'

const router = express.Router()

// «استمارة الميرونيم» and «استمارة الالبومين» (../../shared/drug-requests.js). The patient-entry form
// fills one when the medicine is added; the form's screen lists a ward's forms of one kind for a day,
// edits them, ticks their boxes and prints them. Same access as the ward's chart.

const nameKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')
const idOf = (value) => String(value ?? '').replace(/\D/g, '').slice(0, 20)
const kindOf = (value) => (Object.hasOwn(DRUG_REQUESTS, value) ? value : null)
const BAD_KIND = { message: 'نوع الاستمارة غير معروف' }

const SELECT = `SELECT r.id, r.kind, r.ward_key, r.request_date::text AS date, r.patient_name, r.patient_id, r.fields, r.ticks, r.note,
    r.created_at, r.updated_at, u.full_name AS created_by_name
  FROM drug_requests r LEFT JOIN users u ON u.id = r.created_by`
const toRequest = (row) => {
  const fields = cleanFields(row.kind, row.fields)
  const count = Number(fields.count)
  return {
    id: row.id, kind: row.kind, date: row.date, name: row.patient_name, patientId: row.patient_id,
    fields, ticks: cleanTicks(row.kind, row.ticks), note: row.note,
    // Albumin's «كتابة»: the count spelled out, as the requisition does.
    ...(row.kind === 'albumin' ? { words: Number.isInteger(count) && count > 0 ? numberToArabicWords(count) : '' } : {}),
    createdByName: row.created_by_name || '', createdAt: row.created_at, updatedAt: row.updated_at,
  }
}
const loadRequest = async (id) => (await query(`${SELECT} WHERE r.id = $1`, [id])).rows[0]

// A stored form, access-checked against its ward: { row } or { status, message }.
const ownRequest = async (request) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return { status: 404, message: 'الاستمارة غير موجودة' }
  const row = await loadRequest(id)
  if (!row) return { status: 404, message: 'الاستمارة غير موجودة' }
  const [floorText, ...ward] = row.ward_key.split('|')
  if (!canAccessLocation(request.session.user, floorText ? Number(floorText) : null, ward.join('|'))) return { status: 403, message: 'لا تملك صلاحية لهذه الردهة' }
  return { row }
}
// The same, for a change: a form is edited, ticked or deleted on its own day only (../day-lock.js).
const ownWritableRequest = async (request) => {
  const own = await ownRequest(request)
  return own.row && isDayLocked(request.session.user, own.row.date) ? { status: 403, ...DAY_LOCKED } : own
}

// رقم الطبلة as the ward's charts for that day carry it (main chart first), by the patient's name:
// a form saved before the ID was typed on the chart still shows it. name -> ID.
const chartIds = async (floor, wardName, chartDate) => new Map((await query(
  `SELECT DISTINCT ON (name) regexp_replace(btrim(cp.patient_name), '\\s+', ' ', 'g') AS name, cp.patient_id
   FROM daily_charts dc
   JOIN wards w ON w.id = dc.ward_id
   JOIN chart_patients cp ON cp.chart_id = dc.id
   WHERE w.floor_number IS NOT DISTINCT FROM $1 AND w.name = $2 AND dc.chart_date = $3
     AND cp.patient_id <> '' AND btrim(cp.patient_name) <> ''
   ORDER BY name, (dc.slot = 'main') DESC, cp.row_number`,
  [floor, wardName, chartDate],
)).rows.map((row) => [row.name, row.patient_id]))

router.get('/drug-requests', requireAuth, async (request, response) => {
  const kind = kindOf(request.query.kind)
  if (!kind) return response.status(400).json(BAD_KIND)
  const location = readLocation(request.query, request.session.user)
  if (location.status) return response.status(location.status).json({ message: location.message })
  const { floor, wardName, chartDate } = location
  const result = await query(`${SELECT} WHERE r.kind = $1 AND r.ward_key = $2 AND r.request_date = $3 ORDER BY r.created_at, r.id`, [kind, wardKeyOf(floor, wardName), chartDate])
  // A stored رقم الطبلة (typed in the popup's patient, or on the form) wins; otherwise the chart's.
  const ids = result.rows.some((row) => !row.patient_id) ? await chartIds(floor, wardName, chartDate) : new Map()
  response.json({ requests: result.rows.map((row) => toRequest({ ...row, patient_id: row.patient_id || ids.get(row.patient_name) || '' })) })
})

// How many forms the ward has on `date`, per kind ({ meropenem, albumin }) — two numbers for the ward
// page's rows, so it never ships the forms themselves.
router.get('/drug-requests/counts', requireAuth, async (request, response) => {
  const location = readLocation(request.query, request.session.user)
  if (location.status) return response.status(location.status).json({ message: location.message })
  const { floor, wardName, chartDate } = location
  const rows = (await query('SELECT kind, COUNT(*)::int AS n FROM drug_requests WHERE kind = ANY($3) AND ward_key = $1 AND request_date = $2 GROUP BY kind', [wardKeyOf(floor, wardName), chartDate, Object.keys(DRUG_REQUESTS)])).rows
  response.json(Object.fromEntries(Object.keys(DRUG_REQUESTS).map((kind) => [kind, rows.find((row) => row.kind === kind)?.n ?? 0])))
})

// The patient's course day for this medicine on `date`, and whether today's form is already filled.
// The course is the follow-up form's own (../meropenem.js): the patient is counted as if charted on
// it here today — their chart save may still be on its way — so a patient who had it yesterday, here
// or on the ward they were transferred from, is past day 1. Meropenem asks only on day 1; albumin
// asks every day and starts «Treatment day» from this number.
router.get('/drug-requests/check', requireAuth, async (request, response) => {
  const kind = kindOf(request.query.kind)
  if (!kind) return response.status(400).json(BAD_KIND)
  const location = readLocation(request.query, request.session.user)
  if (location.status) return response.status(location.status).json({ message: location.message })
  const name = nameKey(cleanText(request.query.name, 200))
  const patientId = idOf(request.query.id)
  if (!name && !patientId) return response.status(400).json({ message: 'اسم المريض أو رقمه مطلوب' })
  const { floor, wardName, chartDate } = location
  const rows = await loadCourseRows(location, { pattern: DRUG_REQUESTS[kind].sqlPattern })
  const probe = { date: chartDate, floor, ward: wardName, name, patientId, medicine: kind, quantity: 1 }
  const form = buildMeropenemForm({ ...rows, cells: [...rows.cells, probe], overrides: await loadOverrides(kind) })
  const patient = form.patients.find((row) => (patientId ? row.patientId === patientId : row.name === name))
  const requested = await query(
    `SELECT 1 FROM drug_requests WHERE kind = $1 AND ward_key = $2 AND request_date = $3
       AND (($4 <> '' AND patient_id = $4) OR patient_name = $5) LIMIT 1`,
    [kind, wardKeyOf(floor, wardName), chartDate, patientId, name],
  )
  response.json({ day: patient?.days[chartDate] ?? 1, requested: requested.rowCount > 0 })
})

// Create — or, for the same patient, kind, ward and day, update the typed fields (the ticks stay):
// a form saved offline and sent twice must not print twice.
router.post('/drug-requests', requireAuth, async (request, response) => {
  const kind = kindOf(request.body.kind)
  if (!kind) return response.status(400).json(BAD_KIND)
  const location = readWritableLocation(request.body, request.session.user)
  if (location.status) return refuse(response, location)
  const name = nameKey(cleanText(request.body.name, 200))
  if (!name) return response.status(400).json({ message: 'اسم المريض مطلوب' })
  const { floor, wardName, chartDate } = location
  const result = await query(
    `INSERT INTO drug_requests (kind, ward_key, request_date, patient_name, patient_id, fields, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (kind, ward_key, request_date, patient_name, patient_id) DO UPDATE SET fields = EXCLUDED.fields, updated_at = NOW()
     RETURNING id, (xmax = 0) AS created`,
    [kind, wardKeyOf(floor, wardName), chartDate, name, idOf(request.body.patientId), JSON.stringify(cleanFields(kind, request.body.fields)), request.session.user.id],
  )
  response.status(result.rows[0].created ? 201 : 200).json({ request: toRequest(await loadRequest(result.rows[0].id)) })
})

router.put('/drug-requests/:id', requireAuth, async (request, response) => {
  const own = await ownWritableRequest(request)
  if (own.status) return refuse(response, own)
  const name = nameKey(cleanText(request.body.name, 200))
  if (!name) return response.status(400).json({ message: 'اسم المريض مطلوب' })
  try {
    await query(
      'UPDATE drug_requests SET patient_name = $2, patient_id = $3, fields = $4, updated_at = NOW() WHERE id = $1',
      [own.row.id, name, idOf(request.body.patientId), JSON.stringify(cleanFields(own.row.kind, request.body.fields))],
    )
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ message: 'توجد استمارة أخرى لهذا المريض في هذا اليوم' })
    throw error
  }
  response.json({ request: toRequest(await loadRequest(own.row.id)) })
})

// The ticked boxes, sent whole on each tap (last tap wins), and the «Others (specify)» text.
router.patch('/drug-requests/:id/ticks', requireAuth, async (request, response) => {
  const own = await ownWritableRequest(request)
  if (own.status) return refuse(response, own)
  const ticks = cleanTicks(own.row.kind, request.body.ticks)
  const note = request.body.note === undefined ? own.row.note : cleanText(request.body.note, MAX_REQUEST_NOTE).trim()
  await query('UPDATE drug_requests SET ticks = $2, note = $3, updated_at = NOW() WHERE id = $1', [own.row.id, JSON.stringify(ticks), note])
  response.json({ request: toRequest(await loadRequest(own.row.id)) })
})

router.delete('/drug-requests/:id', requireAuth, async (request, response) => {
  const own = await ownWritableRequest(request)
  if (own.status) return refuse(response, own)
  await query('DELETE FROM drug_requests WHERE id = $1', [own.row.id])
  response.json({ ok: true })
})

export default router
