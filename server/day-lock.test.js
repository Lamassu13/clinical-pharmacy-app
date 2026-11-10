import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'
import { dayLockSettings, tomorrowInBaghdad } from './day-lock.js'
import { todayInBaghdad } from './push.js'

// The today-only rule (./day-lock.js): a pharmacist writes to today only; a manager to any day; the
// copy to the next day may write tomorrow's medicine columns. The rest of the suite runs with it off.
const FLOOR = 2
const WARD = 'ردهة رجال'
const MED = 'Aspirin 100mg Tab'
const TODAY = todayInBaghdad()
const YESTERDAY = new Date(Date.parse(`${TODAY}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
const TOMORROW = tomorrowInBaghdad()

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)); dayLockSettings.enabled = true })
test.after(async () => { dayLockSettings.enabled = false; server.close(); await pool.end() })
test.beforeEach(async () => {
  await resetDatabase()
  await pool.query('INSERT INTO medicines (name) SELECT unnest($1::text[])', [[MED, 'Meronem 1000gm Vial']])
})

const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}
const chart = (date, { patients = true, quantities = true } = {}) => ({
  floor: FLOOR, ward: WARD, date, slot: 'main', expectedVersion: 0,
  patients: patients ? [{ rowNumber: 1, name: 'علي حسن', patientId: '501' }] : [],
  columns: [{ columnNumber: 1, medicineName: MED }],
  quantities: quantities ? [{ rowNumber: 1, columnNumber: 1, quantity: 2 }] : [],
})
const place = (date, extra = {}) => ({ floor: FLOOR, ward: WARD, date, slot: 'main', ...extra })

test('tomorrow is the day after today in Baghdad', () => {
  assert.equal(Date.parse(`${TOMORROW}T00:00:00Z`) - Date.parse(`${TODAY}T00:00:00Z`), 86400000)
})

test('the chart: a pharmacist saves today only; a manager any day; the copy to the next day passes', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const supervisor = await loginAs({ role: 'supervisor' })

  assert.equal((await pharmacist.put('/api/chart', chart(TODAY))).status, 200)
  const past = await pharmacist.put('/api/chart', chart(YESTERDAY))
  assert.equal(past.status, 403)
  assert.equal(past.body.dayLocked, true)
  assert.equal((await pharmacist.put('/api/chart', chart(TOMORROW))).status, 403, 'tomorrow with a patient')
  assert.equal((await pharmacist.put('/api/chart', chart(TOMORROW, { quantities: false }))).status, 403, 'tomorrow with a patient but no dose')
  // «نسخ الأدوية إلى اليوم التالي»: tomorrow's medicine columns, no patient, no dose.
  assert.equal((await pharmacist.put('/api/chart', chart(TOMORROW, { patients: false, quantities: false }))).status, 200)
  // …but only tomorrow: not a day further on, nor yesterday.
  assert.equal((await pharmacist.put('/api/chart', chart(YESTERDAY, { patients: false, quantities: false }))).status, 403)

  assert.equal((await supervisor.put('/api/chart', chart(YESTERDAY))).status, 200)
  const stored = await pool.query('SELECT chart_date::text AS date FROM daily_charts ORDER BY chart_date')
  assert.deepEqual(stored.rows.map((row) => row.date), [YESTERDAY, TODAY, TOMORROW])
})

test('everything else written per day: refused on another day for a pharmacist, allowed for a manager', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const admin = await loginAs({ role: 'admin' })
  assert.equal((await admin.put('/api/chart', chart(YESTERDAY))).status, 200)

  const writes = [
    ['PUT', '/api/chart/room', place(YESTERDAY, { rowNumber: 1, room: '3' })],
    ['PATCH', '/api/chart/complete', place(YESTERDAY, { completed: true })],
    ['POST', '/api/chart/collapse-row', place(YESTERDAY, { rowNumber: 1 })],
    ['PUT', '/api/ward-note', place(YESTERDAY, { body: 'ملاحظة' })],
    ['PUT', '/api/receipts', place(YESTERDAY, { name: 'علي حسن', patientId: '501', received: true })],
    ['PUT', '/api/pills', place(YESTERDAY, { changes: { entries: [{ patientRowNumber: 1, medicineKey: MED, doseTime: '', usageMethod: '', note: 'x' }], rooms: {} } })],
    ['POST', '/api/drug-requests', place(YESTERDAY, { kind: 'meropenem', name: 'علي حسن', patientId: '501', fields: { age: '50' } })],
    ['PUT', '/api/course-day', place(YESTERDAY, { patientKey: 'id:501', drugKey: 'meropenem', anchorDate: YESTERDAY, n: 3 })],
  ]
  const call = (client, [method, path, body]) => client.request(method, path, body)
  for (const write of writes) {
    const refused = await call(pharmacist, write)
    assert.equal(refused.status, 403, `${write[0]} ${write[1]}`)
    assert.equal(refused.body.dayLocked, true, `${write[0]} ${write[1]} says why`)
  }
  for (const write of writes) assert.ok((await call(admin, write)).status < 400, `manager: ${write[0]} ${write[1]}`)

  // A form already saved on yesterday: a pharmacist can no longer edit, tick or delete it.
  const form = (await admin.get(`/api/drug-requests?${new URLSearchParams({ kind: 'meropenem', ...place(YESTERDAY) })}`)).body.requests[0]
  assert.ok(form)
  for (const [method, path, body] of [['PUT', `/api/drug-requests/${form.id}`, { name: 'علي حسن', patientId: '501', fields: {} }], ['PATCH', `/api/drug-requests/${form.id}/ticks`, { ticks: ['cap'] }], ['DELETE', `/api/drug-requests/${form.id}`]]) {
    const refused = await pharmacist.request(method, path, body)
    assert.equal(refused.status, 403, `${method} ${path}`)
    assert.equal(refused.body.dayLocked, true)
  }
  assert.equal((await admin.request('PATCH', `/api/drug-requests/${form.id}/ticks`, { ticks: ['cap'] })).status, 200)

  // Today, the same pharmacist writes every one of them.
  assert.equal((await pharmacist.put('/api/chart', chart(TODAY))).status, 200)
  assert.equal((await pharmacist.put('/api/ward-note', place(TODAY, { body: 'ملاحظة اليوم' }))).status, 200)
  assert.equal((await pharmacist.put('/api/receipts', place(TODAY, { name: 'علي حسن', patientId: '501', received: true }))).status, 200)
  assert.equal((await pharmacist.patch('/api/chart/complete', place(TODAY, { completed: true }))).status, 200)
  assert.equal((await pharmacist.post('/api/drug-requests', place(TODAY, { kind: 'meropenem', name: 'علي حسن', patientId: '501', fields: {} }))).status, 201)
})

test('the long antibiotic courses: a pharmacist reads the last week up to today; a manager any date', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const admin = await loginAs({ role: 'admin' })
  const daysAgo = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10)
  const ask = (client, date, floor = `&floor=${FLOOR}`) => client.get(`/api/antibiotics/long?date=${date}${floor}`)
  assert.equal((await ask(pharmacist, TODAY)).status, 200)
  assert.equal((await ask(pharmacist, daysAgo(7))).status, 200)
  const old = await ask(pharmacist, daysAgo(8))
  assert.equal(old.status, 403)
  assert.equal(old.body.outOfRange, true)
  assert.equal((await ask(pharmacist, TOMORROW)).status, 403)
  assert.equal((await ask(admin, daysAgo(60), '')).status, 200)
  assert.equal((await ask(admin, daysAgo(60))).status, 200)
})
