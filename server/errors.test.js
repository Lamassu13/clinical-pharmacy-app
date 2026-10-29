import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { errorText, flushErrors } from './errors.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

// A developer's shell with real Telegram settings must never make these tests send a message.
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.TELEGRAM_CHAT_ID

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

test('errors: a signed-in user can report but not read; anonymous cannot report; text is cut to 300', async () => {
  const { client: admin } = await loginAs({ role: 'admin' })
  const { client: pharmacist, user } = await loginAs({ role: 'user', floor: 5 })
  assert.equal((await new ApiClient(baseUrl).post('/api/errors', { msg: 'x' })).status, 401)
  assert.equal((await pharmacist.post('/api/errors', { msg: '' })).status, 400)
  assert.equal((await pharmacist.post('/api/errors', { kind: 'save', msg: 'ع'.repeat(500), screen: 'الجارت', device: 'iPhone/iPad' })).status, 204)
  assert.equal((await pharmacist.get('/api/errors')).status, 403)
  const { errors } = (await admin.get('/api/errors')).body
  assert.equal(errors.length, 1)
  assert.equal(errors[0].msg.length, 300)
  assert.equal(errors[0].username, user.username)
  assert.equal(errors[0].screen, 'الجارت')
})

test('errors: clearing deletes only the rows the admin was shown', async () => {
  const { client: admin } = await loginAs({ role: 'admin' })
  const { client: pharmacist } = await loginAs({ role: 'user', floor: 5 })
  await pharmacist.post('/api/errors', { msg: 'first' })
  const shown = (await admin.get('/api/errors')).body.errors.map((row) => row.id)
  await pharmacist.post('/api/errors', { msg: 'arrived while the page was open' })
  const response = await fetch(`${baseUrl}/api/errors`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', cookie: [...admin.cookies].map(([n, v]) => `${n}=${v}`).join('; ') }, body: JSON.stringify({ ids: shown }) })
  assert.equal(response.status, 204)
  assert.deepEqual((await admin.get('/api/errors')).body.errors.map((row) => row.msg), ['arrived while the page was open'])
})

test('errorText: same message from several devices is one counted line, names and time in Baghdad', () => {
  const text = errorText([
    { msg: 'تعذّر حفظ الجارت', at: '2026-01-10T08:00:00Z', username: 'amy', screen: 'الجارت', device: 'iPhone/iPad' },
    { msg: 'تعذّر حفظ الجارت', at: '2026-01-10T09:00:00Z', username: 'ben', screen: 'الحبوب', device: 'Android' },
    { msg: 'x is not defined', at: '2026-01-10T07:00:00Z', username: 'cara', screen: 'الجارت', device: 'Computer' },
  ])
  assert.match(text, /3 أخطاء جديدة/)
  assert.ok(text.indexOf('×2 تعذّر حفظ الجارت') > 0 && text.indexOf('×2') < text.indexOf('x is not defined'))
  assert.match(text, /amy, ben · الجارت, الحبوب · iPhone\/iPad, Android · last 01-10 12:00/) // 09:00 UTC = 12:00 Baghdad
})

test('flushErrors: sends all unsent once, marks them sent, and a failed send keeps them for the next try', async () => {
  const { client: pharmacist } = await loginAs({ role: 'user', floor: 5 })
  await pharmacist.post('/api/errors', { msg: 'one' })
  await pharmacist.post('/api/errors', { msg: 'two' })
  await assert.rejects(flushErrors(async () => { throw new Error('telegram down') }))
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM app_errors WHERE NOT notified')).rows[0].n, 2)
  const messages = []
  assert.equal(await flushErrors(async (text) => { messages.push(text) }), 2)
  assert.equal(messages.length, 1)
  assert.equal(await flushErrors(async () => { throw new Error('must not be called') }), 0, 'nothing new → no message')
})

test('errorText: a flood fits one Telegram message and says how many lines were left out', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ msg: `خطأ رقم ${i} ${'س'.repeat(120)}`, at: '2026-01-10T08:00:00Z', username: 'amy', screen: 'الجارت', device: 'Android' }))
  const text = errorText(rows)
  assert.ok(text.length <= 3900)
  assert.match(text, /… \+\d+ رسائل أخرى/)
})
