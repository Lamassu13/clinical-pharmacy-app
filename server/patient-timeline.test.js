import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(async () => {
  await resetDatabase()
  await pool.query("INSERT INTO medicines (name) VALUES ('Amoxicillin Cap'), ('Aspirin Tab')")
})

const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}
const save = (client, { floor, ward, date, slot = 'main', patients, doses }) =>
  client.put('/api/chart', {
    floor, ward, date, slot, patients,
    columns: [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }, { columnNumber: 2, medicineName: 'Aspirin Tab' }],
    quantities: doses, expectedVersion: 0,
  })
const A = 'ردهة رجال'
const B = 'ردهة النساء'

test('timeline: one patient day by day, newest first, with each ward and medicine', async () => {
  const admin = await loginAs({ role: 'admin' })
  const ali = (rowNumber = 1) => ({ rowNumber, name: 'Ali', patientId: '4001' })
  await save(admin, { floor: 5, ward: A, date: '2026-01-15', patients: [ali()], doses: [{ rowNumber: 1, columnNumber: 1, quantity: 2 }] })
  await save(admin, { floor: 5, ward: A, date: '2026-01-17', patients: [ali()], doses: [{ rowNumber: 1, columnNumber: 1, quantity: 3 }, { rowNumber: 1, columnNumber: 2, quantity: 1 }] })
  await save(admin, { floor: 5, ward: B, date: '2026-01-17', patients: [ali(2)], doses: [] }) // transferred the same day
  await save(admin, { floor: 5, ward: A, date: '2026-01-17', slot: 'extra', patients: [{ rowNumber: 1, name: 'Someone Else', patientId: '9999' }], doses: [] })
  const result = await admin.get('/api/patients/timeline?id=4001')
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.days.map((day) => day.date), ['2026-01-17', '2026-01-15'])
  const latest = result.body.days[0].entries
  assert.deepEqual(latest.map((entry) => entry.ward).sort(), [A, B].sort())
  assert.deepEqual(latest.find((entry) => entry.ward === A).medicines, [{ name: 'Amoxicillin Cap', quantity: 3 }, { name: 'Aspirin Tab', quantity: 1 }])
  assert.deepEqual(latest.find((entry) => entry.ward === B).medicines, [])
  assert.deepEqual(result.body.days[1].entries[0].medicines, [{ name: 'Amoxicillin Cap', quantity: 2 }])
  assert.equal(result.body.truncated, false)
})

test('timeline: by exact name when there is no ID; managers only; an ID or name is required', async () => {
  const admin = await loginAs({ role: 'admin' })
  await save(admin, { floor: 5, ward: A, date: '2026-01-15', patients: [{ rowNumber: 1, name: 'No Id Patient' }], doses: [{ rowNumber: 1, columnNumber: 1, quantity: 1 }] })
  const byName = await admin.get(`/api/patients/timeline?name=${encodeURIComponent('No Id Patient')}`)
  assert.deepEqual(byName.body.days.map((day) => day.date), ['2026-01-15'])
  assert.deepEqual((await admin.get('/api/patients/timeline?name=Nobody')).body.days, [])
  assert.equal((await admin.get('/api/patients/timeline')).status, 400)
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  assert.equal((await pharmacist.get('/api/patients/timeline?id=4001')).status, 403)
  assert.equal((await new ApiClient(baseUrl).get('/api/patients/timeline?id=4001')).status, 401)
})
