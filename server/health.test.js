import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer } from './test-helpers.js'

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

test('GET /api/health/db: readiness — reports the database connection', async () => {
  const response = await fetch(`${baseUrl}/api/health/db`)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.database, 'connected')
})
