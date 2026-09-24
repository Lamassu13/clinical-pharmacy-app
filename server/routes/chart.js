import express from 'express'
import { pool, query } from '../db.js'
import { requireAuth, requireManager } from '../auth.js'
import {
  ALLOWED_FLOORS, MAX_PATIENT_ROWS, MAX_CHART_COLUMNS, SPECIAL_WARDS, isKnownWard,
  canAccessLocation, clampInt, isIsoDate, cleanText,
  normalizeMedicineKey, medicineKeySql,
} from '../validation.js'
import { numberToArabicWords } from '../arabic-number.js'
import { buildMeropenemForm, windowStart, MEROPENEM_SQL_PATTERN } from '../meropenem.js'

const router = express.Router()

// A ward/day holds a 'main' chart and, optionally, an 'extra' one ("الجارت الإضافي").
export const CHART_SLOTS = ['main', 'extra']
export const readSlot = (value) => (CHART_SLOTS.includes(value) ? value : 'main')

// Per-session edit lock (chart_locks). A lock whose heartbeat has been silent this long is
// treated as free — the ~30s client heartbeat means 4 missed beats releases it.
const LOCK_TTL_SECONDS = 120

// The floor/ward/date/slot every chart-scoped route (chart, lock, order, pills) is addressed by,
// validated and access-checked. `source` is the query or the body. Returns { status, message }
// on rejection, { floor, wardName, chartDate, slot } otherwise.
export const readLocation = (source, user) => {
  const floor = source.floor ? clampInt(source.floor, 2, 10) : null
  const wardName = cleanText(source.ward, 120).trim()
  const chartDate = source.date
  if (source.floor && (floor === null || !ALLOWED_FLOORS.includes(floor))) return { status: 400, message: 'الطابق غير مسموح' }
  if (!wardName || !isIsoDate(chartDate)) return { status: 400, message: 'بيانات الردهة والتاريخ مطلوبة' }
  if (!isKnownWard(floor, wardName)) return { status: 400, message: 'الردهة غير معروفة' }
  if (!canAccessLocation(user, floor, wardName)) return { status: 403, message: 'لا تملك صلاحية لهذه الردهة' }
  return { floor, wardName, chartDate, slot: readSlot(source.slot) }
}

// readLocation plus the ward_id the lock is keyed by — null when this ward has never been
// touched (no wards row yet).
const resolveLockTarget = async (source, user) => {
  const target = readLocation(source, user)
  if (target.status) return target
  const wardResult = await query('SELECT id FROM wards WHERE floor_number IS NOT DISTINCT FROM $1 AND name = $2 ORDER BY id LIMIT 1', [target.floor, target.wardName])
  return { ...target, wardId: wardResult.rows[0]?.id ?? null }
}

// ponytail: a brand-new special ward (floor_number IS NULL, no unique across NULLs) touched by
// two devices at the exact same first moment could create two wards rows and two locks. Rare,
// and self-healing — the next chart save resolves to one ward_id and the other lock TTLs out.
const ensureWardId = async (floor, wardName) => {
  const existing = await query('SELECT id FROM wards WHERE floor_number IS NOT DISTINCT FROM $1 AND name = $2 ORDER BY id LIMIT 1', [floor, wardName])
  if (existing.rows[0]) return existing.rows[0].id
  const created = await query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, $3) RETURNING id', [floor, wardName, floor === null])
  return created.rows[0].id
}

const readLock = async (wardId, chartDate, slot) => {
  if (!wardId) return null
  // LOCK_TTL_SECONDS is a hardcoded integer constant, safe to inline.
  const result = await query(
    `SELECT holder_id, holder_name, acquired_at,
            (heartbeat_at > NOW() - make_interval(secs => ${LOCK_TTL_SECONDS})) AS fresh
     FROM chart_locks WHERE ward_id = $1 AND chart_date = $2 AND slot = $3`,
    [wardId, chartDate, slot],
  )
  return result.rows[0] || null
}

