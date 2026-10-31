import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'
import { buildMeropenemForm, doseText, MEROPENEM_SQL_PATTERN, windowStart } from './meropenem.js'
import { todayInBaghdad } from './push.js'
import { loadCourseRows } from './routes/chart.js'

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
const form = (date, where, chartDays) => buildMeropenemForm({ date, ...where, ...scenario(chartDays) }).patients.map(({ key: _key, ...row }) => row)
const ali = (qty = 3, extra = {}) => ({ name: 'علي', id: '123', qty, ...extra })

test('doseText: the catalogue\'s "gm" means mg, and a quantity divisible by 3 reads as a per-dose amount × 3', () => {
  assert.equal(doseText('Meronem 1000gm Vial', 3), '1g × 3')
  assert.equal(doseText('Meronem 1000gm Vial', 6), '2g × 3')
  assert.equal(doseText('Meronem 500gm Vial', 3), '500mg × 3')
  assert.equal(doseText('Meronem 500gm Vial', 6), '1g × 3')
  assert.equal(doseText('Meronem 1000gm Vial', 2), '1g × 2')
  assert.equal(doseText('Meropenem 1g vial', 3), '1g × 3')
  assert.equal(doseText('Vancomycin 500mg vial', 4, 2), '1g × 2') // twice-daily drug
  // A small number with gm is grams, like g: no vial here is under 10 mg.
  assert.equal(doseText('Tazocin 4.5gm Vial', 3), '4.5g × 3')
  assert.equal(doseText('Rocephin 1gm Vial', 2, 2), '1g × 2')
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
test('meropenem: a name that carried two IDs on a ward takes the latest one, in any row order', () => {
  // محمد 111 on Meronem, then another محمد (222, no drug) admitted, then a name-only محمد given it.
  const inputs = scenario([
    ['2026-09-21', A, [{ name: 'محمد', id: '111', qty: 3 }]],
    ['2026-09-22', A, [{ name: 'محمد', id: '111', qty: 3 }]],
    ['2026-09-23', A, [{ name: 'محمد', id: '222' }]],
    ['2026-09-24', A, [{ name: 'محمد', qty: 3 }]],
  ])
  const build = (presence) => buildMeropenemForm({ date: '2026-09-24', ...A, ...inputs, presence }).patients
  const forward = build(inputs.presence)
  assert.deepEqual(build([...inputs.presence].reverse()), forward)
  assert.deepEqual(forward.find((patient) => patient.key === 'id:222')?.days, { '2026-09-24': 1 })
})

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
  assert.deepEqual(res.body.form.patients, [{ name: 'علي', patientId: '123', dose: '1g × 3', days: { '2026-09-24': 1, '2026-09-25': 2, '2026-09-26': 3 }, missed: [], status: { kind: 'active' }, key: 'id:123', drugKey: 'meropenem' }])

  // Retyping the first shown day shifts the course on both forms, and only the ward's own users may.
  const where = `floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-09-26`
  const edit = { floor: FLOOR, ward: WARD, date: '2026-09-26', patientKey: 'id:123', drugKey: 'meropenem', anchorDate: '2026-09-24', n: 3 }
  assert.equal((await client.put('/api/course-day', { ...edit, n: 0 })).status, 400)
  assert.equal((await client.put('/api/course-day', edit)).status, 200)
  assert.deepEqual((await client.get(`/api/meropenem?${where}`)).body.form.patients[0].days, { '2026-09-24': 3, '2026-09-25': 4, '2026-09-26': 5 })
  assert.deepEqual((await client.get(`/api/antibiotics?${where}`)).body.drugs[0].patients[0].days, { '2026-09-24': 3, '2026-09-25': 4, '2026-09-26': 5 })

  const outsider = await loginAs({ role: 'user', floor: 6 })
  assert.equal((await outsider.get(`/api/meropenem?${where}`)).status, 403)
  assert.equal((await outsider.put('/api/course-day', edit)).status, 403)
  // Floor 6's own user, addressing their own ward, still can't renumber a floor-5 patient.
  const sixth = { ...edit, floor: 6, ward: 'ردهة الخاص' }
  assert.equal((await outsider.put('/api/course-day', sixth)).status, 403)
  assert.equal((await outsider.put('/api/course-day', { ...sixth, patientKey: `name:${FLOOR}|${WARD}|حسن` })).status, 403)
  assert.equal((await client.put('/api/course-day', { ...edit, patientKey: `name:${FLOOR}|${WARD}|حسن` })).status, 200)
})

