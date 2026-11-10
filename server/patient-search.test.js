import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

const DATE = '2026-01-15'
const A = { floor: 5, ward: 'ردهة رجال' }
const B = { floor: 8, ward: 'الردهة الخامسة' }

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(async () => {
  await resetDatabase()
  await pool.query("INSERT INTO medicines (name) VALUES ('Amoxicillin Cap')")
})

const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}

const saveChart = (client, where, slot, patients) => client.put('/api/chart', {
  ...where, date: DATE, slot, expectedVersion: 0,
  patients: patients.map((patient, index) => ({ rowNumber: index + 1, ...patient })),
  columns: [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }],
  quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 3 }],
})

const search = (client, params) => client.get(`/api/patients/search?${new URLSearchParams({ date: DATE, ...params })}`)

test('patient search: scans the floor main + extra charts by ID prefix and name part, scoped by role', async () => {
  const admin = await loginAs({ role: 'admin' })
  assert.equal((await saveChart(admin, A, 'main', [{ name: 'علي حسن', patientId: '12345' }])).status, 200)
  assert.equal((await saveChart(admin, A, 'extra', [{ name: 'زيد', patientId: '999' }, { name: 'علي كريم' }])).status, 200)
  assert.equal((await saveChart(admin, B, 'main', [{ name: 'علي جاسم', patientId: '12377' }])).status, 200)

  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  const byId = (await search(pharmacist, { floor: 5, q: '123' })).body.patients
  assert.deepEqual(byId.map((p) => [p.name, p.slot]), [['علي حسن', 'main']])
  assert.deepEqual(byId[0].medicines, [{ name: 'Amoxicillin Cap', quantity: 3 }])

  const byName = (await search(pharmacist, { floor: 5, q: 'علي' })).body.patients
  assert.deepEqual(byName.map((p) => [p.name, p.slot]), [['علي حسن', 'main'], ['علي كريم', 'extra']])
  assert.deepEqual(byName[1].medicines, [])

  assert.equal((await search(pharmacist, { floor: 8, q: 'علي' })).status, 403)
  assert.equal((await search(pharmacist, { q: 'علي' })).status, 403)

  const unit = (await search(admin, { q: '123' })).body.patients
  assert.deepEqual(unit.map((p) => p.floor), [5, 8])
})

test('patient history: one patient across dates and wards, newest first; managers only', async () => {
  const admin = await loginAs({ role: 'admin' })
  const putOn = (where, date, slot, patients) => admin.put('/api/chart', {
    ...where, date, slot, expectedVersion: 0,
    patients: patients.map((patient, index) => ({ rowNumber: index + 1, ...patient })),
    columns: [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }],
    quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 1 }],
  })
  // Ali (ID 12345): two days on A, then a day on B's extra chart. Omar: name only, last year.
  assert.equal((await putOn(A, '2025-03-01', 'main', [{ name: 'علي حسن', patientId: '12345' }])).status, 200)
  assert.equal((await putOn(A, '2025-03-02', 'main', [{ name: 'علي حسن', patientId: '12345' }])).status, 200)
  assert.equal((await putOn(B, '2025-03-05', 'extra', [{ name: 'علي حسن جاسم', patientId: '12345' }, { name: 'عمر علي' }])).status, 200)

  const history = (q) => admin.get(`/api/patients/history?${new URLSearchParams({ q })}`)
  const [ali] = (await history('123')).body.patients
  assert.deepEqual([ali.name, ali.patientId, ali.first, ali.last, ali.days], ['علي حسن جاسم', '12345', '2025-03-01', '2025-03-05', 3])
  assert.deepEqual(ali.stays.map((stay) => [stay.ward, stay.slot, stay.first, stay.last, stay.days]), [
    [B.ward, 'extra', '2025-03-05', '2025-03-05', 1],
    [A.ward, 'main', '2025-03-01', '2025-03-02', 2],
  ])
  assert.deepEqual(ali.stays.map((stay) => stay.medicines), [
    [{ name: 'Amoxicillin Cap', quantity: 1, days: 1 }],
    [{ name: 'Amoxicillin Cap', quantity: 2, days: 2 }],
  ])
  const omar = (await history('عمر')).body.patients[0]
  assert.deepEqual(omar.stays[0].medicines, [])
  assert.deepEqual((await history('علي')).body.patients.map((patient) => patient.name).sort(), ['علي حسن جاسم', 'عمر علي'].sort())
  assert.deepEqual((await history('ع')).body.patients, []) // under 2 characters

  const pharmacist = await loginAs({ role: 'user', floor: 5 })
  assert.equal((await pharmacist.get('/api/patients/history?q=123')).status, 403)
})