const lockView = (row, userId) => (row && row.fresh
  ? { held: true, mine: row.holder_id === userId, holder: { name: row.holder_name, since: row.acquired_at } }
  : { held: false, mine: false, holder: null })

// Look up the daily_charts row id for a (floor, ward, date, slot), or null if none exists.
// Exported because the pills routes in index.js still call it.
const resolveChartId = async (floor, wardName, chartDate, slot = 'main') => {
  const wardResult = await query('SELECT id FROM wards WHERE floor_number IS NOT DISTINCT FROM $1 AND name = $2 ORDER BY id LIMIT 1', [floor, wardName])
  if (!wardResult.rows[0]) return null
  const chartResult = await query('SELECT id FROM daily_charts WHERE ward_id = $1 AND chart_date = $2 AND slot = $3', [wardResult.rows[0].id, chartDate, readSlot(slot)])
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
  const location = readLocation(request.query, request.session.user)
  if (location.status) return response.status(location.status).json({ message: location.message })
  const { floor, wardName, chartDate, slot } = location
  const wardResult = await query('SELECT id, floor_number, name FROM wards WHERE floor_number IS NOT DISTINCT FROM $1 AND name = $2 ORDER BY id LIMIT 1', [floor, wardName])
  const wardId = wardResult.rows[0]?.id ?? null
  // The read-only device polls this too, so the lock rides along on every GET.
  const lock = lockView(await readLock(wardId, chartDate, slot), request.session.user.id)
  if (!wardId) return response.json({ chart: null, lock })
  const chartResult = await query('SELECT id FROM daily_charts WHERE ward_id = $1 AND chart_date = $2 AND slot = $3', [wardId, chartDate, slot])
  if (!chartResult.rows[0]) return response.json({ chart: null, lock })
  const chartId = chartResult.rows[0].id
  const [patients, columns, quantities, chartRow] = await Promise.all([
    query('SELECT row_number, patient_name, patient_id FROM chart_patients WHERE chart_id = $1 ORDER BY row_number', [chartId]),
    query('SELECT cc.column_number, cc.medicine_id, COALESCE(m.name, cc.custom_name) AS medicine_name FROM chart_columns cc LEFT JOIN medicines m ON m.id = cc.medicine_id WHERE cc.chart_id = $1 ORDER BY cc.column_number', [chartId]),
    query('SELECT row_number, column_number, quantity FROM chart_quantities WHERE chart_id = $1', [chartId]),
    query('SELECT dc.version, dc.completed_at, dc.completed_by, u.full_name AS completed_by_name FROM daily_charts dc LEFT JOIN users u ON u.id = dc.completed_by WHERE dc.id = $1', [chartId]),
  ])
  response.json({ chart: {
    patients: patients.rows, columns: columns.rows, quantities: quantities.rows,
    version: chartRow.rows[0].version,
    completedAt: chartRow.rows[0].completed_at, completedBy: chartRow.rows[0].completed_by, completedByName: chartRow.rows[0].completed_by_name,
  }, lock })
})

// Acquire (or re-affirm) the edit lock. Granted when the chart is free, when the current
// lock has gone stale, or when it is already this user's. Otherwise 200 with { ok: false }
// and who holds it, so the client can drop into read-only.
// Also the heartbeat (PATCH): re-claiming a free lock matters there too. iPad Safari fires
// pagehide — which releases the lock — when it parks a tab in the back/forward cache, and a
// resumed tab whose heartbeat could only refresh an existing row stayed 'stale' for good while
// any other device was free to take the chart.
const acquireLock = async (request, response) => {
  const target = await resolveLockTarget(request.body, request.session.user)
  if (target.status) return response.status(target.status).json({ message: target.message })
  const wardId = target.wardId ?? await ensureWardId(target.floor, target.wardName)
  const user = request.session.user
  const granted = await query(
    `INSERT INTO chart_locks (ward_id, chart_date, slot, holder_id, holder_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (ward_id, chart_date, slot) DO UPDATE
       SET holder_id = EXCLUDED.holder_id, holder_name = EXCLUDED.holder_name,
           acquired_at = NOW(), heartbeat_at = NOW()
       WHERE chart_locks.holder_id = EXCLUDED.holder_id
          OR chart_locks.heartbeat_at < NOW() - make_interval(secs => ${LOCK_TTL_SECONDS})
     RETURNING holder_id`,
    [wardId, target.chartDate, target.slot, user.id, user.fullName],
  )
  if (granted.rows[0]) return response.json({ ok: true })
  response.json({ ok: false, ...lockView(await readLock(wardId, target.chartDate, target.slot), user.id) })
}
router.post('/chart/lock', requireAuth, acquireLock)
// Heartbeat. { ok: false } means another device holds a fresh lock; the client keeps editing
// locally and a save will 409 into the merge fallback.
router.patch('/chart/lock', requireAuth, acquireLock)

