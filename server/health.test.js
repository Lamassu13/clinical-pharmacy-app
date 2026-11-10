import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })

test('GET /api/health: liveness only — 200, and no database status in the body', async () => {
  const response = await fetch(`${baseUrl}/api/health`)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(typeof body.serverTime, 'string')
  assert.equal(body.database, undefined, 'the render healthCheckPath must not touch the DB')
})

test('GET /api/health/db: readiness — reports the database connection, to a manager only', async () => {
  await resetDatabase()
  assert.equal((await fetch(`${baseUrl}/api/health/db`)).status, 401, 'not open to anyone: each call wakes the database')
  const loginAs = async (options) => {
    const user = await createUser(options)
    const client = new ApiClient(baseUrl)
    assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
    return client
  }
  assert.equal((await (await loginAs({ role: 'user', floor: 5 })).get('/api/health/db')).status, 403)
  const response = await (await loginAs({ role: 'supervisor' })).get('/api/health/db')
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.equal(response.body.database, 'connected')
})
