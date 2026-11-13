import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'
import { buildCandidates } from './antibiotic-forms.js'
import { buildMeropenemForm } from './meropenem.js'
import { todayInBaghdad } from './push.js'
import { dayLockSettings } from './day-lock.js'
import { cleanForm, missingAnswers, exportRows, EXPORT_COLUMNS, floorLabel, isFinal, YES, NO, FORMS_FROM } from '../shared/antibiotic-form.js'

// The API tests chart days before the form's start day (FORMS_FROM): they turn it off (read by the route; this file's process only).
process.env.ABX_FORMS_FROM = ''

const A = { floor: 5, ward: 'ردهة رجال' }
const MERONEM = 'Meronem 1000gm Vial'
const VANCO = 'Vancomycin 500mg Vial'

// chartDays: [[iso, [{ name, id?, meds: { medicine: qty } }]]] on ward A; a row with no meds is on the chart without any.
const scenario = (date, chartDays, extraCharted = []) => {
  const cells = [], presence = [], charted = extraCharted.map((day) => ({ date: day, ...A }))
  chartDays.forEach(([day, rows]) => {
    charted.push({ date: day, ...A })
    rows.forEach((row) => {
      const base = { date: day, ...A, name: row.name, patientId: row.id || '' }
      presence.push(base)
      Object.entries(row.meds || {}).forEach(([medicine, quantity]) => { if (quantity) cells.push({ ...base, medicine, quantity }) })
    })
  })
  return { date, ...A, cells, presence, charted }
}
// The scenarios chart days before the form's start day (FORMS_FROM); they test the course rules, so the start day is off here.
const candidates = (date, chartDays, extra = {}) => buildCandidates({ rows: scenario(date, chartDays, extra.charted), date, formsFrom: '', ...extra })
const ali = (meds = { [MERONEM]: 3 }) => ({ name: 'علي', id: '123', meds })
const pick = (drug) => ({ drug: drug.drug, strength: drug.strength, oral: drug.oral, injection: drug.injection, frequency: drug.frequency, days: drug.days, start: drug.start, stop: drug.stop })

test('candidates: two antibiotics on one patient are two blocks, each with what the chart says and no frequency', () => {
  const both = { [MERONEM]: 3, [VANCO]: 4 }
  const { patients } = candidates('2026-11-10', [['2026-11-08', [ali(both)]], ['2026-11-09', [ali(both)]], ['2026-11-10', [ali(both)]]])
  assert.equal(patients.length, 1)
  assert.deepEqual(patients[0].drugs.map(pick), [
    { drug: 'meropenem', strength: '1000 mg', oral: NO, injection: YES, frequency: '', days: '3', start: '2026-11-08', stop: '' },
    { drug: 'vancomycin', strength: '500 mg', oral: NO, injection: YES, frequency: '', days: '3', start: '2026-11-08', stop: '' },
  ])
  assert.equal(patients[0].drugs[1].unitsPerDay, 4) // the chart's units, shown as a hint only
  assert.deepEqual(patients[0].prefill.stayDays, { value: '3', source: 'الجارت' })
})

test('candidates: an uncharted Friday counts inside a course; a stop is the last dose day', () => {
  // Thu 5, (Fri 6, no chart), Sat 7, Sun 8 dosed; Mon 9 on the chart without it.
  const { patients: [patient] } = candidates('2026-11-10', [['2026-11-05', [ali()]], ['2026-11-07', [ali()]], ['2026-11-08', [ali()]], ['2026-11-09', [ali({})]]])
  assert.deepEqual(pick(patient.drugs[0]), { drug: 'meropenem', strength: '1000 mg', oral: NO, injection: YES, frequency: '', days: '4', start: '2026-11-05', stop: '2026-11-08' })
})