// Release — on back-out / tab-close. Idempotent.
router.delete('/chart/lock', requireAuth, async (request, response) => {
  const target = await resolveLockTarget(request.query, request.session.user)
  if (target.status) return response.status(target.status).json({ message: target.message })
  if (target.wardId) {
    await query('DELETE FROM chart_locks WHERE ward_id = $1 AND chart_date = $2 AND slot = $3 AND holder_id = $4', [target.wardId, target.chartDate, target.slot, request.session.user.id])
  }
  response.json({ ok: true })
})

// Status only — the read-only device's poll when it is not holding the lock.
router.get('/chart/lock', requireAuth, async (request, response) => {
  const target = await resolveLockTarget(request.query, request.session.user)
  if (target.status) return response.status(target.status).json({ message: target.message })
  response.json(lockView(await readLock(target.wardId, target.chartDate, target.slot), request.session.user.id))
})

// Manual "اكتمل الجارت" mark — a pharmacist's own signal, not inferred from chart content.
// Independent of PUT /chart's heavy patients/columns/quantities payload and its optimistic-
// concurrency version check on purpose: this is a small, low-frequency toggle, and keeping it
// out of that save path avoids touching the merge/conflict machinery it relies on.
router.patch('/chart/complete', requireAuth, async (request, response) => {
  const target = await resolveLockTarget(request.body, request.session.user)
  if (target.status) return response.status(target.status).json({ message: target.message })
  const completed = request.body.completed === true
  const wardId = target.wardId ?? await ensureWardId(target.floor, target.wardName)
  const user = request.session.user
  // No `version` touched here — it stays at the schema DEFAULT 0, so marking a brand-new
  // chart complete before its first real save still matches that first PUT's expectedVersion=0.
  const result = await query(
    `INSERT INTO daily_charts (ward_id, chart_date, slot, created_by, updated_by, completed_at, completed_by)
     VALUES ($1, $2, $3, $4, $4, $5, $6)
     ON CONFLICT (ward_id, chart_date, slot) DO UPDATE
       SET completed_at = $5, completed_by = $6
     RETURNING completed_at, completed_by`,
    [wardId, target.chartDate, target.slot, user.id, completed ? new Date() : null, completed ? user.id : null],
  )
  const row = result.rows[0]
  response.json({ ok: true, completedAt: row.completed_at, completedBy: row.completed_by, completedByName: completed ? user.fullName : null })
})

