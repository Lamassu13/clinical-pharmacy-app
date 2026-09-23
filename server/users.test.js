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
  return { client, ...user }
}

test('DELETE /api/users/:id: a second admin can be deleted while at least one remains', async () => {
  const { client: acting } = await loginAs({ role: 'admin' })
  const other = await createUser({ role: 'admin' })
  const response = await acting.delete(`/api/users/${other.id}`)
  assert.equal(response.status, 200)
  const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [other.id])
  assert.equal(rows.length, 0)
})

test('PUT /api/users/:id/role: a second admin can be demoted while at least one remains', async () => {
  const { client: acting } = await loginAs({ role: 'admin' })
  const other = await createUser({ role: 'admin' })
  const response = await acting.put(`/api/users/${other.id}/role`, { role: 'supervisor' })
  assert.equal(response.status, 200)
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [other.id])
  assert.equal(rows[0].role, 'supervisor')
})

// The count check inside DELETE/role (server/index.js) only ever runs for an id that isn't
// the caller's own — reaching it with exactly one admin left is impossible through the live
// API in a single request, since only an admin can call these routes at all, and that admin
// hitting itself is refused earlier by a separate, more specific self-action guard. This test
// covers that reachable "sole admin, acting on themselves" case; the count check itself exists
// for the two-admins-concurrently-remove-each-other race, which needs real concurrent
// transactions to exercise and isn't something a single sequential test can trigger.
test('DELETE /api/users/:id: a sole admin cannot delete their own account', async () => {
  const { client: acting, id } = await loginAs({ role: 'admin' })
  const response = await acting.delete(`/api/users/${id}`)
  assert.equal(response.status, 400)
  const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [id])
  assert.equal(rows.length, 1)
})

// Two admins concurrently deleting *each other* is exactly the race server/index.js's
// `SELECT ... FOR UPDATE` (not a plain COUNT) is meant to prevent — without it, both
// transactions can read "2 admins" before either commits and both proceed, leaving zero.
// Real concurrent requests, not sequential ones, so this only actually proves something with
// the row lock in place; run it a few times since a race that only sometimes reproduces is
// still worth catching.
test('DELETE /api/users/:id: two admins deleting each other at the same time never drops the system to zero admins', async () => {
  const { client: adminA, id: idA } = await loginAs({ role: 'admin' })
  const { client: adminB, id: idB } = await loginAs({ role: 'admin' })
  const [resultA, resultB] = await Promise.all([
    adminA.delete(`/api/users/${idB}`),
    adminB.delete(`/api/users/${idA}`),
  ])
  const remaining = (await pool.query("SELECT id FROM users WHERE role = 'admin'")).rows.length
  assert.ok(remaining >= 1, `expected at least one admin left, found ${remaining}`)
  // Exactly one side should have won; the other must have been refused with 400, not 200 —
  // both succeeding is precisely the zero-admins outcome this test guards against.
  const statuses = [resultA.status, resultB.status].sort()
  assert.deepEqual(statuses, [200, 400])
})

test('DELETE /api/users/:id: a user who marked a chart complete, uploaded a form or made an extra pill form can still be deleted', async () => {
  const { client: acting } = await loginAs({ role: 'admin' })
  const { client: target, id } = await loginAs({ role: 'user', floor: 3 })
  assert.equal((await target.patch('/api/chart/complete', { floor: 3, ward: 'ردهة الخاص', date: '2026-02-10', completed: true })).status, 200)
  assert.equal((await target.post('/api/extra-pills', { floor: 3, ward: 'ردهة الخاص' })).status, 201)
  await pool.query("INSERT INTO treatment_forms (title, file_name, file_size, file_data, uploaded_by) VALUES ('t', 'f.pdf', 4, '\\x25504446', $1)", [id])

  assert.equal((await acting.delete(`/api/users/${id}`)).status, 200)
  const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [id])
  assert.equal(rows.length, 0)
})
