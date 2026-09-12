import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

const DATE = '2026-04-15'
const NEXT_DAY = '2026-04-16'
const FIVE_DAYS_AGO = '2026-04-10'
const THREE_WEEKS_AGO = '2026-03-26'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(() => resetDatabase())

const loginAs = async (userOptions) => {
  const user = await createUser(userOptions)
  const client = new ApiClient(baseUrl)
  const login = await client.post('/api/auth/login', { username: user.username, password: user.password })
  assert.equal(login.status, 200, 'test setup: login must succeed')
  return client
}

// Seeds one chart directly (bypassing the API) so the dashboard aggregation has real rows to
// read. `patients`/`quantities` default to one of each, which is what makes a ward count as
// "started"; pass [] explicitly to seed a chart that was only opened.
const seedChart = async ({ floor, ward, date, createdBy, columns = [], quantities = [{ rowNumber: 1, columnNumber: 1, quantity: 1 }], patients = [{ rowNumber: 1, name: 'مريض' }] }) => {
  const wardRow = (await pool.query(
    'INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, $3) RETURNING id',
    [floor, ward, floor === null],
  )).rows[0]
  const chartRow = (await pool.query(
    'INSERT INTO daily_charts (ward_id, chart_date, created_by, updated_by, version) VALUES ($1, $2, $3, $3, 1) RETURNING id',
    [wardRow.id, date, createdBy],
  )).rows[0]
  for (const patient of patients) {
    await pool.query('INSERT INTO chart_patients (chart_id, row_number, patient_name) VALUES ($1, $2, $3)', [chartRow.id, patient.rowNumber, patient.name])
  }
  for (const column of columns) {
    await pool.query('INSERT INTO chart_columns (chart_id, column_number, medicine_id, custom_name) VALUES ($1, $2, $3, $4)', [chartRow.id, column.columnNumber, column.medicineId ?? null, column.customName ?? null])
  }
  for (const quantity of quantities) {
    await pool.query('INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) VALUES ($1, $2, $3, $4)', [chartRow.id, quantity.rowNumber, quantity.columnNumber, quantity.quantity])
  }
  return chartRow.id
}

test('GET /api/dashboard: refuses an anonymous request and a missing/malformed date', async () => {
  const anon = new ApiClient(baseUrl)
  assert.equal((await anon.get(`/api/dashboard?date=${DATE}`)).status, 401)

  const client = await loginAs({ role: 'user', floor: 5 })
  assert.equal((await client.get('/api/dashboard')).status, 400)
  assert.equal((await client.get('/api/dashboard?date=2026-13-40')).status, 400)
})

test('GET /api/dashboard startedWards: a ward counts only with a named patient AND an entered quantity, on that date', async () => {
  const user = await createUser({ role: 'user', floor: 5 })
  // Real work — named patient + quantity.
  await seedChart({ floor: 5, ward: 'ردهة رجال', date: DATE, createdBy: user.id })
  await seedChart({ floor: null, ward: 'ردهة الديلزة', date: DATE, createdBy: user.id })
  // Only opened — blank patient rows, no quantities. Must NOT count.
  await seedChart({ floor: 3, ward: 'ردهة CCU', date: DATE, createdBy: user.id, patients: [{ rowNumber: 1, name: '' }], quantities: [] })
  // Names typed but no dose entered yet. Must NOT count.
  await seedChart({ floor: 4, ward: 'ردهة الحوامل', date: DATE, createdBy: user.id, patients: [{ rowNumber: 1, name: 'مريضة' }], quantities: [] })
  // A quantity but every patient row still blank. Must NOT count.
  await seedChart({ floor: 6, ward: 'الوحدة الأولى', date: DATE, createdBy: user.id, patients: [{ rowNumber: 1, name: '' }], quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 4 }] })
  // Real work, but a different day.
  await seedChart({ floor: 2, ward: 'ردهة رجال', date: NEXT_DAY, createdBy: user.id })

  const client = await loginAs({ role: 'admin' })
  const started = (await client.get(`/api/dashboard?date=${DATE}`)).body.startedWards
  assert.equal(started.length, 2)
  assert.ok(started.some((item) => item.floor === 5 && item.ward === 'ردهة رجال'))
  assert.ok(started.some((item) => item.floor === null && item.ward === 'ردهة الديلزة'))
})

