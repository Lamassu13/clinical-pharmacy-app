import express from 'express'
import { pool, query } from '../db.js'
import { requireAuth, requireManager } from '../auth.js'
import {
  ALLOWED_FLOORS, MAX_PATIENT_ROWS, SPECIAL_WARDS, isKnownWard,
  canAccessLocation, clampInt, isIsoDate, cleanText,
  normalizeMedicineKey, medicineKeySql,
} from '../validation.js'

const router = express.Router()

// Look up the daily_charts row id for a (floor, ward, date), or null if none exists.
// Exported because the pills routes in index.js still call it.
const resolveChartId = async (floor, wardName, chartDate) => {
  const wardResult = await query('SELECT id FROM wards WHERE floor_number IS NOT DISTINCT FROM $1 AND name = $2 ORDER BY id LIMIT 1', [floor, wardName])
  if (!wardResult.rows[0]) return null
  const chartResult = await query('SELECT id FROM daily_charts WHERE ward_id = $1 AND chart_date = $2', [wardResult.rows[0].id, chartDate])
  return chartResult.rows[0] ? chartResult.rows[0].id : null
}

// Bulk-delete charts (floor-management screen). Irreversible: dropping a daily_charts row
// cascades to its patients, columns, quantities and both pill tables. Manager-gated, and it
// only ever touches whole (ward, date) charts inside the given inclusive date range — either
// every ward (`all`) or a chosen set of numbered floors and/or special wards.
router.post('/charts/purge', requireManager, async (request, response) => {
  const { from, to } = request.body
  if (!isIsoDate(from) || !isIsoDate(to)) return response.status(400).json({ message: 'التاريخ مطلوب' })
  if (from > to) return response.status(400).json({ message: 'تاريخ البداية بعد تاريخ النهاية' })
  const all = request.body.all === true
  const floors = Array.isArray(request.body.floors) ? [...new Set(request.body.floors.map(Number).filter((n) => ALLOWED_FLOORS.includes(n)))] : []
  const wards = Array.isArray(request.body.wards) ? [...new Set(request.body.wards.filter((w) => SPECIAL_WARDS.includes(w)))] : []
  if (!all && floors.length === 0 && wards.length === 0) return response.status(400).json({ message: 'اختر طابقًا واحدًا على الأقل أو كل الطوابق' })

  const result = all
    ? await query('DELETE FROM daily_charts WHERE chart_date >= $1 AND chart_date <= $2', [from, to])
    : await query(
      `DELETE FROM daily_charts
       WHERE chart_date >= $1 AND chart_date <= $2
         AND ward_id IN (SELECT id FROM wards WHERE floor_number = ANY($3::int[]) OR (floor_number IS NULL AND name = ANY($4::text[])))`,
      [from, to, floors, wards],
    )
  response.json({ deleted: result.rowCount })
})

