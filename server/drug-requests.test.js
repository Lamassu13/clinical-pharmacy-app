import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'
import { cleanTicks, toggleTick, cleanField, DRUG_REQUESTS } from '../shared/drug-requests.js'
import { FORM_URL, albuminFormAnswers } from '../shared/albumin-google-form.js'
import { tigecyclineFormAnswers, FORM_URL as TIGECYCLINE_URL } from '../shared/tigecycline-google-form.js'
import { colistinFormAnswers, FORM_URL as COLISTIN_URL } from '../shared/colistin-google-form.js'
import { ivigFormAnswers } from '../shared/ivig-google-form.js'
import { formProblems, needsFollowUp, GOOGLE_KINDS } from '../shared/form-problems.js'
import { dailyMg, tigecyclineDoseNumber, colistinDoseNumber } from '../shared/dose.js'
import { liveEntries, mismatches, prefillUrl } from '../shared/google-form-check.js'

const FLOOR = 5
const WARD = 'ردهة رجال'
const where = (kind, date) => `kind=${kind}&floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${date}`

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
// One main chart with a single medicine column; `rows` are [{ name, id?, qty? }], qty > 0 = given.
const saveChart = (client, date, medicine, rows, floor = FLOOR, ward = WARD) => client.put('/api/chart', {
  floor, ward, date, slot: 'main', expectedVersion: 0,
  patients: rows.map((row, index) => ({ rowNumber: index + 1, name: row.name, patientId: row.id || '' })),
  columns: [{ columnNumber: 1, medicineName: medicine }],
  quantities: rows.flatMap((row, index) => (row.qty ? [{ rowNumber: index + 1, columnNumber: 1, quantity: row.qty }] : [])),
})
const check = async (client, kind, date, query) => (await client.get(`/api/drug-requests/check?${where(kind, date)}&${new URLSearchParams(query)}`)).body
const Z0 = { meropenem: 0, albumin: 0, tigecycline: 0, colistin: 0, ivig: 0 }
const MERONEM = 'Meronem 1000gm Vial'
const ALBUMIN = 'Human albumin 20% I.V.'

test('PUT keeps the stored fields a request does not send (an old client), and a `fields` that is not an object changes none — never a 500', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const saved = (await pharmacist.post('/api/drug-requests', { kind: 'meropenem', floor: FLOOR, ward: WARD, date: '2026-09-24', name: 'علي', patientId: '1', fields: { sex: 'ذكر', age: '40', dose: '1g × 3' } })).body.request
  const edited = await pharmacist.put(`/api/drug-requests/${saved.id}`, { name: 'علي', patientId: '1', fields: { dose: '2g × 3' } })
  assert.equal(edited.status, 200)
  assert.deepEqual([edited.body.request.fields.sex, edited.body.request.fields.age, edited.body.request.fields.dose], ['ذكر', '40', '2g × 3'])
  // A key sent empty is cleared (that is how a box is emptied).
  assert.equal((await pharmacist.put(`/api/drug-requests/${saved.id}`, { name: 'علي', patientId: '1', fields: { age: '' } })).body.request.fields.age, '')
  for (const fields of ['nope', ['x'], null]) {
    assert.equal((await pharmacist.put(`/api/drug-requests/${saved.id}`, { name: 'علي', patientId: '1', fields })).status, 200)
    assert.equal((await pharmacist.post('/api/drug-requests', { kind: 'meropenem', floor: FLOOR, ward: WARD, date: '2026-09-24', name: 'علي', patientId: '1', fields })).status, 200)
  }
})

test('shared ticks: unknown keys dropped, one culture choice, spec order kept', () => {
  assert.deepEqual(cleanTicks('meropenem', ['cap', 'nope', 'culture-after', 'mastoiditis', 'culture-none', 'cap']), ['mastoiditis', 'cap', 'culture-none'])
  assert.deepEqual(cleanTicks('meropenem', 'cap'), [])
  assert.deepEqual(toggleTick('meropenem', ['culture-after'], 'culture-before'), ['culture-before'])
  assert.deepEqual(toggleTick('meropenem', ['cap', 'culture-after'], 'cap'), ['culture-after'])
  assert.deepEqual(cleanTicks('albumin', ['i17', 'i2', 'cap']), ['i2', 'i17'])
})

test('meropenem check: day 1 for a new course, day 2 after yesterday’s dose (by ID or name), transfers keep counting', async () => {
  const admin = await loginAs({ role: 'admin' })
  await admin.post('/api/medicines', { name: MERONEM })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  assert.deepEqual(await check(pharmacist, 'meropenem', '2026-09-24', { name: 'علي', id: '123' }), { day: 1, requested: false })
  assert.equal((await saveChart(pharmacist, '2026-09-24', MERONEM, [{ name: 'علي', id: '123', qty: 3 }, { name: 'حسن' }])).status, 200)
  assert.deepEqual(await check(pharmacist, 'meropenem', '2026-09-25', { name: 'علي', id: '123' }), { day: 2, requested: false })
  assert.deepEqual(await check(pharmacist, 'meropenem', '2026-09-25', { name: '  علي ' }), { day: 2, requested: false })
  assert.deepEqual(await check(pharmacist, 'meropenem', '2026-09-25', { name: 'حسن' }), { day: 1, requested: false })

  // Transferred in by ID from another ward: still day 2 here.
  assert.equal((await saveChart(admin, '2026-09-24', MERONEM, [{ name: 'زيد', id: '900', qty: 3 }], 8, 'الردهة الخامسة')).status, 200)
  assert.deepEqual(await check(pharmacist, 'meropenem', '2026-09-25', { name: 'زيد', id: '900' }), { day: 2, requested: false })

  const sent = await pharmacist.post('/api/drug-requests', { kind: 'meropenem', floor: FLOOR, ward: WARD, date: '2026-09-24', name: 'علي', patientId: '123', fields: { age: '54', dose: '1g × 3' } })
  assert.equal(sent.status, 201)
  assert.deepEqual(await check(pharmacist, 'meropenem', '2026-09-24', { name: 'علي', id: '123' }), { day: 1, requested: true })
  // The other kind is its own form.
  assert.deepEqual(await check(pharmacist, 'albumin', '2026-09-24', { name: 'علي', id: '123' }), { day: 1, requested: false })

  assert.equal((await pharmacist.get(`/api/drug-requests/check?${where('meropenem', '2026-09-24')}`)).status, 400)
  assert.equal((await pharmacist.get(`/api/drug-requests/check?${where('aspirin', '2026-09-24')}&name=x`)).status, 400)
})

