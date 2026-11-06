import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'
import { monthDates, startDates, totalMgOn, courseMg, formFor, stayRun, diagnosisTexts, samePatient, dedupeStarts, nextStartOf } from './ward-positions.js'
import { inferDose } from '../shared/dose.js'
import { cleanFields } from '../shared/drug-requests.js'

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

test('inferDose: 1 g or 500 mg, 3 then 2 then 1 times a day; anything else is split sensibly', () => {
  assert.deepEqual(inferDose(3000), { doseMg: 1000, perDay: 3 })
  assert.deepEqual(inferDose(1500), { doseMg: 500, perDay: 3 })
  assert.deepEqual(inferDose(2000), { doseMg: 1000, perDay: 2 })
  assert.deepEqual(inferDose(1000), { doseMg: 500, perDay: 2 })
  assert.deepEqual(inferDose(500), { doseMg: 500, perDay: 1 })
  assert.deepEqual(inferDose(6000), { doseMg: 2000, perDay: 3 })
  assert.deepEqual(inferDose(2500), { doseMg: 1250, perDay: 2 })
  assert.equal(inferDose(0), null)
  assert.equal(inferDose(NaN), null)
})

test('sex: only ذكر / أنثى are kept on a Meropenem form', () => {
  assert.equal(cleanFields('meropenem', { sex: 'ذكر' }).sex, 'ذكر')
  assert.equal(cleanFields('meropenem', { sex: 'أنثى' }).sex, 'أنثى')
  assert.equal(cleanFields('meropenem', { sex: 'male' }).sex, '')
  assert.equal(cleanFields('meropenem', {}).sex, '')
})

test('monthDates: one date per calendar month the range touches, the last in `to`', () => {
  assert.deepEqual(monthDates('2026-09-05', '2026-09-20'), ['2026-09-20'])
  assert.deepEqual(monthDates('2026-09-25', '2026-11-03'), ['2026-09-30', '2026-10-31', '2026-11-03'])
  assert.deepEqual(monthDates('2026-12-20', '2027-01-10'), ['2026-12-31', '2027-01-10'])
  assert.deepEqual(monthDates('2028-02-10', '2028-02-29'), ['2028-02-29'])
  assert.deepEqual(monthDates('2028-01-30', '2028-02-02'), ['2028-01-31', '2028-02-02'])
})

test('startDates: only D1 days inside the range; a restarted course counts twice', () => {
  const days = { '2026-09-21': 1, '2026-09-22': 2, '2026-09-26': 1, '2026-09-27': 2 }
  assert.deepEqual(startDates({ days }, '2026-09-01', '2026-09-30'), ['2026-09-21', '2026-09-26'])
  assert.deepEqual(startDates({ days }, '2026-09-22', '2026-09-30'), ['2026-09-26'])
  assert.deepEqual(startDates({ days }, '2026-09-27', '2026-09-30'), [])
})

test('samePatient: two IDs decide it; otherwise the same name on the same ward', () => {
  const ali = { floor: 5, ward: 'أ', name: 'علي', patientId: '123' }
  assert.equal(samePatient(ali, { ...ali, name: 'اسم آخر' }), true) // the same ID, whatever it was typed as
  assert.equal(samePatient(ali, { ...ali, patientId: '999' }), false) // a namesake with another ID
  assert.equal(samePatient(ali, { ...ali, patientId: '' }), true) // typed by name on the same ward
  assert.equal(samePatient(ali, { ...ali, patientId: '', ward: 'ب' }), false)
  assert.equal(samePatient({ ...ali, patientId: '' }, { ...ali, patientId: '' }), true)
})

