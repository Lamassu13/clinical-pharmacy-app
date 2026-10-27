import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(() => resetDatabase())

const WARD_A = 'ردهة رجال'
const WARD_B = 'ردهة النساء'
const DATE = '2026-01-15'
const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}
const save = (client, { floor, ward, date = DATE, slot = 'main', patients }) =>
  client.put('/api/chart', { floor, ward, date, slot, patients, columns: [], quantities: [], expectedVersion: 0 })
const clashes = (client, { floor, ward, date = DATE, slot = 'main' }) =>
  client.get(`/api/chart/id-clashes?floor=${floor}&ward=${encodeURIComponent(ward)}&date=${date}&slot=${slot}`)

test('id clashes: the same ID on another ward the same day is reported by ward label only', async () => {
  const admin = await loginAs({ role: 'admin' })
  await save(admin, { floor: 5, ward: WARD_A, patients: [{ rowNumber: 1, name: 'Ali', patientId: '4001' }, { rowNumber: 2, name: 'Omar', patientId: '4002' }] })
  await save(admin, { floor: 5, ward: WARD_B, patients: [{ rowNumber: 1, name: 'Secret Name', patientId: '4001' }] })
  const result = await clashes(admin, { floor: 5, ward: WARD_A })
  assert.deepEqual(result.body.clashes, [{ patientId: '4001', floor: 5, ward: WARD_B }])
  assert.equal(JSON.stringify(result.body).includes('Secret'), false, 'the other ward\'s patient name must not leak')
})

test('id clashes: a ward\'s own extra chart, another day, and blank IDs are not clashes', async () => {
  const admin = await loginAs({ role: 'admin' })
  await save(admin, { floor: 5, ward: WARD_A, patients: [{ rowNumber: 1, name: 'Ali', patientId: '4001' }, { rowNumber: 2, name: 'No ID' }] })
  await save(admin, { floor: 5, ward: WARD_A, slot: 'extra', patients: [{ rowNumber: 1, name: 'Ali', patientId: '4001' }] })
  await save(admin, { floor: 6, ward: 'ردهة الخاص', date: '2026-01-16', patients: [{ rowNumber: 1, name: 'Ali', patientId: '4001' }, { rowNumber: 2, name: 'No ID too' }] })
  assert.deepEqual((await clashes(admin, { floor: 5, ward: WARD_A })).body.clashes, [])
  assert.deepEqual((await clashes(admin, { floor: 5, ward: WARD_A, slot: 'extra' })).body.clashes, [])
})

test('id clashes: needs sign-in and access to the chart\'s own ward; an unsaved chart has none', async () => {
  const anon = new ApiClient(baseUrl)
  assert.equal((await clashes(anon, { floor: 5, ward: WARD_A })).status, 401)
  const other = await loginAs({ role: 'user', floor: 6 })
  assert.equal((await clashes(other, { floor: 5, ward: WARD_A })).status, 403)
  const mine = await loginAs({ role: 'user', floor: 5 })
  assert.deepEqual((await clashes(mine, { floor: 5, ward: WARD_A })).body.clashes, [])
})
