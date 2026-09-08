import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

// A real ward from validation.js's FLOOR_WARDS, so isKnownWard() accepts it.
const FLOOR = 5
const WARD = 'ردهة رجال'
const OTHER_FLOOR = 6
const DATE = '2026-01-15'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(async () => {
  await resetDatabase()
  // A chart column may only name a catalogue medicine, so the round-trip tests need one.
  await pool.query("INSERT INTO medicines (name) VALUES ('Amoxicillin Cap')")
})

const loginAs = async (userOptions) => {
  const user = await createUser(userOptions)
  const client = new ApiClient(baseUrl)
  const login = await client.post('/api/auth/login', { username: user.username, password: user.password })
  assert.equal(login.status, 200, 'test setup: login must succeed')
  return client
}

test('GET /api/chart: refuses an anonymous request and one for an unassigned floor', async () => {
  const anon = new ApiClient(baseUrl)
  const anonResponse = await anon.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(anonResponse.status, 401)

  const client = await loginAs({ role: 'user', floor: OTHER_FLOOR })
  const wrongFloor = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(wrongFloor.status, 403)
})

test('GET /api/chart: a ward/date with no saved chart yet returns null, not a 404', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const response = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(response.status, 200)
  assert.equal(response.body.chart, null)
})

const buildChartBody = (overrides = {}) => ({
  floor: FLOOR,
  ward: WARD,
  date: DATE,
  patients: [{ rowNumber: 1, name: 'Patient One' }],
  columns: [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }],
  quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 2 }],
  expectedVersion: 0,
  ...overrides,
})

test('PUT /api/chart: a first save creates the chart at version 1 and round-trips through GET', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const saved = await client.put('/api/chart', buildChartBody())
  assert.equal(saved.status, 200)
  assert.equal(saved.body.version, 1)

  const fetched = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(fetched.body.chart.version, 1)
  assert.equal(fetched.body.chart.patients[0].patient_name, 'Patient One')
  assert.equal(fetched.body.chart.columns[0].medicine_name, 'Amoxicillin Cap')
  assert.equal(fetched.body.chart.quantities[0].quantity, 2)
})

test('PUT /api/chart: a save with the current expectedVersion succeeds and bumps the counter', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const first = await client.put('/api/chart', buildChartBody())
  assert.equal(first.body.version, 1)

  const second = await client.put('/api/chart', buildChartBody({ expectedVersion: 1, patients: [{ rowNumber: 1, name: 'Patient One (updated)' }] }))
  assert.equal(second.status, 200)
  assert.equal(second.body.version, 2)
})

test('PUT /api/chart: a stale expectedVersion is rejected with a 409 conflict and leaves the saved data untouched', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  await client.put('/api/chart', buildChartBody())
  await client.put('/api/chart', buildChartBody({ expectedVersion: 1, patients: [{ rowNumber: 1, name: 'Second save' }] }))

  // A third client still believes the chart is at version 1 (its own stale copy) and tries
  // to overwrite what is now version 2 — exactly the two-iPads-same-ward scenario.
  const stale = await client.put('/api/chart', buildChartBody({ expectedVersion: 1, patients: [{ rowNumber: 1, name: 'Stale overwrite attempt' }] }))
  assert.equal(stale.status, 409)
  assert.equal(stale.body.conflict, true)

  const fetched = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(fetched.body.chart.version, 2)
  assert.equal(fetched.body.chart.patients[0].patient_name, 'Second save', 'the rejected stale write must not have landed')
})

test('PUT /api/chart: a column naming a medicine outside the catalogue is dropped, never stored as free text', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const saved = await client.put('/api/chart', buildChartBody({
    columns: [
      { columnNumber: 1, medicineName: 'Amoxicillin Cap' },
      { columnNumber: 2, medicineName: 'Totally Made Up Syrup' },
    ],
  }))
  assert.equal(saved.status, 200)

  const fetched = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(fetched.body.chart.columns.length, 1, 'only the catalogue column is kept')
  assert.equal(fetched.body.chart.columns[0].column_number, 1)
  assert.equal(fetched.body.chart.columns[0].medicine_name, 'Amoxicillin Cap')
})

test('PUT /api/chart: a column matches the catalogue ignoring case and extra spaces', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  await client.put('/api/chart', buildChartBody({ columns: [{ columnNumber: 1, medicineName: '  amoxicillin   cap ' }] }))

  const fetched = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(fetched.body.chart.columns.length, 1)
  assert.equal(fetched.body.chart.columns[0].medicine_name, 'Amoxicillin Cap')
})

test('PUT /api/chart: rejects an unknown ward name for the given floor', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const response = await client.put('/api/chart', buildChartBody({ ward: 'ردهة غير موجودة' }))
  assert.equal(response.status, 400)
})

test('PUT /api/chart: the extra slot is a separate chart for the same ward and date', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  await client.put('/api/chart', buildChartBody({ patients: [{ rowNumber: 1, name: 'Main sheet patient' }] }))
  const extra = await client.put('/api/chart', buildChartBody({ slot: 'extra', patients: [{ rowNumber: 1, name: 'Extra sheet patient' }] }))
  assert.equal(extra.status, 200)
  assert.equal(extra.body.version, 1, 'the extra chart starts its own version count')

  const main = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  const fetchedExtra = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}&slot=extra`)
  assert.equal(main.body.chart.patients[0].patient_name, 'Main sheet patient')
  assert.equal(fetchedExtra.body.chart.patients[0].patient_name, 'Extra sheet patient')

  // An unknown slot value falls back to 'main', never a third chart.
  const bogus = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}&slot=nonsense`)
  assert.equal(bogus.body.chart.patients[0].patient_name, 'Main sheet patient')
})

test('POST /api/charts/purge: removes both slots of a ward/date', async () => {
  const user = await loginAs({ role: 'user', floor: FLOOR })
  await user.put('/api/chart', buildChartBody())
  await user.put('/api/chart', buildChartBody({ slot: 'extra' }))

  const manager = await loginAs({ role: 'admin' })
  const purged = await manager.post('/api/charts/purge', { from: DATE, to: DATE, floors: [FLOOR] })
  assert.equal(purged.status, 200)
  assert.equal(purged.body.deleted, 2)
})

test('canAccessLocation via the API: a supervisor reaches a floor with no explicit assignment', async () => {
  const client = await loginAs({ role: 'supervisor' })
  const response = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(response.status, 200)
})