router.put('/chart', requireAuth, async (request, response) => {
  const location = readLocation(request.body, request.session.user)
  if (location.status) return response.status(location.status).json({ message: location.message })
  const { floor, wardName, chartDate, slot } = location

  const patients = (Array.isArray(request.body.patients) ? request.body.patients : [])
    .map((patient) => ({
      rowNumber: clampInt(patient?.rowNumber, 1, MAX_PATIENT_ROWS),
      name: cleanText(patient?.name, 200),
      // An integer ID, kept as its digits (a leading zero is part of a hospital number).
      patientId: String(patient?.patientId ?? '').replace(/\D/g, '').slice(0, 20),
    }))
    .filter((patient) => patient.rowNumber !== null)
  const columns = (Array.isArray(request.body.columns) ? request.body.columns : [])
    .map((column) => ({ columnNumber: clampInt(column?.columnNumber, 1, MAX_CHART_COLUMNS), medicineName: cleanText(column?.medicineName, 200).trim() }))
    .filter((column) => column.columnNumber !== null)
  const quantities = (Array.isArray(request.body.quantities) ? request.body.quantities : [])
    .map((entry) => ({ rowNumber: clampInt(entry?.rowNumber, 1, MAX_PATIENT_ROWS), columnNumber: clampInt(entry?.columnNumber, 1, MAX_CHART_COLUMNS), quantity: clampInt(entry?.quantity, 0, 1_000_000) }))
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
      `INSERT INTO daily_charts (ward_id, chart_date, slot, created_by, updated_by, version) VALUES ($1, $2, $5, $3, $3, 1)
       ON CONFLICT (ward_id, chart_date, slot) DO UPDATE
         SET updated_by = EXCLUDED.updated_by, updated_at = NOW(), version = daily_charts.version + 1
         WHERE daily_charts.version = $4
       RETURNING id, version`,
      [wardRow.id, chartDate, request.session.user.id, expectedVersion, slot],
    )
    if (!chartResult.rows[0]) {
      await client.query('ROLLBACK')
      return response.status(409).json({ message: 'الجارت تغيّر من جهاز آخر، يجري تحديثه', conflict: true })
    }
    const chartId = chartResult.rows[0].id
    // A column preserved after its medicine was deleted from the catalogue carries the old
    // name as custom_name (see DELETE /api/medicines/:id) precisely so it survives being
    // reloaded and resaved. Read that out before the delete+reinsert below wipes it, so a
    // column whose text doesn't match anything in the *current* catalogue can still be told
    // apart from a genuinely bogus name: "this chart already had exactly this preserved name"
    // vs. "this text has never matched any medicine, drop it" (the backstop two lines down).
    const existingCustom = await client.query('SELECT column_number, custom_name FROM chart_columns WHERE chart_id = $1 AND custom_name IS NOT NULL', [chartId])
    const customNameByColumn = new Map(existingCustom.rows.map((row) => [row.column_number, row.custom_name]))
    await client.query('DELETE FROM chart_patients WHERE chart_id = $1', [chartId])
    await client.query('DELETE FROM chart_columns WHERE chart_id = $1', [chartId])
    await client.query('DELETE FROM chart_quantities WHERE chart_id = $1', [chartId])

    // Batched set-based inserts (UNNEST) instead of one query per row: a full
    // 36x51 chart is ~8 round-trips instead of ~2000, so the pooled connection
    // is held for milliseconds. De-dupe on the natural keys first so a single
    // repeated key in the payload can't abort the whole save.
    const patientByRow = new Map(patients.map((patient) => [patient.rowNumber, patient]))
    if (patientByRow.size) {
      const rows = [...patientByRow.values()]
      await client.query('INSERT INTO chart_patients (chart_id, row_number, patient_name, patient_id) SELECT $1, rn, name, pid FROM UNNEST($2::int[], $3::text[], $4::text[]) AS u(rn, name, pid)', [chartId, rows.map((row) => row.rowNumber), rows.map((row) => row.name), rows.map((row) => row.patientId)])
    }

    // A column may only name a medicine that already exists in the shared catalogue, matched
    // ignoring case and repeated spaces — "amoxicillin  cap" and "Amoxicillin Cap" are one
    // medicine to a pharmacist. A column whose text matches nothing in the catalogue is
    // dropped UNLESS it's exactly the custom_name this same column already carried (read
    // above) — that's not bogus input, it's a medicine deleted from the catalogue after this
    // chart used it, and the client is just resending what it loaded. Everything else — the
    // client rejects unknown names at the input — still gets dropped as the backstop against
    // typing in the chart ever introducing a medicine on its own.
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
      .map((columnNumber) => {
        const medicineName = medicineByColumn.get(columnNumber)
        const medicineId = idByKey.get(normalizeMedicineKey(medicineName)) ?? null
        const preservedCustomName = medicineId === null && medicineName && customNameByColumn.get(columnNumber) === medicineName ? medicineName : null
        return { columnNumber, medicineId, customName: preservedCustomName }
      })
      .filter((entry) => entry.medicineId !== null || entry.customName !== null)
    if (linkedColumns.length) {
      await client.query(
        'INSERT INTO chart_columns (chart_id, column_number, medicine_id, custom_name) SELECT $1, cn, mid, cname FROM UNNEST($2::int[], $3::bigint[], $4::text[]) AS u(cn, mid, cname)',
        [chartId, linkedColumns.map((entry) => entry.columnNumber), linkedColumns.map((entry) => entry.medicineId), linkedColumns.map((entry) => entry.customName)],
      )
    }

    // A column with no linked medicine (blank, or a name outside the catalogue) never gets a
    // chart_columns row above — its quantities are dropped the same way, so a cleared column
    // can never leave orphaned numbers behind server-side regardless of what the client sent.
    const linkedColumnNumbers = new Set(linkedColumns.map((entry) => entry.columnNumber))
    const quantityByCell = new Map(quantities.map((entry) => [`${entry.rowNumber}:${entry.columnNumber}`, entry]))
    const quantityList = [...quantityByCell.values()].filter((entry) => linkedColumnNumbers.has(entry.columnNumber))
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
  const location = readLocation(request.body, request.session.user)
  if (location.status) return response.status(location.status).json({ message: location.message })
  const { floor, wardName, chartDate, slot } = location
  const rowNumber = clampInt(request.body.rowNumber, 1, MAX_PATIENT_ROWS)
  if (rowNumber === null) return response.status(400).json({ message: 'الصف مطلوب' })
  const chartId = await resolveChartId(floor, wardName, chartDate, slot)
  // Nothing saved for this day yet, so there is no pill data to keep in step.
  if (!chartId) return response.json({ ok: true })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const entries = await client.query('SELECT patient_row_number, medicine_key, dose_time, usage_method, note, pill_qty, pill_name FROM pill_entries WHERE chart_id = $1 AND patient_row_number > $2 ORDER BY patient_row_number', [chartId, rowNumber])
    const rooms = await client.query('SELECT patient_row_number, room_number FROM pill_patient_meta WHERE chart_id = $1 AND patient_row_number > $2 ORDER BY patient_row_number', [chartId, rowNumber])
    await client.query('DELETE FROM pill_entries WHERE chart_id = $1 AND patient_row_number >= $2', [chartId, rowNumber])
    await client.query('DELETE FROM pill_patient_meta WHERE chart_id = $1 AND patient_row_number >= $2', [chartId, rowNumber])
    if (entries.rowCount) {
      await client.query(
        'INSERT INTO pill_entries (chart_id, patient_row_number, medicine_key, dose_time, usage_method, note, pill_qty, pill_name) SELECT $1, prn, mk, dt, um, nt, pq, pn FROM UNNEST($2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) AS u(prn, mk, dt, um, nt, pq, pn)',
        [chartId, entries.rows.map((row) => row.patient_row_number - 1), entries.rows.map((row) => row.medicine_key), entries.rows.map((row) => row.dose_time), entries.rows.map((row) => row.usage_method), entries.rows.map((row) => row.note), entries.rows.map((row) => row.pill_qty), entries.rows.map((row) => row.pill_name)],
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

// The requisition ("الطلبية"): one line per medicine on the ward's MAIN chart for the day,
// quantity summed across every patient, plus the same total spelled out in Arabic. Read-only
// and fully derived — nothing is stored.
router.get('/order', requireAuth, async (request, response) => {
  const location = readLocation(request.query, request.session.user)
  if (location.status) return response.status(location.status).json({ message: location.message })
  const { floor, wardName, chartDate, slot } = location
  const chartId = await resolveChartId(floor, wardName, chartDate, slot)
  // Thursday means a 2-day supply (Friday is the ward's day off) — the chart itself shows a
  // second "المجموع المضاعف" total alongside the normal one on Thursday; the requisition
  // mirrors that with a doubled quantity alongside the normal one, not in place of it.
  const isThursday = new Date(`${chartDate}T12:00:00`).getDay() === 4
  if (!chartId) return response.json({ order: { items: [], isThursday } })
  const rows = await query(
    `SELECT COALESCE(m.name, cc.custom_name) AS name, SUM(cq.quantity)::int AS quantity,
            bool_or(COALESCE(m.no_thursday_double, FALSE)) AS no_double
     FROM chart_columns cc
     JOIN chart_quantities cq ON cq.chart_id = cc.chart_id AND cq.column_number = cc.column_number
     LEFT JOIN medicines m ON m.id = cc.medicine_id
     WHERE cc.chart_id = $1
     GROUP BY COALESCE(m.name, cc.custom_name)
     HAVING COALESCE(m.name, cc.custom_name) <> '' AND SUM(cq.quantity) > 0
     ORDER BY MIN(cc.column_number)`,
    [chartId],
  )
  response.json({
    order: {
      isThursday,
      items: rows.rows.map((row) => ({
        name: row.name,
        quantity: row.quantity,
        quantityWords: numberToArabicWords(row.quantity),
        // A medicine ticked «لا يُضاعف يوم الخميس» repeats its normal quantity.
        ...(isThursday ? { doubledQuantity: row.quantity * (row.no_double ? 1 : 2), doubledQuantityWords: numberToArabicWords(row.quantity * (row.no_double ? 1 : 2)) } : {}),
      })),
    },
  })
})

// «استمارة متابعة الميروبينيم»: every patient on Meronem this month on this ward (main and extra
// charts), with each day's course number. Read-only and fully derived — see ../meropenem.js.
router.get('/meropenem', requireAuth, async (request, response) => {
  const location = readLocation(request.query, request.session.user)
  if (location.status) return response.status(location.status).json({ message: location.message })
  const { floor, wardName, chartDate } = location
  const from = windowStart(chartDate)
  const params = [floor, wardName, from, chartDate]
  const [cellRows, chartedRows] = await Promise.all([
    query(
      `SELECT dc.chart_date::text AS date, cp.patient_name AS name, cp.patient_id, COALESCE(m.name, cc.custom_name) AS medicine, cq.quantity
       FROM daily_charts dc
       JOIN wards w ON w.id = dc.ward_id
       JOIN chart_patients cp ON cp.chart_id = dc.id
       JOIN chart_quantities cq ON cq.chart_id = dc.id AND cq.row_number = cp.row_number
       JOIN chart_columns cc ON cc.chart_id = dc.id AND cc.column_number = cq.column_number
       LEFT JOIN medicines m ON m.id = cc.medicine_id
       WHERE w.floor_number IS NOT DISTINCT FROM $1 AND w.name = $2 AND dc.chart_date BETWEEN $3::date AND $4::date
         AND cq.quantity > 0 AND COALESCE(m.name, cc.custom_name) ~* $5
         AND (btrim(cp.patient_name) <> '' OR cp.patient_id <> '')
       ORDER BY dc.chart_date, cp.row_number`,
      [...params, MEROPENEM_SQL_PATTERN],
    ),
    // Days the ward has a chart at all — a charted day without Meronem ends a course, a day with
    // no chart (Friday) does not.
    query(
      `SELECT DISTINCT dc.chart_date::text AS date
       FROM daily_charts dc
       JOIN wards w ON w.id = dc.ward_id
       WHERE w.floor_number IS NOT DISTINCT FROM $1 AND w.name = $2 AND dc.chart_date BETWEEN $3::date AND $4::date
         AND EXISTS (SELECT 1 FROM chart_patients cp WHERE cp.chart_id = dc.id AND cp.patient_name <> '')`,
      params,
    ),
  ])
  response.json({ form: buildMeropenemForm({
    date: chartDate,
    cells: cellRows.rows.map((row) => ({ date: row.date, name: row.name, patientId: row.patient_id, medicine: row.medicine, quantity: row.quantity })),
    chartedDates: chartedRows.rows.map((row) => row.date),
  }) })
})

export { resolveChartId }
export default router
