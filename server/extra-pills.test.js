import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

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

const blankEntries = { entries: [1, 2, 3, 4, 5, 6, 7].map((slot) => ({ slot, medicineName: '', pillQty: '', doseTime: '', usageMethod: '', note: '' })) }
const WARD = 'ردهة الخاص' // present on every EXTRA_PILL_FLOORS floor (3, 6, 8, 9)

test('extra-pills: auth required; access is scoped to the floor, a supervisor reaches every allowed floor', async () => {
  const anon = new ApiClient(baseUrl)
  assert.equal((await anon.get(`/api/extra-pills?floor=9&ward=${encodeURIComponent(WARD)}`)).status, 401)
  assert.equal((await anon.post('/api/extra-pills', { floor: 9, ward: WARD })).status, 401)

  const other = await loginAs({ role: 'user', floor: 5 })
  assert.equal((await other.get(`/api/extra-pills?floor=9&ward=${encodeURIComponent(WARD)}`)).status, 403)
  assert.equal((await other.post('/api/extra-pills', { floor: 9, ward: WARD })).status, 403)

  const member = await loginAs({ role: 'user', floor: 9 })
  assert.equal((await member.get(`/api/extra-pills?floor=9&ward=${encodeURIComponent(WARD)}`)).status, 200)
  const created = await member.post('/api/extra-pills', { floor: 9, ward: WARD })
  assert.equal(created.status, 201)

  // A user assigned to floor 5 may not touch a form that lives on floor 9, even by id.
  assert.equal((await other.put(`/api/extra-pills/${created.body.form.id}`, { patientName: 'x', ...blankEntries })).status, 403)
  assert.equal((await other.delete(`/api/extra-pills/${created.body.form.id}`)).status, 403)

  const supervisor = await loginAs({ role: 'supervisor' })
  assert.equal((await supervisor.get(`/api/extra-pills?floor=9&ward=${encodeURIComponent(WARD)}`)).status, 200)
  assert.equal((await supervisor.post('/api/extra-pills', { floor: 6, ward: WARD })).status, 201)
})

test('extra-pills: only the four floors this tool was built for are accepted, and the ward must belong to that floor', async () => {
  const client = await loginAs({ role: 'admin' })
  assert.equal((await client.get(`/api/extra-pills?floor=5&ward=${encodeURIComponent(WARD)}`)).status, 400)
  assert.equal((await client.post('/api/extra-pills', { floor: 5, ward: WARD })).status, 400)
  assert.equal((await client.get(`/api/extra-pills?floor=9&ward=${encodeURIComponent(WARD)}`)).status, 200)
  // A real ward name, just not one that exists on floor 9.
  assert.equal((await client.get('/api/extra-pills?floor=9&ward=' + encodeURIComponent('الوحدة الأولى'))).status, 400)
  assert.equal((await client.post('/api/extra-pills', { floor: 9, ward: 'الوحدة الأولى' })).status, 400)
})

test('extra-pills: one list per ward — a form created for one ward never appears under another, even on the same floor', async () => {
  const client = await loginAs({ role: 'user', floor: 9 })
  const created = await client.post('/api/extra-pills', { floor: 9, ward: 'ردهة الخاص' })
  assert.equal(created.status, 201)
  assert.equal(created.body.form.ward, 'ردهة الخاص')

  const sameWard = await client.get('/api/extra-pills?floor=9&ward=' + encodeURIComponent('ردهة الخاص'))
  assert.deepEqual(sameWard.body.forms, [created.body.form])

  const otherWard = await client.get('/api/extra-pills?floor=9&ward=' + encodeURIComponent('الردهة الرابعة'))
  assert.deepEqual(otherWard.body.forms, [])
})