test('albumin: the treatment day counts up day by day; fields cleaned per kind; the count is spelled out', async () => {
  const admin = await loginAs({ role: 'admin' })
  await admin.post('/api/medicines', { name: ALBUMIN })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  await saveChart(pharmacist, '2026-09-24', ALBUMIN, [{ name: 'سارة', id: '44', qty: 2 }])
  await saveChart(pharmacist, '2026-09-25', ALBUMIN, [{ name: 'سارة', id: '44', qty: 2 }])
  assert.deepEqual(await check(pharmacist, 'albumin', '2026-09-26', { name: 'سارة', id: '44' }), { day: 3, requested: false })

  const sent = await pharmacist.post('/api/drug-requests', {
    kind: 'albumin', floor: FLOOR, ward: WARD, date: '2026-09-26', name: 'سارة', patientId: '44',
    fields: { treatmentDay: '٣', count: '4 vials', serumAlbumin: '1,8x', weight: '70.5', scr: '1.1', doctor: ' د. سعد كاظم ', diagnosis: 'Liver cirrhosis', sex: 'ذكر', age: '54,5', bogus: '1' },
  })
  assert.equal(sent.status, 201)
  assert.deepEqual(sent.body.request.fields, { sex: 'ذكر', age: '54.5', treatmentDay: '3', count: '4', serumAlbumin: '1.8', weight: '70.5', scr: '1.1', doctor: 'د. سعد كاظم', hideDoctor: '', diagnosis: 'Liver cirrhosis', indicated: '', reason: '' })
  assert.equal(sent.body.request.words, 'أربعة')
  assert.deepEqual(sent.body.request.ticks, [])
  assert.deepEqual(await check(pharmacist, 'albumin', '2026-09-26', { name: 'سارة', id: '44' }), { day: 3, requested: true })

  // The next day's popup starts from the patient's details of their last form — the sex, age, weight and doctor, not the day's own values.
  const next = { carried: { sex: 'ذكر', age: '54.5', weight: '70.5', doctor: 'د. سعد كاظم' } }
  assert.deepEqual(await check(pharmacist, 'albumin', '2026-09-27', { name: 'سارة', id: '44' }), { day: 4, requested: false, ...next }) // (the day's form is still to be made: day 4 of the course)
  assert.deepEqual(await check(pharmacist, 'albumin', '2026-09-27', { name: 'سارة' }), { day: 4, requested: false, ...next }) // by name on the same ward
  assert.equal((await check(pharmacist, 'albumin', '2026-09-27', { name: 'سارة', id: '99' })).carried, undefined) // two different IDs are two patients, even under one name
  assert.equal((await check(pharmacist, 'albumin', '2026-10-11', { name: 'سارة', id: '44' })).carried, undefined) // 15 days later: a new course
  assert.equal((await check(pharmacist, 'albumin', '2026-09-26', { name: 'سارة', id: '44' })).carried, undefined) // not once today's form exists
  assert.equal((await check(pharmacist, 'meropenem', '2026-09-27', { name: 'سارة', id: '44' })).carried, undefined) // a first-day kind carries nothing
})

test('requests: list per kind, resend updates in place and keeps ticks, edit, tick, delete; other floors refused', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const form = { kind: 'meropenem', floor: FLOOR, ward: WARD, date: '2026-09-24', name: ' علي  حسين ', patientId: '12a3', fields: { age: '54', weight: '80', allergy: 'Penicillin', scr: '1.2', dose: '1g × 3', duration: '7 أيام', doctor: 'د. سعد كاظم' } }
  assert.equal((await pharmacist.post('/api/drug-requests', { ...form, name: '  ' })).status, 400)
  assert.equal((await pharmacist.post('/api/drug-requests', { ...form, kind: 'x' })).status, 400)
  const created = await pharmacist.post('/api/drug-requests', form)
  assert.equal(created.status, 201)
  const { id } = created.body.request
  assert.equal(created.body.request.name, 'علي حسين')
  assert.equal(created.body.request.patientId, '123')
  assert.match(created.body.request.createdByName, /Test User/)
  assert.equal(created.body.request.fields.doctor, 'د. سعد كاظم')

  const ticked = await pharmacist.patch(`/api/drug-requests/${id}/ticks`, { ticks: ['others', 'culture-after', 'culture-before', 'i3'], note: 'Brain abscess' })
  assert.equal(ticked.status, 200)
  assert.deepEqual(ticked.body.request.ticks, ['others', 'culture-before'])
  assert.equal(ticked.body.request.note, 'Brain abscess')

  // The same patient sent again (an offline save replayed): one form, new fields, ticks kept.
  const again = await pharmacist.post('/api/drug-requests', { ...form, fields: { ...form.fields, weight: '82' } })
  assert.equal(again.status, 200)
  assert.equal(again.body.request.id, id)
  assert.equal(again.body.request.fields.weight, '82')
  assert.deepEqual(again.body.request.ticks, ['others', 'culture-before'])

  await pharmacist.post('/api/drug-requests', { ...form, kind: 'albumin', fields: { count: '2' } })
  const list = async (kind) => (await pharmacist.get(`/api/drug-requests?${where(kind, '2026-09-24')}`)).body.requests
  assert.deepEqual((await list('meropenem')).map((r) => [r.name, r.fields.weight, r.note]), [['علي حسين', '82', 'Brain abscess']])
  assert.deepEqual((await list('albumin')).map((r) => [r.name, r.fields.count, r.words]), [['علي حسين', '2', 'اثنان']])
  assert.deepEqual((await pharmacist.get(`/api/drug-requests?${where('meropenem', '2026-09-25')}`)).body.requests, [])

  // Corrected on the form, as its screen does: one value changes, the others stay.
  const edited = await pharmacist.put(`/api/drug-requests/${id}`, { name: 'علي حسين', patientId: '123', fields: { ...form.fields, duration: '10 أيام', doctor: 'د. سعد كاظم الجبوري' } })
  assert.equal(edited.status, 200)
  assert.equal(edited.body.request.fields.duration, '10 أيام')
  assert.equal(edited.body.request.fields.doctor, 'د. سعد كاظم الجبوري')
  assert.equal(edited.body.request.fields.dose, '1g × 3')
  assert.deepEqual(edited.body.request.ticks, ['others', 'culture-before'])
  // Renaming onto another form of the same kind and day is a clash, not a silent merge.
  const other = await pharmacist.post('/api/drug-requests', { ...form, name: 'حسن', patientId: '' })
  assert.equal((await pharmacist.put(`/api/drug-requests/${other.body.request.id}`, { name: 'علي حسين', patientId: '123', fields: {} })).status, 409)

  const outsider = await loginAs({ role: 'user', floor: 6 })
  assert.equal((await outsider.get(`/api/drug-requests?${where('meropenem', '2026-09-24')}`)).status, 403)
  assert.equal((await outsider.post('/api/drug-requests', form)).status, 403)
  assert.equal((await outsider.put(`/api/drug-requests/${id}`, { name: 'x' })).status, 403)
  assert.equal((await outsider.patch(`/api/drug-requests/${id}/ticks`, { ticks: [] })).status, 403)
  assert.equal((await outsider.delete(`/api/drug-requests/${id}`)).status, 403)

  assert.equal((await pharmacist.delete(`/api/drug-requests/${id}`)).status, 200)
  assert.equal((await pharmacist.delete(`/api/drug-requests/${id}`)).status, 404)
  assert.equal((await pharmacist.patch(`/api/drug-requests/${id}/ticks`, { ticks: [] })).status, 404)
  assert.deepEqual((await list('meropenem')).map((r) => r.name), ['حسن'])
})

test('counts: forms per kind for the ward and day; zeros when none; another floor refused', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const counts = async (date, client = pharmacist, floor = FLOOR, ward = WARD) => client.get(`/api/drug-requests/counts?floor=${floor}&ward=${encodeURIComponent(ward)}&date=${date}`)
  assert.deepEqual((await counts('2026-09-24')).body, { ...Z0, attention: Z0 })
  const form = { floor: FLOOR, ward: WARD, date: '2026-09-24', fields: {} }
  for (const [kind, name] of [['meropenem', 'علي'], ['albumin', 'علي'], ['albumin', 'حسن']]) assert.equal((await pharmacist.post('/api/drug-requests', { ...form, kind, name })).status, 201)
  assert.deepEqual((await counts('2026-09-24')).body, { meropenem: 1, albumin: 2, tigecycline: 0, colistin: 0, ivig: 0, attention: { meropenem: 1, albumin: 2, tigecycline: 0, colistin: 0, ivig: 0 } })
  assert.deepEqual((await counts('2026-09-25')).body, { ...Z0, attention: Z0 })
  assert.equal((await counts('2026-09-24', pharmacist, 8, 'الردهة الخامسة')).status, 403)
  assert.equal((await counts('not-a-date')).status, 400)
})

