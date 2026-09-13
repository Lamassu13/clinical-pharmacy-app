import express from 'express'
import { pool, query } from '../db.js'
import { requireAuth } from '../auth.js'
import { canAccessLocation, clampInt, cleanText, DOSE_TIMES, USAGE_METHODS, NOTE_OPTIONS } from '../validation.js'

const router = express.Router()

// استمارة الحبوب الإضافي — a standalone manual pill form, one per floor workspace, with no
// chart behind it at all (unlike /api/pills, which is entirely chart-derived). Only the four
// floors this was built for; see extra_pill_forms' own CHECK constraint in schema.sql.
const EXTRA_PILL_FLOORS = [3, 6, 8, 9]
const SLOTS = [1, 2, 3, 4, 5, 6, 7]

const loadForm = async (id) => {
  const formResult = await query('SELECT id, floor_number, patient_name, room_number FROM extra_pill_forms WHERE id = $1', [id])
  const form = formResult.rows[0]
  if (!form) return null
  const entries = (await query(
    'SELECT slot_number, medicine_name, pill_qty, dose_time, usage_method, note FROM extra_pill_form_entries WHERE form_id = $1 ORDER BY slot_number',
    [id],
  )).rows
  const bySlot = new Map(entries.map((row) => [row.slot_number, row]))
  return {
    id: form.id,
    floor: form.floor_number,
    patientName: form.patient_name,
    roomNumber: form.room_number,
    entries: SLOTS.map((slot) => {
      const row = bySlot.get(slot)
      return { slot, medicineName: row?.medicine_name || '', pillQty: row?.pill_qty || '', doseTime: row?.dose_time || '', usageMethod: row?.usage_method || '', note: row?.note || '' }
    }),
  }
}

router.get('/extra-pills', requireAuth, async (request, response) => {
  const floor = clampInt(request.query.floor, 1, 99)
  if (floor === null || !EXTRA_PILL_FLOORS.includes(floor)) return response.status(400).json({ message: 'الطابق غير مسموح' })
  if (!canAccessLocation(request.session.user, floor, null)) return response.status(403).json({ message: 'لا تملك صلاحية لهذا الطابق' })
  const ids = (await query('SELECT id FROM extra_pill_forms WHERE floor_number = $1 ORDER BY created_at', [floor])).rows.map((row) => row.id)
  const forms = await Promise.all(ids.map(loadForm))
  response.json({ forms })
})

router.post('/extra-pills', requireAuth, async (request, response) => {
  const floor = clampInt(request.body.floor, 1, 99)
  if (floor === null || !EXTRA_PILL_FLOORS.includes(floor)) return response.status(400).json({ message: 'الطابق غير مسموح' })
  if (!canAccessLocation(request.session.user, floor, null)) return response.status(403).json({ message: 'لا تملك صلاحية لهذا الطابق' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const formId = (await client.query(
      'INSERT INTO extra_pill_forms (floor_number, created_by) VALUES ($1, $2) RETURNING id',
      [floor, request.session.user.id],
    )).rows[0].id
    await client.query(
      'INSERT INTO extra_pill_form_entries (form_id, slot_number) SELECT $1, s FROM UNNEST($2::int[]) AS u(s)',
      [formId, SLOTS],
    )
    await client.query('COMMIT')
    response.status(201).json({ form: await loadForm(formId) })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})

router.put('/extra-pills/:id', requireAuth, async (request, response) => {
  const id = clampInt(request.params.id, 1, Number.MAX_SAFE_INTEGER)
  if (id === null) return response.status(404).json({ message: 'الاستمارة غير موجودة' })
  const existing = await query('SELECT floor_number FROM extra_pill_forms WHERE id = $1', [id])
  const floor = existing.rows[0]?.floor_number
  if (!floor) return response.status(404).json({ message: 'الاستمارة غير موجودة' })
  if (!canAccessLocation(request.session.user, floor, null)) return response.status(403).json({ message: 'لا تملك صلاحية لهذا الطابق' })

  const patientName = cleanText(request.body.patientName, 200).trim()
  const roomNumber = cleanText(request.body.roomNumber, 40).trim()
  const bySlot = new Map()
  ;(Array.isArray(request.body.entries) ? request.body.entries : []).forEach((entry) => {
    const slot = clampInt(entry?.slot, 1, 7)
    if (slot === null) return
    bySlot.set(slot, {
      medicineName: cleanText(entry?.medicineName, 200).trim(),
      pillQty: String(entry?.pillQty ?? '').replace(/\D/g, '').slice(0, 9),
      doseTime: DOSE_TIMES.includes(entry?.doseTime) ? entry.doseTime : '',
      usageMethod: USAGE_METHODS.includes(entry?.usageMethod) ? entry.usageMethod : '',
      note: NOTE_OPTIONS.includes(entry?.note) ? entry.note : '',
    })
  })
  const rows = SLOTS.map((slot) => ({ slot, ...(bySlot.get(slot) || { medicineName: '', pillQty: '', doseTime: '', usageMethod: '', note: '' }) }))

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('UPDATE extra_pill_forms SET patient_name = $2, room_number = $3, updated_at = NOW() WHERE id = $1', [id, patientName, roomNumber])
    await client.query('DELETE FROM extra_pill_form_entries WHERE form_id = $1', [id])
    await client.query(
      `INSERT INTO extra_pill_form_entries (form_id, slot_number, medicine_name, pill_qty, dose_time, usage_method, note)
       SELECT $1, s, mn, pq, dt, um, nt FROM UNNEST($2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
         AS u(s, mn, pq, dt, um, nt)`,
      [id, rows.map((r) => r.slot), rows.map((r) => r.medicineName), rows.map((r) => r.pillQty), rows.map((r) => r.doseTime), rows.map((r) => r.usageMethod), rows.map((r) => r.note)],
    )
    await client.query('COMMIT')
    response.json({ form: await loadForm(id) })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})

router.delete('/extra-pills/:id', requireAuth, async (request, response) => {
  const id = clampInt(request.params.id, 1, Number.MAX_SAFE_INTEGER)
  if (id === null) return response.status(404).json({ message: 'الاستمارة غير موجودة' })
  const existing = await query('SELECT floor_number FROM extra_pill_forms WHERE id = $1', [id])
  const floor = existing.rows[0]?.floor_number
  if (!floor) return response.status(404).json({ message: 'الاستمارة غير موجودة' })
  if (!canAccessLocation(request.session.user, floor, null)) return response.status(403).json({ message: 'لا تملك صلاحية لهذا الطابق' })
  await query('DELETE FROM extra_pill_forms WHERE id = $1', [id])
  response.json({ ok: true })
})

export default router