test('candidates: a course last charted on a Thursday ran through the uncharted Friday — unless that Friday was charted', () => {
  const days = [['2026-11-03', [ali()]], ['2026-11-04', [ali()]], ['2026-11-05', [ali()]], ['2026-11-07', [ali({})]]]
  const bridged = candidates('2026-11-08', days).patients[0].drugs[0]
  assert.deepEqual([bridged.days, bridged.start, bridged.stop], ['4', '2026-11-03', '2026-11-06'])
  const chartedFriday = candidates('2026-11-08', [...days, ['2026-11-06', [ali({})]]]).patients[0].drugs[0]
  assert.deepEqual([chartedFriday.days, chartedFriday.stop], ['3', '2026-11-05'])
})

test('candidates: a patient no longer on the ward\'s latest chart is flagged out of the chart; a Friday looks at Thursday\'s chart', () => {
  const chartDays = [['2026-11-04', [ali(), { name: 'سعد', id: '777', meds: { [VANCO]: 2 } }]], ['2026-11-05', [ali(), { name: 'سعد', id: '777', meds: { [VANCO]: 2 } }]], ['2026-11-07', [ali()]]]
  const byName = (list) => Object.fromEntries(list.map((patient) => [patient.name, patient.inChart]))
  assert.deepEqual(byName(candidates('2026-11-08', chartDays).patients), { 'علي': true, 'سعد': false })
  // Friday 6: no chart that day, Thursday's is the latest — both are still on it.
  assert.deepEqual(byName(candidates('2026-11-06', chartDays.slice(0, 2)).patients), { 'علي': true, 'سعد': true })
})

test('candidates: only the main chart\'s patients are listed; an extra-chart dose still counts in the course', () => {
  const rows = scenario('2026-11-10', [['2026-11-08', [ali()]], ['2026-11-09', [ali()]], ['2026-11-10', [ali(), { name: 'سعد', id: '777', meds: { [VANCO]: 2 } }]]])
  // سعد is on الجارت الإضافي only; علي's first day was on it too.
  rows.cells.forEach((cell) => { cell.extra = cell.name === 'سعد' || cell.date === '2026-11-08' })
  const { patients } = buildCandidates({ rows, date: '2026-11-10', formsFrom: '' })
  assert.deepEqual(patients.map((patient) => patient.name), ['علي'])
  assert.deepEqual([patients[0].drugs[0].days, patients[0].drugs[0].start], ['3', '2026-11-08'])
})

test('candidates: nobody before the form\'s start day; from it, a course already running keeps its real start', () => {
  assert.equal(FORMS_FROM, '2026-11-15')
  const days = [['2026-11-12', [ali()]], ['2026-11-14', [ali(), { name: 'سعد', id: '777', meds: { [VANCO]: 2 } }]], ['2026-11-15', [ali()]], ['2026-11-16', [ali()]]]
  const later = buildCandidates({ rows: scenario('2026-11-16', days), date: '2026-11-16' })
  assert.deepEqual(later.patients.map((patient) => patient.name), ['علي']) // سعد's last dose was the day before
  assert.equal(later.patients[0].drugs[0].start, '2026-11-12')
  assert.deepEqual(buildCandidates({ rows: scenario('2026-11-14', days.slice(0, 2)), date: '2026-11-14' }).patients, [])
})

test('candidates: a restart shows the latest course only', () => {
  // 27-28 Oct, then Thu 29 / Sat 31 / Sun 1 on the chart without it (course over), restarted 2-3 Nov.
  const { patients: [patient] } = candidates('2026-11-03', [
    ['2026-10-27', [ali()]], ['2026-10-28', [ali()]], ['2026-10-29', [ali({})]], ['2026-10-31', [ali({})]], ['2026-11-01', [ali({})]],
    ['2026-11-02', [ali()]], ['2026-11-03', [ali()]],
  ])
  assert.equal(patient.drugs.length, 1)
  assert.deepEqual([patient.drugs[0].days, patient.drugs[0].start, patient.drugs[0].stop], ['2', '2026-11-02', ''])
})

test('candidates: strengths given the same day are joined, colistin reads in IU', () => {
  const both = candidates('2026-11-09', [['2026-11-09', [ali({ [MERONEM]: 3, 'Meronem 500gm Vial': 3 })]]]).patients[0].drugs[0]
  assert.equal(both.strength, '1000 mg + 500 mg')
  const colistin = candidates('2026-11-09', [['2026-11-09', [ali({ 'Colistin 1000000 IU vial': 3 })]]]).patients[0].drugs[0]
  assert.deepEqual([colistin.drug, colistin.strength], ['colistin', '1000000 IU'])
})