test('GET /api/antibiotics: a course whose medicine was deleted from the catalogue still shows', async () => {
  const seeder = await createUser({ role: 'admin' })
  const medicineId = (await pool.query("INSERT INTO medicines (name) VALUES ('Meronem 1000gm Vial') RETURNING id")).rows[0].id
  const wardId = (await pool.query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, false) RETURNING id', [FLOOR, WARD])).rows[0].id
  await seedDay({ wardId, createdBy: seeder.id, date: '2026-09-26', patients: [{ row: 1, name: 'علي', id: '123' }], meronemRows: [1], medicineId })
  const admin = await loginAs({ role: 'admin' })
  assert.equal((await admin.delete(`/api/medicines/${medicineId}`)).status, 200)
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const res = await client.get(`/api/antibiotics?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-09-26`)
  assert.equal(res.status, 200)
  assert.equal(res.body.drugs[0]?.patients[0]?.patientId, '123')
})

test('GET /api/antibiotics: one course per patient per antibiotic — any antibiotic, by generic name — Meropenem included', async () => {
  const seeder = await createUser({ role: 'admin' })
  const medicineId = (await pool.query("INSERT INTO medicines (name) VALUES ('Meronem 1000gm Vial') RETURNING id")).rows[0].id
  const vancoId = (await pool.query("INSERT INTO medicines (name) VALUES ('Vancomycin 500mg Vial') RETURNING id")).rows[0].id
  const ceftriaxoneId = (await pool.query("INSERT INTO medicines (name) VALUES ('Ceftrixone 1g inj') RETURNING id")).rows[0].id // catalogue misspelling
  const wardId = (await pool.query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, false) RETURNING id', [FLOOR, WARD])).rows[0].id
  const patients = [{ row: 1, name: 'علي', id: '123' }]
  for (const date of ['2026-09-25', '2026-09-26']) {
    await seedDay({ wardId, createdBy: seeder.id, date, patients, meronemRows: [1], medicineId })
    const chartId = (await pool.query('SELECT id FROM daily_charts WHERE chart_date = $1', [date])).rows[0].id
    await pool.query('INSERT INTO chart_columns (chart_id, column_number, medicine_id) VALUES ($1, 2, $2)', [chartId, vancoId])
    if (date === '2026-09-26') await pool.query('INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) VALUES ($1, 1, 2, 4)', [chartId])
    await pool.query('INSERT INTO chart_columns (chart_id, column_number, medicine_id) VALUES ($1, 3, $2)', [chartId, ceftriaxoneId])
    await pool.query('INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) VALUES ($1, 1, 3, 2)', [chartId])
  }

  const client = await loginAs({ role: 'user', floor: FLOOR })
  const res = await client.get(`/api/antibiotics?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-09-26`)
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.drugs.map((drug) => [drug.label, drug.patients[0].dose, drug.patients[0].days]), [
    ['Ceftriaxone', '2g × 1', { '2026-09-25': 1, '2026-09-26': 2 }],
    ['Meropenem', '1g × 3', { '2026-09-25': 1, '2026-09-26': 2 }],
    ['Vancomycin', '1g × 2', { '2026-09-26': 1 }],
  ])
  const meropenem = await client.get(`/api/meropenem?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-09-26`)
  assert.equal(meropenem.body.form.patients.length, 1) // the Meropenem form still lists Meronem only
  assert.equal((await (await loginAs({ role: 'user', floor: 6 })).get(`/api/antibiotics?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-09-26`)).status, 403)
})