test('extra-pills: POST creates a form with 7 blank slots; GET returns it padded the same way', async () => {
  const client = await loginAs({ role: 'user', floor: 3 })
  const created = await client.post('/api/extra-pills', { floor: 3, ward: WARD })
  assert.equal(created.status, 201)
  assert.equal(created.body.form.floor, 3)
  assert.equal(created.body.form.ward, WARD)
  assert.equal(created.body.form.patientName, '')
  assert.deepEqual(created.body.form.entries.map((e) => e.slot), [1, 2, 3, 4, 5, 6, 7])
  assert.ok(created.body.form.entries.every((e) => e.medicineName === '' && e.pillQty === '' && e.doseTime === '' && e.usageMethod === '' && e.note === ''))

  const listed = await client.get(`/api/extra-pills?floor=3&ward=${encodeURIComponent(WARD)}`)
  assert.equal(listed.status, 200)
  assert.deepEqual(listed.body.forms, [created.body.form])
})

test('extra-pills: PUT replaces the patient/room and all 7 slots; a second PUT fully overwrites, no stale leftovers', async () => {
  const client = await loginAs({ role: 'user', floor: 8 })
  const id = (await client.post('/api/extra-pills', { floor: 8, ward: WARD })).body.form.id

  const first = await client.put(`/api/extra-pills/${id}`, {
    patientName: 'أحمد علي',
    roomNumber: '12',
    entries: [
      { slot: 1, medicineName: 'باراسيتامول', pillQty: '2', doseTime: '٨ صباحًا', usageMethod: 'حبة بعد الطعام مباشرة', note: 'لا يؤخذ مع الخضراوات الورقية الخضراء' },
      { slot: 2, medicineName: 'أوميبرازول', pillQty: '1', doseTime: '', usageMethod: '', note: '' },
    ],
  })
  assert.equal(first.status, 200)
  assert.equal(first.body.form.patientName, 'أحمد علي')
  assert.equal(first.body.form.roomNumber, '12')
  assert.deepEqual(first.body.form.entries[0], { slot: 1, medicineName: 'باراسيتامول', pillQty: '2', doseTime: '٨ صباحًا', usageMethod: 'حبة بعد الطعام مباشرة', note: 'لا يؤخذ مع الخضراوات الورقية الخضراء' })
  assert.equal(first.body.form.entries[1].medicineName, 'أوميبرازول')
  assert.equal(first.body.form.entries[2].medicineName, '')

  // A second PUT that no longer mentions slot 1 must clear it, not leave the old value.
  const second = await client.put(`/api/extra-pills/${id}`, {
    patientName: 'أحمد علي',
    roomNumber: '12',
    entries: [{ slot: 2, medicineName: 'أوميبرازول', pillQty: '3', doseTime: '', usageMethod: '', note: '' }],
  })
  assert.equal(second.status, 200)
  assert.equal(second.body.form.entries[0].medicineName, '')
  assert.equal(second.body.form.entries[1].pillQty, '3')

  // An unrecognized dose-time/usage/note value is dropped rather than stored verbatim.
  const bogus = await client.put(`/api/extra-pills/${id}`, { patientName: 'أحمد', roomNumber: '', entries: [{ slot: 1, medicineName: 'x', pillQty: '', doseTime: 'ليس وقتًا حقيقيًا', usageMethod: '', note: '' }] })
  assert.equal(bogus.body.form.entries[0].doseTime, '')
})

test('extra-pills: DELETE removes the form and its entries; a second delete is 404', async () => {
  const client = await loginAs({ role: 'user', floor: 6 })
  const id = (await client.post('/api/extra-pills', { floor: 6, ward: WARD })).body.form.id
  assert.equal((await client.delete(`/api/extra-pills/${id}`)).status, 200)
  assert.deepEqual((await client.get(`/api/extra-pills?floor=6&ward=${encodeURIComponent(WARD)}`)).body.forms, [])
  assert.equal((await client.delete(`/api/extra-pills/${id}`)).status, 404)
  assert.equal((await client.put(`/api/extra-pills/${id}`, { patientName: 'x', ...blankEntries })).status, 404)
})
