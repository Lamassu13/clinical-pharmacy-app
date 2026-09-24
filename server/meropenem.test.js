import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'
import { buildMeropenemForm, doseText } from './meropenem.js'

const FLOOR = 5
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

const cell = (date, name, quantity = 3, extra = {}) => ({ date, name, patientId: '', medicine: 'Meronem 1000gm Vial', quantity, ...extra })

test('doseText: the catalogue\'s "gm" means mg, and a quantity divisible by 3 reads as a per-dose amount × 3', () => {
  assert.equal(doseText('Meronem 1000gm Vial', 3), '1g × 3')
  assert.equal(doseText('Meronem 1000gm Vial', 6), '2g × 3')
  assert.equal(doseText('Meronem 500gm Vial', 3), '500mg × 3')
  assert.equal(doseText('Meronem 500gm Vial', 6), '1g × 3')
  assert.equal(doseText('Meronem 1000gm Vial', 2), '1g × 2')
  assert.equal(doseText('Meropenem 1g vial', 3), '1g × 3')
})

test('buildMeropenemForm: consecutive days count D1, D2, D3 with the dose from the chart', () => {
  const form = buildMeropenemForm({
    date: '2026-09-23',
    cells: [cell('2026-09-21', 'علي'), cell('2026-09-22', 'علي'), cell('2026-09-23', 'علي')],
    chartedDates: ['2026-09-21', '2026-09-22', '2026-09-23'],
  })
  assert.deepEqual(form.dates, ['2026-09-21', '2026-09-22', '2026-09-23'])
  assert.deepEqual(form.patients, [{ name: 'علي', patientId: '', dose: '1g × 3', days: { '2026-09-21': 1, '2026-09-22': 2, '2026-09-23': 3 } }])
})

test('buildMeropenemForm: a Friday with no chart keeps counting; a charted day without Meronem restarts at D1', () => {
  const form = buildMeropenemForm({
    date: '2026-09-29',
    cells: [cell('2026-09-24', 'علي'), cell('2026-09-26', 'علي'), cell('2026-09-29', 'علي')],
    // 25th Friday: no chart. 27th/28th: charted, but علي has no Meronem → course ends.
    chartedDates: ['2026-09-24', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29'],
  })
  assert.deepEqual(form.patients[0].days, { '2026-09-24': 1, '2026-09-25': 2, '2026-09-26': 3, '2026-09-29': 1 })
})

test('buildMeropenemForm: a course started last month keeps its real D-number on the 1st', () => {
  const form = buildMeropenemForm({
    date: '2026-10-01',
    cells: [cell('2026-09-29', 'علي'), cell('2026-09-30', 'علي'), cell('2026-10-01', 'علي')],
    chartedDates: ['2026-09-29', '2026-09-30', '2026-10-01'],
  })
  assert.deepEqual(form.dates, ['2026-10-01'])
  assert.deepEqual(form.patients[0].days, { '2026-10-01': 3 })
})

test('buildMeropenemForm: a name-only day and a day with the ID are one patient; the latest dose shows', () => {
  const form = buildMeropenemForm({
    date: '2026-09-22',
    cells: [
      cell('2026-09-21', 'علي حسين'),
      cell('2026-09-22', 'علي  حسين', 2, { patientId: '555', medicine: 'Meronem 500gm Vial' }),
      cell('2026-09-22', 'علي  حسين', 1, { patientId: '555' }),
    ],
    chartedDates: ['2026-09-21', '2026-09-22'],
  })
  assert.equal(form.patients.length, 1)
  assert.deepEqual(form.patients[0], { name: 'علي حسين', patientId: '555', dose: '500mg × 2 + 1g × 1', days: { '2026-09-21': 1, '2026-09-22': 2 } })
})

test('buildMeropenemForm: a course that ended last month is not listed this month', () => {
  const form = buildMeropenemForm({ date: '2026-10-05', cells: [cell('2026-09-20', 'علي')], chartedDates: ['2026-09-20', '2026-10-05'] })
  assert.deepEqual(form.patients, [])
})

// Direct chart seed: patients = [{ row, name, id? }], meronem on column 1 for the listed rows.
const seedDay = async ({ wardId, createdBy, date, patients, meronemRows, medicineId }) => {
  const chartId = (await pool.query(
    "INSERT INTO daily_charts (ward_id, chart_date, slot, created_by, updated_by, version) VALUES ($1, $2, 'main', $3, $3, 1) RETURNING id",
    [wardId, date, createdBy],
  )).rows[0].id
  for (const p of patients) await pool.query('INSERT INTO chart_patients (chart_id, row_number, patient_name, patient_id) VALUES ($1, $2, $3, $4)', [chartId, p.row, p.name, p.id ?? ''])
  await pool.query('INSERT INTO chart_columns (chart_id, column_number, medicine_id) VALUES ($1, 1, $2)', [chartId, medicineId])
  for (const row of meronemRows) await pool.query('INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) VALUES ($1, $2, 1, 3)', [chartId, row])
}

test('GET /api/meropenem: builds the form from the ward\'s saved charts, and refuses another floor\'s user', async () => {
  const seeder = await createUser({ role: 'admin' })
  const medicineId = (await pool.query("INSERT INTO medicines (name) VALUES ('Meronem 1000gm Vial') RETURNING id")).rows[0].id
  const wardId = (await pool.query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, false) RETURNING id', [FLOOR, WARD])).rows[0].id
  const patients = [{ row: 1, name: 'علي', id: '123' }, { row: 2, name: 'حسن' }]
  await seedDay({ wardId, createdBy: seeder.id, date: '2026-09-24', patients, meronemRows: [1], medicineId })
  await seedDay({ wardId, createdBy: seeder.id, date: '2026-09-26', patients, meronemRows: [1], medicineId })

  const client = await loginAs({ role: 'user', floor: FLOOR })
  const res = await client.get(`/api/meropenem?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-09-26`)
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.form.patients, [{ name: 'علي', patientId: '123', dose: '1g × 3', days: { '2026-09-24': 1, '2026-09-25': 2, '2026-09-26': 3 } }])

  const outsider = await loginAs({ role: 'user', floor: 6 })
  assert.equal((await outsider.get(`/api/meropenem?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-09-26`)).status, 403)
})
