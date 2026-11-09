import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'
import { cleanTicks, toggleTick } from '../shared/drug-requests.js'
import { FORM_URL, albuminFormAnswers } from '../shared/albumin-google-form.js'
import { tigecyclineFormAnswers, dailyMg } from '../shared/tigecycline-google-form.js'

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
const MERONEM = 'Meronem 1000gm Vial'
const ALBUMIN = 'Human albumin 20% I.V.'

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
  assert.deepEqual(sent.body.request.fields, { sex: 'ذكر', age: '54.5', treatmentDay: '3', count: '4', serumAlbumin: '1.8', weight: '70.5', scr: '1.1', doctor: 'د. سعد كاظم', hideDoctor: '', diagnosis: 'Liver cirrhosis' })
  assert.equal(sent.body.request.words, 'أربعة')
  assert.deepEqual(sent.body.request.ticks, [])
  assert.deepEqual(await check(pharmacist, 'albumin', '2026-09-26', { name: 'سارة', id: '44' }), { day: 3, requested: true })
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
  assert.deepEqual((await counts('2026-09-24')).body, { meropenem: 0, albumin: 0, tigecycline: 0 })
  const form = { floor: FLOOR, ward: WARD, date: '2026-09-24', fields: {} }
  for (const [kind, name] of [['meropenem', 'علي'], ['albumin', 'علي'], ['albumin', 'حسن']]) assert.equal((await pharmacist.post('/api/drug-requests', { ...form, kind, name })).status, 201)
  assert.deepEqual((await counts('2026-09-24')).body, { meropenem: 1, albumin: 2, tigecycline: 0 })
  assert.deepEqual((await counts('2026-09-25')).body, { meropenem: 0, albumin: 0, tigecycline: 0 })
  assert.equal((await counts('2026-09-24', pharmacist, 8, 'الردهة الخامسة')).status, 403)
  assert.equal((await counts('not-a-date')).status, 400)
})

test('requests: purging the ward’s charts for the dates removes its forms too', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const place = { floor: FLOOR, ward: WARD }
  await pharmacist.post('/api/drug-requests', { ...place, kind: 'meropenem', date: '2026-09-24', name: 'علي' })
  await pharmacist.post('/api/drug-requests', { ...place, kind: 'albumin', date: '2026-09-24', name: 'سارة' })
  await pharmacist.post('/api/drug-requests', { ...place, kind: 'meropenem', date: '2026-09-28', name: 'حسن' })
  const manager = await loginAs({ role: 'supervisor' })
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
  google = fakeGoogle(() => { throw Object.assign(new Error('refused'), { name: 'TypeError' }) })
  assert.equal((await send(fourth.id)).status, 502)
  assert.equal(await sentAt(fourth.id), null)
  google.restore()
  google = fakeGoogle(() => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }) })
  const timedOut = await send(fourth.id)
  assert.equal(timedOut.status, 504)
  assert.ok(await sentAt(fourth.id))
  google.restore()
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
  assert.deepEqual(sent.body.request.fields, { sex: 'أنثى', age: '40', diagnosis: 'Diabetic foot', weight: '70.5', scr: '1.1', dose: '50mg × 2', duration: '7 أيام', culture: 'Resistant', committee: 'ص. ليث', doctor: 'د. سعد', hideDoctor: '' })
  // One of the two permitted cases is chosen (a second tick replaces the first); an unknown key is dropped.
  const ticked = await pharmacist.patch(`/api/drug-requests/${sent.body.request.id}/ticks`, { ticks: ['skin', 'abdominal', 'nope'] })
  assert.deepEqual(ticked.body.request.ticks, ['abdominal'])
  assert.deepEqual(await check(pharmacist, 'tigecycline', '2026-09-24', { name: 'سارة', id: '44' }), { day: 1, requested: true })
  const counts = (await pharmacist.get(`/api/drug-requests/counts?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-09-24`)).body
  assert.deepEqual(counts, { meropenem: 0, albumin: 0, tigecycline: 1 })
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
    ['بريد النموذج (GOOGLE_FORM_EMAIL على الخادم)', 'اسم عضو لجنة المضادات', 'اسم الطبيب الاختصاص', 'الحالة المصرح بها (علّم مربعًا)', 'الوزن', 'الجرعة المطلوبة يوميًا (مثل 50mg × 2)', 'S.Cr.', 'نتيجة الزرع البكتيري'])
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
