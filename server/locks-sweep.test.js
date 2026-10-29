import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(() => resetDatabase())

// A file of its own: the sweep runs on a process's first lock request of the day, so any earlier
// lock request in the same process would already have spent it.
test('a lock request sweeps locks left stale for over a day, and leaves recent ones', async () => {
  const user = await createUser({ floor: 5 })
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  const ward = (await pool.query("INSERT INTO wards (floor_number, name) VALUES (5, 'ردهة النساء') RETURNING id")).rows[0].id
  await pool.query(
    `INSERT INTO chart_locks (ward_id, chart_date, slot, holder_id, holder_name, heartbeat_at) VALUES
       ($1, '2026-01-01', 'main', $2, 'x', NOW() - INTERVAL '3 days'),
       ($1, '2026-01-02', 'main', $2, 'x', NOW() - INTERVAL '5 minutes')`,
    [ward, user.id],
  )
  assert.equal((await client.post('/api/chart/lock', { floor: 5, ward: 'ردهة رجال', date: '2026-05-07' })).status, 200)
  await new Promise((resolve) => setTimeout(resolve, 200)) // the request does not wait for the sweep
  const left = (await pool.query('SELECT chart_date::text AS date FROM chart_locks WHERE ward_id = $1 ORDER BY chart_date', [ward])).rows.map((row) => row.date)
  assert.deepEqual(left, ['2026-01-02'])
})
