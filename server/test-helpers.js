// Shared plumbing for the real, over-HTTP API tests in server/*.test.js. Each test
// file runs in its own process (Node's test runner does this per file), so it's safe
// for a file to own the pool/server lifecycle end-to-end in its own before/after hooks.
import bcrypt from 'bcryptjs'
import { pool } from './db.js'

// A test run pointed at the wrong database would TRUNCATE real patient data. The name
// is the only signal available here, so refuse anything that isn't obviously a test DB
// rather than trust that .env.test was loaded correctly.
if (!/clinical_pharmacy_test\b/.test(process.env.DATABASE_URL || '')) {
  throw new Error('server/test-helpers.js requires a DATABASE_URL pointing at a "clinical_pharmacy_test" database. Run tests via `npm test` (loads .env.test), not directly.')
}

export const startServer = (app) => new Promise((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    resolve({ server, baseUrl: `http://127.0.0.1:${port}` })
  })
})

// `session` is created lazily by connect-pg-simple on the app's first request, so it
// may not exist yet the first time a test file resets the database.
export const resetDatabase = () => pool.query(`
  TRUNCATE TABLE chart_quantities, chart_columns, chart_patients, pill_entries,
    pill_patient_meta, daily_charts, wards, medicines, user_floor_access,
    user_ward_access, users RESTART IDENTITY CASCADE;
  DO $$ BEGIN
    IF to_regclass('public.session') IS NOT NULL THEN EXECUTE 'TRUNCATE TABLE session'; END IF;
  END $$;
`)

let userCounter = 0
// Inserts a ready-to-log-in user directly (bypassing /api/auth/register, which always
// starts a user as 'pending'), with an optional floor/ward grant. A low bcrypt cost
// keeps a suite of many logins fast; production still uses BCRYPT_COST from the env.
export const createUser = async ({ role = 'user', accountStatus = 'active', floor = null, ward = null, password = 'Test-Pass-123' } = {}) => {
  userCounter += 1
  const username = `test-user-${userCounter}`
  const passwordHash = await bcrypt.hash(password, 4)
  const result = await pool.query(
    `INSERT INTO users (full_name, username, phone, email, fingerprint_number, password_hash, role, account_status)
     VALUES ($1, $2, '0000000000', $3, 'fp', $4, $5, $6) RETURNING id`,
    [`Test User ${userCounter}`, username, `${username}@example.test`, passwordHash, role, accountStatus],
  )
  const id = result.rows[0].id
  if (floor !== null) await pool.query('INSERT INTO user_floor_access (user_id, floor_number, assigned_by) VALUES ($1, $2, $1)', [id, floor])
  if (ward !== null) await pool.query('INSERT INTO user_ward_access (user_id, ward_name, assigned_by) VALUES ($1, $2, $1)', [id, ward])
  return { id, username, password }
}

// A tiny cookie-jar fetch wrapper: the app authenticates with a session cookie, and
// plain fetch() does not remember cookies between calls the way a browser does.
export class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl
    this.cookies = new Map()
  }
  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' }
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
    const response = await fetch(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    for (const setCookie of response.headers.getSetCookie()) {
      const pair = setCookie.split(';')[0]
      const separator = pair.indexOf('=')
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }
  get(path) { return this.request('GET', path) }
  post(path, body) { return this.request('POST', path, body) }
  put(path, body) { return this.request('PUT', path, body) }
  delete(path) { return this.request('DELETE', path) }
}