test('candidates: what the name does not say stays blank — route, a per-ml or missing strength', () => {
  const noRoute = candidates('2026-11-09', [['2026-11-09', [ali({ 'Meronem 1000gm': 3 })]]]).patients[0].drugs[0]
  assert.deepEqual([noRoute.oral, noRoute.injection, noRoute.strength], ['', '', '1000 mg'])
  const syrup = candidates('2026-11-09', [['2026-11-09', [ali({ 'Augmentin 228mg/5ml susp': 2 })]]]).patients[0].drugs[0]
  assert.deepEqual([syrup.drug, syrup.strength], ['augementin', ''])
  assert.equal(candidates('2026-11-09', [['2026-11-09', [ali({ 'Vancomycin vial': 2 })]]]).patients[0].drugs[0].strength, '')
  // One unreadable strength on the day blanks the whole answer rather than give half of it.
  assert.equal(candidates('2026-11-09', [['2026-11-09', [ali({ [VANCO]: 2, 'Vancomycin vial': 2 })]]]).patients[0].drugs[0].strength, '')
})

test('candidates: antifungals are not listed; a patient off antibiotics for over two weeks is not either', () => {
  assert.deepEqual(candidates('2026-11-09', [['2026-11-09', [ali({ 'Fluconazole 200mg vial': 1 })]]]).patients, [])
  assert.deepEqual(candidates('2026-11-09', [['2026-10-25', [ali()]], ['2026-10-26', [ali({})]]]).patients, [])
})

test('candidates: a course that ended last month is still found (since), with its own dates', () => {
  const days = [['2026-10-26', [ali()]], ['2026-10-27', [ali()]], ['2026-10-28', [ali()]], ['2026-10-29', [ali({})]]]
  // The month view alone (from the 1st) no longer has the patient …
  assert.deepEqual(buildMeropenemForm(scenario('2026-11-03', days)).patients, [])
  // … the list reaches back across the month's start.
  const drug = candidates('2026-11-03', days).patients[0].drugs[0]
  assert.deepEqual([drug.days, drug.start, drug.stop], ['3', '2026-10-26', '2026-10-28'])
})

test('candidates: a typed course day keeps its count but gives no start date', () => {
  const overridesByDrug = new Map([['meropenem', [{ patientKey: 'id:123', date: '2026-11-08', n: 4 }]]])
  const drug = candidates('2026-11-10', [['2026-11-08', [ali()]], ['2026-11-09', [ali()]], ['2026-11-10', [ali()]]], { overridesByDrug }).patients[0].drugs[0]
  assert.deepEqual([drug.days, drug.start], ['6', ''])
})

test('candidates: age and diagnosis from the request forms; allergy and culture only as hints; the saved form attached', () => {
  const requests = [
    { id: 1, kind: 'meropenem', wardKey: '5|ردهة رجال', date: '2026-11-08', name: 'علي', patientId: '123', fields: { age: '45 سنة', allergy: 'لا يوجد' }, ticks: ['cap', 'culture-before'], note: '' },
    // A namesake with another ID is someone else.
    { id: 2, kind: 'tigecycline', wardKey: '5|ردهة رجال', date: '2026-11-09', name: 'علي', patientId: '999', fields: { age: '80', diagnosis: 'Other' }, ticks: [], note: '' },
  ]
  const forms = [
    { id: 7, name: 'علي', patientId: '123', formDate: '2026-11-09', fields: {}, drugs: [], updatedAt: '2026-11-09T10:00:00.000Z' },
    { id: 8, name: 'سعاد', patientId: '', formDate: '2026-11-09', fields: { department: 'الجراحة' }, drugs: [], updatedAt: '2026-11-09T11:00:00.000Z' },
  ]
  const { patients: [patient], manual, lastDepartment } = candidates('2026-11-10', [['2026-11-08', [ali()]], ['2026-11-09', [ali()]], ['2026-11-10', [ali()]]], { requests, forms })
  assert.deepEqual(patient.prefill.age, { value: '45', source: 'استمارة الميرونيم', date: '2026-11-08' })
  assert.equal(patient.prefill.diagnosis.value, 'Severe CAP admitted to ICU')
  assert.deepEqual(patient.hints.allergy, { answer: NO, detail: 'لا يوجد', source: 'استمارة الميرونيم', date: '2026-11-08' })
  assert.equal(patient.hints.culture.answer, YES)
  assert.equal(patient.form.id, 7)
  assert.deepEqual(manual.map((form) => form.id), [8])
  assert.equal(lastDepartment, 'الجراحة')
})