test('GET /api/dashboard startedWards: each carries slot, updatedAt and minutesQuiet (minutes since last save)', async () => {
  const user = await createUser({ role: 'user', floor: 5 })
  const freshId = await seedChart({ floor: 5, ward: 'ردهة رجال', date: DATE, createdBy: user.id })
  const staleId = await seedChart({ floor: 5, ward: 'ردهة النساء', date: DATE, createdBy: user.id })
  await pool.query("UPDATE daily_charts SET updated_at = NOW() - INTERVAL '40 minutes' WHERE id = $1", [staleId])
  await pool.query("UPDATE daily_charts SET updated_at = NOW() WHERE id = $1", [freshId])

  const client = await loginAs({ role: 'admin' })
  const started = (await client.get(`/api/dashboard?date=${DATE}`)).body.startedWards
  const fresh = started.find((item) => item.ward === 'ردهة رجال')
  const stale = started.find((item) => item.ward === 'ردهة النساء')
  assert.equal(fresh.slot, 'main')
  assert.ok(typeof fresh.updatedAt === 'string' && !Number.isNaN(Date.parse(fresh.updatedAt)))
  assert.ok(fresh.minutesQuiet <= 1, `fresh chart should read ~0 min quiet, got ${fresh.minutesQuiet}`)
  assert.ok(stale.minutesQuiet >= 39 && stale.minutesQuiet <= 41, `stale chart should read ~40 min, got ${stale.minutesQuiet}`)
})

test('GET /api/dashboard topMedicines (manager): sums across every ward, ranks by quantity, and honours the period window', async () => {
  const user = await createUser({ role: 'user', floor: 5 })
  const medicine = (await pool.query("INSERT INTO medicines (name) VALUES ('Amoxicillin Cap') RETURNING id")).rows[0]

  await seedChart({
    floor: 5, ward: 'ردهة رجال', date: DATE, createdBy: user.id,
    columns: [{ columnNumber: 1, medicineId: medicine.id }, { columnNumber: 2, customName: 'Custom Syrup' }],
    quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 5 }, { rowNumber: 2, columnNumber: 1, quantity: 3 }, { rowNumber: 1, columnNumber: 2, quantity: 2 }],
  })
  await seedChart({
    floor: 6, ward: 'الوحدة الأولى', date: FIVE_DAYS_AGO, createdBy: user.id,
    columns: [{ columnNumber: 1, medicineId: medicine.id }],
    quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 10 }],
  })
  await seedChart({
    floor: 8, ward: 'ردهة الخاص', date: THREE_WEEKS_AGO, createdBy: user.id,
    columns: [{ columnNumber: 1, medicineId: medicine.id }],
    quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 100 }],
  })

  const client = await loginAs({ role: 'admin' })

  const today = (await client.get(`/api/dashboard?date=${DATE}&period=today`)).body
  assert.equal(today.medicinesPeriod, 'today')
  assert.deepEqual(today.topMedicines.map((m) => [m.name, m.quantity]), [['Amoxicillin Cap', 8], ['Custom Syrup', 2]])

  const week = (await client.get(`/api/dashboard?date=${DATE}&period=week`)).body
  assert.equal(week.medicinesPeriod, 'week')
  assert.equal(week.topMedicines.find((m) => m.name === 'Amoxicillin Cap').quantity, 18) // 8 today + 10 five days ago

  const month = (await client.get(`/api/dashboard?date=${DATE}&period=month`)).body
  assert.equal(month.topMedicines.find((m) => m.name === 'Amoxicillin Cap').quantity, 118) // + 100 three weeks ago
  assert.equal(month.topMedicines[0].name, 'Amoxicillin Cap', 'highest total ranked first')

  // No/invalid period defaults to month for a manager.
  assert.equal((await client.get(`/api/dashboard?date=${DATE}`)).body.medicinesPeriod, 'month')
  assert.equal((await client.get(`/api/dashboard?date=${DATE}&period=decade`)).body.medicinesPeriod, 'month')
})