test('requests: purging the ward’s charts for the dates removes its forms too', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const place = { floor: FLOOR, ward: WARD }
  await pharmacist.post('/api/drug-requests', { ...place, kind: 'meropenem', date: '2026-09-24', name: 'علي' })
  await pharmacist.post('/api/drug-requests', { ...place, kind: 'albumin', date: '2026-09-24', name: 'سارة' })
  await pharmacist.post('/api/drug-requests', { ...place, kind: 'meropenem', date: '2026-09-28', name: 'حسن' })
  const manager = await loginAs({ role: 'admin' })
  assert.equal((await manager.post('/api/charts/purge', { from: '2026-09-20', to: '2026-09-25', floors: [FLOOR] })).status, 200)
  assert.deepEqual((await pharmacist.get(`/api/drug-requests?${where('meropenem', '2026-09-24')}`)).body.requests, [])
  assert.deepEqual((await pharmacist.get(`/api/drug-requests?${where('albumin', '2026-09-24')}`)).body.requests, [])
  assert.equal((await pharmacist.get(`/api/drug-requests?${where('meropenem', '2026-09-28')}`)).body.requests.length, 1)
})

test('list: a form saved before the رقم الطبلة was typed shows the one that day’s chart has; a stored one wins', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const place = { kind: 'albumin', floor: FLOOR, ward: WARD, date: '2026-09-24' }
  await pharmacist.post('/api/drug-requests', { ...place, name: 'اخلاص  علي' })
  await pharmacist.post('/api/drug-requests', { ...place, name: 'سارة', patientId: '55' })
  await pharmacist.post('/api/drug-requests', { ...place, name: 'زينب' })
  // The ID typed on the chart afterwards (name spaced differently); سارة's chart ID differs from her
  // stored one; زينب has an ID only on another day's chart.
  await saveChart(pharmacist, '2026-09-24', ALBUMIN, [{ name: ' اخلاص علي', id: '901' }, { name: 'سارة', id: '77' }])
  await saveChart(pharmacist, '2026-09-23', ALBUMIN, [{ name: 'زينب', id: '300' }])
  const list = (await pharmacist.get(`/api/drug-requests?${where('albumin', '2026-09-24')}`)).body.requests
  assert.deepEqual(list.map((r) => [r.name, r.patientId]), [['اخلاص علي', '901'], ['سارة', '55'], ['زينب', '']])
})

test('google form: the answers an albumin form makes, the page the diagnosis leads to, what is missing', () => {
  const form = { name: 'علي حسين', patientId: '123', date: '2026-11-06', fields: { doctor: 'د. سعد', sex: 'أنثى', age: '0.08', count: '3' }, ticks: ['i2', 'i17'] }
  const sent = albuminFormAnswers(form)
  const answer = (name) => sent.body.find(([key]) => key === name)?.[1]
  // i2 comes first in the spec's order: Part I (the user's choice), whose page is 6.
  assert.equal(answer('entry.181711708'), 'Part I')
  assert.match(answer('entry.405609873'), /^large volume paracentesis/)
  assert.equal(answer('pageHistory'), '0,1,6')
  assert.equal(answer('entry.589084363'), 'الفصل الرابع')
  assert.equal(answer('entry.1792534844'), 'الشهر الحادي عشر: تشرين الثاني')
  assert.equal(answer('entry.1143953533'), 'انثى')
  assert.equal(answer('entry.1161018343'), '3')
  assert.equal(answer('entry.1124900641'), '0')
  assert.equal(albuminFormAnswers({ ...form, ticks: ['i11'] }).body.find(([key]) => key === 'pageHistory')[1], '0,1,5')
  assert.deepEqual(albuminFormAnswers({ ...form, fields: { count: '0' }, ticks: [] }).missing, ['اسم الطبيب الاختصاص', 'الجنس', 'العمر', 'العدد المطلوب', 'الاستطباب (علّم مربعًا)'])
  // Every app indication maps to an option the form really has.
  for (const key of ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9', 'i10', 'i11', 'i12', 'i13', 'i14', 'i15', 'i16', 'i17']) {
    const result = albuminFormAnswers({ ...form, ticks: [key] })
    assert.ok(result.ok && result.body.every(([, value]) => value && value !== 'undefined'), key)
  }
})

test('google form: the route sends nothing unless GOOGLE_FORM_SEND=1, names what is missing, refuses another floor', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const base = { kind: 'albumin', floor: FLOOR, ward: WARD, date: '2026-11-06', name: 'سارة', patientId: '44' }
  const saved = (await pharmacist.post('/api/drug-requests', { ...base, fields: { count: '2' } })).body.request
  const missing = await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})
  assert.equal(missing.status, 422)
  assert.match(missing.body.message, /الجنس.*العمر/)
  await pharmacist.put(`/api/drug-requests/${saved.id}`, { name: 'سارة', patientId: '44', fields: { count: '2', doctor: 'د. سعد', sex: 'أنثى', age: '30' } })
  await pharmacist.patch(`/api/drug-requests/${saved.id}/ticks`, { ticks: ['i4'] })
  const dry = await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})
  assert.equal(dry.status, 200)
  assert.equal(dry.body.dryRun, true)
  assert.equal(dry.body.answers.find(([key]) => key === 'pageHistory')[1], '0,1,5')
  assert.equal((await pharmacist.get(`/api/drug-requests?${where('albumin', '2026-11-06')}`)).body.requests[0].googleSentAt, null)
  assert.equal((await (await loginAs({ role: 'user', floor: 6 })).post(`/api/drug-requests/${saved.id}/google-form`, {})).status, 403)
  const meropenem = (await pharmacist.post('/api/drug-requests', { ...base, kind: 'meropenem', fields: { sex: 'ذكر', age: '5' } })).body.request
  assert.equal((await pharmacist.post(`/api/drug-requests/${meropenem.id}/google-form`, {})).status, 400)
})

// A fake Google: only calls to the form's URL are answered here; the test client's own calls go through.
const fakeGoogle = (answer) => {
  const real = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    if (String(url) !== FORM_URL) return real(url, options)
    calls.push(options.body.toString())
    return answer(calls.length)
  }
  return { calls, restore: () => { globalThis.fetch = real } }
}
const recorded = { ok: true, status: 200, redirected: false, url: FORM_URL }
const readyAlbumin = async (pharmacist, patientId = '44') => {
  const saved = (await pharmacist.post('/api/drug-requests', { kind: 'albumin', floor: FLOOR, ward: WARD, date: '2026-11-06', name: 'سارة', patientId, fields: { count: '2', doctor: 'د. سعد', sex: 'أنثى', age: '30' } })).body.request
  await pharmacist.patch(`/api/drug-requests/${saved.id}/ticks`, { ticks: ['i4'] })
  return saved
}

test('google form send: marked sent once, a second send needs resend, a refused or unconfirmed send is handled', async (t) => {
  process.env.GOOGLE_FORM_SEND = '1'
  t.after(() => { delete process.env.GOOGLE_FORM_SEND })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const sentAt = async (id) => (await pharmacist.get(`/api/drug-requests?${where('albumin', '2026-11-06')}`)).body.requests.find((r) => r.id === id).googleSentAt
  const send = (id, body = {}) => pharmacist.post(`/api/drug-requests/${id}/google-form`, body)

  // Accepted: marked sent; a second tap is refused without posting; resend posts again.
  let google = fakeGoogle(() => recorded)
  const form = await readyAlbumin(pharmacist)
  assert.equal((await send(form.id)).status, 200)
  assert.ok(await sentAt(form.id))
  const again = await send(form.id)
  assert.equal(again.status, 409)
  assert.ok(again.body.sentAt)
  assert.equal(google.calls.length, 1)
  assert.equal((await send(form.id, { resend: true })).status, 200)
  assert.equal(google.calls.length, 2)
  google.restore()

  // Two at once: only one reaches Google.
  const second = await readyAlbumin(pharmacist, '45')
  google = fakeGoogle(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); return recorded })
  const both = await Promise.all([send(second.id), send(second.id)])
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409])
  assert.equal(google.calls.length, 1)
  google.restore()

  // Refused (400) and a redirect (a sign-in page): not sent, the mark is undone so it can be retried.
  for (const bad of [{ ok: false, status: 400, redirected: false, url: FORM_URL }, { ok: true, status: 200, redirected: true, url: 'https://accounts.google.com/signin' }]) {
    const third = await readyAlbumin(pharmacist, `9${google.calls.length}`)
    google = fakeGoogle(() => bad)
    assert.equal((await send(third.id)).status, 502)
    assert.equal(await sentAt(third.id), null)
    google.restore()
  }

  // Not reached at all: undone. Timed out: the mark stays (Google may have it), with a message not to resend blindly.
  const fourth = await readyAlbumin(pharmacist, '71')
  google = fakeGoogle(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) })
  assert.equal((await send(fourth.id)).status, 502)
  assert.equal(await sentAt(fourth.id), null)
  google.restore()
  // A timeout, or a connection dropped after the request left (no code from before it): Google may have it — the mark stays,
  // and the reply is the form itself, marked sent but unconfirmed (shown as «لم يتأكد الإرسال», counted as needing follow-up).
  for (const [index, failure] of [Object.assign(new Error('timeout'), { name: 'TimeoutError' }), Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })].entries()) {
    const unsure = await readyAlbumin(pharmacist, `8${index}`)
    google = fakeGoogle(() => { throw failure })
    const timedOut = await send(unsure.id)
    assert.equal(timedOut.status, 504)
    assert.ok(await sentAt(unsure.id))
    assert.ok(timedOut.body.request.googleSentAt)
    assert.match(timedOut.body.request.googleError, /لم يتأكد/)
    google.restore()
  }
})

