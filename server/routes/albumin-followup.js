import express from 'express'
import { query } from '../db.js'
import { requireAuth } from '../auth.js'
import { canAccessLocation, cleanText, isIsoDate } from '../validation.js'
import { cleanFields, cleanTicks } from '../../shared/drug-requests.js'

const router = express.Router()

// «Albumin follow up»: one sheet per day. Its main rows are the day's albumin request forms
// (drug-requests.js) — the screen edits them through those routes, so the two never disagree. What
// the forms cannot hold is typed on the sheet and kept here, one document per day and per scope: rows
// added by hand, the «Not indicated» list and the notes. A manager's scope is the whole hospital; anyone
// else's is their floor (and sees only their floor's forms).
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

const scopeOf = (user) => (user.role === 'admin' || user.role === 'supervisor' ? 'all' : `floor:${user.assignedFloor ?? 'wards'}`)

router.get('/albumin-followup', requireAuth, async (request, response) => {
  const { date } = request.query
  if (!isIsoDate(date)) return response.status(400).json({ message: 'التاريخ مطلوب' })
  const user = request.session.user
  const [forms, saved] = await Promise.all([
    query(
      `SELECT id, ward_key, patient_name, patient_id, fields, ticks FROM drug_requests
       WHERE kind = 'albumin' AND request_date = $1 ORDER BY ward_key, created_at, id`, [date]),
    query('SELECT doc FROM albumin_followups WHERE day = $1 AND scope = $2', [date, scopeOf(user)]),
  ])
  const rows = forms.rows.flatMap((row) => {
    const [floorText, ...ward] = row.ward_key.split('|')
    const floor = floorText ? Number(floorText) : null
    if (!canAccessLocation(user, floor, ward.join('|'))) return []
    return [{ id: row.id, name: row.patient_name, patientId: row.patient_id, floor, ward: ward.join('|'), fields: cleanFields('albumin', row.fields), ticks: cleanTicks('albumin', row.ticks) }]
  })
  response.json({ date, rows, doc: cleanDoc(saved.rows[0]?.doc) })
})

router.put('/albumin-followup', requireAuth, async (request, response) => {
  const { date } = request.body
  if (!isIsoDate(date)) return response.status(400).json({ message: 'التاريخ مطلوب' })
  const doc = cleanDoc(request.body.doc)
  await query(
    `INSERT INTO albumin_followups (day, scope, doc) VALUES ($1, $2, $3)
     ON CONFLICT (day, scope) DO UPDATE SET doc = EXCLUDED.doc, updated_at = NOW()`,
    [date, scopeOf(request.session.user), JSON.stringify(doc)],
  )
  response.json({ doc })
})

export default router