test('meropenem: a typed first day shifts that course and the days after it follow', () => {
  const days = [['2026-09-21', A, [ali()]], ['2026-09-22', A, [ali()]], ['2026-09-23', A, [ali()]]]
  const [row] = buildMeropenemForm({ date: '2026-09-23', ...A, ...scenario(days), overrides: [{ patientKey: 'id:123', date: '2026-09-21', n: 3 }] }).patients
  assert.deepEqual(row.days, { '2026-09-21': 3, '2026-09-22': 4, '2026-09-23': 5 })
  assert.equal(row.key, 'id:123')
})

test('GET /api/antibiotics/long: managers see active courses past 14 days across wards; others are refused', async () => {
  const seeder = await createUser({ role: 'admin' })
  const medicineId = (await pool.query("INSERT INTO medicines (name) VALUES ('Meronem 1000gm Vial') RETURNING id")).rows[0].id
  const ward = async (floor, name) => (await pool.query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, false) RETURNING id', [floor, name])).rows[0].id
  const [long, short] = [await ward(FLOOR, WARD), await ward(8, 'الردهة الخامسة')]
  for (let day = 11; day <= 26; day += 1) await seedDay({ wardId: long, createdBy: seeder.id, date: `2026-09-${day}`, patients: [{ row: 1, name: 'علي', id: '123' }], meronemRows: [1], medicineId })
  for (let day = 22; day <= 26; day += 1) await seedDay({ wardId: short, createdBy: seeder.id, date: `2026-09-${day}`, patients: [{ row: 1, name: 'حسن', id: '456' }], meronemRows: [1], medicineId })

  const supervisor = await loginAs({ role: 'supervisor' })
  const res = await supervisor.get('/api/antibiotics/long?date=2026-09-26')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.patients, [{ floor: FLOOR, ward: WARD, name: 'علي', patientId: '123', drugKey: 'meropenem', drug: 'Meropenem', day: 16 }])
  assert.equal((await supervisor.get('/api/antibiotics/long?date=2026-09-14')).body.patients.length, 0) // D4 that day
  assert.equal((await supervisor.get('/api/antibiotics/long')).status, 400)
  assert.equal((await (await loginAs({ role: 'user', floor: FLOOR })).get('/api/antibiotics/long?date=2026-09-26')).status, 403)
})

test('GET /api/antibiotics/long?floor=: a floor user sees only their own floor; another floor is refused', async () => {
  const seeder = await createUser({ role: 'admin' })
  const medicineId = (await pool.query("INSERT INTO medicines (name) VALUES ('Meronem 1000gm Vial') RETURNING id")).rows[0].id
  const ward = async (floor, name) => (await pool.query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, false) RETURNING id', [floor, name])).rows[0].id
  const [mine, other] = [await ward(FLOOR, WARD), await ward(8, 'الردهة الخامسة')]
  for (let day = 11; day <= 26; day += 1) {
    await seedDay({ wardId: mine, createdBy: seeder.id, date: `2026-09-${day}`, patients: [{ row: 1, name: 'علي', id: '123' }], meronemRows: [1], medicineId })
    await seedDay({ wardId: other, createdBy: seeder.id, date: `2026-09-${day}`, patients: [{ row: 1, name: 'حسن', id: '456' }], meronemRows: [1], medicineId })
  }
  const user = await loginAs({ role: 'user', floor: FLOOR })
  const res = await user.get(`/api/antibiotics/long?date=2026-09-26&floor=${FLOOR}`)
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.patients.map((patient) => patient.name), ['علي'])
  assert.equal((await user.get('/api/antibiotics/long?date=2026-09-26&floor=8')).status, 403)
  assert.equal((await user.get('/api/antibiotics/long?date=2026-09-26')).status, 403) // hospital-wide is for managers
  const manager = await loginAs({ role: 'supervisor' })
  assert.equal((await manager.get('/api/antibiotics/long?date=2026-09-26')).body.patients.length, 2)
})

