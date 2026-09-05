import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(() => resetDatabase())

test('register: rejects a request missing required fields', async () => {
  const client = new ApiClient(baseUrl)
  const response = await client.post('/api/auth/register', { username: 'newuser' })
  assert.equal(response.status, 400)
})

test('register: rejects a malformed email and an out-of-alphabet username', async () => {
  const client = new ApiClient(baseUrl)
  const base = { fullName: 'New Person', phone: '0123456789', fingerprintNumber: 'fp1', password: 'password123' }
  const badEmail = await client.post('/api/auth/register', { ...base, username: 'newuser', email: 'not-an-email' })
  assert.equal(badEmail.status, 400)
  const badUsername = await client.post('/api/auth/register', { ...base, username: 'new user!', email: 'newuser@example.test' })
  assert.equal(badUsername.status, 400)
})

test('register: a valid submission is created pending, and duplicates are rejected', async () => {
  const client = new ApiClient(baseUrl)
  const payload = { fullName: 'New Person', username: 'newperson', phone: '0123456789', email: 'newperson@example.test', fingerprintNumber: 'fp1', password: 'password123' }
  const created = await client.post('/api/auth/register', payload)
  assert.equal(created.status, 201)
  const { rows } = await pool.query('SELECT account_status FROM users WHERE username = $1', ['newperson'])
  assert.equal(rows[0].account_status, 'pending')

  const duplicate = await client.post('/api/auth/register', payload)
  assert.equal(duplicate.status, 409)
})

test('login: rejects an unknown username, a wrong password, and a not-yet-approved account', async () => {
  const client = new ApiClient(baseUrl)
  const unknown = await client.post('/api/auth/login', { username: 'ghost', password: 'whatever123' })
  assert.equal(unknown.status, 401)

  const active = await createUser({ accountStatus: 'active', password: 'right-password' })
  const wrongPassword = await client.post('/api/auth/login', { username: active.username, password: 'wrong-password' })
  assert.equal(wrongPassword.status, 401)

  const pending = await createUser({ accountStatus: 'pending', password: 'right-password' })
  const pendingLogin = await client.post('/api/auth/login', { username: pending.username, password: 'right-password' })
  assert.equal(pendingLogin.status, 401)
})

test('login: a correct active login establishes a session usable by /api/auth/me, and logout clears it', async () => {
  const user = await createUser({ role: 'user', accountStatus: 'active', password: 'right-password' })
  const client = new ApiClient(baseUrl)

  const before = await client.get('/api/auth/me')
  assert.equal(before.body.user, null)

  const login = await client.post('/api/auth/login', { username: user.username, password: 'right-password' })
  assert.equal(login.status, 200)
  assert.equal(login.body.user.username, user.username)
  assert.ok(client.cookies.has('cpa.sid'), 'login must set the session cookie')

  const me = await client.get('/api/auth/me')
  assert.equal(me.body.user.username, user.username)

  const logout = await client.post('/api/auth/logout')
  assert.equal(logout.status, 204)
  const afterLogout = await client.get('/api/auth/me')
  assert.equal(afterLogout.body.user, null)
})

test('requireAuth: an endpoint behind login refuses an anonymous request', async () => {
  const client = new ApiClient(baseUrl)
  const response = await client.get('/api/medicines')
  assert.equal(response.status, 401)
})