test('GET /api/dashboard topMedicines (plain user): only their own floor, only the day, no matter what period they pass', async () => {
  const seeder = await createUser({ role: 'user', floor: 5 })
  const medicine = (await pool.query("INSERT INTO medicines (name) VALUES ('Amoxicillin Cap') RETURNING id")).rows[0]
  // Their floor, today.
  await seedChart({ floor: 5, ward: 'ردهة رجال', date: DATE, createdBy: seeder.id, columns: [{ columnNumber: 1, medicineId: medicine.id }], quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 7 }] })
  // Their floor, but yesterday — outside the day window.
  await seedChart({ floor: 5, ward: 'ردهة النساء', date: FIVE_DAYS_AGO, createdBy: seeder.id, columns: [{ columnNumber: 1, medicineId: medicine.id }], quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 50 }] })
  // A different floor, today — not theirs.
  await seedChart({ floor: 6, ward: 'الوحدة الأولى', date: DATE, createdBy: seeder.id, columns: [{ columnNumber: 1, medicineId: medicine.id }], quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 99 }] })

  const client = await loginAs({ role: 'user', floor: 5 })
  const body = (await client.get(`/api/dashboard?date=${DATE}&period=month`)).body
  assert.equal(body.medicinesScope, 'own')
  assert.equal(body.medicinesPeriod, 'today')
  assert.deepEqual(body.topMedicines.map((m) => [m.name, m.quantity]), [['Amoxicillin Cap', 7]])
})

test('GET /api/dashboard topMedicines (special-ward pharmacist): only their assigned wards', async () => {
  const seeder = await createUser({ role: 'user', floor: 5 })
  const medicine = (await pool.query("INSERT INTO medicines (name) VALUES ('Meronem 1g Vial') RETURNING id")).rows[0]
  await seedChart({ floor: null, ward: 'ردهة الديلزة', date: DATE, createdBy: seeder.id, columns: [{ columnNumber: 1, medicineId: medicine.id }], quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 4 }] })
  await seedChart({ floor: null, ward: 'ردهة الخدج', date: DATE, createdBy: seeder.id, columns: [{ columnNumber: 1, medicineId: medicine.id }], quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 30 }] })

  const client = await loginAs({ role: 'user', ward: 'ردهة الديلزة' })
  const body = (await client.get(`/api/dashboard?date=${DATE}`)).body
  assert.deepEqual(body.topMedicines.map((m) => [m.name, m.quantity]), [['Meronem 1g Vial', 4]])
})

