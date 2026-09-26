import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

const DATE = '2026-01-15'
const A = { floor: 5, ward: 'ردهة رجال' }
const B = { floor: 8, ward: 'الردهة الخامسة' }

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(async () => {
  await resetDatabase()
  await pool.query("INSERT INTO medicines (name) VALUES ('Amoxicillin Cap')")
})

const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}

const saveChart = (client, where, slot, patients) => client.put('/api/chart', {
  ...where, date: DATE, slot, expectedVersion: 0,
  patients: patients.map((patient, index) => ({ rowNumber: index + 1, ...patient })),
  columns: [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }],
  quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 3 }],
})

const search = (client, params) => client.get(`/api/patients/search?${new URLSearchParams({ date: DATE, ...params })}`)

test('patient search: scans the floor main + extra charts by ID prefix and name part, scoped by role', async () => {
  const admin = await loginAs({ role: 'admin' })
  assert.equal((await saveChart(admin, A, 'main', [{ name: 'علي حسن', patientId: '12345' }])).status, 200)
  assert.equal((await saveChart(admin, A, 'extra', [{ name: 'زيد', patientId: '999' }, { name: 'علي كريم' }])).status, 200)
  assert.equal((await saveChart(admin, B, 'main', [{ name: 'علي جاسم', patientId: '12377' }])).status, 200)

  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  const byId = (await search(pharmacist, { floor: 5, q: '123' })).body.patients
  assert.deepEqual(byId.map((p) => [p.name, p.slot]), [['علي حسن', 'main']])
  assert.deepEqual(byId[0].medicines, [{ name: 'Amoxicillin Cap', quantity: 3 }])

  const byName = (await search(pharmacist, { floor: 5, q: 'علي' })).body.patients
  assert.deepEqual(byName.map((p) => [p.name, p.slot]), [['علي حسن', 'main'], ['علي كريم', 'extra']])
  assert.deepEqual(byName[1].medicines, [])

  assert.equal((await search(pharmacist, { floor: 8, q: 'علي' })).status, 403)
  assert.equal((await search(pharmacist, { q: 'علي' })).status, 403)

  const unit = (await search(admin, { q: '123' })).body.patients
  assert.deepEqual(unit.map((p) => p.floor), [5, 8])
})