test('cleanForm: known keys, checked choices, English digits, caps; a chip group once answered is all answered', () => {
  const form = cleanForm({
    name: '  علي   حسن ', patientId: '١٢٣abc', fields: { age: '٤٥', department: 'العظمية', diagnosis: 'x'.repeat(400), stayDays: '٦٠+', allergy: 'yes', increase: YES, death: YES, stillAdmitted: YES, hacked: 1 },
    drugs: [...Array.from({ length: 12 }, () => ({ drug: 'meropenem', injection: YES, frequency: '٣x', days: '7', start: '2026-02-31', stop: '2026-11-08' })), {}],
  })
  assert.deepEqual([form.name, form.patientId, form.fields.age, form.fields.department, form.fields.diagnosis.length, form.fields.stayDays, form.fields.allergy], ['علي حسن', '123', '45', '', 300, '60+', ''])
  assert.equal(form.fields.hacked, undefined)
  assert.deepEqual([form.fields.increase, form.fields.same, form.fields.stop], [YES, NO, NO])
  assert.deepEqual([form.fields.death, form.fields.recovery, form.fields.stillAdmitted], [YES, NO, NO]) // an outcome wins over «still admitted»
  assert.equal(form.drugs.length, 10)
  assert.deepEqual([form.drugs[0].oral, form.drugs[0].frequency, form.drugs[0].start, form.drugs[0].stop], [NO, '3', '', '2026-11-08'])
  assert.equal(isFinal(form.fields), true)
  const still = cleanForm({ name: 'x', fields: { stillAdmitted: YES } })
  assert.deepEqual([still.fields.recovery, still.fields.death, isFinal(still.fields)], [NO, NO, false])
})

test('missingAnswers: every unanswered Google question, in its order; none on a complete form', () => {
  assert.deepEqual(missingAnswers(cleanForm({})).map((item) => item.label), ['اسم المريض', 'العمر', 'الردهة', 'التشخيص', 'فترة الرقود', 'الحساسية', 'اسم المضادات', 'وجود زرع', 'مراجعة وصف المضاد بعد 48-72 ساعة', 'ما الذي تم بعد المراجعة', 'النتيجة'])
  const complete = cleanForm({
    name: 'علي', fields: { age: '45', department: 'الباطنية', diagnosis: 'CAP', stayDays: '5', allergy: NO, culture: YES, review48: YES, same: YES, stillAdmitted: YES },
    drugs: [{ drug: 'meropenem', strength: '1000 mg', injection: YES, frequency: '3', days: '5' }],
  })
  assert.deepEqual(missingAnswers(complete), [])
  assert.deepEqual(missingAnswers({ ...complete, drugs: [{ drug: 'vancomycin' }] }).map((item) => item.key), ['drug:0:route', 'drug:0:strength', 'drug:0:frequency', 'drug:0:days'])
})

