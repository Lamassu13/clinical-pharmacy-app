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
  return { client, user }
}
const trail = async (client) => (await client.get('/api/audit')).body.entries
const brief = (entries) => entries.map((entry) => [entry.action, entry.target])

test('audit log: account decisions, role, access and deletion are recorded, newest first, with who did it', async () => {
  const { client: admin } = await loginAs({ role: 'admin' })
  const pending = await createUser({ role: 'user', accountStatus: 'pending' })
  assert.equal((await admin.put(`/api/registrations/${pending.id}`, { status: 'active', floor: 5 })).status, 200)
  const second = await createUser({ role: 'user' })
  assert.equal((await admin.put(`/api/users/${second.id}/role`, { role: 'supervisor' })).status, 200)
  assert.equal((await admin.put(`/api/access/${second.id}`, { floor: 6 })).status, 200)
  assert.equal((await admin.delete(`/api/users/${second.id}`)).status, 200)
  const entries = await trail(admin)
  assert.deepEqual(brief(entries), [
    ['user.deleted', second.username], ['user.access', second.username], ['user.role', second.username], ['registration.approved', pending.username],
  ])
  assert.equal(entries[2].detail, 'مستخدم ← مسؤول')
  assert.equal(entries[1].detail, 'الطابق 6')
  assert.ok(entries.every((entry) => /^Test User \d+ \(test-user-\d+\)$/.test(entry.actor)))
})

test('audit log: medicine edits and chart purges are recorded; admins only can read it', async () => {
  const { client: admin } = await loginAs({ role: 'admin' })
  const { client: supervisor } = await loginAs({ role: 'supervisor' })
  const created = await supervisor.post('/api/medicines', { name: 'Test Drug 5mg' })
  assert.equal(created.status, 201)
  const id = created.body.medicine.id
  assert.equal((await supervisor.put(`/api/medicines/${id}`, { name: 'Test Drug 10mg', isSupply: true })).status, 200)
  assert.equal((await supervisor.delete(`/api/medicines/${id}`)).status, 200)
  assert.equal((await supervisor.post('/api/charts/purge', { from: '2026-01-01', to: '2026-01-31', all: true })).status, 200)
  const entries = await trail(admin)
  assert.deepEqual(brief(entries), [['charts.purged', 'كل الطوابق والردهات'], ['medicine.deleted', 'Test Drug 10mg'], ['medicine.updated', 'Test Drug 10mg'], ['medicine.created', 'Test Drug 5mg']])
  assert.equal(entries[2].detail, 'الاسم: Test Drug 5mg ← Test Drug 10mg · مستلزم: نعم') // only what changed
  assert.equal((await admin.get('/api/audit?before=99999999999999999999')).status, 200) // oversized cursor is ignored, not a 500
  assert.equal((await supervisor.get('/api/audit')).status, 403)
  assert.equal((await new ApiClient(baseUrl).get('/api/audit')).status, 403) // like every admin-only route
})

test('audit log: pages with `before`, and a logging failure never fails the action', async () => {
  const { client: admin } = await loginAs({ role: 'admin' })
  await pool.query("INSERT INTO audit_log (action, target) SELECT 'x', g::text FROM generate_series(1, 205) g")
  const first = (await admin.get('/api/audit')).body
  assert.equal(first.entries.length, 200)
  assert.equal(first.more, true)
  const next = (await admin.get(`/api/audit?before=${first.entries[199].id}`)).body
  assert.equal(next.entries.length, 5)
  assert.equal(next.more, false)

  await pool.query('ALTER TABLE audit_log RENAME TO audit_log_away')
  try {
    const result = await admin.post('/api/medicines', { name: 'Still Saved Drug' })
    assert.equal(result.status, 201, 'the action must succeed even when the log cannot be written')
  } finally { await pool.query('ALTER TABLE audit_log_away RENAME TO audit_log') }
})