test('GET/POST/DELETE /api/announcements: a plain user can only read; a manager can post and remove', async () => {
  const anon = new ApiClient(baseUrl)
  assert.equal((await anon.get('/api/announcements')).status, 401)
  // requireManager (like requireAdmin) checks the role directly rather than first checking for
  // a session, so an anonymous write gets 403, not 401 — matches every requireManager route.
  assert.equal((await anon.post('/api/announcements', { message: 'x' })).status, 403)

  const plainUser = await loginAs({ role: 'user', floor: 5 })
  assert.equal((await plainUser.get('/api/announcements')).status, 200)
  assert.equal((await plainUser.post('/api/announcements', { message: 'محاولة من مستخدم عادي' })).status, 403)

  const manager = await loginAs({ role: 'supervisor' })
  assert.deepEqual((await manager.get('/api/announcements')).body.announcements, [])
  assert.equal((await manager.post('/api/announcements', { message: '   ' })).status, 400)

  const created = await manager.post('/api/announcements', { message: 'الرجاء التأكد من مطابقة الأسماء' })
  assert.equal(created.status, 201)
  assert.equal(created.body.announcement.message, 'الرجاء التأكد من مطابقة الأسماء')
  assert.equal(created.body.announcement.author_name, undefined, 'the poster name is not exposed')

  const listed = await plainUser.get('/api/announcements')
  assert.equal(listed.body.announcements.length, 1)
  assert.equal(listed.body.announcements[0].id, created.body.announcement.id)

  const id = created.body.announcement.id
  assert.equal((await plainUser.patch(`/api/announcements/${id}`, { message: 'تعديل من مستخدم عادي' })).status, 403)
  assert.equal((await manager.patch(`/api/announcements/${id}`, { message: '   ' })).status, 400)
  const edited = await manager.patch(`/api/announcements/${id}`, { message: 'الرجاء التأكد من الجرعات أيضًا' })
  assert.equal(edited.status, 200)
  assert.equal(edited.body.announcement.message, 'الرجاء التأكد من الجرعات أيضًا')
  assert.equal((await plainUser.get('/api/announcements')).body.announcements[0].message, 'الرجاء التأكد من الجرعات أيضًا')
  assert.equal((await manager.patch('/api/announcements/999999', { message: 'لا شيء' })).status, 404)

  assert.equal((await plainUser.delete(`/api/announcements/${id}`)).status, 403)
  assert.equal((await manager.delete(`/api/announcements/${id}`)).status, 200)
  assert.deepEqual((await plainUser.get('/api/announcements')).body.announcements, [])
  assert.equal((await manager.delete('/api/announcements/999999')).status, 404)
})

test('GET /api/dashboard patientsByFloor (manager): cumulative patient-days per numbered floor, own window, independent of the medicines period', async () => {
  const user = await createUser({ role: 'user', floor: 5 })
  const two = [{ rowNumber: 1, name: 'أ' }, { rowNumber: 2, name: 'ب' }]
  const three = [...two, { rowNumber: 3, name: 'ج' }]

  await seedChart({ floor: 5, ward: 'ردهة رجال', date: DATE, createdBy: user.id, patients: two })
  // A blank patient row alongside a named one — only the named one counts.
  await seedChart({ floor: 5, ward: 'ردهة النساء', date: DATE, createdBy: user.id, patients: [{ rowNumber: 1, name: 'د' }, { rowNumber: 2, name: '' }] })
  await seedChart({ floor: 5, ward: 'ردهة الخاص', date: FIVE_DAYS_AGO, createdBy: user.id, patients: three })
  await seedChart({ floor: 6, ward: 'الوحدة الأولى', date: DATE, createdBy: user.id, patients: [{ rowNumber: 1, name: 'هـ' }] })
  await seedChart({ floor: 6, ward: 'الوحدة الثالثة', date: THREE_WEEKS_AGO, createdBy: user.id, patients: two })
  // A special (non-numbered) ward must never appear in a per-floor total.
  await seedChart({ floor: null, ward: 'ردهة الديلزة', date: DATE, createdBy: user.id, patients: two })

  const client = await loginAs({ role: 'admin' })
  const at = async (patientsPeriod, period = 'month') =>
    (await client.get(`/api/dashboard?date=${DATE}&period=${period}&patientsPeriod=${patientsPeriod}`)).body.patientsByFloor

  assert.deepEqual(await at('today'), [{ floor: 5, count: 3 }, { floor: 6, count: 1 }])
  assert.deepEqual(await at('week'), [{ floor: 5, count: 6 }, { floor: 6, count: 1 }])
  assert.deepEqual(await at('month'), [{ floor: 5, count: 6 }, { floor: 6, count: 3 }])
  // The medicines `period` param does not bleed into the patient window.
  assert.deepEqual(await at('month', 'today'), [{ floor: 5, count: 6 }, { floor: 6, count: 3 }])
})