router.get('/chart', requireAuth, async (request, response) => {
  const floor = request.query.floor ? clampInt(request.query.floor, 2, 10) : null
  const wardName = cleanText(request.query.ward, 120).trim()
  const chartDate = request.query.date
  if (request.query.floor && (floor === null || !ALLOWED_FLOORS.includes(floor))) return response.status(400).json({ message: 'الطابق غير مسموح' })
  if (!wardName || !isIsoDate(chartDate)) return response.status(400).json({ message: 'بيانات الردهة والتاريخ مطلوبة' })
  if (!isKnownWard(floor, wardName)) return response.status(400).json({ message: 'الردهة غير معروفة' })
  if (!canAccessLocation(request.session.user, floor, wardName)) return response.status(403).json({ message: 'لا تملك صلاحية لهذه الردهة' })
  const wardResult = await query('SELECT id, floor_number, name FROM wards WHERE floor_number IS NOT DISTINCT FROM $1 AND name = $2 ORDER BY id LIMIT 1', [floor, wardName])
  if (!wardResult.rows[0]) return response.json({ chart: null })
  const chartResult = await query('SELECT id FROM daily_charts WHERE ward_id = $1 AND chart_date = $2', [wardResult.rows[0].id, chartDate])
  if (!chartResult.rows[0]) return response.json({ chart: null })
  const chartId = chartResult.rows[0].id
  const [patients, columns, quantities, chartRow] = await Promise.all([
    query('SELECT row_number, patient_name FROM chart_patients WHERE chart_id = $1 ORDER BY row_number', [chartId]),
    query('SELECT cc.column_number, cc.medicine_id, COALESCE(m.name, cc.custom_name) AS medicine_name FROM chart_columns cc LEFT JOIN medicines m ON m.id = cc.medicine_id WHERE cc.chart_id = $1 ORDER BY cc.column_number', [chartId]),
    query('SELECT row_number, column_number, quantity FROM chart_quantities WHERE chart_id = $1', [chartId]),
    query('SELECT version FROM daily_charts WHERE id = $1', [chartId]),
  ])
  response.json({ chart: { patients: patients.rows, columns: columns.rows, quantities: quantities.rows, version: chartRow.rows[0].version } })
})
router.put('/chart', requireAuth, async (request, response) => {
  const floor = request.body.floor ? clampInt(request.body.floor, 2, 10) : null
  const wardName = cleanText(request.body.ward, 120).trim()
  const chartDate = request.body.date
  if (request.body.floor && (floor === null || !ALLOWED_FLOORS.includes(floor))) return response.status(400).json({ message: 'الطابق غير مسموح' })
  if (!wardName || !isIsoDate(chartDate)) return response.status(400).json({ message: 'بيانات الردهة والتاريخ مطلوبة' })
  if (!isKnownWard(floor, wardName)) return response.status(400).json({ message: 'الردهة غير معروفة' })
  if (!canAccessLocation(request.session.user, floor, wardName)) return response.status(403).json({ message: 'لا تملك صلاحية لهذه الردهة' })

  const patients = (Array.isArray(request.body.patients) ? request.body.patients : [])
    .map((patient) => ({ rowNumber: clampInt(patient?.rowNumber, 1, MAX_PATIENT_ROWS), name: cleanText(patient?.name, 200) }))
    .filter((patient) => patient.rowNumber !== null)
  const columns = (Array.isArray(request.body.columns) ? request.body.columns : [])
    .map((column) => ({ columnNumber: clampInt(column?.columnNumber, 1, 51), medicineName: cleanText(column?.medicineName, 200).trim() }))
    .filter((column) => column.columnNumber !== null)
  const quantities = (Array.isArray(request.body.quantities) ? request.body.quantities : [])
    .map((entry) => ({ rowNumber: clampInt(entry?.rowNumber, 1, MAX_PATIENT_ROWS), columnNumber: clampInt(entry?.columnNumber, 1, 51), quantity: clampInt(entry?.quantity, 0, 1_000_000) }))
    .filter((entry) => entry.rowNumber !== null && entry.columnNumber !== null && entry.quantity !== null)
  // 0 means "I have no chart yet" — the correct baseline for a first save, since a plain
  // INSERT with no existing row always succeeds regardless of this value.
  const expectedVersion = clampInt(request.body.expectedVersion, 0, Number.MAX_SAFE_INTEGER) ?? 0

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Select-then-insert: ON CONFLICT (floor_number, name) never matches when
    // floor_number IS NULL (special wards), which would create duplicates.
    let wardRow = (await client.query('SELECT id FROM wards WHERE floor_number IS NOT DISTINCT FROM $1 AND name = $2 ORDER BY id LIMIT 1', [floor, wardName])).rows[0]
    if (!wardRow) {
      wardRow = (await client.query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, $3) RETURNING id', [floor, wardName, floor === null])).rows[0]
    }
    // Optimistic concurrency: an UPDATE only applies (and only then does the WHERE let the
    // row through to RETURNING) when this client's expectedVersion still matches what's in
    // the database. A first-ever save for this ward/date hits the plain INSERT branch
    // instead — there's no existing row to conflict with, so it always succeeds. Losing the
    // race here rolls back before any of the patients/columns/quantities tables are touched.
    const chartResult = await client.query(
      `INSERT INTO daily_charts (ward_id, chart_date, created_by, updated_by, version) VALUES ($1, $2, $3, $3, 1)
       ON CONFLICT (ward_id, chart_date) DO UPDATE
         SET updated_by = EXCLUDED.updated_by, updated_at = NOW(), version = daily_charts.version + 1
         WHERE daily_charts.version = $4
       RETURNING id, version`,
      [wardRow.id, chartDate, request.session.user.id, expectedVersion],
    )
    if (!chartResult.rows[0]) {
      await client.query('ROLLBACK')
      return response.status(409).json({ message: 'الجارت تغيّر من جهاز آخر، يجري تحديثه', conflict: true })
    }
    const chartId = chartResult.rows[0].id
    await client.query('DELETE FROM chart_patients WHERE chart_id = $1', [chartId])
    await client.query('DELETE FROM chart_columns WHERE chart_id = $1', [chartId])
    await client.query('DELETE FROM chart_quantities WHERE chart_id = $1', [chartId])

    // Batched set-based inserts (UNNEST) instead of one query per row: a full
    // 36x51 chart is ~8 round-trips instead of ~2000, so the pooled connection
    // is held for milliseconds. De-dupe on the natural keys first so a single
    // repeated key in the payload can't abort the whole save.
    const patientByRow = new Map(patients.map((patient) => [patient.rowNumber, patient.name]))
    if (patientByRow.size) {
      await client.query('INSERT INTO chart_patients (chart_id, row_number, patient_name) SELECT $1, rn, name FROM UNNEST($2::int[], $3::text[]) AS u(rn, name)', [chartId, [...patientByRow.keys()], [...patientByRow.values()]])
    }

    // A column may only name a medicine that already exists in the shared catalogue, matched
    // ignoring case and repeated spaces — "amoxicillin  cap" and "Amoxicillin Cap" are one
    // medicine to a pharmacist. A column whose text matches nothing is simply dropped (no
    // custom_name is ever written from the chart): the client rejects unknown names at the
    // input, and this is the backstop so typing in the chart can never introduce a medicine.
    const medicineByColumn = new Map(columns.map((column) => [column.columnNumber, column.medicineName]))
    const wantedKeys = [...new Set([...medicineByColumn.values()].filter(Boolean).map(normalizeMedicineKey))]
    const idByKey = new Map()
    if (wantedKeys.length) {
      // A catalogue predating the duplicate check can hold two rows with one key; the oldest
      // wins, so the same typed column always links to the same row rather than alternating.
      const known = await client.query(`SELECT id, name FROM medicines WHERE ${medicineKeySql('name')} = ANY($1::text[]) ORDER BY id`, [wantedKeys])
      known.rows.forEach((row) => { const key = normalizeMedicineKey(row.name); if (!idByKey.has(key)) idByKey.set(key, row.id) })
    }
    const linkedColumns = [...medicineByColumn.keys()]
      .map((columnNumber) => ({ columnNumber, medicineId: idByKey.get(normalizeMedicineKey(medicineByColumn.get(columnNumber))) ?? null }))
      .filter((entry) => entry.medicineId !== null)
    if (linkedColumns.length) {
      await client.query(
        'INSERT INTO chart_columns (chart_id, column_number, medicine_id, custom_name) SELECT $1, cn, mid, NULL FROM UNNEST($2::int[], $3::bigint[]) AS u(cn, mid)',
        [chartId, linkedColumns.map((entry) => entry.columnNumber), linkedColumns.map((entry) => entry.medicineId)],
      )
    }

    const quantityByCell = new Map(quantities.map((entry) => [`${entry.rowNumber}:${entry.columnNumber}`, entry]))
    const quantityList = [...quantityByCell.values()]
    if (quantityList.length) {
      await client.query('INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) SELECT $1, rn, cn, qty FROM UNNEST($2::int[], $3::int[], $4::int[]) AS u(rn, cn, qty)', [chartId, quantityList.map((entry) => entry.rowNumber), quantityList.map((entry) => entry.columnNumber), quantityList.map((entry) => entry.quantity)])
    }
    await client.query('COMMIT')
    response.json({ ok: true, chartId, version: chartResult.rows[0].version })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('chart save failed:', error)
    response.status(400).json({ message: 'تعذر حفظ الجارت' })
  } finally { client.release() }
})

