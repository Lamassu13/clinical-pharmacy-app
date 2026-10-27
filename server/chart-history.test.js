import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { diffChart, pruneChartChanges } from './chart-history.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(async () => {
  await resetDatabase()
  await pool.query("INSERT INTO medicines (name) VALUES ('Amoxicillin Cap'), ('Aspirin Tab')")
})

const FLOOR = 5
const WARD = 'ردهة رجال'
const DATE = '2026-01-15'
const HISTORY = `/api/chart/history?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`
const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  const fullName = (await pool.query('SELECT full_name FROM users WHERE id = $1', [user.id])).rows[0].full_name
  return { client, user: { ...user, fullName } }
}
const save = (client, version, patients, quantities, columns = [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }]) =>
  client.put('/api/chart', { floor: FLOOR, ward: WARD, date: DATE, patients, columns, quantities, expectedVersion: version })
const patient = (rowNumber, name, patientId = '') => ({ rowNumber, name, patientId })
const dose = (rowNumber, columnNumber, quantity) => ({ rowNumber, columnNumber, quantity })

test('history: first save is one "created" line, a dose edit logs old → new with who', async () => {
  const { client, user } = await loginAs({ role: 'user', floor: FLOOR })
  await save(client, 0, [patient(1, 'Ali', '11'), patient(2, 'Omar', '22')], [dose(1, 1, 2), dose(2, 1, 1)])
  await save(client, 1, [patient(1, 'Ali', '11'), patient(2, 'Omar', '22')], [dose(1, 1, 3), dose(2, 1, 1)])
  const { saves } = (await client.get(HISTORY)).body
  assert.equal(saves.length, 2)
  assert.deepEqual(saves[1].changes.map((c) => [c.kind, c.to]), [['created', '2 مريض، 2 جرعة']])
  assert.equal(saves[0].userName, user.fullName)
  assert.deepEqual(saves[0].changes.map((c) => [c.kind, c.label.patient, c.label.medicine, c.from, c.to]), [['qty', 'Ali', 'Amoxicillin Cap', '2', '3']])
})

test('history: deleting a patient pulls rows up but logs only that patient, not every row below', async () => {
  const { client } = await loginAs({ role: 'user', floor: FLOOR })
  await save(client, 0, [patient(1, 'A', '1'), patient(2, 'B', '2'), patient(3, 'C', '3')], [dose(1, 1, 1), dose(2, 1, 2), dose(3, 1, 3)])
  // B removed, C moves up to row 2: same doses, new row numbers.
  await save(client, 1, [patient(1, 'A', '1'), patient(2, 'C', '3')], [dose(1, 1, 1), dose(2, 1, 3)])
  const latest = (await client.get(HISTORY)).body.saves[0]
  assert.deepEqual(latest.changes.map((c) => [c.kind, c.from, c.to]), [['patient', 'B', ''], ['qty', '2', '']])
})

test('history: a wiped grid logs every lost cell; unchanged saves log nothing', async () => {
  const { client } = await loginAs({ role: 'user', floor: FLOOR })
  await save(client, 0, [patient(1, 'A'), patient(2, 'B')], [dose(1, 1, 1), dose(2, 1, 2)])
  await save(client, 1, [patient(1, 'A'), patient(2, 'B')], [dose(1, 1, 1), dose(2, 1, 2)]) // identical
  await save(client, 2, [], [], [])
  const { saves } = (await client.get(HISTORY)).body
  assert.equal(saves.length, 2) // created + the wipe; the identical save left no entry
  assert.equal(saves[0].changes.filter((c) => c.kind === 'qty').length, 2)
  assert.equal(saves[0].changes.filter((c) => c.kind === 'medicine').length, 1)
})

test('history: another floor cannot read it; a deleted user keeps their name; a history failure never fails the save', async () => {
  const { client, user } = await loginAs({ role: 'user', floor: FLOOR })
  await save(client, 0, [patient(1, 'A')], [dose(1, 1, 1)])
  const { client: outsider } = await loginAs({ role: 'user', floor: 6 })
  assert.equal((await outsider.get(HISTORY)).status, 403)

  await pool.query('DELETE FROM users WHERE id = $1', [user.id]).catch(() => {})
  const { client: admin } = await loginAs({ role: 'admin' })
  assert.equal((await admin.get(HISTORY)).body.saves[0].userName, user.fullName)

  await pool.query('ALTER TABLE chart_changes RENAME TO chart_changes_away')
  try {
    const result = await save(admin, 1, [patient(1, 'A'), patient(2, 'B')], [dose(1, 1, 1)])
    assert.equal(result.status, 200, 'the chart must save even when history cannot be written')
    assert.equal((await admin.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)).body.chart.patients.length, 2)
  } finally { await pool.query('ALTER TABLE chart_changes_away RENAME TO chart_changes') }
})

test('diffChart: a renamed catalogue medicine is not a chart change; changing a column medicine is', () => {
  const base = { patients: [{ rowNumber: 1, name: 'A', patientId: '' }], columns: [{ columnNumber: 1, medicineId: 7, customName: null }], quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 1 }] }
  assert.deepEqual(diffChart(base, structuredClone(base)), [])
  const swapped = { ...base, columns: [{ columnNumber: 1, medicineId: 8, customName: null }] }
  assert.deepEqual(diffChart(base, swapped).map((c) => c.kind), ['medicine'])
})

test('history: adding an ID or fixing a typo is one change, not a remove + add with every dose', async () => {
  const { client } = await loginAs({ role: 'user', floor: FLOOR })
  await save(client, 0, [patient(1, 'Ali')], [dose(1, 1, 2)])
  await save(client, 1, [patient(1, 'Ali', '55')], [dose(1, 1, 2)])
  await save(client, 2, [patient(1, 'Aly', '55')], [dose(1, 1, 2)])
  const [rename, addId] = (await client.get(HISTORY)).body.saves
  assert.deepEqual(addId.changes.map((c) => [c.kind, c.from, c.to]), [['patient_id', '', '55']])
  assert.deepEqual(rename.changes.map((c) => [c.kind, c.from, c.to]), [['patient', 'Ali', 'Aly']])
})

test('history: entries older than 90 days are pruned, newer ones kept', async () => {
  const { client } = await loginAs({ role: 'user', floor: FLOOR })
  await save(client, 0, [patient(1, 'A')], [dose(1, 1, 1)])
  await pool.query("INSERT INTO chart_changes (chart_id, version, kind, at) SELECT chart_id, 99, 'qty', NOW() - INTERVAL '91 days' FROM chart_changes LIMIT 1")
  await pool.query("INSERT INTO chart_changes (chart_id, version, kind, at) SELECT chart_id, 98, 'qty', NOW() - INTERVAL '89 days' FROM chart_changes LIMIT 1")
  await pruneChartChanges(pool)
  const versions = (await pool.query('SELECT version FROM chart_changes ORDER BY version')).rows.map((row) => row.version)
  assert.deepEqual(versions, [1, 98])
})