test('google form send: the رقم الطبلة the screen shows is the one sent; an old client does not blank a stored age', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  await (await loginAs({ role: 'admin' })).post('/api/medicines', { name: ALBUMIN })
  await saveChart(pharmacist, '2026-11-06', ALBUMIN, [{ name: 'سارة', id: '77', qty: 2 }])
  const saved = (await pharmacist.post('/api/drug-requests', { kind: 'albumin', floor: FLOOR, ward: WARD, date: '2026-11-06', name: 'سارة', patientId: '', fields: { count: '2', doctor: 'د. سعد', sex: 'أنثى', age: '30' } })).body.request
  await pharmacist.patch(`/api/drug-requests/${saved.id}/ticks`, { ticks: ['i4'] })
  const dry = await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})
  assert.equal(dry.status, 200)
  assert.equal(dry.body.answers.find(([key]) => key === 'entry.1062167645')[1], '77')
  // A resend of the same patient from a client that knows no `age`: the stored one stays.
  await pharmacist.post('/api/drug-requests', { kind: 'albumin', floor: FLOOR, ward: WARD, date: '2026-11-06', name: 'سارة', patientId: '', fields: { count: '3' } })
  const listed = (await pharmacist.get(`/api/drug-requests?${where('albumin', '2026-11-06')}`)).body.requests[0]
  assert.deepEqual([listed.fields.count, listed.fields.age, listed.fields.sex], ['3', '30', 'أنثى'])
})

test('the doctor’s name can be left off the printed form: the setting is kept, a resend does not undo it, the name itself stays stored', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const base = { floor: FLOOR, ward: WARD, date: '2026-09-26', name: 'سارة', patientId: '44' }
  for (const kind of ['albumin', 'meropenem']) {
    const saved = (await pharmacist.post('/api/drug-requests', { ...base, kind, fields: { doctor: 'د. سعد', sex: 'ذكر', age: '5' } })).body.request
    assert.equal(saved.fields.hideDoctor, '')
    const hidden = (await pharmacist.put(`/api/drug-requests/${saved.id}`, { name: 'سارة', patientId: '44', fields: { ...saved.fields, hideDoctor: '1' } })).body.request
    assert.deepEqual([hidden.fields.hideDoctor, hidden.fields.doctor], ['1', 'د. سعد'])
    // The patient entry popup resends without the setting: it is kept.
    const resent = (await pharmacist.post('/api/drug-requests', { ...base, kind, fields: { doctor: 'د. سعد' } })).body.request
    assert.equal(resent.fields.hideDoctor, '1')
  }
})

test('tigecycline: a third kind — asked on the first day only, dose prefilled twice a day, counted, saved and cleaned like the others', async () => {
  const admin = await loginAs({ role: 'admin' })
  await admin.post('/api/medicines', { name: 'Tygacil 50mg Vial' })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  assert.deepEqual(await check(pharmacist, 'tigecycline', '2026-09-24', { name: 'سارة', id: '44' }), { day: 1, requested: false })
  await saveChart(pharmacist, '2026-09-24', 'Tygacil 50mg Vial', [{ name: 'سارة', id: '44', qty: 2 }])
  assert.deepEqual(await check(pharmacist, 'tigecycline', '2026-09-25', { name: 'سارة', id: '44' }), { day: 2, requested: false })

  const sent = await pharmacist.post('/api/drug-requests', {
    kind: 'tigecycline', floor: FLOOR, ward: WARD, date: '2026-09-24', name: 'سارة', patientId: '44',
    fields: { sex: 'أنثى', age: '40', diagnosis: 'Diabetic foot', weight: '70,5', scr: '1.1', dose: '50mg × 2', duration: '7 أيام', culture: 'Resistant', committee: 'ص. ليث', doctor: 'د. سعد', bogus: 'x' },
  })
  assert.equal(sent.status, 201)
  assert.deepEqual(sent.body.request.fields, { sex: 'أنثى', age: '40', diagnosis: 'Diabetic foot', weight: '70.5', scr: '1.1', dose: '100', duration: '7 أيام', culture: 'Resistant', committee: 'ص. ليث', doctor: 'د. سعد', hideDoctor: '' })
  // One of the two permitted cases is chosen (a second tick replaces the first); an unknown key is dropped.
  const ticked = await pharmacist.patch(`/api/drug-requests/${sent.body.request.id}/ticks`, { ticks: ['skin', 'abdominal', 'nope'] })
  assert.deepEqual(ticked.body.request.ticks, ['abdominal'])
  assert.deepEqual(await check(pharmacist, 'tigecycline', '2026-09-24', { name: 'سارة', id: '44' }), { day: 1, requested: true })
  const counts = (await pharmacist.get(`/api/drug-requests/counts?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-09-24`)).body
  assert.deepEqual(counts, { ...Z0, tigecycline: 1, attention: { ...Z0, tigecycline: 1 } }) // sent by nobody yet, no case chosen
  assert.equal((await pharmacist.get(`/api/drug-requests?${where('tigecycline', '2026-09-24')}`)).body.requests.length, 1)
})

test('tigecycline google form: the answers (email, other options, month/day date), the daily mg read from the dose, what is missing', () => {
  const form = { name: 'رشيدة', patientId: '413495', date: '2026-11-09', ticks: ['abdominal'], fields: { sex: 'أنثى', age: '45', weight: '70', scr: '1.2', dose: '50mg × 2', duration: '7 أيام', culture: 'Sensitive', committee: 'ص. ليث', doctor: 'د. سعد' } }
  const sent = tigecyclineFormAnswers(form, { ward: 'الطابق 3 — ردهة', email: 'unit@example.org' })
  const answer = (name) => sent.body.find(([key]) => key === name)?.[1]
  assert.equal(answer('emailAddress'), 'unit@example.org')
  assert.equal(answer('entry.610635236'), 'انثى')
  assert.equal(answer('entry.279852210'), 'complicated intra abdominal infection ( when other antibiotics are not sutible)')
  assert.deepEqual([answer('entry.1833893625_month'), answer('entry.1833893625_day')], ['11', '9'])
  assert.deepEqual([answer('entry.1824282702'), answer('entry.966710107'), answer('entry.1572352685'), answer('entry.1218916115')], ['100', '100', '0', 'لا'])
  assert.deepEqual([answer('entry.1570470798'), answer('entry.1570470798.other_option_response')], ['__other_option__', '7'])
  assert.equal(answer('entry.1619293670'), 'sensetive')
  assert.equal(answer('pageHistory'), '0,1')
  // No number of days: «not set by the doctor», no other-option answer.
  const open = tigecyclineFormAnswers({ ...form, fields: { ...form.fields, duration: '' } }, { ward: 'x', email: 'a@b.c' }).body
  assert.equal(open.find(([key]) => key === 'entry.1570470798')[1], 'غير محدد من قبل الطبيب')
  assert.equal(open.some(([key]) => key.endsWith('other_option_response')), false)
  assert.deepEqual(tigecyclineFormAnswers({ ...form, fields: { sex: 'ذكر', age: '5' }, ticks: [] }, { ward: 'x', email: '' }).missing,
    ['بريد النموذج (GOOGLE_FORM_EMAIL على الخادم)', 'اسم عضو لجنة المضادات', 'اسم الطبيب الاختصاص', 'الحالة المصرح بها (علّم مربعًا)', 'الوزن', 'الجرعة المطلوبة يوميًا (رقم بالمليغرام، مثل 100)', 'S.Cr.', 'نتيجة الزرع البكتيري'])
  assert.deepEqual(['50mg × 2', '50mg × 2 + 50mg × 1', '100', '1g × 3', 'two vials', ''].map(dailyMg), [100, 150, 100, 3000, null, null])
})