test('GET /api/dashboard patientsByFloor: a non-manager never receives it', async () => {
  const user = await createUser({ role: 'user', floor: 5 })
  await seedChart({ floor: 5, ward: 'ردهة رجال', date: DATE, createdBy: user.id, patients: [{ rowNumber: 1, name: 'أ' }] })
  const client = await loginAs({ role: 'user', floor: 5 })
  assert.deepEqual((await client.get(`/api/dashboard?date=${DATE}`)).body.patientsByFloor, [])
})

test('GET /api/dashboard dailyPatientsByFloor (manager): per-floor patient count, day by day, over a fixed 30-day window regardless of the other widgets\' period', async () => {
  const user = await createUser({ role: 'user', floor: 5 })
  const two = [{ rowNumber: 1, name: 'أ' }, { rowNumber: 2, name: 'ب' }]
  const three = [...two, { rowNumber: 3, name: 'ج' }]

  await seedChart({ floor: 5, ward: 'ردهة رجال', date: DATE, createdBy: user.id, patients: two })
  // A blank patient row alongside a named one — only the named one counts.
  await seedChart({ floor: 5, ward: 'ردهة النساء', date: DATE, createdBy: user.id, patients: [{ rowNumber: 1, name: 'د' }, { rowNumber: 2, name: '' }] })
  await seedChart({ floor: 5, ward: 'ردهة الخاص', date: FIVE_DAYS_AGO, createdBy: user.id, patients: three })
  await seedChart({ floor: 6, ward: 'الوحدة الأولى', date: DATE, createdBy: user.id, patients: [{ rowNumber: 1, name: 'هـ' }] })
  await seedChart({ floor: 6, ward: 'الوحدة الثالثة', date: THREE_WEEKS_AGO, createdBy: user.id, patients: two })
  // A special (non-numbered) ward must never appear in a per-floor breakdown.
  await seedChart({ floor: null, ward: 'ردهة الديلزة', date: DATE, createdBy: user.id, patients: two })

  const client = await loginAs({ role: 'admin' })
  const expected = [
    { floor: 5, date: FIVE_DAYS_AGO, count: 3 },
    { floor: 5, date: DATE, count: 3 },
    { floor: 6, date: THREE_WEEKS_AGO, count: 2 },
    { floor: 6, date: DATE, count: 1 },
  ]
  assert.deepEqual((await client.get(`/api/dashboard?date=${DATE}&patientsPeriod=today`)).body.dailyPatientsByFloor, expected)
  // Unaffected by the other widgets' own periods — this trend always uses its fixed window.
  assert.deepEqual((await client.get(`/api/dashboard?date=${DATE}&period=today&patientsPeriod=month`)).body.dailyPatientsByFloor, expected)
})

test('GET /api/dashboard dailyPatientsByFloor: a non-manager never receives it', async () => {
  const user = await createUser({ role: 'user', floor: 5 })
  await seedChart({ floor: 5, ward: 'ردهة رجال', date: DATE, createdBy: user.id, patients: [{ rowNumber: 1, name: 'أ' }] })
  const client = await loginAs({ role: 'user', floor: 5 })
  assert.deepEqual((await client.get(`/api/dashboard?date=${DATE}`)).body.dailyPatientsByFloor, [])
})

test('DELETE /api/users/:id: does not fail on a user who posted an announcement', async () => {
  const manager = await loginAs({ role: 'admin' })
  const author = await createUser({ role: 'user', floor: 5 })
  await pool.query("INSERT INTO announcements (message, created_by) VALUES ('إعلان', $1)", [author.id])

  assert.equal((await manager.delete(`/api/users/${author.id}`)).status, 200)
  const row = await pool.query('SELECT created_by FROM announcements')
  assert.equal(row.rows[0].created_by, null)
})
