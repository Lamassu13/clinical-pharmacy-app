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
