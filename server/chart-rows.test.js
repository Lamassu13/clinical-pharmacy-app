import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'
import { MAX_PATIENT_ROWS } from './validation.js'

// «+ صف»: a chart may grow past its first printed page (41 rows) up to MAX_PATIENT_ROWS (80).
const FLOOR = 5
const WARD = 'ردهة رجال'
const DATE = '2026-02-12'
const MED = 'Aspirin 100mg Tab'
const KEY = 'aspirin 100mg tab'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(async () => {
  await resetDatabase()
  await pool.query('INSERT INTO medicines (name) VALUES ($1)', [MED])
})

const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}
// `rows` blank-or-named patient rows 1..rows, a dose on each named one.
const body = (rows, named, extra = {}) => ({
  floor: FLOOR, ward: WARD, date: DATE, expectedVersion: 0,
  patients: Array.from({ length: rows }, (_, i) => ({ rowNumber: i + 1, name: named[i + 1] || '', patientId: named[i + 1] ? String(1000 + i) : '' })),
  columns: [{ columnNumber: 1, medicineName: MED }],
  quantities: Object.keys(named).map((row) => ({ rowNumber: Number(row), columnNumber: 1, quantity: 2 })),
  ...extra,
})
const chartOf = (client) => client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)

test('rows past 41 are saved and come back: 41 → 60 → 80 rows, each patient and dose on its own row', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const named = { 1: 'أول', 42: 'الثاني والأربعون', 60: 'الستون', 80: 'الثمانون' }
  assert.equal((await client.put('/api/chart', body(80, named))).status, 200)
  const chart = (await chartOf(client)).body.chart
  assert.equal(chart.patients.length, 80)
  assert.deepEqual(chart.patients.filter((p) => p.patient_name).map((p) => [p.row_number, p.patient_name]), [[1, 'أول'], [42, 'الثاني والأربعون'], [60, 'الستون'], [80, 'الثمانون']])
  assert.deepEqual(chart.quantities.map((q) => q.row_number).sort((a, b) => a - b), [1, 42, 60, 80])
  // A second save of the same chart (one row more filled, the version moved on) replaces them all, none stale.
  const again = await client.put('/api/chart', { ...body(70, { 1: 'أول', 65: 'الخامس والستون' }), expectedVersion: chart.version })
  assert.equal(again.status, 200)
  const after = (await chartOf(client)).body.chart
  assert.deepEqual(after.patients.filter((p) => p.patient_name).map((p) => p.row_number), [1, 65])
  assert.equal(after.patients.length, 70)
})

test('the ceiling holds: a row past 80 is not stored (server and database), and 41 rows still save as before', async () => {
  assert.equal(MAX_PATIENT_ROWS, 80)
  const client = await loginAs({ role: 'user', floor: FLOOR })
  assert.equal((await client.put('/api/chart', body(41, { 41: 'الأخير' }))).status, 200)
  const over = await client.put('/api/chart', { ...body(80, { 5: 'x' }), patients: [{ rowNumber: 81, name: 'خارج', patientId: '' }, { rowNumber: 5, name: 'x', patientId: '' }], quantities: [{ rowNumber: 81, columnNumber: 1, quantity: 3 }], expectedVersion: (await chartOf(client)).body.chart.version })
  assert.equal(over.status, 200)
  const stored = (await pool.query('SELECT row_number FROM chart_patients ORDER BY row_number')).rows.map((r) => r.row_number)
  assert.deepEqual(stored, [5])
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM chart_quantities')).rows[0].n, 0)
  // The database itself refuses a row past the ceiling (the CHECKs in schema.sql).
  const chartId = (await pool.query('SELECT id FROM daily_charts')).rows[0].id
  await assert.rejects(pool.query("INSERT INTO chart_patients (chart_id, row_number, patient_name) VALUES ($1, 81, 'x')", [chartId]), /check/i)
  await assert.rejects(pool.query('INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) VALUES ($1, 81, 1, 1)', [chartId]), /check/i)
  await pool.query("INSERT INTO chart_patients (chart_id, row_number, patient_name) VALUES ($1, 80, 'x')", [chartId]) // 80 is allowed
})

test('the pill form and the room numbers work on rows past 41, and deleting a row there pulls the rows below it up', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  assert.equal((await client.put('/api/chart', body(60, { 50: 'خمسون', 51: 'واحد وخمسون' }))).status, 200)
  const saved = await client.put('/api/pills', { floor: FLOOR, ward: WARD, date: DATE, changes: { entries: [{ patientRowNumber: 50, medicineKey: KEY, pillQty: '5' }, { patientRowNumber: 51, medicineKey: KEY, pillQty: '6' }], rooms: { 50: '12', 51: '13' } } })
  assert.equal(saved.status, 200)
  const pills = (await client.get(`/api/pills?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)).body.pills
  assert.deepEqual(pills.patients.map((p) => [p.rowNumber, p.name]), [[50, 'خمسون'], [51, 'واحد وخمسون']])
  assert.deepEqual(pills.entries.map((e) => [e.patientRowNumber, e.pillQty]).sort(), [[50, '5'], [51, '6']])
  assert.deepEqual(pills.rooms, { 50: '12', 51: '13' })
  // The row at 50 is removed: row 51's pill data and room move up to 50 (the chart itself is re-saved by the app, as for any row).
  const removed = await client.post('/api/chart/collapse-row', { floor: FLOOR, ward: WARD, date: DATE, rowNumber: 50 })
  assert.equal(removed.status, 200)
  assert.deepEqual((await pool.query('SELECT patient_row_number, pill_qty FROM pill_entries ORDER BY patient_row_number')).rows.map((r) => [r.patient_row_number, r.pill_qty]), [[50, '6']])
  assert.deepEqual((await pool.query('SELECT patient_row_number, room_number FROM pill_patient_meta ORDER BY patient_row_number')).rows.map((r) => [r.patient_row_number, r.room_number]), [[50, '13']])
  // And the undo puts both back on their own rows.
  assert.equal((await client.post('/api/chart/expand-row', { floor: FLOOR, ward: WARD, date: DATE, rowNumber: 50, removed: removed.body.removed })).status, 200)
  assert.deepEqual((await pool.query('SELECT patient_row_number, pill_qty FROM pill_entries ORDER BY patient_row_number')).rows.map((r) => [r.patient_row_number, r.pill_qty]), [[50, '5'], [51, '6']])
})
