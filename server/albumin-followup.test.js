import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

const WARD = 'ردهة رجال'
let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(() => resetDatabase())

const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}
const form = (client, floor, name, fields) => client.post('/api/drug-requests', { kind: 'albumin', floor, ward: WARD, date: '2026-11-06', name, patientId: '41', fields })

test('albumin follow-up: the day’s albumin forms as rows, scoped to the user; the typed parts kept per scope', async () => {
  const supervisor = await loginAs({ role: 'supervisor' })
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  const other = await loginAs({ role: 'user', floor: 2 })
  assert.equal((await form(pharmacist, 5, 'سارة', { sex: 'أنثى', age: '30', count: '2', serumAlbumin: '1.6', scr: '0.6', treatmentDay: '3', diagnosis: 'Bed sore' })).status, 201)
  assert.equal((await other.post('/api/drug-requests', { kind: 'albumin', floor: 2, ward: WARD, date: '2026-11-06', name: 'هدى', patientId: '', fields: {} })).status, 201)
  await pharmacist.patch('/api/drug-requests/1/ticks', { ticks: ['i16'] })

  const all = (await supervisor.get('/api/albumin-followup?date=2026-11-06')).body
  assert.deepEqual(all.rows.map((row) => [row.name, row.floor, row.ward]), [['هدى', 2, WARD], ['سارة', 5, WARD]])
  const mine = (await pharmacist.get('/api/albumin-followup?date=2026-11-06')).body
  assert.deepEqual(mine.rows.map((row) => row.name), ['سارة'])
  assert.deepEqual([mine.rows[0].fields.treatmentDay, mine.rows[0].fields.serumAlbumin, mine.rows[0].fields.scr, mine.rows[0].fields.count, mine.rows[0].ticks], ['3', '1.6', '0.6', '2', ['i16']])
  assert.equal((await supervisor.get('/api/albumin-followup?date=2026-11-07')).body.rows.length, 0)

  // The typed parts: cleaned, empty rows dropped, and kept per scope (the manager's is not the floor's).
  const doc = { extraRows: [{ day: 'D1', name: 'علي', ward: 'غ3', junk: 'x' }, {}], notIndicated: [{ name: 'وجيهة', reason: 'Elevated s.albumin' }], notes: ' ملاحظة ' }
  const saved = (await supervisor.put('/api/albumin-followup', { date: '2026-11-06', doc })).body.doc
  assert.deepEqual(saved.extraRows.map((row) => [row.day, row.name, row.ward, 'junk' in row]), [['D1', 'علي', 'غ3', false]])
  assert.equal(saved.notIndicated[0].reason, 'Elevated s.albumin')
  assert.equal(saved.notes, 'ملاحظة')
  assert.deepEqual((await supervisor.get('/api/albumin-followup?date=2026-11-06')).body.doc, saved)
  assert.deepEqual((await pharmacist.get('/api/albumin-followup?date=2026-11-06')).body.doc, { extraRows: [], notIndicated: [], notes: '' })

  assert.equal((await supervisor.get('/api/albumin-followup')).status, 400)
  assert.equal((await supervisor.put('/api/albumin-followup', { date: 'nope', doc })).status, 400)
  assert.equal((await new ApiClient(baseUrl).get('/api/albumin-followup?date=2026-11-06')).status, 401)
})
