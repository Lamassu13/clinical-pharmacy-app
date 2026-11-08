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

test('albumin follow-up: a floor sheet holds that floor’s albumin forms only (a manager too); the typed parts are kept per floor', async () => {
  const supervisor = await loginAs({ role: 'supervisor' })
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  const other = await loginAs({ role: 'user', floor: 2 })
  assert.equal((await form(pharmacist, 5, 'سارة', { sex: 'أنثى', age: '30', count: '2', serumAlbumin: '1.6', scr: '0.6', treatmentDay: '3', diagnosis: 'Bed sore' })).status, 201)
  assert.equal((await other.post('/api/drug-requests', { kind: 'albumin', floor: 2, ward: WARD, date: '2026-11-06', name: 'هدى', patientId: '', fields: {} })).status, 201)
  await pharmacist.patch('/api/drug-requests/1/ticks', { ticks: ['i16'] })
  const sheet = (client, floor, date = '2026-11-06') => client.get(`/api/albumin-followup?date=${date}&floor=${floor}`)

  // Floor 5's sheet: its form only, with the cells the sheet shows. A manager sees the same, not the hospital.
  const mine = (await sheet(pharmacist, 5)).body
  assert.deepEqual(mine.rows.map((row) => [row.name, row.floor, row.ward]), [['سارة', 5, WARD]])
  assert.deepEqual([mine.rows[0].fields.treatmentDay, mine.rows[0].fields.serumAlbumin, mine.rows[0].fields.scr, mine.rows[0].fields.count, mine.rows[0].ticks], ['3', '1.6', '0.6', '2', ['i16']])
  assert.deepEqual((await sheet(supervisor, 5)).body.rows.map((row) => row.name), ['سارة'])
  assert.deepEqual((await sheet(supervisor, 2)).body.rows.map((row) => row.name), ['هدى'])
  assert.equal((await sheet(supervisor, 5, '2026-11-07')).body.rows.length, 0)
  // A floor user may open only their own floor.
  assert.equal((await sheet(pharmacist, 2)).status, 403)
  assert.equal((await sheet(pharmacist, 'x')).status, 400)

  // The typed parts: cleaned, empty rows dropped, kept per floor.
  const doc = { extraRows: [{ day: 'D1', name: 'علي', ward: 'غ3', junk: 'x' }, {}], notIndicated: [{ name: 'وجيهة', reason: 'Elevated s.albumin' }], notes: ' ملاحظة ' }
  const saved = (await pharmacist.put('/api/albumin-followup', { date: '2026-11-06', floor: 5, doc })).body.doc
  assert.deepEqual(saved.extraRows.map((row) => [row.day, row.name, row.ward, 'junk' in row]), [['D1', 'علي', 'غ3', false]])
  assert.equal(saved.notIndicated[0].reason, 'Elevated s.albumin')
  assert.equal(saved.notes, 'ملاحظة')
  assert.deepEqual((await sheet(supervisor, 5)).body.doc, saved)
  assert.deepEqual((await sheet(supervisor, 2)).body.doc, { extraRows: [], notIndicated: [], notes: '' })
  assert.equal((await other.put('/api/albumin-followup', { date: '2026-11-06', floor: 5, doc })).status, 403)

  assert.equal((await supervisor.get('/api/albumin-followup?floor=5')).status, 400)
  assert.equal((await supervisor.put('/api/albumin-followup', { date: 'nope', floor: 5, doc })).status, 400)
  assert.equal((await supervisor.put('/api/albumin-followup', { date: '2026-11-06', doc })).status, 400)
  assert.equal((await new ApiClient(baseUrl).get('/api/albumin-followup?date=2026-11-06&floor=5')).status, 401)
})