test('GET /api/meropenem: on a ward that types only patient numbers, a stopped course ends like a named one', async () => {
  const seeder = await createUser({ role: 'admin' })
  const medicineId = (await pool.query("INSERT INTO medicines (name) VALUES ('Meronem 1000gm Vial') RETURNING id")).rows[0].id
  const wardId = (await pool.query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, false) RETURNING id', [FLOOR, WARD])).rows[0].id
  const patients = [{ row: 1, name: '', id: '777' }]
  await seedDay({ wardId, createdBy: seeder.id, date: '2026-09-21', patients, meronemRows: [1], medicineId })
  await seedDay({ wardId, createdBy: seeder.id, date: '2026-09-22', patients, meronemRows: [1], medicineId })
  await seedDay({ wardId, createdBy: seeder.id, date: '2026-09-23', patients, meronemRows: [], medicineId }) // charted, no Meronem
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const res = await client.get(`/api/meropenem?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-09-23`)
  assert.equal(res.status, 200)
  assert.notEqual(res.body.form.patients[0]?.status.kind, 'active', JSON.stringify(res.body.form.patients))
})

test('GET /api/meropenem: days before today come from the cache until a save to one of them', async () => {
  const seeder = await createUser({ role: 'admin' })
  const medicineId = (await pool.query("INSERT INTO medicines (name) VALUES ('Meronem 1000gm Vial') RETURNING id")).rows[0].id
  const wardId = (await pool.query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, false) RETURNING id', [FLOOR, WARD])).rows[0].id
  await seedDay({ wardId, createdBy: seeder.id, date: '2026-09-26', patients: [{ row: 1, name: 'علي', id: '123' }], meronemRows: [1], medicineId })
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const where = `floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-09-26`
  const names = async () => (await client.get(`/api/meropenem?${where}`)).body.form.patients.map((patient) => patient.name)
  assert.deepEqual(await names(), ['علي'])

  // A row slipped in behind the app's back is not seen while the cached copy is fresh…
  await pool.query("INSERT INTO chart_patients (chart_id, row_number, patient_name, patient_id) SELECT id, 2, 'حسن', '' FROM daily_charts WHERE ward_id = $1", [wardId])
  await pool.query("INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) SELECT id, 2, 1, 3 FROM daily_charts WHERE ward_id = $1", [wardId])
  assert.deepEqual(await names(), ['علي'], 'served from the cache')

  // …but a save through the app clears it.
  const saved = await client.put('/api/chart', {
    floor: FLOOR, ward: WARD, date: '2026-09-26', expectedVersion: 1,
    patients: [{ rowNumber: 1, name: 'علي', patientId: '123' }, { rowNumber: 2, name: 'حسن' }],
    columns: [{ columnNumber: 1, medicineName: 'Meronem 1000gm Vial' }],
    quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 3 }, { rowNumber: 2, columnNumber: 1, quantity: 3 }],
  })
  assert.equal(saved.status, 200)
  assert.deepEqual((await names()).sort(), ['حسن', 'علي'].sort())
})

test('GET /api/meropenem: today is always read fresh, and a save to today keeps the earlier days cached', async () => {
  const seeder = await createUser({ role: 'admin' })
  const medicineId = (await pool.query("INSERT INTO medicines (name) VALUES ('Meronem 1000gm Vial') RETURNING id")).rows[0].id
  const wardId = (await pool.query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, false) RETURNING id', [FLOOR, WARD])).rows[0].id
  const today = todayInBaghdad()
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
  for (const date of [yesterday, today]) await seedDay({ wardId, createdBy: seeder.id, date, patients: [{ row: 1, name: 'علي', id: '123' }], meronemRows: [1], medicineId })
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const names = async () => (await client.get(`/api/meropenem?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${today}`)).body.form.patients.map((patient) => patient.name).sort()
  assert.deepEqual(await names(), ['علي'])

  // Behind the app's back: حسن on Meronem yesterday. Yesterday is kept, so he is not seen…
  const addHassan = (date) => pool.query(`WITH c AS (SELECT id FROM daily_charts WHERE ward_id = $1 AND chart_date = $2)
    , p AS (INSERT INTO chart_patients (chart_id, row_number, patient_name, patient_id) SELECT id, 2, 'حسن', '456' FROM c)
    INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) SELECT id, 2, 1, 3 FROM c`, [wardId, date])
  await addHassan(yesterday)
  assert.deepEqual(await names(), ['علي'])
  // …and a save to today's chart does not drop the kept days.
  const saved = await client.put('/api/chart', {
    floor: FLOOR, ward: WARD, date: today, expectedVersion: 1,
    patients: [{ rowNumber: 1, name: 'علي', patientId: '123' }],
    columns: [{ columnNumber: 1, medicineName: 'Meronem 1000gm Vial' }],
    quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 6 }],
  })
  assert.equal(saved.status, 200)
  assert.deepEqual(await names(), ['علي'], 'yesterday still served from the cache')
  // Today is read on every open: the same change made today shows at once.
  await addHassan(today)
  assert.deepEqual(await names(), ['حسن', 'علي'].sort())
})

