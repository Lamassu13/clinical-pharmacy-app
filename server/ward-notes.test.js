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
const at = (date) => `/api/ward-note?floor=5&ward=${encodeURIComponent(WARD)}&date=${date}`

test('ward note: saved per ward and day, previous note found across a gap, blank deletes', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  assert.equal((await pharmacist.put('/api/ward-note', { floor: 5, ward: WARD, date: '2026-05-07', body: '  bed 4 needs a K level  ' })).status, 200)
  const today = await pharmacist.get(at('2026-05-07'))
  assert.equal(today.body.note.body, 'bed 4 needs a K level')
  assert.equal(today.body.previous, null)

  // Saturday after a Friday with nothing: Thursday's note is the previous one.
  const saturday = await pharmacist.get(at('2026-05-09'))
  assert.equal(saturday.body.note, null)
  assert.deepEqual([saturday.body.previous.date, saturday.body.previous.body], ['2026-05-07', 'bed 4 needs a K level'])
  // More than three days later it no longer carries over.
  assert.equal((await pharmacist.get(at('2026-05-11'))).body.previous, null)

  await pharmacist.put('/api/ward-note', { floor: 5, ward: WARD, date: '2026-05-07', body: 'updated' })
  assert.equal((await pharmacist.get(at('2026-05-07'))).body.note.body, 'updated')
  await pharmacist.put('/api/ward-note', { floor: 5, ward: WARD, date: '2026-05-07', body: '   ' })
  assert.equal((await pharmacist.get(at('2026-05-07'))).body.note, null)
})

test('ward note: another floor is refused, and the chart purge removes notes in range', async () => {
  const other = await loginAs({ role: 'user', floor: 3 })
  assert.equal((await other.get(at('2026-05-07'))).status, 403)
  assert.equal((await other.put('/api/ward-note', { floor: 5, ward: WARD, date: '2026-05-07', body: 'x' })).status, 403)

  const admin = await loginAs({ role: 'admin' })
  await admin.put('/api/ward-note', { floor: 5, ward: WARD, date: '2026-05-07', body: 'in range' })
  await admin.put('/api/ward-note', { floor: 5, ward: WARD, date: '2026-06-07', body: 'out of range' })
  await admin.put('/api/ward-note', { floor: null, ward: 'ردهة العناية المركزة', date: '2026-05-07', body: 'icu' })
  assert.equal((await admin.post('/api/charts/purge', { from: '2026-05-01', to: '2026-05-31', floors: [5] })).status, 200)
  const left = (await pool.query('SELECT ward_key, body FROM ward_notes ORDER BY body')).rows.map((row) => row.body)
  assert.deepEqual(left, ['icu', 'out of range'])
  await admin.post('/api/charts/purge', { from: '2026-05-01', to: '2026-05-31', wards: ['ردهة العناية المركزة'] })
  assert.deepEqual((await pool.query('SELECT body FROM ward_notes')).rows.map((row) => row.body), ['out of range'])
})
