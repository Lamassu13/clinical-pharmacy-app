import express from 'express'
import { query } from '../db.js'
import { requireAuth } from '../auth.js'
import { canAccessLocation, cleanText, isIsoDate } from '../validation.js'
import { cleanFields, cleanTicks } from '../../shared/drug-requests.js'
import { isNotIndicated } from '../../shared/form-problems.js'

const router = express.Router()

// «Albumin follow up»: one sheet per day. Its main rows are the day's albumin request forms
// (drug-requests.js) — the screen edits them through those routes, so the two never disagree. What
// the forms cannot hold is typed on the sheet and kept here, one document per day and floor: rows
// added by hand, the «Not indicated» rows typed on the sheet and the notes (the forms marked «Not indicated» are listed there too, from the forms). It is a floor's sheet — its own patients only,
// for a manager too, who opens it from inside the floor.
const MAX_ROWS = 100
const EXTRA_KEYS = ['day', 'name', 'fileNo', 'ward', 'diagnosis', 'sAlb', 'sCreat', 'vials', 'indication']
const NOT_INDICATED_KEYS = ['name', 'fileNo', 'ward', 'diagnosis', 'sAlb', 'sCreat', 'reason']
const rowsOf = (list, keys) => (Array.isArray(list) ? list : []).slice(0, MAX_ROWS)
  .map((row) => Object.fromEntries(keys.map((key) => [key, cleanText(row?.[key], 200).trim()])))
  .filter((row) => keys.some((key) => row[key]))
export const cleanDoc = (doc) => ({
  extraRows: rowsOf(doc?.extraRows, EXTRA_KEYS),
  notIndicated: rowsOf(doc?.notIndicated, NOT_INDICATED_KEYS),
  notes: cleanText(doc?.notes, 4000).trim(),
})

const floorOf = (value) => { const floor = Number(value); return Number.isInteger(floor) && floor > 0 ? floor : null }
// 400 for a missing floor, 403 for a floor the user may not open; otherwise the floor.
const readFloor = (request, response, value) => {
  const floor = floorOf(value)
  if (floor === null) { response.status(400).json({ message: 'الطابق مطلوب' }); return null }
  if (!canAccessLocation(request.session.user, floor, null)) { response.status(403).json({ message: 'لا تملك صلاحية لهذا الطابق' }); return null }
  return floor
}

router.get('/albumin-followup', requireAuth, async (request, response) => {
  const { date } = request.query
  if (!isIsoDate(date)) return response.status(400).json({ message: 'التاريخ مطلوب' })
  const floor = readFloor(request, response, request.query.floor)
  if (floor === null) return undefined
  const [forms, saved] = await Promise.all([
    query(
      `SELECT id, ward_key, patient_name, patient_id, fields, ticks FROM drug_requests
       WHERE kind = 'albumin' AND request_date = $1 AND ward_key LIKE $2 ORDER BY ward_key, created_at, id`, [date, `${floor}|%`]),
    query('SELECT doc FROM albumin_followups WHERE day = $1 AND scope = $2', [date, `floor:${floor}`]),
  ])
  const all = forms.rows.map((row) => {
    const [, ...ward] = row.ward_key.split('|')
    return { id: row.id, name: row.patient_name, patientId: row.patient_id, floor, ward: ward.join('|'), fields: cleanFields('albumin', row.fields), ticks: cleanTicks('albumin', row.ticks) }
  })
  // The forms marked «Not indicated» are the sheet's «Not indicated» list (with their reason); the rest are its main rows.
  const rows = all.filter((row) => !isNotIndicated('albumin', row))
  const notForms = all.filter((row) => isNotIndicated('albumin', row))
  return response.json({ date, floor, rows, notForms, doc: cleanDoc(saved.rows[0]?.doc) })
})

router.put('/albumin-followup', requireAuth, async (request, response) => {
  const { date } = request.body
  if (!isIsoDate(date)) return response.status(400).json({ message: 'التاريخ مطلوب' })
  const floor = readFloor(request, response, request.body.floor)
  if (floor === null) return undefined
  const doc = cleanDoc(request.body.doc)
  await query(
    `INSERT INTO albumin_followups (day, scope, doc) VALUES ($1, $2, $3)
     ON CONFLICT (day, scope) DO UPDATE SET doc = EXCLUDED.doc, updated_at = NOW()`,
    [date, `floor:${floor}`, JSON.stringify(doc)],
  )
  return response.json({ doc })
})

export default router
