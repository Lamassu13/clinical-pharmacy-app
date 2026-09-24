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

const A = { floor: 5, ward: 'ردهة رجال' }
const B = { floor: 8, ward: 'الردهة الخامسة' }
// Scenario → the three inputs. chartDays: [[iso, ward, [{ name, id?, qty? }]]] — qty > 0 means
// Meronem that day (Meronem 1000gm Vial), 0/absent means on the chart without it.
const scenario = (chartDays) => {
  const cells = [], presence = [], charted = []
  chartDays.forEach(([date, where, rows]) => {
    charted.push({ date, ...where })
    rows.forEach((row) => {
      const base = { date, ...where, name: row.name, patientId: row.id || '' }
      presence.push(base)
      if (row.qty) cells.push({ ...base, medicine: row.medicine || 'Meronem 1000gm Vial', quantity: row.qty })
    })
  })
  return { cells, presence, charted }
}
const form = (date, where, chartDays) => buildMeropenemForm({ date, ...where, ...scenario(chartDays) }).patients
const ali = (qty = 3, extra = {}) => ({ name: 'علي', id: '123', qty, ...extra })

test('doseText: the catalogue\'s "gm" means mg, and a quantity divisible by 3 reads as a per-dose amount × 3', () => {
  assert.equal(doseText('Meronem 1000gm Vial', 3), '1g × 3')
  assert.equal(doseText('Meronem 1000gm Vial', 6), '2g × 3')
  assert.equal(doseText('Meronem 500gm Vial', 3), '500mg × 3')
  assert.equal(doseText('Meronem 500gm Vial', 6), '1g × 3')
  assert.equal(doseText('Meronem 1000gm Vial', 2), '1g × 2')
  assert.equal(doseText('Meropenem 1g vial', 3), '1g × 3')
})

test('meropenem: consecutive days count D1…D3 and the patient is active', () => {
  const [row] = form('2026-09-23', A, [['2026-09-21', A, [ali()]], ['2026-09-22', A, [ali()]], ['2026-09-23', A, [ali()]]])
  assert.deepEqual(row, { name: 'علي', patientId: '123', dose: '1g × 3', days: { '2026-09-21': 1, '2026-09-22': 2, '2026-09-23': 3 }, missed: [], status: { kind: 'active' } })
})

test('meropenem: a Friday with no chart keeps counting; still active when today is not charted yet', () => {
  // 24 Thu, 25 Fri (no chart), 26 Sat; asked on 27 before anyone charted it.
  const [row] = form('2026-09-27', A, [['2026-09-24', A, [ali()]], ['2026-09-26', A, [ali()]]])
  assert.deepEqual(row.days, { '2026-09-24': 1, '2026-09-25': 2, '2026-09-26': 3 })
  assert.deepEqual(row.status, { kind: 'active' })
})

test('meropenem: one charted day without it is forgiven and flagged; two restart at D1', () => {
  const [forgiven] = form('2026-09-23', A, [['2026-09-21', A, [ali()]], ['2026-09-22', A, [ali(0)]], ['2026-09-23', A, [ali()]]])
  assert.deepEqual(forgiven.days, { '2026-09-21': 1, '2026-09-22': 2, '2026-09-23': 3 })
  assert.deepEqual(forgiven.missed, ['2026-09-22'])
  const [restarted] = form('2026-09-24', A, [['2026-09-21', A, [ali()]], ['2026-09-22', A, [ali(0)]], ['2026-09-23', A, [ali(0)]], ['2026-09-24', A, [ali()]]])
  assert.deepEqual(restarted.days, { '2026-09-21': 1, '2026-09-24': 1 })
  assert.deepEqual(restarted.missed, [])
})

test('meropenem: stopped (still on the ward without it) vs left (gone from the chart)', () => {
  const [stopped] = form('2026-09-22', A, [['2026-09-21', A, [ali()]], ['2026-09-22', A, [ali(0)]]])
  assert.deepEqual(stopped.status, { kind: 'stopped' })
  const [left] = form('2026-09-22', A, [['2026-09-21', A, [ali(), { name: 'حسن' }]], ['2026-09-22', A, [{ name: 'حسن' }]]])
  assert.deepEqual(left.status, { kind: 'left' })
})

test('meropenem: a transfer by ID reads «نُقل إلى» on the old ward and keeps counting on the new one', () => {
  const days = [['2026-09-21', A, [ali()]], ['2026-09-22', A, [ali()]], ['2026-09-23', A, [{ name: 'حسن' }]], ['2026-09-23', B, [ali()]]]
  const [old] = form('2026-09-23', A, days)
  assert.deepEqual(old.status, { kind: 'transferred', to: 'الطابق 8 — الردهة الخامسة' })
  const [arrived] = form('2026-09-23', B, days)
  assert.deepEqual(arrived.days, { '2026-09-23': 3 })
  assert.deepEqual(arrived.status, { kind: 'active' })
})

test('meropenem: a name-only day and a day with the ID are one patient; the latest dose shows', () => {
  const rows = form('2026-09-22', A, [
    ['2026-09-21', A, [{ name: 'علي حسين', qty: 3 }]],
    ['2026-09-22', A, [{ name: 'علي  حسين', id: '555', qty: 6 }]],
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].patientId, '555')
  assert.equal(rows[0].dose, '2g × 3')
  assert.deepEqual(rows[0].days, { '2026-09-21': 1, '2026-09-22': 2 })
})

test('meropenem: a course started last month keeps its D-number; one that ended last month is not listed', () => {
  const [running] = form('2026-10-01', A, [['2026-09-29', A, [ali()]], ['2026-09-30', A, [ali()]], ['2026-10-01', A, [ali()]]])
  assert.deepEqual(running.days, { '2026-10-01': 3 })
  assert.deepEqual(form('2026-10-05', A, [['2026-09-20', A, [ali()]], ['2026-10-05', A, [{ name: 'حسن' }]]]), [])
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
  assert.deepEqual(res.body.form.patients, [{ name: 'علي', patientId: '123', dose: '1g × 3', days: { '2026-09-24': 1, '2026-09-25': 2, '2026-09-26': 3 }, missed: [], status: { kind: 'active' } }])

  const outsider = await loginAs({ role: 'user', floor: 6 })
  assert.equal((await outsider.get(`/api/meropenem?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-09-26`)).status, 403)
})