// The original read: one query per part over the whole window, nothing kept. loadCourseRows must
// return the same rows (presence as a set: its split may return a row twice).
const referenceCourseRows = async ({ floor, wardName, chartDate }, { pattern, names, allWards = false }) => {
  const from = windowStart(chartDate)
  const cells = (await pool.query(
    `SELECT dc.chart_date::text AS date, w.floor_number AS floor, w.name AS ward, cp.patient_name AS name, cp.patient_id, COALESCE(m.name, cc.custom_name) AS medicine, cq.quantity
     FROM daily_charts dc JOIN wards w ON w.id = dc.ward_id JOIN chart_patients cp ON cp.chart_id = dc.id
     JOIN chart_quantities cq ON cq.chart_id = dc.id AND cq.row_number = cp.row_number
     JOIN chart_columns cc ON cc.chart_id = dc.id AND cc.column_number = cq.column_number LEFT JOIN medicines m ON m.id = cc.medicine_id
     WHERE dc.chart_date BETWEEN $1::date AND $2::date AND cq.quantity > 0
       AND ${pattern ? 'COALESCE(m.name, cc.custom_name) ~* $3' : 'COALESCE(m.name, cc.custom_name) = ANY($3::text[])'}
       AND (btrim(cp.patient_name) <> '' OR cp.patient_id <> '')`,
    [from, chartDate, pattern || names],
  )).rows
  const ids = [...new Set(cells.map((row) => row.patient_id).filter(Boolean))]
  const cellNames = [...new Set(cells.map((row) => String(row.name).trim().replace(/\s+/g, ' ')).filter(Boolean))]
  const presence = (await pool.query(
    `SELECT dc.chart_date::text AS date, w.floor_number AS floor, w.name AS ward, cp.patient_name AS name, cp.patient_id
     FROM daily_charts dc JOIN wards w ON w.id = dc.ward_id JOIN chart_patients cp ON cp.chart_id = dc.id
     WHERE dc.chart_date BETWEEN $1::date AND $2::date AND (btrim(cp.patient_name) <> '' OR cp.patient_id <> '')
       AND ${allWards ? "(cp.patient_id = ANY($3::text[]) OR regexp_replace(btrim(cp.patient_name), '\\s+', ' ', 'g') = ANY($4::text[]))" : '((w.floor_number IS NOT DISTINCT FROM $3 AND w.name = $4) OR cp.patient_id = ANY($5::text[]))'}`,
    allWards ? [from, chartDate, ids, cellNames] : [from, chartDate, floor, wardName, ids],
  )).rows
  const charted = (await pool.query(
    `SELECT DISTINCT dc.chart_date::text AS date, w.floor_number AS floor, w.name AS ward FROM daily_charts dc JOIN wards w ON w.id = dc.ward_id
     WHERE dc.chart_date BETWEEN $1::date AND $2::date AND EXISTS (SELECT 1 FROM chart_patients cp WHERE cp.chart_id = dc.id AND (cp.patient_name <> '' OR cp.patient_id <> ''))`,
    [from, chartDate],
  )).rows
  const toRow = (row) => ({ date: row.date, floor: row.floor, ward: row.ward, name: row.name, patientId: row.patient_id })
  return { cells: cells.map((row) => ({ ...toRow(row), medicine: row.medicine, quantity: row.quantity })), presence: presence.map(toRow), charted }
}

