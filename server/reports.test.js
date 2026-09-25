import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

const WARD = 'ردهة رجال'
const MEDS = ['Aspirin 100mg Tab', 'Panadol 500mg Tab', 'Lasix 40mg Tab', 'Plavix 75mg tab', 'Brufen 200mg Tab', 'Risek 20mg cap', 'Heparin', 'Digoxin 250mcg Tab', 'Losartan 50mg Tab', 'Inderal 40mg Tab']
const SUPPLIES = ['IV set', 'N/S 500ml']

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(async () => {
  await resetDatabase()
  await pool.query('INSERT INTO medicines (name) SELECT unnest($1::text[])', [MEDS])
  await pool.query('INSERT INTO medicines (name, is_supply) SELECT unnest($1::text[]), TRUE', [SUPPLIES])
})

const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}

// patients: [{ name, id?, meds: { 'Aspirin 100mg Tab': 2, ... } }]
const saveChart = async (client, floor, date, patients) => {
  const columns = [...new Set(patients.flatMap((patient) => Object.keys(patient.meds)))]
  const response = await client.put('/api/chart', {
    floor, ward: WARD, date, expectedVersion: 0,
    patients: patients.map((patient, index) => ({ rowNumber: index + 1, name: patient.name, patientId: patient.id || '' })),
    columns: columns.map((medicineName, index) => ({ columnNumber: index + 1, medicineName })),
    quantities: patients.flatMap((patient, row) => Object.entries(patient.meds).map(([name, quantity]) => ({ rowNumber: row + 1, columnNumber: columns.indexOf(name) + 1, quantity }))),
  })
  assert.equal(response.status, 200)
}

test('GET /api/reports: census, admissions/discharges, stays, polypharmacy, consumption and coverage', async () => {
  const admin = await loginAs({ role: 'admin' })
  const ali = { name: 'علي', meds: { 'Aspirin 100mg Tab': 2 } }
  // Ten real medicines plus two supplies: polypharmacy counts 10, not 12.
  const omar = { name: 'عمر', meds: { ...Object.fromEntries(MEDS.map((name) => [name, 1])), 'IV set': 1, 'N/S 500ml': 1 } }
  await saveChart(admin, 5, '2026-04-30', [ali]) // previous period
  await saveChart(admin, 5, '2026-05-01', [ali, omar])
  await saveChart(admin, 5, '2026-05-02', [ali, omar])
  await saveChart(admin, 5, '2026-05-03', [ali])
  // 05-04: no chart at all — must not read as Ali discharged and re-admitted.
  await saveChart(admin, 5, '2026-05-05', [ali, { name: 'سارة', meds: { 'Panadol 500mg Tab': 1 } }])
  await admin.patch('/api/chart/complete', { floor: 5, ward: WARD, date: '2026-05-01', completed: true })

  const { status, body } = await admin.get(`/api/reports?scope=5&from=2026-05-01&to=2026-05-05`)
  assert.equal(status, 200)
  const ward = body.wards.find((row) => row.ward === WARD)
  assert.equal(ward.patientDays, 7)
  assert.equal(ward.distinctPatients, 3)
  assert.equal(ward.previousPatientDays, 1)
  assert.equal(ward.admissions, 1, 'Omar on 05-01; Sara on 05-05 follows an uncharted day')
  assert.equal(ward.discharges, 1, 'Omar after 05-02')
  assert.equal(ward.averageStay, 2, 'stays of 4 (from 04-30), 2, 1 and 1 days')
  assert.equal(ward.chartedDays, 4)
  assert.equal(ward.completedDays, 1)
  assert.deepEqual(ward.missedDates, ['2026-05-04'])
  assert.deepEqual(body.polypharmacy.map((row) => [row.patient, row.maxMedicines]), [['عمر', 10]])

  const aspirin = body.consumption.find((line) => line.name === 'Aspirin 100mg Tab')
  assert.deepEqual([aspirin.quantity, aspirin.previous, aspirin.change], [10, 2, 400], "Ali 2×4 days + Omar 1×2 days, vs 2")
  assert.equal(body.consumption.find((line) => line.name === 'IV set').isSupply, true)
  // Medicine types include supplies: 10 medicines + IV set + N/S; the previous period had Aspirin only.
  assert.deepEqual([body.summary.medicineTypes, body.summary.previousMedicineTypes], [12, 1])
  // Other floor-5 wards had no charts at all.
  assert.equal(body.wards.find((row) => row.ward === 'ردهة النساء').missedDates.length, 5)
})

