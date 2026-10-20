import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { setPushSender, todayInBaghdad, isAllowedEndpoint } from './push.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

const FLOOR = 5
const WARD = 'ردهة رجال'
const KEYS = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) }

let server, baseUrl
let calls = []
let failWith = null
test.before(async () => {
  ;({ server, baseUrl } = await startServer(app))
  setPushSender(async (subscription, body, options) => {
    if (failWith) throw failWith
    calls.push({ endpoint: subscription.endpoint, payload: JSON.parse(body), options })
  })
})
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(async () => {
  await resetDatabase()
  await pool.query('TRUNCATE TABLE push_subscriptions, announcements RESTART IDENTITY')
  await pool.query("INSERT INTO medicines (name) VALUES ('Amoxicillin Cap')")
  calls = []
  failWith = null
})

let endpointCounter = 0
const newEndpoint = () => { endpointCounter += 1; return `https://fcm.googleapis.com/fcm/send/test-${endpointCounter}` }
const signedIn = async (userOptions) => {
  const user = await createUser(userOptions)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return { client, user }
}
const subscribe = async (client) => {
  const endpoint = newEndpoint()
  const response = await client.post('/api/push/subscribe', { endpoint, keys: KEYS })
  assert.equal(response.status, 201)
  return endpoint
}
// A push is sent after the response, so give it a moment; and a moment longer to prove silence.
const waitForCalls = async (count) => { for (let i = 0; i < 40 && calls.length < count; i += 1) await new Promise((r) => setTimeout(r, 25)) }
const settle = () => new Promise((r) => setTimeout(r, 150))

test('subscribing needs a sign-in, and only a real push-service address is accepted', async () => {
  assert.equal((await new ApiClient(baseUrl).post('/api/push/subscribe', { endpoint: newEndpoint(), keys: KEYS })).status, 401)
  const { client } = await signedIn({ role: 'user', floor: FLOOR })
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://evil.example.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com:8443/x', 42, undefined]) {
    assert.equal((await client.post('/api/push/subscribe', { endpoint, keys: KEYS })).status, 400, String(endpoint))
  }
  assert.equal((await client.post('/api/push/subscribe', { endpoint: newEndpoint(), keys: { p256dh: 'short', auth: KEYS.auth } })).status, 400)
  assert.equal(isAllowedEndpoint('https://web.push.apple.com/abc'), true)
  assert.equal(isAllowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'), true)
})

test('a user can keep ten devices, not eleven; DELETE only removes their own', async () => {
  const { client } = await signedIn({ role: 'user', floor: FLOOR })
  const endpoints = []
  for (let i = 0; i < 10; i += 1) endpoints.push(await subscribe(client))
  assert.equal((await client.post('/api/push/subscribe', { endpoint: newEndpoint(), keys: KEYS })).status, 400)
  const other = await signedIn({ role: 'user', floor: FLOOR })
  await other.client.request('DELETE', '/api/push/subscribe', { endpoint: endpoints[0] })
  assert.equal((await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [endpoints[0]])).rowCount, 1)
  await client.request('DELETE', '/api/push/subscribe', { endpoint: endpoints[0] })
  assert.equal((await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [endpoints[0]])).rowCount, 0)
})

test('subscriptions left by ended sessions do not count against the ten-device cap', async () => {
  const { client, user } = await signedIn({ role: 'user', floor: FLOOR })
  for (let i = 0; i < 10; i += 1) {
    await pool.query('INSERT INTO push_subscriptions (user_id, sid, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4, $5)', [user.id, `dead-session-${i}`, newEndpoint(), KEYS.p256dh, KEYS.auth])
  }
  assert.equal((await client.post('/api/push/subscribe', { endpoint: newEndpoint(), keys: KEYS })).status, 201)
  assert.equal((await pool.query('SELECT 1 FROM push_subscriptions WHERE user_id = $1', [user.id])).rowCount, 1, 'the dead rows are cleared')
})

test('an announcement reaches the other signed-in devices once, with generic text, not its author', async () => {
  const manager = await signedIn({ role: 'supervisor' })
  const pharmacist = await signedIn({ role: 'user', floor: FLOOR })
  const managerEndpoint = await subscribe(manager.client)
  const pharmacistEndpoint = await subscribe(pharmacist.client)
  const posted = await manager.client.post('/api/announcements', { message: 'اجتماع الساعة ١٠ — المريض فلان' })
  assert.equal(posted.status, 201)
  await waitForCalls(1); await settle()
  assert.deepEqual(calls.map((call) => call.endpoint), [pharmacistEndpoint])
  assert.notEqual(calls[0].endpoint, managerEndpoint)
  assert.equal(calls[0].payload.body, 'إعلان جديد')
  assert.ok(!JSON.stringify(calls[0].payload).includes('فلان'))
})

