import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

const FLOOR = 5
const WARD = 'ردهة رجال'
const DATE = '2026-02-10'
const MED = 'Aspirin 100mg Tab'
const KEY = 'aspirin 100mg tab'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(async () => {
  await resetDatabase()
  await pool.query('INSERT INTO medicines (name) VALUES ($1)', [MED])
})

const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}

const chartBody = (overrides = {}) => ({
  floor: FLOOR, ward: WARD, date: DATE, expectedVersion: 0,
  patients: [{ rowNumber: 1, name: 'Patient One' }],
  columns: [{ columnNumber: 1, medicineName: MED }],
  quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 8 }],
  ...overrides,
})

test('GET /api/pills: quantityByCell carries the chart quantity for each (patient, medicine)', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  assert.equal((await client.put('/api/chart', chartBody())).status, 200)

  const pills = await client.get(`/api/pills?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(pills.status, 200)
  assert.equal(pills.body.pills.quantityByCell[`1:${KEY}`], 8)
  assert.ok(pills.body.pills.medicines.some((m) => m.key === KEY))
})

test('PUT /api/pills: a pill_qty override persists on its own and never touches the chart', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  await client.put('/api/chart', chartBody())

  // Only pillQty — no dose time / usage / note. Must still be stored.
  const saved = await client.put('/api/pills', {
    floor: FLOOR, ward: WARD, date: DATE,
    entries: [{ patientRowNumber: 1, medicineKey: KEY, pillQty: '12' }],
    rooms: {},
  })
  assert.equal(saved.status, 200)

  const pills = await client.get(`/api/pills?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  const entry = pills.body.pills.entries.find((e) => e.patientRowNumber === 1 && e.medicineKey === KEY)
  assert.equal(entry?.pillQty, '12', 'the override round-trips')
  assert.equal(pills.body.pills.quantityByCell[`1:${KEY}`], 8, 'the chart-derived seed is unchanged')

  const chart = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(chart.body.chart.quantities[0].quantity, 8, 'the chart quantity is untouched by the pill override')
})

test('PUT /api/pills: pill_qty is digits-only and capped', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  await client.put('/api/chart', chartBody())
  await client.put('/api/pills', {
    floor: FLOOR, ward: WARD, date: DATE,
    entries: [{ patientRowNumber: 1, medicineKey: KEY, pillQty: 'ab3x4' }],
    rooms: {},
  })
  const pills = await client.get(`/api/pills?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  const entry = pills.body.pills.entries.find((e) => e.medicineKey === KEY)
  assert.equal(entry?.pillQty, '34')
})

test('GET /api/pills: an unlinked column resolves its Arabic name past a spacing mismatch', async () => {
  await pool.query("INSERT INTO medicines (name, arabic_name) VALUES ('Metronidazole 500mg tab', 'ميترونيدازول')")
  const ccu = 'ردهة CCU'
  const wardId = (await pool.query("INSERT INTO wards (floor_number, name, is_special) VALUES (3, $1, false) RETURNING id", [ccu])).rows[0].id
  const seeder = await createUser({ role: 'admin' })
  const chartId = (await pool.query(
    "INSERT INTO daily_charts (ward_id, chart_date, slot, created_by, updated_by, version) VALUES ($1, $2, 'main', $3, $3, 1) RETURNING id",
    [wardId, DATE, seeder.id],
  )).rows[0].id
  await pool.query("INSERT INTO chart_patients (chart_id, row_number, patient_name) VALUES ($1, 1, 'مريض')", [chartId])
  // Free-text column (medicine_id NULL) whose text differs from the catalogue only by the
  // space in "500 mg" — the old exact-key lookup missed this and showed English.
  await pool.query("INSERT INTO chart_columns (chart_id, column_number, medicine_id, custom_name) VALUES ($1, 1, NULL, 'Metronidazole 500 mg tab')", [chartId])
  await pool.query('INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) VALUES ($1, 1, 1, 2)', [chartId])

  const client = await loginAs({ role: 'admin' })
  const pills = await client.get(`/api/pills?floor=3&ward=${encodeURIComponent(ccu)}&date=${DATE}`)
  assert.equal(pills.status, 200)
  const med = pills.body.pills.medicines.find((m) => m.name.toLowerCase().includes('metronidazole'))
  assert.equal(med?.arabicName, 'ميترونيدازول')
})
