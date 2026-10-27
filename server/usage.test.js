import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { flushUsage } from './usage.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(() => resetDatabase())

const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return { client, user }
}

test('usage report: counts requests, writes and bytes per user; quiet users show zeros; managers only', async () => {
  const { client: admin } = await loginAs({ role: 'admin' })
  const { client: busy, user: busyUser } = await loginAs({ role: 'user', floor: 5 })
  const quietUser = await createUser({ role: 'user', floor: 5 }) // never signed in
  await busy.get('/api/medicines')
  await busy.get('/api/medicines')
  await busy.put('/api/ward-note', { floor: 5, ward: 'ردهة رجال', date: '2026-05-07', body: 'x' })

  assert.equal((await busy.get('/api/usage')).status, 403)
  const report = await admin.get('/api/usage?days=7')
  assert.equal(report.status, 200)
  const byId = Object.fromEntries(report.body.users.map((row) => [row.id, row]))
  assert.equal(byId[busyUser.id].requests >= 4, true) // login + 2 reads + the write
  assert.equal(byId[busyUser.id].writes, 1) // the note save; sign-in is not a save
  assert.equal(byId[busyUser.id].bytesOut > 0, true)
  assert.equal(byId[quietUser.id].requests, 0)
  assert.equal(report.body.users[0].id, busyUser.id) // heaviest data first

  // A second flush adds to the same (user, day) row instead of replacing it.
  const before = (await pool.query('SELECT requests FROM user_activity WHERE user_id = $1', [busyUser.id])).rows[0].requests
  await busy.get('/api/medicines')
  await flushUsage()
  const after = (await pool.query('SELECT requests FROM user_activity WHERE user_id = $1', [busyUser.id])).rows[0].requests
  assert.equal(after, before + 1)
})

test('usage flush: counts of a deleted user are skipped and do not block anyone else', async () => {
  const { client: admin, user: adminUser } = await loginAs({ role: 'admin' })
  const { client: gone, user: goneUser } = await loginAs({ role: 'user', floor: 5 })
  await gone.get('/api/medicines')
  await pool.query('DELETE FROM users WHERE id = $1', [goneUser.id])
  await admin.get('/api/medicines')
  await flushUsage() // would throw an FK error and re-queue forever without the EXISTS filter
  const rows = (await pool.query('SELECT user_id FROM user_activity')).rows.map((row) => String(row.user_id))
  assert.deepEqual(rows, [String(adminUser.id)])
})