test('tigecycline google form: the route returns the dry-run answers with a placeholder email, and sends nothing', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const saved = (await pharmacist.post('/api/drug-requests', { kind: 'tigecycline', floor: FLOOR, ward: WARD, date: '2026-11-09', name: 'سارة', patientId: '44', fields: { sex: 'أنثى', age: '40', weight: '70', scr: '1.1', dose: '50mg × 2', culture: 'Not done', committee: 'ص. ليث', doctor: 'د. سعد' } })).body.request
  assert.equal((await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})).status, 422) // no case ticked yet
  await pharmacist.patch(`/api/drug-requests/${saved.id}/ticks`, { ticks: ['skin'] })
  const dry = await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})
  assert.equal(dry.status, 200)
  assert.equal(dry.body.dryRun, true)
  assert.equal(dry.body.answers.find(([key]) => key === 'entry.1720649116')[1], `الطابق ${FLOOR} — ${WARD}`)
  assert.equal(dry.body.answers.find(([key]) => key === 'emailAddress')[1], 'dry-run@example.invalid')
  assert.equal((await pharmacist.get(`/api/drug-requests?${where('tigecycline', '2026-11-09')}`)).body.requests[0].googleSentAt, null)
})

const goodTigecycline = { name: 'رشيدة', patientId: '413495', date: '2026-11-09', ticks: ['skin'], fields: { sex: 'أنثى', age: '45', weight: '70', scr: '1.2', dose: '50mg × 2', duration: '7 أيام', culture: 'Sensitive', committee: 'ص. ليث', doctor: 'د. سعد' } }
const unit = { ward: 'x', email: 'unit@example.org' }

test('google forms: a value the form would refuse is named before the send (tigecycline age whole digits, numbers only; albumin age ≤ 3 decimals)', () => {
  const invalid = (fields, request = goodTigecycline) => tigecyclineFormAnswers({ ...request, fields: { ...request.fields, ...fields } }, unit).invalid
  assert.equal(tigecyclineFormAnswers(goodTigecycline, unit).ok, true)
  assert.match(invalid({ age: '0.08' })[0], /^العمر/)
  assert.match(invalid({ age: '45 سنة' })[0], /^العمر/)
  assert.match(invalid({ scr: '1.2 mg/dL' })[0], /^S\.Cr\./)
  assert.match(invalid({ weight: '٧٠ كغم' })[0], /^الوزن/)
  assert.match(invalid({}, { ...goodTigecycline, patientId: 'A12' })[0], /^رقم الطبلة/)
  const album = { name: 'سارة', patientId: '44', date: '2026-11-09', ticks: ['i4'], fields: { doctor: 'د. سعد', sex: 'أنثى', age: '30.12345', count: '2' } }
  assert.match(albuminFormAnswers(album).invalid[0], /^العمر/)
  assert.equal(albuminFormAnswers({ ...album, fields: { ...album.fields, age: '0.083' } }).ok, true)
})

test('google forms: the live form is compared with what is sent — a gone question or option is named; the pre-filled link carries the answers', () => {
  const answers = tigecyclineFormAnswers(goodTigecycline, unit).body
  const live = (entries) => `<script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, [null, entries.map(([id, options]) => [id, 't', null, options ? 2 : 0, [[id, options ? options.map((text) => [text]) : null, 1]]])]])};</script>`
  const ids = [...new Set(answers.map(([name]) => /^entry\.(\d+)$/.exec(name)?.[1]).filter(Boolean))]
  const diagnosis = 'complicated skin and soft tissue infections ( when other antibiotics are not sutible)'
  const same = ids.map((id) => [Number(id), id === '279852210' ? [diagnosis, 'other'] : null])
  assert.deepEqual(mismatches(answers, liveEntries(live(same))), [])
  assert.deepEqual(mismatches(answers, liveEntries(live(same.filter(([id]) => id !== 1572102836)))), ['سؤال غير موجود (1572102836)'])
  assert.match(mismatches(answers, liveEntries(live(same.map(([id, options]) => [id, options ? ['Complicated skin changed'] : null]))))[0], /^خيار غير موجود/)
  assert.deepEqual(mismatches(answers, liveEntries('<html>no data</html>')), ['تعذّرت قراءة النموذج'])
  const link = new URL(prefillUrl(TIGECYCLINE_URL, answers))
  assert.equal(link.pathname.endsWith('/viewform'), true)
  assert.equal(link.searchParams.get('usp'), 'pp_url')
  assert.equal(link.searchParams.get('entry.813402020'), '45')
  assert.equal(link.searchParams.get('emailAddress'), 'unit@example.org')
  assert.equal(link.searchParams.has('pageHistory'), false)
})

test('google forms: a refused send is released, says whether the form changed, and offers the pre-filled form', async (t) => {
  process.env.GOOGLE_FORM_SEND = '1'
  process.env.GOOGLE_FORM_EMAIL = 'unit@example.org'
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real; delete process.env.GOOGLE_FORM_SEND; delete process.env.GOOGLE_FORM_EMAIL })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const saved = (await pharmacist.post('/api/drug-requests', { kind: 'tigecycline', floor: FLOOR, ward: WARD, date: '2026-11-09', name: 'سارة', patientId: '44', fields: { sex: 'أنثى', age: '40', weight: '70', scr: '1.1', dose: '50mg × 2', culture: 'Not done', committee: 'ص. ليث', doctor: 'د. سعد' } })).body.request
  await pharmacist.patch(`/api/drug-requests/${saved.id}/ticks`, { ticks: ['skin'] })
  // A page with no sign-in setting: the form has stopped asking fillers to sign in (the app expects it to), so the post is tried.
  const live = (ids) => `<script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, [null, ids.map((id) => [id, 't', null, 0, [[id, null, 1]]])]])};</script>`
  const allIds = [1306251493, 1406660343, 1155462451, 1572102836, 1720649116, 610635236, 813402020, 772043536, 279852210, 1833893625, 1336399327, 1824282702, 966710107, 1572352685, 1218916115, 1570470798, 534253892, 1619293670]
  const fakeGoogle = (ids) => { globalThis.fetch = async (url, options) => String(url).includes('docs.google.com')
    ? (String(url).endsWith('formResponse') ? { ok: false, status: 400, redirected: false, url: String(url) } : { ok: true, text: async () => live(ids) })
    : real(url, options) }
  const sentAt = async () => (await pharmacist.get(`/api/drug-requests?${where('tigecycline', '2026-11-09')}`)).body.requests[0].googleSentAt

  fakeGoogle(allIds) // the same questions, but the form no longer asks for a sign-in: posted, and refused
  let refused = await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})
  assert.equal(refused.status, 502)
  // (The form no longer asking for a sign-in is the health check's to report; what refused THIS send is not known to be that.)
  assert.match(refused.body.message, /رفض نموذج Google إحدى القيم/)
  assert.match(refused.body.manualUrl, /viewform\?usp=pp_url.*entry\.813402020=40/)
  assert.equal(await sentAt(), null) // released: it can be sent again

  fakeGoogle(allIds.filter((id) => id !== 1572102836)) // the form lost a question
  refused = await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})
  assert.match(refused.body.message, /تغيّر نموذج Google/)
  assert.ok(refused.body.manualUrl)
  assert.equal(await sentAt(), null)
})