// Deleting a patient's name in the chart pulls every row below it up one. The pill form's
// dose times and room numbers are keyed by that row number and live only in the database, so
// without this they stay behind and reattach to whoever moves up into the row — a room number
// on the wrong patient's printed administration form. Reinsert rather than UPDATE ... - 1:
// the primary key is checked per row, so shifting rows in an unspecified order collides.
router.post('/chart/collapse-row', requireAuth, async (request, response) => {
  const floor = request.body.floor ? clampInt(request.body.floor, 2, 10) : null
  const wardName = cleanText(request.body.ward, 120).trim()
  const chartDate = request.body.date
  const rowNumber = clampInt(request.body.rowNumber, 1, MAX_PATIENT_ROWS)
  if (request.body.floor && (floor === null || !ALLOWED_FLOORS.includes(floor))) return response.status(400).json({ message: 'الطابق غير مسموح' })
  if (!wardName || !isIsoDate(chartDate) || rowNumber === null) return response.status(400).json({ message: 'بيانات الردهة والتاريخ والصف مطلوبة' })
  if (!isKnownWard(floor, wardName)) return response.status(400).json({ message: 'الردهة غير معروفة' })
  if (!canAccessLocation(request.session.user, floor, wardName)) return response.status(403).json({ message: 'لا تملك صلاحية لهذه الردهة' })
  const chartId = await resolveChartId(floor, wardName, chartDate)
  // Nothing saved for this day yet, so there is no pill data to keep in step.
  if (!chartId) return response.json({ ok: true })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const entries = await client.query('SELECT patient_row_number, medicine_key, dose_time, usage_method, note FROM pill_entries WHERE chart_id = $1 AND patient_row_number > $2 ORDER BY patient_row_number', [chartId, rowNumber])
    const rooms = await client.query('SELECT patient_row_number, room_number FROM pill_patient_meta WHERE chart_id = $1 AND patient_row_number > $2 ORDER BY patient_row_number', [chartId, rowNumber])
    await client.query('DELETE FROM pill_entries WHERE chart_id = $1 AND patient_row_number >= $2', [chartId, rowNumber])
    await client.query('DELETE FROM pill_patient_meta WHERE chart_id = $1 AND patient_row_number >= $2', [chartId, rowNumber])
    if (entries.rowCount) {
      await client.query(
        'INSERT INTO pill_entries (chart_id, patient_row_number, medicine_key, dose_time, usage_method, note) SELECT $1, prn, mk, dt, um, nt FROM UNNEST($2::int[], $3::text[], $4::text[], $5::text[], $6::text[]) AS u(prn, mk, dt, um, nt)',
        [chartId, entries.rows.map((row) => row.patient_row_number - 1), entries.rows.map((row) => row.medicine_key), entries.rows.map((row) => row.dose_time), entries.rows.map((row) => row.usage_method), entries.rows.map((row) => row.note)],
      )
    }
    if (rooms.rowCount) {
      await client.query(
        'INSERT INTO pill_patient_meta (chart_id, patient_row_number, room_number) SELECT $1, prn, rn FROM UNNEST($2::int[], $3::text[]) AS u(prn, rn)',
        [chartId, rooms.rows.map((row) => row.patient_row_number - 1), rooms.rows.map((row) => row.room_number)],
      )
    }
    await client.query('COMMIT')
    response.json({ ok: true })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('collapse row failed:', error)
    response.status(500).json({ message: 'تعذر إزاحة بيانات الحبوب' })
  } finally { client.release() }
})

export { resolveChartId }
export default router
