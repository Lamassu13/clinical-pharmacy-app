import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'
import { clearReports } from './routes/reports.js'

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
const saveChart = async (client, floor, date, patients, ward = WARD) => {
  const columns = [...new Set(patients.flatMap((patient) => Object.keys(patient.meds)))]
  const response = await client.put('/api/chart', {
    floor, ward, date, expectedVersion: 0,
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
  // 05-04: no chart at all (as on a Friday) — Ali, there on 05-03 and 05-05, was there on 05-04 too.
  await saveChart(admin, 5, '2026-05-05', [ali, { name: 'سارة', meds: { 'Panadol 500mg Tab': 1 } }])
  await admin.patch('/api/chart/complete', { floor: 5, ward: WARD, date: '2026-05-01', completed: true })

  const { status, body } = await admin.get(`/api/reports?scope=5&from=2026-05-01&to=2026-05-05`)
  assert.equal(status, 200)
  const ward = body.wards.find((row) => row.ward === WARD)
  assert.equal(ward.patientDays, 8, 'Ali\'s uncharted 05-04 is bridged')
  assert.equal(ward.distinctPatients, 3)
  assert.equal(ward.previousPatientDays, 1)
  assert.equal(ward.admissions, 2, 'Omar on 05-01; Sara on 05-05, compared with 05-03 across the uncharted day')
  assert.equal(ward.discharges, 1, 'Omar after 05-02')
  assert.equal(ward.averageStay, 3, 'stays of 6 (Ali, 04-30 to 05-05), 2 and 1 days')
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

test('GET /api/reports: antibiotic stewardship — long courses, concurrent antibiotics, Reserve drugs, scope', async () => {
  const admin = await loginAs({ role: 'admin' })
  await pool.query('INSERT INTO medicines (name) SELECT unnest($1::text[])', [['Meronem 1000gm Vial', 'Tazocin 4.5gm Vial', 'Tygacil 50mg Vial', 'Diflucan 200mg Vial']])
  for (let day = 1; day <= 16; day += 1) {
    const meds = { 'Meronem 1000gm Vial': 3 }
    if (day === 10) Object.assign(meds, { 'Tazocin 4.5gm Vial': 3, 'Tygacil 50mg Vial': 2 })
    await saveChart(admin, 2, `2026-05-${String(day).padStart(2, '0')}`, [{ name: 'هادي', meds }])
  }
  await saveChart(admin, 5, '2026-05-16', [{ name: 'سعد', meds: { 'Tygacil 50mg Vial': 2, 'Diflucan 200mg Vial': 1 } }])

  const { body } = await admin.get('/api/reports?scope=all&from=2026-05-01&to=2026-05-16')
  assert.deepEqual(body.antibiotics.longCourses.map((row) => [row.name, row.floor, row.drugKey, row.day]), [['هادي', 2, 'meropenem', 16]])
  assert.deepEqual(body.antibiotics.multiple.map((row) => [row.patient, row.maxConcurrent, row.days, row.drugs]), [['هادي', 3, 1, ['Meropenem', 'Piperacillin/tazobactam', 'Tigecycline']]])
  assert.deepEqual(body.antibiotics.reserve.map((row) => [row.patient, row.drug, row.days]), [['سعد', 'Tigecycline', 1], ['هادي', 'Tigecycline', 1]])
  // Days of therapy: Meropenem 16 + Tazocin 1 + Tigecycline 1 (هادي) + Tigecycline 1 and fluconazole 1 (سعد, an antifungal counts like the DDD).
  assert.deepEqual([body.antibiotics.dot.days, ...body.antibiotics.dot.byDrug.slice(0, 2).map((row) => [row.drug, row.days])], [20, ['Meropenem', 16], ['Tigecycline', 2]])

  const floor5 = (await admin.get('/api/reports?scope=5&from=2026-05-01&to=2026-05-16')).body.antibiotics
  assert.deepEqual([floor5.longCourses.length, floor5.multiple.length, floor5.reserve.map((row) => row.patient)], [0, 0, ['سعد']])
})

test('GET /api/reports: DDD counts Thursday twice (Friday has no chart), except a range ending that Thursday or a no-double medicine', async () => {
  const admin = await loginAs({ role: 'admin' })
  await pool.query('INSERT INTO medicines (name) VALUES ($1)', ['Meronem 1000gm Vial'])
  // 2026-05-07 is a Thursday; 05-08 (Friday) has no chart; 05-09 is the Saturday.
  await saveChart(admin, 2, '2026-05-07', [{ name: 'هادي', meds: { 'Meronem 1000gm Vial': 3 } }])
  await saveChart(admin, 2, '2026-05-09', [{ name: 'هادي', meds: { 'Meronem 1000gm Vial': 3 } }])
  const over = (to) => admin.get(`/api/reports?scope=2&from=2026-05-07&to=${to}`).then((response) => response.body.antibiotics)

  let { totalDdds, dddPer100 } = await over('2026-05-09')
  assert.deepEqual([totalDdds, dddPer100], [3, 100], 'Thu 3 vials x2 + Sat 3 = 9 g = 3 DDD over 3 patient-days')
  assert.deepEqual([(await over('2026-05-09')).dot.days, (await over('2026-05-09')).dot.per1000], [3, 1000], 'days of therapy: Thu, the bridged Fri and Sat, whatever the vials')
  ;({ totalDdds } = await over('2026-05-07'))
  assert.equal(totalDdds, 1, 'the range ends on the Thursday: Friday is not in the range')

  // One patient, 3 vials = 1 DDD a day: Friday is only owed when the patient-days count it.
  const dose = { 'Meronem 1000gm Vial': 3 }
  const ddd = (from, to) => admin.get(`/api/reports?scope=2&from=${from}&to=${to}`).then((response) => [response.body.antibiotics.totalDdds, response.body.antibiotics.dddPer100])
  await saveChart(admin, 2, '2026-05-13', [{ name: 'عمر', meds: dose }]) // Wed
  await saveChart(admin, 2, '2026-05-14', [{ name: 'عمر', meds: dose }]) // Thu
  assert.deepEqual(await ddd('2026-05-13', '2026-05-15'), [2, 100], 'range ends on the Friday: no later chart, so no Friday patient-day and no Friday doses')
  await saveChart(admin, 2, '2026-05-21', [{ name: 'عمر', meds: dose }]) // Thu, the day before the range
  await saveChart(admin, 2, '2026-05-23', [{ name: 'عمر', meds: dose }]) // Sat
  assert.deepEqual(await ddd('2026-05-22', '2026-05-24'), [2, 100], 'the range starts on the Friday: Thursday\'s extra day is inside it')
  for (const day of [28, 29, 30]) await saveChart(admin, 2, `2026-05-${day}`, [{ name: 'عمر', meds: dose }])
  assert.deepEqual(await ddd('2026-05-28', '2026-05-30'), [3, 100], 'Friday was charted: nothing is doubled')

  await pool.query('UPDATE medicines SET no_thursday_double = TRUE WHERE name = $1', ['Meronem 1000gm Vial'])
  clearReports()
  ;({ totalDdds } = await over('2026-05-09'))
  assert.equal(totalDdds, 2, 'a medicine that repeats its normal quantity is not doubled')
})

test('GET /api/reports: staff activity per user, scoped to the floor', async () => {
  const admin = await loginAs({ role: 'admin' })
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  await saveChart(pharmacist, 5, '2026-05-01', [{ name: 'علي', meds: { 'Aspirin 100mg Tab': 1 } }])
  await saveChart(pharmacist, 5, '2026-05-02', [{ name: 'علي', meds: { 'Aspirin 100mg Tab': 1 } }])
  await admin.patch('/api/chart/complete', { floor: 5, ward: WARD, date: '2026-05-02', completed: true })
  await saveChart(admin, 2, '2026-05-02', [{ name: 'هادي', meds: { 'Aspirin 100mg Tab': 1 } }])

  const byName = (body) => Object.fromEntries(body.staff.map(({ name, userId: _userId, ...counts }) => [name, counts]))
  const floor5 = byName((await admin.get('/api/reports?scope=5&from=2026-05-01&to=2026-05-05')).body)
  const names = Object.keys(floor5)
  assert.equal(names.length, 2)
  const [pharmacistName, adminName] = names.sort((a, b) => floor5[b].started - floor5[a].started)
  assert.deepEqual(floor5[pharmacistName], { started: 2, completed: 0, lastEdited: 2, extraForms: 0 })
  assert.deepEqual(floor5[adminName], { started: 0, completed: 1, lastEdited: 0, extraForms: 0 })
  // The floor-2 chart only counts hospital-wide.
  const all = byName((await admin.get('/api/reports?scope=all&from=2026-05-01&to=2026-05-05')).body)
  assert.deepEqual(all[adminName], { started: 1, completed: 1, lastEdited: 1, extraForms: 0 })
})

test('GET /api/reports: managers only, valid scope, and at most 120 days', async () => {
  const user = await loginAs({ role: 'user', floor: 5 })
  assert.equal((await user.get('/api/reports?scope=5&from=2026-05-01&to=2026-05-05')).status, 403)
  const supervisor = await loginAs({ role: 'supervisor' })
  assert.equal((await supervisor.get('/api/reports?scope=5&from=2026-05-01&to=2026-05-05')).status, 200)
  assert.equal((await supervisor.get('/api/reports?scope=5,ردهة العناية المركزة&from=2026-05-01&to=2026-05-05')).status, 200, 'several floors/wards at once')
  assert.equal((await supervisor.get('/api/reports?scope=5,7&from=2026-05-01&to=2026-05-05')).status, 400, 'one unknown entry rejects')
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

test('GET /api/reports: antibiotic DDD per 100 patient-days with the AWaRe split', async () => {
  const admin = await loginAs({ role: 'admin' })
  await pool.query('INSERT INTO medicines (name) SELECT unnest($1::text[])', [['Meronem 1000gm Vial', 'Flagyl 500mg tab', 'Amoxil 250mg/5ml Susp']])
  const patients = [
    { name: 'علي', meds: { 'Meronem 1000gm Vial': 3 } }, // 3 g a day = 1 DDD
    { name: 'عمر', meds: { 'Flagyl 500mg tab': 4, 'Amoxil 250mg/5ml Susp': 1 } }, // 2 g oral = 1 DDD; suspension not counted
    { name: 'سارة', meds: { 'Aspirin 100mg Tab': 1 } },
    { name: 'هدى', meds: { 'Aspirin 100mg Tab': 1 } },
  ]
  await saveChart(admin, 5, '2026-05-01', patients)
  await saveChart(admin, 5, '2026-05-02', patients)

  const { body } = await admin.get('/api/reports?scope=5&from=2026-05-01&to=2026-05-02')
  const { antibiotics } = body
  assert.deepEqual(antibiotics.lines.map((line) => [line.name, line.atc, line.aware, line.ddds, line.dddPer100]), [
    ['Flagyl 500mg tab', 'P01AB01', 'Access', 2, 25],
    ['Meronem 1000gm Vial', 'J01DH02', 'Watch', 2, 25],
  ]) // 8 patient-days
  assert.deepEqual([antibiotics.totalDdds, antibiotics.dddPer100, antibiotics.aware], [4, 50, { Access: 50, Watch: 50, Reserve: 0 }])
  assert.deepEqual(antibiotics.notCounted.map((line) => line.name), ['Amoxil 250mg/5ml Susp'])
})

test('GET /api/reports: course length, restarts, ward DDD, weekly trend, stay lengths and readmissions', async () => {
  const admin = await loginAs({ role: 'admin' })
  await pool.query('INSERT INTO medicines (name) VALUES ($1)', ['Meronem 1000gm Vial'])
  const mero = { 1: 2, 2: 2, 3: 2, 5: 2, 6: 2, 8: 4 } // days on meropenem; 05-04 and 05-07 are gaps
  for (let day = 1; day <= 8; day += 1) {
    const patients = [{ name: 'هادي', meds: mero[day] ? { 'Meronem 1000gm Vial': mero[day] } : { 'Aspirin 100mg Tab': 1 } }]
    if (day !== 3) patients.push({ name: 'سامي', meds: { 'Aspirin 100mg Tab': 1 } }) // away on day 3 only
    await saveChart(admin, 2, `2026-05-0${day}`, patients)
  }
  const { body } = await admin.get('/api/reports?scope=2&from=2026-05-01&to=2026-05-09')
  const { antibiotics } = body
  assert.deepEqual(antibiotics.courseStats.map((row) => [row.drug, row.courses, row.average, row.median, row.max]), [['Meropenem', 3, 2, 2, 3]])
  assert.deepEqual(antibiotics.restarts.map((row) => [row.patient, row.stoppedOn, row.restartedOn, row.gap]), [['هادي', '2026-05-03', '2026-05-05', 1], ['هادي', '2026-05-06', '2026-05-08', 1]])
  const ward = antibiotics.byWard.find((row) => row.ward === WARD)
  assert.deepEqual([ward.patientDays, ward.ddds > 0, ward.dddPer100 > 0], [15, true, true])
  assert.deepEqual(body.trend.medicines.find((line) => line.name === 'Meronem 1000gm Vial').weeks, [10, 4])
  assert.deepEqual(body.readmissions.map((row) => [row.patient, row.count, row.returns]), [['سامي', 1, [{ date: '2026-05-04', gap: 1 }]]])
  const stays = body.stayRows.find((row) => row.ward === WARD)
  assert.deepEqual([stays.stays, stays.median, stays.max, stays.buckets], [3, 5, 8, [1, 1, 1, 0]])
})

test('GET /api/reports: no chart on Friday — stays, courses, admissions and returns bridge it; ID-only rows count as charted', async () => {
  const admin = await loginAs({ role: 'admin' })
  await pool.query('INSERT INTO medicines (name) VALUES ($1)', ['Tazocin 4.5gm Vial'])
  const tazocin = { 'Tazocin 4.5gm Vial': 3 }
  const aspirin = { 'Aspirin 100mg Tab': 1 }
  // September 2026: the 18th and 25th are Fridays, with no chart at all.
  for (let day = 13; day <= 30; day += 1) {
    if (day === 18 || day === 25) continue
    const patients = []
    if (day >= 15) patients.push({ name: 'بكر', id: '102', meds: day >= 22 ? tazocin : aspirin })
    if ((day >= 14 && day <= 17) || day >= 24) patients.push({ name: 'جمال', id: '103', meds: aspirin }) // away 18–23
    await saveChart(admin, 5, `2026-09-${day}`, patients)
  }
  const { body } = await admin.get('/api/reports?scope=5&from=2026-09-22&to=2026-09-30')
  const ward = body.wards.find((row) => row.ward === WARD)
  assert.equal(ward.patientDays, 16, 'بكر 22–30 and جمال 24–30, Friday 25 included')
  assert.equal(ward.admissions, 1, 'جمال on the 24th')
  assert.deepEqual(body.longStays.map((row) => [row.patient, row.days, row.since]), [['بكر', 16, '2026-09-15'], ['جمال', 7, '2026-09-24']])
  assert.deepEqual(body.readmissions.map((row) => [row.patient, row.returns]), [['جمال', [{ date: '2026-09-24', gap: 6 }]]], 'absence began before the range')
  assert.deepEqual(body.antibiotics.courseStats.map((row) => [row.drug, row.courses, row.max]), [['Piperacillin/tazobactam', 1, 9]])
  assert.deepEqual(body.antibiotics.restarts, [])
  // 4.5gm is grams: 8 charted days + Thursday the 24th counted twice for the uncharted Friday = 9 days
  // × 3 vials × 4 g piperacillin = 108 g = 7.7 DDD.
  assert.equal(body.antibiotics.lines[0].ddds, 7.7)

  // A ward that types only the patient number is charted, not "missed".
  for (const day of [22, 23, 24]) await saveChart(admin, 5, `2026-09-${day}`, [{ name: '', id: '901', meds: aspirin }], 'ردهة النساء')
  const ids = (await admin.get('/api/reports?scope=5&from=2026-09-22&to=2026-09-24')).body.wards.find((row) => row.ward === 'ردهة النساء')
  assert.deepEqual([ids.chartedDays, ids.missedDates, ids.patientDays], [3, [], 3])
})

test('GET /api/reports: antibiotics per floor, and every antibacterial course over 14 days in the range', async () => {
  const admin = await loginAs({ role: 'admin' })
  await pool.query('INSERT INTO medicines (name) SELECT unnest($1::text[])', [['Meronem 1000gm Vial', 'Fluconazole 200mg Tab', 'Ceftriaxone 1gm Vial']])
  const mero = { 'Meronem 1000gm Vial': 3 }
  const aspirin = { 'Aspirin 100mg Tab': 1 }
  for (let day = 1; day <= 30; day += 1) {
    const date = `2026-08-${String(day).padStart(2, '0')}`
    await saveChart(admin, 2, date, [
      { name: 'أحمد', meds: day <= 20 ? mero : aspirin }, // 08-01 → 08-20, began before the range, then charted without it
      { name: 'باسم', meds: day >= 12 ? mero : aspirin }, // 08-12 → 08-30, still on it
      { name: 'جاسم', meds: day >= 5 && day <= 24 ? { 'Fluconazole 200mg Tab': 1 } : aspirin }, // 20 days, but an antifungal
      { name: 'داود', meds: day >= 15 && day <= 24 ? { 'Ceftriaxone 1gm Vial': 1 } : aspirin }, // 10 days only
    ])
    if (day >= 10) await saveChart(admin, 2, date, [{ name: 'هاني', meds: mero }], 'ردهة النساء') // 21 days, another ward
  }
  const { antibiotics } = (await admin.get('/api/reports?scope=all&from=2026-08-10&to=2026-08-30')).body

  assert.deepEqual(antibiotics.longRuns.map((row) => [row.patient, row.ward, row.drug, row.from, row.to, row.days, row.ongoing]), [
    ['هاني', 'ردهة النساء', 'Meropenem', '2026-08-10', '2026-08-30', 21, true],
    ['أحمد', WARD, 'Meropenem', '2026-08-01', '2026-08-20', 20, false],
    ['باسم', WARD, 'Meropenem', '2026-08-12', '2026-08-30', 19, true],
  ])
  // The course table counts the same full lengths (the antifungal too — it is only left off the list).
  assert.deepEqual(antibiotics.courseStats.filter((row) => row.long).map((row) => [row.drug, row.courses, row.max, row.long]), [['Fluconazole', 1, 20, 1], ['Meropenem', 3, 21, 3]].sort((a, b) => b[1] - a[1]))

  const floor2 = antibiotics.byFloor.filter((row) => row.floor === 2)
  const wards2 = antibiotics.byWard.filter((row) => row.floor === 2)
  assert.equal(floor2.length, 1)
  assert.equal(wards2.length, 2)
  assert.equal(floor2[0].patientDays, wards2[0].patientDays + wards2[1].patientDays)
  assert.ok(Math.abs(floor2[0].ddds - (wards2[0].ddds + wards2[1].ddds)) <= 0.1)
  assert.equal(floor2[0].dddPer100, Math.round((floor2[0].ddds / floor2[0].patientDays) * 1000) / 10)
})

test('GET /api/reports: the same patient ID on different patients lists each one with its floor; a transfer of one patient does not', async () => {
  const admin = await loginAs({ role: 'admin' })
  const meds = { 'Aspirin 100mg Tab': 1 }
  await saveChart(admin, 2, '2026-05-02', [{ name: 'سامي', id: '500', meds }, { name: 'نور', id: '600', meds }])
  await saveChart(admin, 5, '2026-05-03', [{ name: 'ليث', id: '500', meds }, { name: 'نور', id: '600', meds }]) // 600: one patient moved ward
  await saveChart(admin, 5, '2026-05-04', [{ name: 'ليث', id: '500', meds }])
  const { body } = await admin.get('/api/reports?scope=all&from=2026-05-01&to=2026-05-05')
  assert.deepEqual(body.sameIds.map((group) => [group.patientId, group.entries.map((e) => [e.patient, e.floor, e.from, e.to, e.days])]),
    [['500', [['سامي', 2, '2026-05-02', '2026-05-02', 1], ['ليث', 5, '2026-05-03', '2026-05-04', 2]]]])
})

test('GET /api/reports: one name spelled two ways under the same ID is not a clash', async () => {
  const admin = await loginAs({ role: 'admin' })
  const meds = { 'Aspirin 100mg Tab': 1 }
  await saveChart(admin, 2, '2026-05-02', [{ name: 'أحمد علي', id: '700', meds }])
  await saveChart(admin, 5, '2026-05-03', [{ name: 'احمد على', id: '700', meds }])
  assert.deepEqual((await admin.get('/api/reports?scope=all&from=2026-05-01&to=2026-05-05')).body.sameIds, [])
})

test('GET /api/reports: the same ID on two patients of one floor is not listed; on two floors it is', async () => {
  const admin = await loginAs({ role: 'admin' })
  const meds = { 'Aspirin 100mg Tab': 1 }
  await saveChart(admin, 2, '2026-05-02', [{ name: 'سامي', id: '800', meds }, { name: 'ليث', id: '800', meds }]) // one floor
  await saveChart(admin, 2, '2026-05-04', [{ name: 'نور', id: '900', meds }])
  await saveChart(admin, 5, '2026-05-03', [{ name: 'هدى', id: '900', meds }])
  const { body } = await admin.get('/api/reports?scope=all&from=2026-05-01&to=2026-05-05')
  assert.deepEqual(body.sameIds.map((group) => group.patientId), ['900'])
})

test('GET /api/reports: a repeat of the same range is served from the 60 s cache, and a clear refreshes it', async () => {
  const admin = await loginAs({ role: 'admin' })
  const meds = { 'Aspirin 100mg Tab': 1 }
  const url = '/api/reports?scope=all&from=2026-05-01&to=2026-05-05'
  await saveChart(admin, 2, '2026-05-02', [{ name: 'سامي', id: '800', meds }])
  assert.equal((await admin.get(url)).body.summary.distinctPatients, 1)
  await saveChart(admin, 2, '2026-05-03', [{ name: 'ليث', id: '801', meds }])
  assert.equal((await admin.get(url)).body.summary.distinctPatients, 1, 'second read of the range is the cached one')
  assert.equal((await admin.get('/api/reports?scope=2&from=2026-05-01&to=2026-05-05')).body.summary.distinctPatients, 2, 'another scope is its own entry')
  clearReports()
  assert.equal((await admin.get(url)).body.summary.distinctPatients, 2)
})