test('exportRows: one row per antibiotic with the patient repeated, numbers numeric, the floor as the Google Form lists it', () => {
  const form = { formDate: '2026-11-10', floor: 5, ward: 'ردهة رجال', ...cleanForm({
    name: 'علي', patientId: '123', fields: { age: '45', department: 'الباطنية', diagnosis: 'CAP', stayDays: '60+', allergy: NO, culture: YES, review48: YES, add: YES, dischargeOn: YES },
    drugs: [{ drug: 'meropenem', strength: '1000 mg', injection: YES, frequency: '3', days: '7', start: '2026-11-04' }, { drug: 'vancomycin', strength: '500 mg', injection: YES, frequency: '2', days: '5' }],
  }) }
  const rows = exportRows([form, { formDate: '2026-11-10', floor: null, ward: 'ردهة العناية المركزة', ...cleanForm({ name: 'سعاد' }) }])
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.slice(0, 2).map((row) => [row.name, row.age, row.count, row.drug, row.frequency, row.days, row.floor, row.add, row.same, row.dischargeOn, row.death]), [
    ['علي', 45, 2, 'meropenem', 3, 7, '٥', YES, NO, YES, NO],
    ['علي', 45, 2, 'vancomycin', 2, 5, '٥', YES, NO, YES, NO],
  ])
  assert.deepEqual([rows[0].stayDays, rows[0].startDate, rows[0].ward], ['60+', '2026-11-04', 'الطابق 5 — ردهة رجال'])
  assert.deepEqual([rows[2].name, rows[2].count, rows[2].drug, rows[2].floor], ['سعاد', 0, '', 'عناية'])
  assert.equal(floorLabel(10, 'x'), '١٠')
  // The Google Form's titles first, in its order, then the app's own columns.
  assert.deepEqual(EXPORT_COLUMNS.slice(0, 3).map((column) => column.header), ['تاريخ الاستمارة', 'اسم المريض', 'العمر'])
  assert.deepEqual(EXPORT_COLUMNS.slice(-5).map((column) => column.header), ['الطابق', 'رقم الطبلة', 'تاريخ بدء المضاد', 'تاريخ إيقاف المضاد', 'ردهة التطبيق'])
  assert.equal(EXPORT_COLUMNS.length, 32)
})

// ---- The API ----
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
const where = (date) => `floor=${A.floor}&ward=${encodeURIComponent(A.ward)}&date=${date}`
const saveChart = (client, date, rows) => {
  const medicines = [...new Set(rows.flatMap((row) => Object.keys(row.meds || {})))]
  return client.put('/api/chart', {
    ...A, date, slot: 'main', expectedVersion: 0,
    patients: rows.map((row, index) => ({ rowNumber: index + 1, name: row.name, patientId: row.id || '' })),
    columns: medicines.map((medicineName, index) => ({ columnNumber: index + 1, medicineName })),
    quantities: rows.flatMap((row, rowIndex) => medicines.flatMap((medicine, index) => (row.meds?.[medicine] ? [{ rowNumber: rowIndex + 1, columnNumber: index + 1, quantity: row.meds[medicine] }] : []))),
  })
}
const body = (extra = {}) => ({ ...A, name: 'علي', patientId: '123', fields: { age: '45' }, drugs: [{ drug: 'meropenem', injection: YES }], ...extra })
const count = async () => Number((await pool.query('SELECT count(*) FROM antibiotic_forms')).rows[0].count)

test('GET lists the ward\'s patients on antibiotics with a block per drug; another floor is refused', async () => {
  await pool.query('INSERT INTO medicines (name) VALUES ($1), ($2)', [MERONEM, VANCO])
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  for (const date of ['2026-11-08', '2026-11-09']) assert.equal((await saveChart(pharmacist, date, [ali({ [MERONEM]: 3, [VANCO]: 2 })])).status, 200)
  const listed = await pharmacist.get(`/api/antibiotic-forms?${where('2026-11-09')}`)
  assert.equal(listed.status, 200)
  assert.deepEqual(listed.body.patients.map((patient) => [patient.name, patient.drugs.map((drug) => drug.drug)]), [['علي', ['meropenem', 'vancomycin']]])
  const elsewhere = await loginAs({ role: 'user', floor: 8 })
  assert.equal((await elsewhere.get(`/api/antibiotic-forms?${where('2026-11-09')}`)).status, 403)
  assert.equal((await elsewhere.post('/api/antibiotic-forms', body())).status, 403)
})

