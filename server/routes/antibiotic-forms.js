import express from 'express'
import { pool, query } from '../db.js'
import { requireAuth, requireManager } from '../auth.js'
import { canAccessLocation, isIsoDate } from '../validation.js'
import { readLocation, refuse, loadCourseRows, loadOverrides, antibioticNames } from './chart.js'
import { wardKeyOf } from '../meropenem.js'
import { antibioticOf } from '../ddd.js'
import { todayInBaghdad } from '../push.js'
import { DAY_LOCKED, isDayLocked } from '../day-lock.js'
import { recordAudit } from '../audit.js'
import { buildCandidates, FORM_DAYS } from '../antibiotic-forms.js'
import { CARRY_DAYS } from '../../shared/drug-requests.js'
import { cleanForm, missingAnswers, isFinal, OUTCOMES, YES } from '../../shared/antibiotic-form.js'

const router = express.Router()

// «استمارة صرف المضادات الحياتية» (../antibiotic-forms.js, ../../shared/antibiotic-form.js): one form per patient per ward
// stay. Same access as the ward's chart. A form stays open — editable on any later day — until its outcome is given; after
// that it is changed on the day it was last saved only (../day-lock.js), like every other form. Its date is the day it was
// begun, set here, never by the device.
export const MAX_EXPORT_DAYS = 92
const DAY_MS = 86400000
const toDay = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)

const SELECT = `SELECT f.id, f.ward_key, f.form_date::text AS form_date, f.patient_name, f.patient_id, f.fields, f.drugs, f.updated_at,
    (f.updated_at AT TIME ZONE 'Asia/Baghdad')::date::text AS updated_day, u.full_name AS created_by_name
  FROM antibiotic_forms f LEFT JOIN users u ON u.id = f.created_by`
const stored = (row) => cleanForm({ name: row.patient_name, patientId: row.patient_id, fields: row.fields, drugs: row.drugs })
const lockedFor = (user, row) => isFinal(row.fields) && isDayLocked(user, row.updated_day)
const toForm = (row, user) => {
  const form = stored(row)
  return {
    id: Number(row.id), formDate: row.form_date, ...form, updatedAt: row.updated_at.toISOString(), createdByName: row.created_by_name || '',
    final: isFinal(form.fields), missing: missingAnswers(form).map((item) => item.label), editable: !lockedFor(user, row),
  }
}
// A form still open (no outcome «نعم»), in SQL; `yes` is the parameter that holds «نعم». The keys are the module's constants.
const openSql = (yes) => `(${OUTCOMES.map((item) => `COALESCE(f.fields->>'${item.key}', '') <> ${yes}`).join(' AND ')})`
const wardOfKey = (wardKey) => { const [floor, ...ward] = String(wardKey).split('|'); return { floor: floor ? Number(floor) : null, ward: ward.join('|') } }

// The ward's patients on an antibiotic lately, what the charts and request forms say for each, and their saved forms.
router.get('/antibiotic-forms', requireAuth, async (request, response) => {
  const user = request.session.user
  const location = readLocation(request.query, user)
  if (location.status) return refuse(response, location)
  const { floor, wardName, chartDate } = location
  const wardKey = wardKeyOf(floor, wardName)
  const rows = await loadCourseRows(location, { names: await antibioticNames() })
  const drugKeys = [...new Set(rows.cells.map((cell) => antibioticOf(cell.medicine)?.key).filter(Boolean))]
  const overridesByDrug = new Map(await Promise.all(drugKeys.map(async (key) => [key, await loadOverrides(key)])))
  const ids = [...new Set(rows.cells.map((cell) => cell.patientId).filter(Boolean))]
  const [requests, forms] = await Promise.all([
    query(
      `SELECT id, kind, ward_key, request_date::text AS date, patient_name, patient_id, fields, ticks, note FROM drug_requests
       WHERE request_date BETWEEN $3::date - $4::int AND $3::date AND (ward_key = $1 OR patient_id = ANY($2::text[]))`,
      [wardKey, ids, chartDate, CARRY_DAYS],
    ),
    // The ward's open forms however old (a long stay), and the finished ones of the last FORM_DAYS — up to today, not the
    // date asked: a form belongs to a stay, so one begun after that date is still this patient's.
    query(`${SELECT} WHERE f.ward_key = $1 AND (f.form_date >= $2::date - $3::int OR ${openSql('$4')})`, [wardKey, chartDate, FORM_DAYS, YES]),
  ])
  const result = buildCandidates({
    rows, date: chartDate, overridesByDrug,
    requests: requests.rows.map((row) => ({ id: Number(row.id), kind: row.kind, wardKey: row.ward_key, date: row.date, name: row.patient_name, patientId: row.patient_id, fields: row.fields, ticks: row.ticks, note: row.note })),
    forms: forms.rows.map((row) => toForm(row, user)),
  })
  response.json({ date: chartDate, ...result })
})

