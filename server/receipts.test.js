import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(() => resetDatabase())

const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}
const WARD = 'ردهة رجال'
const DATE = '2026-05-07'
const place = { floor: 5, ward: WARD, date: DATE }
const LIST = `/api/receipts?floor=5&ward=${encodeURIComponent(WARD)}&date=${DATE}`
const saveChart = (client, slot, patients, expectedVersion = 0) => client.put('/api/chart', { ...place, slot, patients, columns: [], quantities: [], expectedVersion })
const marks = async (client) => (await client.get(LIST)).body.patients.map((p) => [p.rowNumber, p.name, p.room, p.received])

test('receipts: main chart only with rooms; mark, clear, and a mark follows its patient, never the row', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  await saveChart(pharmacist, 'main', [{ rowNumber: 1, name: 'Ali', patientId: '11' }, { rowNumber: 2, name: 'Omar', patientId: '22' }, { rowNumber: 3, name: '  ' }])
  await saveChart(pharmacist, 'extra', [{ rowNumber: 1, name: 'Sara' }])
  await pharmacist.put('/api/chart/room', { ...place, slot: 'main', rowNumber: 2, room: '12' })
  // The extra chart's patients are not listed.
  assert.deepEqual(await marks(pharmacist), [[1, 'Ali', '', null], [2, 'Omar', '12', null]])

  const mark = (name, patientId, received, slot = 'main') => pharmacist.put('/api/receipts', { ...place, slot, name, patientId, received })
  assert.equal((await mark('Ali', '11', true)).status, 200)
  assert.equal((await mark('Omar', '22', false)).status, 200)
  assert.equal((await mark('Ali', '11', 'yes')).status, 400)
  // Not on the main chart (a name typed over since the list loaded, or an extra-chart patient): refused.
  assert.equal((await mark('Ali', '99', true)).status, 409)
  assert.equal((await mark('Sara', '', true, 'extra')).status, 409)
  assert.deepEqual(await marks(pharmacist), [[1, 'Ali', '', true], [2, 'Omar', '12', false]])

  // Ali's row is deleted: Omar moves up to row 1 and keeps his own mark; nobody inherits Ali's.
  await saveChart(pharmacist, 'main', [{ rowNumber: 1, name: 'Omar', patientId: '22' }, { rowNumber: 2, name: 'Zaid', patientId: '33' }], 1)
  assert.deepEqual((await marks(pharmacist)).map(([row, name, , received]) => [row, name, received]), [[1, 'Omar', false], [2, 'Zaid', null]])

  // A pasted name ending in a tab: GET's btrim keeps the tab, and the mark still finds the patient.
  await saveChart(pharmacist, 'main', [{ rowNumber: 1, name: 'Omar', patientId: '22' }, { rowNumber: 2, name: 'Huda\t' }], 2)
  const huda = (await pharmacist.get(LIST)).body.patients.find((p) => p.name.startsWith('Huda'))
  assert.equal((await mark(huda.name, huda.patientId, false)).status, 200)
  assert.equal((await pharmacist.get(LIST)).body.patients.find((p) => p.name.startsWith('Huda')).received, false)

  assert.equal((await mark('Omar', '22', null)).status, 200)
  assert.equal((await marks(pharmacist))[0][3], null)
})

test('receipts: another floor is refused, a day with no chart is 404, the purge removes marks', async () => {
  const other = await loginAs({ role: 'user', floor: 3 })
  assert.equal((await other.get(LIST)).status, 403)
  assert.equal((await other.put('/api/receipts', { ...place, slot: 'main', name: 'Ali', patientId: '', received: true })).status, 403)

  const admin = await loginAs({ role: 'admin' })
  assert.deepEqual((await admin.get(LIST)).body.patients, [])
  assert.equal((await admin.put('/api/receipts', { ...place, slot: 'main', name: 'Ali', patientId: '', received: true })).status, 404)
  await saveChart(admin, 'main', [{ rowNumber: 1, name: 'Ali' }])
  await admin.put('/api/receipts', { ...place, slot: 'main', name: 'Ali', patientId: '', received: true })
  assert.equal((await admin.post('/api/charts/purge', { from: DATE, to: DATE, floors: [5] })).status, 200)
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM dose_receipts')).rows[0].n, 0)
})