test('a device stops receiving once its login session is gone: sign-out, expiry, or a suspended account', async () => {
  const manager = await signedIn({ role: 'supervisor' })
  const a = await signedIn({ role: 'user', floor: FLOOR })
  const b = await signedIn({ role: 'user', floor: FLOOR })
  const c = await signedIn({ role: 'user', floor: FLOOR })
  const d = await signedIn({ role: 'user', floor: FLOOR })
  const aEndpoint = await subscribe(a.client)
  await subscribe(b.client); await subscribe(c.client)
  const dEndpoint = await subscribe(d.client)
  await a.client.post('/api/auth/logout')
  assert.equal((await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [aEndpoint])).rowCount, 0, 'sign-out removes the row')
  await pool.query("UPDATE session SET expire = NOW() - interval '1 minute' WHERE sess::text LIKE $1", [`%"user":{"id":"${b.user.id}"%`])
  await pool.query("UPDATE users SET account_status = 'suspended' WHERE id = $1", [c.user.id])
  await manager.client.post('/api/announcements', { message: 'x' })
  await waitForCalls(1); await settle()
  assert.deepEqual(calls.map((call) => call.endpoint), [dEndpoint])
})

test('the same device handed to another person delivers to that person only', async () => {
  const first = await signedIn({ role: 'user', floor: FLOOR })
  const second = await signedIn({ role: 'user', floor: FLOOR })
  const manager = await signedIn({ role: 'admin' })
  const endpoint = await subscribe(first.client)
  await second.client.post('/api/push/subscribe', { endpoint, keys: KEYS })
  const rows = await pool.query('SELECT user_id FROM push_subscriptions WHERE endpoint = $1', [endpoint])
  assert.deepEqual(rows.rows.map((row) => row.user_id), [second.user.id])
  await manager.client.post('/api/announcements', { message: 'x' })
  await waitForCalls(1); await settle()
  assert.equal(calls.length, 1)
})

test('a new join request alerts admins only, and at most once per ten minutes', async () => {
  const admin = await signedIn({ role: 'admin' })
  const supervisor = await signedIn({ role: 'supervisor' })
  const adminEndpoint = await subscribe(admin.client)
  await subscribe(supervisor.client)
  const register = (n) => new ApiClient(baseUrl).post('/api/auth/register', { fullName: `Applicant ${n}`, username: `applicant${n}`, phone: '0770000000', email: `applicant${n}@example.test`, fingerprintNumber: `f${n}`, password: 'secret-123' })
  assert.equal((await register(1)).status, 201)
  await waitForCalls(1); await settle()
  assert.deepEqual(calls.map((call) => call.endpoint), [adminEndpoint])
  assert.ok(!JSON.stringify(calls[0].payload).includes('Applicant'))
  assert.equal((await register(2)).status, 201)
  await settle()
  assert.equal(calls.length, 1, 'a second sign-up inside ten minutes stays quiet')
})

const chartBody = (overrides = {}) => ({
  floor: FLOOR, ward: WARD, date: todayInBaghdad(),
  patients: [{ rowNumber: 1, name: 'Patient One' }],
  columns: [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }],
  quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 2 }],
  expectedVersion: 0, ...overrides,
})

test('a chart starting today alerts managers once; opening it, completing it, or another day does not', async () => {
  const pharmacist = await signedIn({ role: 'user', floor: FLOOR })
  const manager = await signedIn({ role: 'supervisor' })
  const admin = await signedIn({ role: 'admin' })
  await subscribe(pharmacist.client)
  const managerEndpoint = await subscribe(manager.client)
  const adminEndpoint = await subscribe(admin.client)

  // Opening a ward writes an empty first row: not a start.
  const opened = await pharmacist.client.put('/api/chart', chartBody({ patients: [], quantities: [] }))
  assert.equal(opened.status, 200)
  // Completing, and a chart for another day (copy-forward), are not starts either.
  await pharmacist.client.patch('/api/chart/complete', { floor: FLOOR, ward: WARD, date: todayInBaghdad(), completed: true })
  await pharmacist.client.put('/api/chart', chartBody({ date: '2030-01-01' }))
  await settle()
  assert.equal(calls.length, 0)

  // The real first entries (version 1 after the empty open) announce it once.
  const started = await pharmacist.client.put('/api/chart', chartBody({ expectedVersion: opened.body.version }))
  assert.equal(started.status, 200)
  await waitForCalls(2); await settle()
  assert.deepEqual(calls.map((call) => call.endpoint).sort(), [managerEndpoint, adminEndpoint].sort())
  assert.ok(calls[0].payload.body.includes(`الطابق ${FLOOR}`) && calls[0].payload.body.includes(WARD))
  assert.ok(!JSON.stringify(calls[0].payload).includes('Patient One'))

  await pharmacist.client.put('/api/chart', chartBody({ expectedVersion: started.body.version, quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 5 }] }))
  await settle()
  assert.equal(calls.length, 2, 'later saves are silent')
})

test('a failing push service never fails the request, and a gone subscription is dropped', async () => {
  const manager = await signedIn({ role: 'supervisor' })
  const pharmacist = await signedIn({ role: 'user', floor: FLOOR })
  const endpoint = await subscribe(pharmacist.client)
  failWith = new Error('push service down')
  assert.equal((await manager.client.post('/api/announcements', { message: 'x' })).status, 201)
  await settle()
  assert.equal((await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [endpoint])).rowCount, 1, 'a transient error keeps it')
  failWith = Object.assign(new Error('gone'), { statusCode: 410 })
  assert.equal((await manager.client.post('/api/announcements', { message: 'y' })).status, 201)
  await settle()
  assert.equal((await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [endpoint])).rowCount, 0, '410 removes it')
  const saved = await pharmacist.client.put('/api/chart', chartBody())
  assert.equal(saved.status, 200)
})
