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

test('login: email is matched case-insensitively (registration lowercases it, login must too)', async () => {
  const user = await createUser({ accountStatus: 'active', password: 'right-password' })
  const client = new ApiClient(baseUrl)
  const upperCaseEmail = `${user.username}@EXAMPLE.TEST`
  const login = await client.post('/api/auth/login', { username: upperCaseEmail, password: 'right-password' })
  assert.equal(login.status, 200, 'a correct password with the email typed in a different case must still log in')
  assert.equal(login.body.user.username, user.username)
})

test('requireAuth: an endpoint behind login refuses an anonymous request', async () => {
  const client = new ApiClient(baseUrl)
  const response = await client.get('/api/medicines')
  assert.equal(response.status, 401)
})

test('PUT /api/auth/me: anonymous is refused, and a logged-in user updates their own name/email/phone', async () => {
  const anon = new ApiClient(baseUrl)
  const refused = await anon.put('/api/auth/me', { fullName: 'X', email: 'x@example.test', phone: '123' })
  assert.equal(refused.status, 401)

  const user = await createUser({ accountStatus: 'active', password: 'right-password' })
  const client = new ApiClient(baseUrl)
  await client.post('/api/auth/login', { username: user.username, password: 'right-password' })

  const updated = await client.put('/api/auth/me', { fullName: 'New Name', email: 'new-email@example.test', phone: '0700000000' })
  assert.equal(updated.status, 200)
  assert.equal(updated.body.user.fullName, 'New Name')
  assert.equal(updated.body.user.email, 'new-email@example.test')

  const me = await client.get('/api/auth/me')
  assert.equal(me.body.user.fullName, 'New Name')
  assert.equal(me.body.user.email, 'new-email@example.test')
})

test('PUT /api/auth/me: taking another user\'s email is rejected as a conflict', async () => {
  const other = await createUser({ accountStatus: 'active' })
  const user = await createUser({ accountStatus: 'active', password: 'right-password' })
  const client = new ApiClient(baseUrl)
  await client.post('/api/auth/login', { username: user.username, password: 'right-password' })

  const clash = await client.put('/api/auth/me', { fullName: 'New Name', email: `${other.username}@example.test`, phone: '0700000000' })
  assert.equal(clash.status, 409)
})