test('POST begins a form dated today whatever the device says, and a replay of the same save is the same form', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  const first = await pharmacist.post('/api/antibiotic-forms', body({ date: '2020-01-01', formDate: '2020-01-01' }))
  assert.equal(first.status, 201)
  assert.equal(first.body.form.formDate, todayInBaghdad())
  assert.ok(first.body.missing.includes('الردهة'))
  const replay = await pharmacist.post('/api/antibiotic-forms', body())
  assert.deepEqual([replay.status, replay.body.form.id, await count()], [200, first.body.form.id, 1])
})

test('POST: the رقم الطبلة typed after the first save updates the same form', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  const first = (await pharmacist.post('/api/antibiotic-forms', body({ patientId: '' }))).body.form
  const second = await pharmacist.post('/api/antibiotic-forms', body({ patientId: '123', updatedAt: first.updatedAt }))
  assert.deepEqual([second.status, second.body.form.id, second.body.form.patientId, await count()], [200, first.id, '123', 1])
})

test('POST: a save started from an older version is refused (409) with the stored form; a current one goes through', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  const first = (await pharmacist.post('/api/antibiotic-forms', body())).body.form
  const newer = (await pharmacist.post('/api/antibiotic-forms', body({ id: first.id, updatedAt: first.updatedAt, fields: { age: '46' } }))).body.form
  const stale = await pharmacist.post('/api/antibiotic-forms', body({ id: first.id, updatedAt: first.updatedAt, fields: { age: '47' } }))
  assert.equal(stale.status, 409)
  assert.equal(stale.body.form.fields.age, '46')
  // Without a version (a first save replayed from the queue) a different form is not overwritten either.
  assert.equal((await pharmacist.post('/api/antibiotic-forms', body({ fields: { age: '48' } }))).status, 409)
  assert.equal((await pharmacist.post('/api/antibiotic-forms', body({ id: first.id, updatedAt: newer.updatedAt, fields: { age: '47' } }))).body.form.fields.age, '47')
})

test('POST under the day lock: an open form is completed on a later day (its date kept); a finished one is not changed later', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  const first = (await pharmacist.post('/api/antibiotic-forms', body())).body.form
  await pool.query("UPDATE antibiotic_forms SET form_date = form_date - 3, updated_at = updated_at - interval '3 days'")
  const stamp = async () => (await pool.query('SELECT updated_at FROM antibiotic_forms')).rows[0].updated_at.toISOString()
  dayLockSettings.enabled = true
  try {
    const finished = await pharmacist.post('/api/antibiotic-forms', body({ id: first.id, updatedAt: await stamp(), fields: { age: '45', recovery: YES } }))
    assert.equal(finished.status, 200)
    assert.equal((await pool.query('SELECT (form_date = $1::date - 3) AS kept FROM antibiotic_forms', [todayInBaghdad()])).rows[0].kept, true)
    assert.equal(finished.body.form.final, true)
    assert.equal(finished.body.form.editable, true) // the day it was finished
    await pool.query("UPDATE antibiotic_forms SET updated_at = updated_at - interval '2 days'")
    const later = await pharmacist.post('/api/antibiotic-forms', body({ id: first.id, updatedAt: await stamp(), fields: { age: '50', recovery: YES } }))
    assert.deepEqual([later.status, later.body.dayLocked], [403, true])
    assert.equal((await pharmacist.delete(`/api/antibiotic-forms/${first.id}`)).status, 403)
    const listed = (await pharmacist.get(`/api/antibiotic-forms?${where(todayInBaghdad())}`)).body
    assert.equal(listed.manual[0].editable, false)
  } finally { dayLockSettings.enabled = false }
})