test('totalMgOn / courseMg: the patient\'s vials on that ward and day; the second day when it was dosed', () => {
  const at = { floor: 5, ward: 'أ' }
  const cell = (date, name, patientId, medicine, quantity) => ({ date, ...at, name, patientId, medicine, quantity })
  const cells = [
    cell('2026-09-21', 'علي', '123', 'Meronem 1000gm Vial', 2),
    cell('2026-09-21', 'علي', '123', 'Meronem 500gm Vial', 1),
    cell('2026-09-21', 'علي', '999', 'Meronem 1000gm Vial', 3), // a namesake with another ID
    cell('2026-09-22', 'علي', '123', 'Meronem 1000gm Vial', 3),
    cell('2026-09-21', 'حسن', '9', 'Meronem 1000gm Vial', 3),
    { ...cell('2026-09-21', 'علي', '123', 'Meronem 1000gm Vial', 3), floor: 8, ward: 'ب' },
  ]
  const ali = { ...at, name: 'علي', patientId: '123' }
  assert.equal(totalMgOn(cells, ali, '2026-09-21'), 2500)
  assert.equal(courseMg(cells, ali, '2026-09-21'), 3000) // day 2 was dosed
  assert.equal(courseMg(cells, { ...at, name: 'حسن', patientId: '9' }, '2026-09-21'), 3000) // no day 2: day 1
})

test('stayRun: the run of seen days up to the start; one missing day forgiven, two end it; capped at the read window', () => {
  assert.deepEqual(stayRun(['2026-09-19', '2026-09-21', '2026-09-22'], '2026-09-22', '2026-08-01'), { days: 4, capped: false })
  assert.deepEqual(stayRun(['2026-09-10', '2026-09-19', '2026-09-21', '2026-09-22'], '2026-09-22', '2026-08-01'), { days: 4, capped: false }) // an earlier admission ends at the gap
  assert.deepEqual(stayRun(['2026-09-19', '2026-09-22'], '2026-09-22', '2026-08-01'), { days: 1, capped: false }) // two days missing in a row end it
  assert.deepEqual(stayRun(['2026-09-22'], '2026-09-22', '2026-08-01'), { days: 1, capped: false })
  assert.deepEqual(stayRun(['2026-08-01', '2026-08-02', '2026-08-03'], '2026-08-03', '2026-08-01'), { days: 3, capped: true })
  assert.equal(stayRun(['2026-09-23'], '2026-09-22', '2026-08-01').days, 1) // later days never count
})

test('formFor: the earliest form on or after the start, before the next course; never another patient\'s', () => {
  const forms = [
    { name: 'علي', patientId: '123', wardKey: '5|أ', requestDate: '2026-09-23', fields: { age: '40' }, ticks: [], note: '' },
    { name: 'علي', patientId: '123', wardKey: '5|أ', requestDate: '2026-09-21', fields: { age: '45' }, ticks: [], note: '' },
    { name: 'حسن', patientId: '', wardKey: '5|أ', requestDate: '2026-09-21', fields: { age: '9' }, ticks: [], note: '' },
    { name: 'علي', patientId: '999', wardKey: '5|أ', requestDate: '2026-09-21', fields: { age: '70' }, ticks: [], note: '' }, // a namesake
  ]
  const ali = { floor: 5, ward: 'أ', name: 'علي', patientId: '123' }
  assert.equal(formFor(forms, ali, '2026-09-21').fields.age, '45')
  assert.equal(formFor(forms, ali, '2026-09-22').fields.age, '40')
  assert.equal(formFor(forms, ali, '2026-09-22', '2026-09-23'), null) // the form dated 23 belongs to the course that began on the 23rd
  assert.equal(formFor(forms, ali, '2026-10-30'), null) // more than 14 days away
  assert.equal(formFor(forms, { floor: 5, ward: 'أ', name: 'حسن', patientId: '' }, '2026-09-21').fields.age, '9') // by ward and name
  assert.equal(formFor(forms, { floor: 8, ward: 'ب', name: 'حسن', patientId: '' }, '2026-09-21'), null)
})