test('tigecycline google form: a form that asks every filler to sign in is not posted to — the pre-filled form is offered, and a hand-sent form can be marked sent', async (t) => {
  process.env.GOOGLE_FORM_SEND = '1'
  process.env.GOOGLE_FORM_EMAIL = 'unit@example.org'
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real; delete process.env.GOOGLE_FORM_SEND; delete process.env.GOOGLE_FORM_EMAIL })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const saved = (await pharmacist.post('/api/drug-requests', { kind: 'tigecycline', floor: FLOOR, ward: WARD, date: '2026-11-09', name: 'سارة', patientId: '44', fields: { sex: 'أنثى', age: '40', weight: '70', scr: '1.1', dose: '50mg × 2', culture: 'Not done', committee: 'ص. ليث', doctor: 'د. سعد' } })).body.request
  await pharmacist.patch(`/api/drug-requests/${saved.id}/ticks`, { ticks: ['skin'] })
  // The form's email setting is 2 (verified): the page has [1][10] = [.., 2] at index 6.
  const html = `<script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, [null, [[1, 't', null, 0, [[1572102836, null, 1]]]], null, null, null, null, null, null, null, null, [null, null, null, 2, null, null, 2]]])};</script>`
  const posted = []
  globalThis.fetch = async (url, options) => {
    if (!String(url).includes('docs.google.com')) return real(url, options)
    if (String(url).endsWith('formResponse')) { posted.push(url); return { ok: true, status: 200, redirected: false, url: String(url) } }
    return { ok: true, text: async () => html }
  }
  const result = await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})
  assert.equal(result.status, 200)
  assert.equal(result.body.signIn, true)
  assert.deepEqual(posted, []) // nothing was posted
  const link = new URL(result.body.manualUrl)
  assert.equal(link.searchParams.get('entry.1833893625'), '2026-11-09') // the date as Google's own link writes it
  assert.equal(link.searchParams.has('entry.1833893625_month'), false)
  assert.equal(link.searchParams.get('entry.813402020'), '40')
  const sentAt = async () => (await pharmacist.get(`/api/drug-requests?${where('tigecycline', '2026-11-09')}`)).body.requests[0].googleSentAt
  assert.equal(await sentAt(), null)
  // Sent by hand, the pharmacist marks it.
  assert.equal((await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, { confirmManual: true })).status, 200)
  assert.ok(await sentAt())
})

test('colistin: a fourth kind — asked on the first day only, dose prefilled in million units, one case chosen, counted', async () => {
  const admin = await loginAs({ role: 'admin' })
  await admin.post('/api/medicines', { name: 'Colistin 1000000 IU vial' })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  assert.deepEqual(await check(pharmacist, 'colistin', '2026-09-24', { name: 'ليلى', id: '55' }), { day: 1, requested: false })
  await saveChart(pharmacist, '2026-09-24', 'Colistin 1000000 IU vial', [{ name: 'ليلى', id: '55', qty: 6 }])
  assert.deepEqual(await check(pharmacist, 'colistin', '2026-09-25', { name: 'ليلى', id: '55' }), { day: 2, requested: false })

  // The popup's prefill: 6 vials of 1,000,000 IU = 6 MU; the same drug under its other names is matched.
  assert.deepEqual(DRUG_REQUESTS.colistin.prefill([{ medicine: 'Colistin 1000000 IU vial', quantity: 6 }]), { dose: '6000000' })
  assert.deepEqual(DRUG_REQUESTS.colistin.prefill([{ medicine: 'Colistin vial', quantity: 2 }]), { dose: '' })
  assert.deepEqual(DRUG_REQUESTS.tigecycline.prefill([{ medicine: 'Tygacil 50mg Vial', quantity: 2 }]), { dose: '100' })
  assert.ok(['Colistin 1000000 IU vial', 'Colomycin 2MU', 'colistimethate'].every((name) => DRUG_REQUESTS.colistin.pattern.test(name)))

  const sent = await pharmacist.post('/api/drug-requests', {
    kind: 'colistin', floor: FLOOR, ward: WARD, date: '2026-09-24', name: 'ليلى', patientId: '55',
    fields: { sex: 'أنثى', age: '40', diagnosis: 'VAP', weight: '70,5', scr: '1.1', dose: '1000000 IU', duration: '7 أيام', culture: 'Sensitive', committee: 'ص. ليث', doctor: 'د. سعد', bogus: 'x' },
  })
  assert.equal(sent.status, 201)
  assert.deepEqual(sent.body.request.fields, { sex: 'أنثى', age: '40', diagnosis: 'VAP', weight: '70.5', scr: '1.1', dose: '1000000', duration: '7 أيام', culture: 'Sensitive', committee: 'ص. ليث', doctor: 'د. سعد', hideDoctor: '' })
  const ticked = await pharmacist.patch(`/api/drug-requests/${sent.body.request.id}/ticks`, { ticks: ['serious', 'cf', 'nope'] })
  assert.deepEqual(ticked.body.request.ticks, ['cf'])
  assert.deepEqual(await check(pharmacist, 'colistin', '2026-09-24', { name: 'ليلى', id: '55' }), { day: 1, requested: true })
  const counts = (await pharmacist.get(`/api/drug-requests/counts?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-09-24`)).body
  assert.deepEqual(counts, { ...Z0, colistin: 1, attention: { ...Z0, colistin: 1 } })
})

test('dose boxes hold a number only: letters dropped, the old wording («50mg × 2», «6 MU») read as the number', () => {
  const tige = DRUG_REQUESTS.tigecycline.fields.find((field) => field.key === 'dose')
  const coli = DRUG_REQUESTS.colistin.fields.find((field) => field.key === 'dose')
  assert.deepEqual(['50', '100', '50mg', '50mg × 2', '50mg × 2 + 50mg × 1', 'abc', '1,5'].map((text) => cleanField(tige, text)), ['50', '100', '50', '100', '150', '', '1.5'])
  assert.deepEqual(['1000000', '1000000 IU', '6 MU', '٣٠٠٠٠٠٠', '× 2'].map((text) => cleanField(coli, text)), ['1000000', '1000000', '6000000', '3000000', '2'])
  assert.deepEqual([tigecyclineDoseNumber('50mg × 2'), tigecyclineDoseNumber('75'), colistinDoseNumber('4.5 MU'), colistinDoseNumber('9')], ['100', '75', '4500000', '9'])
})