test('GET /api/reports: a stay of 7+ days still running on the last day is a long stay', async () => {
  const admin = await loginAs({ role: 'admin' })
  for (let day = 29; day <= 35; day += 1) {
    const date = day <= 30 ? `2026-04-${day}` : `2026-05-0${day - 30}`
    await saveChart(admin, 2, date, [{ name: 'هادي', meds: { 'Aspirin 100mg Tab': 1 } }])
  }
  const { body } = await admin.get('/api/reports?scope=all&from=2026-05-01&to=2026-05-05')
  assert.deepEqual(body.longStays.map((row) => [row.patient, row.floor, row.days, row.since]), [['هادي', 2, 7, '2026-04-29']])
  assert.ok(body.floors.some((row) => row.floor === 2 && row.patientDays === 5))
})

test('GET /api/reports: managers only, valid scope, and at most 120 days', async () => {
  const user = await loginAs({ role: 'user', floor: 5 })
  assert.equal((await user.get('/api/reports?scope=5&from=2026-05-01&to=2026-05-05')).status, 403)
  const supervisor = await loginAs({ role: 'supervisor' })
  assert.equal((await supervisor.get('/api/reports?scope=5&from=2026-05-01&to=2026-05-05')).status, 200)
  assert.equal((await supervisor.get('/api/reports?scope=7&from=2026-05-01&to=2026-05-05')).status, 400)
  assert.equal((await supervisor.get('/api/reports?scope=all&from=2026-01-01&to=2026-06-01')).status, 400)
  assert.equal((await supervisor.get('/api/reports?scope=all&from=2026-05-05&to=2026-05-01')).status, 400)
})

test('medicines is_supply: defaults from the name on add, and the admin can toggle it', async () => {
  const admin = await loginAs({ role: 'admin' })
  const cannula = await admin.post('/api/medicines', { name: 'Cannula 20G' })
  assert.equal(cannula.body.medicine.is_supply, true)
  const clexane = await admin.post('/api/medicines', { name: 'Clexane prefilled syringe 4000 IU' })
  assert.equal(clexane.body.medicine.is_supply, false)
  const toggled = await admin.put(`/api/medicines/${clexane.body.medicine.id}`, { isSupply: true, noThursdayDouble: true })
  assert.equal(toggled.body.medicine.is_supply, true)
  assert.equal(toggled.body.medicine.no_thursday_double, true)
  assert.equal(toggled.body.medicine.name, 'Clexane prefilled syringe 4000 IU')
})

test('GET /api/reports: a patient is one patient by ID (رقم الطبلة), else by name', async () => {
  const admin = await loginAs({ role: 'admin' })
  const meds = { 'Aspirin 100mg Tab': 1 }
  // Two different patients who share a name (different IDs), and one patient typed by name on
  // day 1 and given an ID on day 2.
  await saveChart(admin, 5, '2026-06-01', [{ name: 'علي', id: '100', meds }, { name: 'علي', id: '200', meds }, { name: 'زينب', meds }])
  await saveChart(admin, 5, '2026-06-02', [{ name: 'علي', id: '100', meds }, { name: 'علي', id: '200', meds }, { name: 'زينب', id: '300', meds }])

  const { body } = await admin.get(`/api/reports?scope=5&from=2026-06-01&to=2026-06-02`)
  const ward = body.wards.find((row) => row.ward === WARD)
  assert.equal(ward.distinctPatients, 3, 'علي/100, علي/200 and زينب (name-only on day 1, ID 300 on day 2)')
  assert.equal(ward.admissions, 0, 'Zeinab getting her ID on day 2 is not a new admission')
  assert.equal(ward.discharges, 0)
})