// Save a form: the patient's open form on this ward (or the one named by `id`) is updated, else one is begun today.
// `updatedAt` is the version the device started from: a form changed since then is not overwritten (409, with the
// stored form) unless what is sent is exactly what is stored — a save replayed from the offline queue.
router.post('/antibiotic-forms', requireAuth, async (request, response) => {
  const user = request.session.user
  const today = todayInBaghdad()
  const location = readLocation({ ...request.body, date: today }, user)
  if (location.status) return refuse(response, location)
  const form = cleanForm(request.body)
  if (!form.name) return response.status(400).json({ message: 'اسم المريض مطلوب' })
  const wardKey = wardKeyOf(location.floor, location.wardName)
  const id = Number(request.body.id)
  const client = await pool.connect()
  let outcome
  try {
    await client.query('BEGIN')
    // One save per ward at a time, so two first saves of one patient (two devices, a replay racing its original) make one form.
    // ponytail: a per-ward lock; saves on one ward are seconds apart, so it never queues for long.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`antibiotic-form|${wardKey}`])
    const target = Number.isSafeInteger(id) && id > 0
      ? (await client.query(`${SELECT} WHERE f.id = $1 AND f.ward_key = $2`, [id, wardKey])).rows[0]
      // By ID, else by name when one side has none (as the request forms match a patient). An open form, or one finished
      // today (its save replayed, or completed again), or exactly this one: a patient back after a finished stay gets a new one.
      : (await client.query(
        `${SELECT} WHERE f.ward_key = $1 AND (f.form_date >= $2::date - $5::int OR ${openSql('$6')})
           AND (($3 <> '' AND f.patient_id = $3) OR (f.patient_name = $4 AND ($3 = '' OR f.patient_id = '')))
         ORDER BY f.updated_at DESC`,
        [wardKey, today, form.patientId, form.name, FORM_DAYS, YES],
      )).rows.find((row) => !isFinal(row.fields) || row.updated_day === today || JSON.stringify(stored(row)) === JSON.stringify({ ...form, patientId: form.patientId || row.patient_id }))
    const before = target && stored(target)
    // A save that names the form sends its رقم الطبلة as it is (cleared, too); one that does not keeps the stored one.
    const next = target && { ...form, patientId: id ? form.patientId : form.patientId || before.patientId }
    if (id && !target) outcome = { status: 404, body: { message: 'الاستمارة غير موجودة — ربما حُذفت' } }
    // Exactly what is stored: a replay, answered as the save it repeats (before the lock: it changes nothing).
    else if (target && JSON.stringify(next) === JSON.stringify(before)) outcome = { status: 200, row: target }
    else if (target && lockedFor(user, target)) outcome = { status: 403, body: DAY_LOCKED }
    else if (target) {
      if (!(Date.parse(request.body.updatedAt || '') >= target.updated_at.getTime())) {
        outcome = { status: 409, body: { message: 'عُدّلت هذه الاستمارة على جهاز آخر بعد أن فتحتها.', form: toForm(target, user) } }
      } else {
        await client.query(
          'UPDATE antibiotic_forms SET patient_name = $2, patient_id = $3, fields = $4, drugs = $5, updated_at = NOW() WHERE id = $1',
          [target.id, next.name, next.patientId, JSON.stringify(next.fields), JSON.stringify(next.drugs)],
        )
        outcome = { status: 200, id: target.id }
      }
    } else {
      const inserted = await client.query(
        `INSERT INTO antibiotic_forms (ward_key, form_date, patient_name, patient_id, fields, drugs, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [wardKey, today, form.name, form.patientId, JSON.stringify(form.fields), JSON.stringify(form.drugs), user.id],
      )
      outcome = { status: 201, id: inserted.rows[0].id }
    }
    if (outcome.id) outcome.row = (await client.query(`${SELECT} WHERE f.id = $1`, [outcome.id])).rows[0]
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
  if (!outcome.row) return response.status(outcome.status).json(outcome.body)
  const saved = toForm(outcome.row, user)
  response.status(outcome.status).json({ form: saved, missing: saved.missing })
})

router.delete('/antibiotic-forms/:id', requireAuth, async (request, response) => {
  const user = request.session.user
  const id = Number(request.params.id)
  const row = Number.isSafeInteger(id) && id > 0 ? (await query(`${SELECT} WHERE f.id = $1`, [id])).rows[0] : null
  if (!row) return response.status(404).json({ message: 'الاستمارة غير موجودة' })
  const { floor, ward } = wardOfKey(row.ward_key)
  if (!canAccessLocation(user, floor, ward)) return response.status(403).json({ message: 'لا تملك صلاحية لهذه الردهة' })
  if (lockedFor(user, row)) return refuse(response, { status: 403, ...DAY_LOCKED })
  await query('DELETE FROM antibiotic_forms WHERE id = $1', [id])
  response.json({ ok: true })
})

// Every form begun between two dates, hospital-wide, for the reports' Excel (built on the device: shared/antibiotic-form.js
// exportRows). No patient name goes into the audit line.
router.get('/antibiotic-forms/export', requireManager, async (request, response) => {
  const { from, to } = request.query
  if (!isIsoDate(from) || !isIsoDate(to)) return response.status(400).json({ message: 'التاريخ مطلوب' })
  if (from > to) return response.status(400).json({ message: 'تاريخ البداية بعد تاريخ النهاية' })
  if (toDay(to) - toDay(from) + 1 > MAX_EXPORT_DAYS) return response.status(400).json({ message: `المدة القصوى ${MAX_EXPORT_DAYS} يومًا` })
  const result = await query(`${SELECT} WHERE f.form_date BETWEEN $1::date AND $2::date ORDER BY f.form_date, f.ward_key, f.patient_name, f.id`, [from, to])
  const forms = result.rows.map((row) => ({ ...wardOfKey(row.ward_key), formDate: row.form_date, ...stored(row) }))
  await recordAudit(request, 'antibiotic-forms.exported', `${from} ← ${to}`, `${forms.length} استمارة`)
  response.json({ range: { from, to }, forms })
})

export default router
