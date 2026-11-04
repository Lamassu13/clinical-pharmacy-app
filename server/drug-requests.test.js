import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'
import { cleanTicks, toggleTick } from '../shared/drug-requests.js'

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
    fields: { treatmentDay: '٣', count: '4 vials', serumAlbumin: '1,8x', weight: '70.5', scr: '1.1', doctor: ' د. سعد كاظم ', diagnosis: 'Liver cirrhosis', age: '54' },
  })
  assert.equal(sent.status, 201)
  assert.deepEqual(sent.body.request.fields, { treatmentDay: '3', count: '4', serumAlbumin: '1.8', weight: '70.5', scr: '1.1', doctor: 'د. سعد كاظم', diagnosis: 'Liver cirrhosis' })
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