test('colistin google form: the answers (its own ids and case texts, daily dose as typed), what is missing, the route dry-run', async () => {
  const form = { name: 'ليلى', patientId: '55', date: '2026-11-09', ticks: ['cf'], fields: { sex: 'أنثى', age: '40', weight: '70', scr: '1.2', dose: '1000000', duration: '7 أيام', culture: 'Not done', committee: 'ص. ليث', doctor: 'د. سعد' } }
  const sent = colistinFormAnswers(form, { ward: 'الطابق 3 — ردهة', email: 'unit@example.org' })
  const answer = (name) => sent.body.find(([key]) => key === name)?.[1]
  assert.equal(sent.ok, true)
  assert.equal(answer('entry.1668545535'), 'management of chronic pulmonary infection due to pseudomonas aeruginosa in patient with cystic fibrosis')
  // The request holds IU; the form takes mg of colistin base (1 million IU = 30 mg).
  assert.deepEqual([answer('entry.275553482'), answer('entry.703290303'), answer('entry.1765020922'), answer('entry.2011704287')], ['30', '30', '0', 'لا'])
  const mgFor = (dose) => colistinFormAnswers({ ...form, fields: { ...form.fields, dose } }, unit).body.find(([key]) => key === 'entry.275553482')[1]
  assert.deepEqual(['6000000', '4500000', '500000', '3333333'].map(mgFor), ['180', '135', '15', '100'])
  assert.deepEqual([answer('entry.120145077_month'), answer('entry.120145077_day')], ['11', '9'])
  assert.equal(answer('entry.78709220'), 'not done')
  assert.equal(answer('entry.2071414154'), 'مستشفى بغداد التعليمي العام')
  assert.ok(COLISTIN_URL.includes('1FAIpQLScKnP4IrG9HDHYlHnGr7AYPIVwAMRQTWEYRzm8J0P9fd1B20w'))
  assert.deepEqual(colistinFormAnswers({ ...form, fields: { ...form.fields, dose: '' }, ticks: [] }, unit).missing, ['الحالة المصرح بها (علّم مربعًا)', 'الجرعة المطلوبة يوميًا (رقم بالوحدات الدولية، مثل 1000000)'])

  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const saved = (await pharmacist.post('/api/drug-requests', { kind: 'colistin', floor: FLOOR, ward: WARD, date: '2026-11-09', name: 'ليلى', patientId: '55', fields: form.fields })).body.request
  await pharmacist.patch(`/api/drug-requests/${saved.id}/ticks`, { ticks: ['serious'] })
  const dry = await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})
  assert.equal(dry.body.dryRun, true)
  assert.equal(dry.body.answers.find(([key]) => key === 'entry.890134783')[1], `الطابق ${FLOOR} — ${WARD}`)
})

test('ivig: a fifth kind — asked on the first day only, vials prefilled, one diagnosis chosen, counted', async () => {
  const admin = await loginAs({ role: 'admin' })
  await admin.post('/api/medicines', { name: 'IVIG 5g vial' })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  assert.deepEqual(await check(pharmacist, 'ivig', '2026-09-24', { name: 'نور', id: '66' }), { day: 1, requested: false })
  await saveChart(pharmacist, '2026-09-24', 'IVIG 5g vial', [{ name: 'نور', id: '66', qty: 4 }])
  assert.deepEqual(await check(pharmacist, 'ivig', '2026-09-25', { name: 'نور', id: '66' }), { day: 2, requested: false })
  assert.deepEqual(DRUG_REQUESTS.ivig.prefill([{ medicine: 'IVIG 5g vial', quantity: 4 }, { medicine: 'Octagam', quantity: 1 }]), { vials: '5' })
  assert.ok(['IVIG 5g vial', 'Human immunoglobulin 5%', 'Octagam 10%', 'Intratect'].every((name) => DRUG_REQUESTS.ivig.pattern.test(name)))
  assert.equal(DRUG_REQUESTS.ivig.pattern.test('Human albumin 20% I.V.'), false)

  const sent = await pharmacist.post('/api/drug-requests', { kind: 'ivig', floor: FLOOR, ward: WARD, date: '2026-09-24', name: 'نور', patientId: '66', fields: { sex: 'أنثى', age: '0,08', vials: '4 vials', doctor: 'د. سعد', bogus: 'x' } })
  assert.equal(sent.status, 201)
  assert.deepEqual(sent.body.request.fields, { sex: 'أنثى', age: '0.08', vials: '4', doctor: 'د. سعد' })
  const ticked = await pharmacist.patch(`/api/drug-requests/${sent.body.request.id}/ticks`, { ticks: ['itp', 'kawasaki', 'nope'] })
  assert.deepEqual(ticked.body.request.ticks, ['kawasaki'])
  assert.deepEqual(await check(pharmacist, 'ivig', '2026-09-24', { name: 'نور', id: '66' }), { day: 1, requested: true })
})

test('ivig google form: each part is its own page (pageHistory) with its own question; season and month from the day; what is missing or refused', () => {
  const form = { name: 'نور', patientId: '66', date: '2026-11-09', ticks: ['kawasaki'], note: '', fields: { sex: 'أنثى', age: '0.083', vials: '4', doctor: 'د. سعد' } }
  const answers = (patch) => ivigFormAnswers({ ...form, ...patch })
  const get = (result, name) => result.body.find(([key]) => key === name)?.[1]
  const sent = answers({})
  assert.equal(sent.ok, true)
  assert.deepEqual([get(sent, 'entry.1595320943'), get(sent, 'entry.105603720'), get(sent, 'entry.2018093175')], ['انثى', '0.083', '4'])
  assert.deepEqual([get(sent, 'entry.214137601'), get(sent, 'entry.1987280467')], ['الفصل الرابع', 'الشهر الحادي عشر: تشرين الثاني'])
  assert.deepEqual([get(sent, 'entry.1082107107'), get(sent, 'entry.96234760'), get(sent, 'pageHistory')], ['Part ( hematology )', 'kawasaki vasculitis', '0,1,4'])
  assert.equal(sent.body.some(([key]) => key === 'emailAddress'), false)
  const branch = (ticks, note = '') => { const result = answers({ ticks, note }); return [get(result, 'entry.1082107107'), get(result, 'pageHistory'), result.body.at(-3)[0]] }
  assert.deepEqual(branch(['abmr']), ['Part ( nephrology )', '0,1,3', 'entry.1537971111'])
  assert.deepEqual(branch(['mg']), ['Part ( neurology)', '0,1,5', 'entry.601709297'])
  assert.deepEqual(branch(['others'], 'Sjogren syndrome'), ['others', '0,1,2', 'entry.332421866'])
  assert.deepEqual(answers({ ticks: ['others'], note: '' }).missing, ['تفصيل «Others»'])
  assert.match(answers({ ticks: ['others'], note: 'متلازمة' }).invalid[0], /^تفصيل/)
  assert.match(answers({ fields: { ...form.fields, age: '0.0833' } }).invalid[0], /^العمر/)
  assert.deepEqual(answers({ ticks: [], fields: { sex: 'ذكر' } }).missing, ['اسم الطبيب الاختصاص', 'العمر', 'عدد الفيالات المصروفة', 'التشخيص (علّم مربعًا)'])
  assert.equal(get(answers({ date: '2026-02-03' }), 'entry.214137601'), 'الفصل الاول')
})

test('ivig google form: the route posts it with no email (the form asks none), tolerates the form’s title block, and marks it sent', async (t) => {
  process.env.GOOGLE_FORM_SEND = '1'
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real; delete process.env.GOOGLE_FORM_SEND })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const saved = (await pharmacist.post('/api/drug-requests', { kind: 'ivig', floor: FLOOR, ward: WARD, date: '2026-11-09', name: 'نور', patientId: '66', fields: { sex: 'أنثى', age: '5', vials: '4', doctor: 'د. سعد' } })).body.request
  assert.equal((await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})).status, 422) // no diagnosis yet
  await pharmacist.patch(`/api/drug-requests/${saved.id}/ticks`, { ticks: ['gbs'] })
  // The live form: a title block with no question (type 11) first, email setting 1 (none).
  const html = `<script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, [null, [[1, 'IVIG', '', 11, null], [2, 't', null, 0, [[601709297, null, 1]]]], null, null, null, null, null, null, null, null, [null, null, null, 2, null, null, 1]]])};</script>`
  const posted = []
  globalThis.fetch = async (url, options) => {
    if (!String(url).includes('docs.google.com')) return real(url, options)
    if (String(url).endsWith('formResponse')) { posted.push(new URLSearchParams(options.body)); return { ok: true, status: 200, redirected: false, url: String(url) } }
    return { ok: true, text: async () => html }
  }
  const result = await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})
  assert.equal(result.status, 200)
  assert.equal(result.body.signIn, undefined)
  assert.equal(posted.length, 1)
  assert.deepEqual([posted[0].get('pageHistory'), posted[0].get('entry.601709297'), posted[0].has('emailAddress')], ['0,1,5', 'guillian barrie syndrome in case plasmapheresis cannot be done or not available', false])
  assert.ok(result.body.request.googleSentAt)
})

