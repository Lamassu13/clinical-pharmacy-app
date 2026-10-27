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
  await pool.query("INSERT INTO medicines (name) VALUES ('Amoxicillin Cap')")
})

const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}
const WARD = 'ردهة رجال'
const save = (client, date, patients, doses) => client.put('/api/chart', {
  floor: 5, ward: WARD, date, patients, columns: [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }], quantities: doses, expectedVersion: 0,
})

// Counts the rows each chart_patients query hands back to the app (what Neon bills as transfer).
const spyOnRows = () => {
  const original = pool.query.bind(pool)
  const rows = []
  pool.query = async (...args) => {
    const result = await original(...args)
    if (typeof args[0] === 'string' && args[0].includes('chart_patients') && args[0].includes('hits')) rows.push(result.rows.length)
    if (typeof args[0] === 'string' && args[0].includes('chart_patients') && args[0].includes('sum(cq.quantity)')) rows.push(result.rows.length)
    return result
  }
  return { rows, restore: () => { pool.query = original } }
}

test('all-dates search: only the 30 most recent matches leave the database, newest first', async () => {
  const admin = await loginAs({ role: 'admin' })
  const many = Array.from({ length: 35 }, (_, i) => ({ rowNumber: i + 1, name: `Ahmed ${String(i + 1).padStart(2, '0')}` }))
  await save(admin, '2026-01-10', many, many.map((p) => ({ rowNumber: p.rowNumber, columnNumber: 1, quantity: 1 })))
  await admin.put('/api/chart', { floor: 5, ward: WARD, date: '2026-01-20', slot: 'extra', patients: [{ rowNumber: 1, name: 'Ahmed Newest' }], columns: [], quantities: [], expectedVersion: 0 })
  const spy = spyOnRows()
  try {
    const result = await admin.get(`/api/patients/history?q=${encodeURIComponent('ahmed')}`)
    assert.equal(result.status, 200)
    assert.equal(result.body.patients.length, 30)
    assert.equal(result.body.patients[0].name, 'Ahmed Newest', 'the most recently charted patient comes first')
    assert.equal(result.body.patients[1].stays[0].medicines[0].name, 'Amoxicillin Cap')
    // 36 patients match, but the stays query returned only the 30 chosen and the medicines query only theirs.
    assert.deepEqual(spy.rows.map((count) => count <= 30), [true, true])
  } finally { spy.restore() }
})

test('all-dates search: a name needs 3 characters, an ID prefix 2; managers only', async () => {
  const admin = await loginAs({ role: 'admin' })
  await save(admin, '2026-01-10', [{ rowNumber: 1, name: 'Ali Hassan', patientId: '4001' }], [])
  assert.deepEqual((await admin.get(`/api/patients/history?q=${encodeURIComponent('al')}`)).body.patients, [])
  assert.equal((await admin.get(`/api/patients/history?q=${encodeURIComponent('ali')}`)).body.patients.length, 1)
  assert.equal((await admin.get('/api/patients/history?q=40')).body.patients.length, 1)
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  assert.equal((await pharmacist.get('/api/patients/history?q=ali')).status, 403)
})