test('dedupeStarts / nextStartOf / diagnosisTexts', () => {
  const rows = [{ key: 'id:1', startDate: '2026-09-21', ward: 'أ' }, { key: 'id:1', startDate: '2026-09-21', ward: 'ب' }, { key: 'id:1', startDate: '2026-09-26', ward: 'أ' }]
  assert.deepEqual(dedupeStarts(rows).map((row) => row.ward), ['أ', 'أ'])
  assert.equal(nextStartOf(rows, rows[0]), '2026-09-26')
  assert.equal(nextStartOf(rows, rows[2]), null)
  assert.deepEqual(diagnosisTexts(['sepsis', 'others', 'mastoiditis'], 'brain abscess'), ['Acute mastoiditis', 'Sepsis (specify the origin of Infection)', 'Others: brain abscess'])
  assert.deepEqual(diagnosisTexts([], ''), [])
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

test('GET /api/ward-positions: a row per course started in the range, with the form, the inferred dose and the stay', async () => {
  const seeder = await createUser({ role: 'admin' })
  const medicineId = (await pool.query("INSERT INTO medicines (name) VALUES ('Meronem 1000gm Vial') RETURNING id")).rows[0].id
  const wardId = (await pool.query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, false) RETURNING id', [FLOOR, WARD])).rows[0].id
  const ali = [{ row: 1, name: 'علي', id: '123' }]
  await seedDay({ wardId, createdBy: seeder.id, date: '2026-09-19', patients: ali, meronemRows: [], medicineId }) // first seen
  for (const day of ['21', '22', '23']) await seedDay({ wardId, createdBy: seeder.id, date: `2026-09-${day}`, patients: ali, meronemRows: [1], medicineId })
  for (const day of ['24', '25']) await seedDay({ wardId, createdBy: seeder.id, date: `2026-09-${day}`, patients: ali, meronemRows: [], medicineId }) // two days off: the course ended
  await seedDay({ wardId, createdBy: seeder.id, date: '2026-09-26', patients: ali, meronemRows: [1], medicineId }) // a new course
  await pool.query(
    `INSERT INTO drug_requests (kind, ward_key, request_date, patient_name, patient_id, fields, ticks, note, created_by)
     VALUES ('meropenem', $1, '2026-09-21', 'علي', '123', '{"sex":"ذكر","age":"45"}', '["sepsis","others"]', 'brain abscess', $2)`,
    [`${FLOOR}|${WARD}`, seeder.id],
  )

  const supervisor = await loginAs({ role: 'supervisor' })
  const res = await supervisor.get('/api/ward-positions?from=2026-09-20&to=2026-09-30')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.patients, [
    { floor: FLOOR, ward: WARD, name: 'علي', patientId: '123', startDate: '2026-09-21', sex: 'ذكر', age: '45', diagnoses: ['Sepsis (specify the origin of Infection)', 'Others: brain abscess'], doseMg: 1000, perDay: 3, stayDays: 3, stayCapped: false, hasForm: true },
    { floor: FLOOR, ward: WARD, name: 'علي', patientId: '123', startDate: '2026-09-26', sex: '', age: '', diagnoses: [], doseMg: 1000, perDay: 3, stayDays: 8, stayCapped: false, hasForm: false },
  ])
  // A course that began before the range is not a start in it.
  const later = await supervisor.get('/api/ward-positions?from=2026-09-22&to=2026-09-30')
  assert.deepEqual(later.body.patients.map((patient) => patient.startDate), ['2026-09-26'])
  assert.deepEqual((await supervisor.get('/api/ward-positions?from=2026-09-27&to=2026-09-30')).body.patients, [])
})

test('GET /api/ward-positions: dates are validated, the range is capped, and only managers may read it', async () => {
  const supervisor = await loginAs({ role: 'supervisor' })
  assert.equal((await supervisor.get('/api/ward-positions')).status, 400)
  assert.equal((await supervisor.get('/api/ward-positions?from=2026-09-30&to=2026-09-01')).status, 400)
  assert.equal((await supervisor.get('/api/ward-positions?from=2026-07-01&to=2026-09-30')).status, 400) // 92 days
  assert.equal((await supervisor.get('/api/ward-positions?from=2026-08-01&to=2026-09-30')).status, 200) // 61 days
  assert.equal((await (await loginAs({ role: 'user', floor: FLOOR })).get('/api/ward-positions?from=2026-09-01&to=2026-09-30')).status, 403)
  assert.equal((await new ApiClient(baseUrl).get('/api/ward-positions?from=2026-09-01&to=2026-09-30')).status, 401)
})

test('GET /api/ward-positions: a typed course day does not hide the course; a namesake\'s form and vials are not theirs; the next course keeps its own form', async () => {
  const seeder = await createUser({ role: 'admin' })
  const medicineId = (await pool.query("INSERT INTO medicines (name) VALUES ('Meronem 1000gm Vial') RETURNING id")).rows[0].id
  const wardId = (await pool.query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, false) RETURNING id', [FLOOR, WARD])).rows[0].id
  const ali = [{ row: 1, name: 'علي', id: '123' }, { row: 2, name: 'علي', id: '999' }]
  for (const day of ['21', '22']) await seedDay({ wardId, createdBy: seeder.id, date: `2026-09-${day}`, patients: ali, meronemRows: [1], medicineId })
  for (const day of ['23', '24']) await seedDay({ wardId, createdBy: seeder.id, date: `2026-09-${day}`, patients: ali, meronemRows: [], medicineId })
  await seedDay({ wardId, createdBy: seeder.id, date: '2026-09-25', patients: ali, meronemRows: [1], medicineId })
  // «already D4 on admission»: the typed course day the follow-up screen allows.
  await pool.query("INSERT INTO course_day_overrides (patient_key, drug_key, anchor_date, n) VALUES ('id:123', 'meropenem', '2026-09-21', 4)")
  const form = (date, id, age) => pool.query(
    `INSERT INTO drug_requests (kind, ward_key, request_date, patient_name, patient_id, fields, created_by) VALUES ('meropenem', $1, $2, 'علي', $3, $4, $5)`,
    [`${FLOOR}|${WARD}`, date, id, JSON.stringify({ age }), seeder.id])
  await form('2026-09-25', '999', '70') // the namesake's form, dated inside the 14 days
  await form('2026-09-26', '123', '45') // the second course's form

  const supervisor = await loginAs({ role: 'supervisor' })
  const rows = (await supervisor.get('/api/ward-positions?from=2026-09-20&to=2026-09-30')).body.patients
  assert.deepEqual(rows.map((row) => [row.patientId, row.startDate, row.age, row.hasForm, row.doseMg, row.perDay]), [
    ['123', '2026-09-21', '', false, 1000, 3], // the typed D4 does not hide it; no form of its own
    ['123', '2026-09-25', '45', true, 1000, 3], // the form dated the 26th belongs to this course, not the namesake's (999) dated the 25th
  ])
})

test('POST /api/drug-requests: a resend from a client that does not send sex keeps the stored sex', async () => {
  const seeder = await createUser({ role: 'admin' })
  await pool.query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, false)', [FLOOR, WARD])
  const manager = await loginAs({ role: 'supervisor' })
  const form = { kind: 'meropenem', floor: FLOOR, ward: WARD, date: '2026-09-24', name: 'علي', patientId: '123' }
  assert.equal((await manager.post('/api/drug-requests', { ...form, fields: { sex: 'أنثى', age: '54' } })).status, 201)
  const again = await manager.post('/api/drug-requests', { ...form, fields: { age: '55' } }) // an older bundle: no sex key
  assert.equal(again.status, 200)
  assert.equal(again.body.request.fields.sex, 'أنثى')
  assert.equal(again.body.request.fields.age, '55')
  const changed = await manager.post('/api/drug-requests', { ...form, fields: { sex: 'ذكر', age: '55' } })
  assert.equal(changed.body.request.fields.sex, 'ذكر')
  assert.ok(seeder.id)
})