test('needsFollowUp: a Google form until Google has taken it (and while unconfirmed); Meropenem while it lacks what «مواقف القسم» shows', () => {
  const ivig = { name: 'نور', patientId: '66', date: '2026-11-09', ticks: [], note: '', fields: {}, googleSentAt: null, googleError: '' }
  assert.equal(needsFollowUp('ivig', ivig), true)
  assert.equal(needsFollowUp('ivig', { ...ivig, googleSentAt: '2026-11-09T09:00:00Z' }), false) // sent, though it still lacks things
  assert.equal(needsFollowUp('ivig', { ...ivig, googleSentAt: '2026-11-09T09:00:00Z', googleError: 'لم يتأكد' }), true)
  assert.equal(needsFollowUp('meropenem', { ...ivig, fields: { sex: 'ذكر', age: '4' }, ticks: ['cap'] }), false)
  assert.equal(needsFollowUp('meropenem', ivig), true)
})

test('formProblems: Meropenem lacks what «مواقف القسم» shows; the Google kinds lack what their form would refuse', () => {
  const meropenem = (fields, ticks = [], note = '') => formProblems('meropenem', { name: 'علي', patientId: '1', date: '2026-11-09', fields, ticks, note })
  assert.deepEqual(meropenem({}), ['الجنس', 'العمر', 'التشخيص'])
  assert.deepEqual(meropenem({ sex: 'ذكر', age: '40' }, ['culture-none']), ['التشخيص']) // the culture box is not a diagnosis
  assert.deepEqual(meropenem({ sex: 'ذكر', age: '40' }, ['cap']), [])
  assert.deepEqual(meropenem({ sex: 'ذكر', age: '40' }, ['others']), ['تفصيل «Others»'])
  assert.deepEqual(meropenem({ sex: 'ذكر', age: '40' }, ['others'], 'Sepsis'), [])
  assert.deepEqual(GOOGLE_KINDS, ['albumin', 'tigecycline', 'colistin', 'ivig'])
  const ivig = { name: 'نور', patientId: '66', date: '2026-11-09', ticks: [], note: '', fields: { sex: 'أنثى', age: '5', vials: '4', doctor: 'د. سعد' } }
  assert.deepEqual(formProblems('ivig', ivig), ['التشخيص (علّم مربعًا)'])
  assert.deepEqual(formProblems('ivig', { ...ivig, ticks: ['gbs'] }), [])
  assert.deepEqual(formProblems('ivig', { ...ivig, ticks: ['gbs'], fields: { ...ivig.fields, age: '0.0833' } }).length, 1) // the form's own rule on the age
  assert.deepEqual(formProblems('tigecycline', { name: 'سارة', patientId: '', date: '2026-11-09', ticks: [], note: '', fields: {} }).includes('رقم الطبلة'), true)
})

test('google send follow-up: who sent it and how, why a try failed (kept, then cleared by a send), counts say what needs following up', async (t) => {
  process.env.GOOGLE_FORM_SEND = '1'
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real; delete process.env.GOOGLE_FORM_SEND })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const saved = (await pharmacist.post('/api/drug-requests', { kind: 'ivig', floor: FLOOR, ward: WARD, date: '2026-11-09', name: 'نور', patientId: '66', fields: { sex: 'أنثى', age: '5', vials: '4', doctor: 'د. سعد' } })).body.request
  assert.deepEqual([saved.googleSentAt, saved.googleSentHow, saved.googleSentBy, saved.googleError], [null, null, '', ''])
  await pharmacist.patch(`/api/drug-requests/${saved.id}/ticks`, { ticks: ['gbs'] })
  const countsOf = async () => (await pharmacist.get(`/api/drug-requests/counts?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-11-09`)).body
  const stored = async () => (await pharmacist.get(`/api/drug-requests?${where('ivig', '2026-11-09')}`)).body.requests[0]
  assert.equal((await countsOf()).attention.ivig, 1) // complete, but not sent yet

  const html = `<script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, [null, [[2, 't', null, 0, [[601709297, null, 1]]]], null, null, null, null, null, null, null, null, [null, null, null, 2, null, null, 1]]])};</script>`
  let answer = { ok: false, status: 400, redirected: false }
  globalThis.fetch = async (url, options) => {
    if (!String(url).includes('docs.google.com')) return real(url, options)
    return String(url).endsWith('formResponse') ? { ...answer, url: String(url) } : { ok: true, text: async () => html }
  }
  const refused = await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})
  assert.equal(refused.status, 502)
  const after = await stored()
  assert.equal(after.googleSentAt, null)
  assert.match(after.googleError, /Google/)
  assert.ok(after.googleAttemptAt)
  assert.equal((await countsOf()).attention.ivig, 1)

  answer = { ok: true, status: 200, redirected: false }
  const sent = await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})
  assert.equal(sent.status, 200)
  assert.deepEqual([sent.body.request.googleSentHow, sent.body.request.googleError], ['auto', ''])
  assert.ok(sent.body.request.googleSentBy)
  assert.equal((await countsOf()).attention.ivig, 0) // sent and complete: nothing to follow up
  assert.deepEqual((await countsOf()).ivig, 1)

  // A hand-send, said by the pharmacist, is kept as such.
  const second = (await pharmacist.post('/api/drug-requests', { kind: 'ivig', floor: FLOOR, ward: WARD, date: '2026-11-09', name: 'علي', patientId: '67', fields: {} })).body.request
  assert.equal((await countsOf()).attention.ivig, 1) // the new one lacks things and is unsent
  assert.equal((await pharmacist.post(`/api/drug-requests/${second.id}/google-form`, { confirmManual: true })).status, 200)
  const manual = (await pharmacist.get(`/api/drug-requests?${where('ivig', '2026-11-09')}`)).body.requests.find((item) => item.id === second.id)
  assert.equal(manual.googleSentHow, 'manual')
  assert.ok(manual.googleSentBy)
  assert.equal((await countsOf()).attention.ivig, 0) // Google has taken it: what the app's own copy lacks no longer matters

  // A refused resend gives back who sent it and how; it never wipes a sent mark.
  const third = (await pharmacist.post('/api/drug-requests', { kind: 'ivig', floor: FLOOR, ward: WARD, date: '2026-11-09', name: 'هدى', patientId: '68', fields: { sex: 'أنثى', age: '5', vials: '4', doctor: 'د. سعد' } })).body.request
  await pharmacist.patch(`/api/drug-requests/${third.id}/ticks`, { ticks: ['gbs'] })
  assert.equal((await pharmacist.post(`/api/drug-requests/${third.id}/google-form`, { confirmManual: true })).status, 200)
  answer = { ok: false, status: 400, redirected: false }
  assert.equal((await pharmacist.post(`/api/drug-requests/${third.id}/google-form`, { resend: true })).status, 502)
  const kept = (await pharmacist.get(`/api/drug-requests?${where('ivig', '2026-11-09')}`)).body.requests.find((item) => item.id === third.id)
  assert.deepEqual([Boolean(kept.googleSentAt), kept.googleSentHow, kept.googleSentBy === manual.googleSentBy], [true, 'manual', true])
  assert.equal((await countsOf()).attention.ivig, 1) // sent, but the last try left a reason: follow it up
})

test('requests: a name with hidden characters is saved without them, so a form and a check by the plain name meet', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const saved = await pharmacist.post('/api/drug-requests', { kind: 'albumin', floor: FLOOR, ward: WARD, date: '2026-09-24', name: ' سعاد\u200f جاس\u200cم ', patientId: '', fields: {} })
  assert.equal(saved.status, 201)
  assert.equal(saved.body.request.name, 'سعاد جاسم')
  assert.equal((await check(pharmacist, 'albumin', '2026-09-24', { name: 'سعاد جاسم' })).requested, true)
  assert.equal((await check(pharmacist, 'albumin', '2026-09-24', { name: 'سعاد جاس\u200cم' })).requested, true)
})