test('loadCourseRows: kept days + today read fresh give the same rows as one read of the whole window', async () => {
  const seeder = await createUser({ role: 'admin' })
  const medicineId = (await pool.query("INSERT INTO medicines (name) VALUES ('Meronem 1000gm Vial') RETURNING id")).rows[0].id
  const wardId = async (floor, name) => (await pool.query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, false) RETURNING id', [floor, name])).rows[0].id
  const wardA = await wardId(A.floor, A.ward)
  const wardB = await wardId(B.floor, B.ward)
  const today = todayInBaghdad()
  const day = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
  const chart = async (ward, n, patients) => {
    const chartId = (await pool.query("INSERT INTO daily_charts (ward_id, chart_date, slot, created_by, updated_by, version) VALUES ($1, $2, 'main', $3, $3, 1) RETURNING id", [ward, day(n), seeder.id])).rows[0].id
    await pool.query('INSERT INTO chart_columns (chart_id, column_number, medicine_id) VALUES ($1, 1, $2)', [chartId, medicineId])
    for (const [index, p] of patients.entries()) {
      await pool.query('INSERT INTO chart_patients (chart_id, row_number, patient_name, patient_id) VALUES ($1, $2, $3, $4)', [chartId, index + 1, p.name, p.id ?? ''])
      if (p.dose) await pool.query('INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) VALUES ($1, $2, 1, 3)', [chartId, index + 1])
    }
  }
  // علي (123): Meronem on A for three days, then on B today without it — a transfer.
  // حسن (no ID): Meronem on A two days ago, still on A since. سعد (456): on B without it, first dose
  // today (a newcomer by ID). زيد (no ID): on B two days ago, first dose today (a newcomer by name).
  // خالد (789): on A without it throughout.
  for (const n of [-3, -2, -1]) {
    await chart(wardA, n, [{ name: 'علي', id: '123', dose: true }, { name: 'حسن', dose: n === -2 }, { name: 'خالد', id: '789' }])
    await chart(wardB, n, [{ name: 'سعد', id: '456' }, ...(n === -2 ? [{ name: 'زيد' }] : [])])
  }
  await chart(wardA, 0, [{ name: 'حسن' }, { name: 'خالد', id: '789' }])
  await chart(wardB, 0, [{ name: 'علي', id: '123' }, { name: 'سعد', id: '456', dose: true }, { name: 'زيد', dose: true }])

  const views = [
    [{ floor: A.floor, wardName: A.ward, chartDate: today }, { pattern: MEROPENEM_SQL_PATTERN }],
    [{ floor: B.floor, wardName: B.ward, chartDate: today }, { pattern: MEROPENEM_SQL_PATTERN }],
    [{ floor: null, wardName: '', chartDate: today }, { names: ['Meronem 1000gm Vial'], allWards: true }],
    [{ floor: A.floor, wardName: A.ward, chartDate: day(-1) }, { pattern: MEROPENEM_SQL_PATTERN }],
  ]
  const asSet = (rows) => [...new Set(rows.map((row) => JSON.stringify(row)))].sort()
  const compare = async (label) => {
    for (const [location, options] of views) {
      const got = await loadCourseRows(location, options)
      const want = await referenceCourseRows(location, options)
      const where = `${label} ${location.wardName || 'all'} ${location.chartDate}`
      assert.deepEqual(got.cells.map((row) => JSON.stringify(row)).sort(), want.cells.map((row) => JSON.stringify(row)).sort(), `${where}: cells`)
      assert.deepEqual(got.cells.map((row) => row.date), [...got.cells.map((row) => row.date)].sort(), `${where}: cells in date order`)
      assert.deepEqual(asSet(got.presence), asSet(want.presence), `${where}: presence`)
      assert.deepEqual(asSet(got.charted), asSet(want.charted), `${where}: charted`)
    }
  }
  await compare('cold')
  await compare('cached')
  // A change to today, behind the app's back: read fresh, so still identical.
  await pool.query("INSERT INTO chart_patients (chart_id, row_number, patient_name, patient_id) SELECT id, 4, 'خالد', '789' FROM daily_charts WHERE ward_id = $1 AND chart_date = $2", [wardB, today])
  await compare('after a change today')
})