const FINAL = { fields: { age: '45', department: 'الباطنية', recovery: YES } }
test('POST: a finished form saved again without its id is the same form, never a second (a lost answer, a replay)', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  const first = await pharmacist.post('/api/antibiotic-forms', body(FINAL))
  const replay = await pharmacist.post('/api/antibiotic-forms', body(FINAL))
  assert.deepEqual([first.status, replay.status, replay.body.form.id, await count()], [201, 200, first.body.form.id, 1])
  // Changed and sent without a version: refused rather than a second form.
  assert.equal((await pharmacist.post('/api/antibiotic-forms', body({ fields: { ...FINAL.fields, age: '46' } }))).status, 409)
  assert.equal(await count(), 1)
  // The same replay on a later day, past the day lock: answered as the save it repeats.
  await pool.query("UPDATE antibiotic_forms SET form_date = form_date - 3, updated_at = updated_at - interval '3 days'")
  dayLockSettings.enabled = true
  try {
    const late = await pharmacist.post('/api/antibiotic-forms', body({ ...FINAL, id: first.body.form.id }))
    assert.deepEqual([late.status, await count()], [200, 1])
  } finally { dayLockSettings.enabled = false }
})

test('an open form older than 30 days is still listed and still the one saved; one begun after the asked date is listed too', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  const form = (await pharmacist.post('/api/antibiotic-forms', body())).body.form
  const yesterday = new Date(Date.parse(`${todayInBaghdad()}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
  assert.deepEqual((await pharmacist.get(`/api/antibiotic-forms?${where(yesterday)}`)).body.manual.map((item) => item.id), [form.id])
  await pool.query("UPDATE antibiotic_forms SET form_date = form_date - 40, updated_at = updated_at - interval '40 days'")
  assert.deepEqual((await pharmacist.get(`/api/antibiotic-forms?${where(todayInBaghdad())}`)).body.manual.map((item) => item.id), [form.id])
  const stamp = (await pool.query('SELECT updated_at FROM antibiotic_forms')).rows[0].updated_at.toISOString()
  const saved = await pharmacist.post('/api/antibiotic-forms', body({ updatedAt: stamp, fields: { age: '50' } }))
  assert.deepEqual([saved.status, saved.body.form.id, await count()], [200, form.id, 1])
})

test('POST: a save naming the form can clear its رقم الطبلة', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  const form = (await pharmacist.post('/api/antibiotic-forms', body())).body.form
  const cleared = await pharmacist.post('/api/antibiotic-forms', body({ id: form.id, updatedAt: form.updatedAt, patientId: '' }))
  assert.deepEqual([cleared.status, cleared.body.form.patientId], [200, ''])
})

test('DELETE: the ward\'s own form only', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  const form = (await pharmacist.post('/api/antibiotic-forms', body())).body.form
  assert.equal((await (await loginAs({ role: 'user', floor: 8 })).delete(`/api/antibiotic-forms/${form.id}`)).status, 403)
  assert.equal((await pharmacist.delete(`/api/antibiotic-forms/${form.id}`)).status, 200)
  assert.equal(await count(), 0)
})

test('export: managers only, a date range of at most 92 days, audited without names; a purge removes the forms', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  await pharmacist.post('/api/antibiotic-forms', body())
  const today = todayInBaghdad()
  assert.equal((await pharmacist.get(`/api/antibiotic-forms/export?from=${today}&to=${today}`)).status, 403)
  const admin = await loginAs({ role: 'admin' })
  assert.equal((await admin.get('/api/antibiotic-forms/export?from=2026-01-01&to=2026-06-01')).status, 400)
  const exported = await admin.get(`/api/antibiotic-forms/export?from=${today}&to=${today}`)
  assert.equal(exported.status, 200)
  assert.deepEqual(exported.body.forms.map((form) => [form.name, form.floor, form.ward, form.formDate, form.drugs.length]), [['علي', 5, 'ردهة رجال', today, 1]])
  const audit = (await pool.query("SELECT target, detail FROM audit_log WHERE action = 'antibiotic-forms.exported'")).rows
  assert.equal(audit.length, 1)
  assert.doesNotMatch(`${audit[0].target} ${audit[0].detail}`, /علي/)
  assert.equal((await admin.post('/api/charts/purge', { from: today, to: today, floors: [8] })).status, 200)
  assert.equal(await count(), 1) // another floor's purge leaves it
  assert.equal((await admin.post('/api/charts/purge', { from: today, to: today, floors: [5] })).status, 200)
  assert.equal(await count(), 0)
})