test('patient search: a name is found whichever way it was spelled, an ID by its start; a doubled space does not hide it', async () => {
  const admin = await loginAs({ role: 'admin' })
  assert.equal((await saveChart(admin, A, 'main', [{ name: 'أحمد  علي', patientId: '41355' }])).status, 200)
  assert.equal((await saveChart(admin, B, 'main', [{ name: 'فاطمة الزهراء', patientId: '50021' }])).status, 200)
  const found = async (q) => (await search(admin, { q })).body.patients.map((patient) => patient.name)
  assert.deepEqual(await found('احمد'), ['أحمد  علي'])
  assert.deepEqual(await found('احمد علي'), ['أحمد  علي'])
  assert.deepEqual(await found('أحمد علي'), ['أحمد  علي'])
  assert.deepEqual(await found('فاطمه'), ['فاطمة الزهراء'])
  assert.deepEqual(await found('413'), ['أحمد  علي'])
  assert.deepEqual(await found('٥٠٠'), []) // Arabic digits are turned into 500 by the app before they are sent
  // The all-dates search folds the same way.
  const history = (await admin.get(`/api/patients/history?${new URLSearchParams({ q: 'فاطمه' })}`)).body.patients
  assert.deepEqual(history.map((patient) => patient.name), ['فاطمة الزهراء'])
  // …and so does the treatment of each stay: the medicines are found too, however the name is typed (they came back empty for any
  // name with ة / أ / ى when the medicines were matched on the raw name).
  for (const q of ['فاطمه', 'فاطمة']) {
    const [patient] = (await admin.get(`/api/patients/history?${new URLSearchParams({ q })}`)).body.patients
    assert.deepEqual(patient.stays.flatMap((stay) => stay.medicines.map((medicine) => [medicine.name, medicine.quantity])), [['Amoxicillin Cap', 3]], q)
  }
})

test('hidden characters in a name: dropped when it is saved, and a name already saved with one is still found and cleaned by the migration', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: A.floor })
  // «سعاد جاس‌م» — a zero-width non-joiner before the م, a right-to-left mark after the first word, a soft hyphen.
  const dirty = 'سعاد\u200f جاس\u200cم\u00ad'
  assert.equal((await saveChart(pharmacist, A, 'main', [{ name: dirty, patientId: '417583' }])).status, 200)
  const rows = (await pool.query('SELECT patient_name FROM chart_patients')).rows.map((row) => row.patient_name)
  assert.deepEqual(rows.filter(Boolean), ['سعاد جاسم'])
  assert.equal((await pharmacist.get(`/api/patients/search?floor=${A.floor}&date=${DATE}&q=${encodeURIComponent(dirty)}`)).body.patients[0].name, 'سعاد جاسم')

  // A row from before the fix, written straight to the table: found by the plain name, and listed once with the other spelling.
  await pool.query("UPDATE chart_patients SET patient_name = $1", [dirty])
  assert.equal((await pharmacist.get(`/api/patients/search?floor=${A.floor}&date=${DATE}&q=${encodeURIComponent('جاسم')}`)).body.patients.length, 1)
  // The migration (run on every deploy) puts it right; run twice, it changes nothing the second time.
  const { default: fs } = await import('node:fs/promises')
  const schema = await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  await pool.query(schema); await pool.query(schema)
  assert.deepEqual((await pool.query('SELECT patient_name FROM chart_patients')).rows.map((row) => row.patient_name).filter(Boolean), ['سعاد جاسم'])
})
