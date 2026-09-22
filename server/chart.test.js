import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

// A real ward from validation.js's FLOOR_WARDS, so isKnownWard() accepts it.
const FLOOR = 5
const WARD = 'ردهة رجال'
const OTHER_FLOOR = 6
const DATE = '2026-01-15'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(async () => {
  await resetDatabase()
  // A chart column may only name a catalogue medicine, so the round-trip tests need one.
  await pool.query("INSERT INTO medicines (name) VALUES ('Amoxicillin Cap')")
})

const loginAs = async (userOptions) => {
  const user = await createUser(userOptions)
  const client = new ApiClient(baseUrl)
  const login = await client.post('/api/auth/login', { username: user.username, password: user.password })
  assert.equal(login.status, 200, 'test setup: login must succeed')
  return client
}

test('GET /api/chart: refuses an anonymous request and one for an unassigned floor', async () => {
  const anon = new ApiClient(baseUrl)
  const anonResponse = await anon.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(anonResponse.status, 401)

  const client = await loginAs({ role: 'user', floor: OTHER_FLOOR })
  const wrongFloor = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(wrongFloor.status, 403)
})

test('GET /api/chart: a ward/date with no saved chart yet returns null, not a 404', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const response = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(response.status, 200)
  assert.equal(response.body.chart, null)
})

const buildChartBody = (overrides = {}) => ({
  floor: FLOOR,
  ward: WARD,
  date: DATE,
  patients: [{ rowNumber: 1, name: 'Patient One' }],
  columns: [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }],
  quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 2 }],
  expectedVersion: 0,
  ...overrides,
})

test('PUT /api/chart: a first save creates the chart at version 1 and round-trips through GET', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const saved = await client.put('/api/chart', buildChartBody())
  assert.equal(saved.status, 200)
  assert.equal(saved.body.version, 1)

  const fetched = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(fetched.body.chart.version, 1)
  assert.equal(fetched.body.chart.patients[0].patient_name, 'Patient One')
  assert.equal(fetched.body.chart.columns[0].medicine_name, 'Amoxicillin Cap')
  assert.equal(fetched.body.chart.quantities[0].quantity, 2)
})

test('PUT /api/chart: a save with the current expectedVersion succeeds and bumps the counter', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const first = await client.put('/api/chart', buildChartBody())
  assert.equal(first.body.version, 1)

  const second = await client.put('/api/chart', buildChartBody({ expectedVersion: 1, patients: [{ rowNumber: 1, name: 'Patient One (updated)' }] }))
  assert.equal(second.status, 200)
  assert.equal(second.body.version, 2)
})

test('PUT /api/chart: a stale expectedVersion is rejected with a 409 conflict and leaves the saved data untouched', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  await client.put('/api/chart', buildChartBody())
  await client.put('/api/chart', buildChartBody({ expectedVersion: 1, patients: [{ rowNumber: 1, name: 'Second save' }] }))

  // A third client still believes the chart is at version 1 (its own stale copy) and tries
  // to overwrite what is now version 2 — exactly the two-iPads-same-ward scenario.
  const stale = await client.put('/api/chart', buildChartBody({ expectedVersion: 1, patients: [{ rowNumber: 1, name: 'Stale overwrite attempt' }] }))
  assert.equal(stale.status, 409)
  assert.equal(stale.body.conflict, true)

  const fetched = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(fetched.body.chart.version, 2)
  assert.equal(fetched.body.chart.patients[0].patient_name, 'Second save', 'the rejected stale write must not have landed')
})

test('PUT /api/chart: a column naming a medicine outside the catalogue is dropped, never stored as free text', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const saved = await client.put('/api/chart', buildChartBody({
    columns: [
      { columnNumber: 1, medicineName: 'Amoxicillin Cap' },
      { columnNumber: 2, medicineName: 'Totally Made Up Syrup' },
    ],
  }))
  assert.equal(saved.status, 200)

  const fetched = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(fetched.body.chart.columns.length, 1, 'only the catalogue column is kept')
  assert.equal(fetched.body.chart.columns[0].column_number, 1)
  assert.equal(fetched.body.chart.columns[0].medicine_name, 'Amoxicillin Cap')
})

test('PUT /api/chart: a column survives its medicine being deleted from the catalogue, then resaved (regression — used to silently vanish on the next autosave)', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  await client.put('/api/chart', buildChartBody({
    columns: [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }],
    quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 2 }],
  }))

  const admin = await loginAs({ role: 'admin' })
  const medicineId = (await pool.query("SELECT id FROM medicines WHERE name = 'Amoxicillin Cap'")).rows[0].id
  const deleted = await admin.delete(`/api/medicines/${medicineId}`)
  assert.equal(deleted.status, 200)

  // The medicine is gone, but the chart still shows its name (custom_name preserved) — this
  // is what the client would resend on the very next autosave, unchanged.
  const afterDelete = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(afterDelete.body.chart.columns[0].medicine_name, 'Amoxicillin Cap')

  const resaved = await client.put('/api/chart', buildChartBody({
    columns: [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }],
    quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 2 }],
    expectedVersion: afterDelete.body.chart.version,
  }))
  assert.equal(resaved.status, 200)

  const afterResave = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(afterResave.body.chart.columns.length, 1, 'the column must survive the resave, not silently disappear')
  assert.equal(afterResave.body.chart.columns[0].medicine_name, 'Amoxicillin Cap')
  assert.deepEqual(
    afterResave.body.chart.quantities.map((q) => ({ row: q.row_number, col: q.column_number, qty: q.quantity })),
    [{ row: 1, col: 1, qty: 2 }],
    'its quantity must survive the resave too',
  )
})

test('PUT /api/chart: a column preserved after a medicine deletion is dropped the moment it\'s actually cleared', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  await client.put('/api/chart', buildChartBody({ columns: [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }] }))
  const admin = await loginAs({ role: 'admin' })
  const medicineId = (await pool.query("SELECT id FROM medicines WHERE name = 'Amoxicillin Cap'")).rows[0].id
  await admin.delete(`/api/medicines/${medicineId}`)
  const afterDelete = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)

  const cleared = await client.put('/api/chart', buildChartBody({
    columns: [{ columnNumber: 1, medicineName: '' }],
    quantities: [],
    expectedVersion: afterDelete.body.chart.version,
  }))
  assert.equal(cleared.status, 200)
  const afterClear = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(afterClear.body.chart.columns.length, 0, 'clearing the column for real must still work, not be stuck "preserved" forever')
})

test('PUT /api/chart: quantities for a column with no linked medicine (blank or outside the catalogue) are never stored — no orphaned numbers under a dropped column', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const saved = await client.put('/api/chart', buildChartBody({
    columns: [
      { columnNumber: 1, medicineName: 'Amoxicillin Cap' },
      { columnNumber: 2, medicineName: '' },
      { columnNumber: 3, medicineName: 'Totally Made Up Syrup' },
    ],
    quantities: [
      { rowNumber: 1, columnNumber: 1, quantity: 2 },
      { rowNumber: 1, columnNumber: 2, quantity: 5 },
      { rowNumber: 1, columnNumber: 3, quantity: 7 },
    ],
  }))
  assert.equal(saved.status, 200)

  const fetched = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.deepEqual(
    fetched.body.chart.quantities.map((q) => ({ row: q.row_number, col: q.column_number, qty: q.quantity })),
    [{ row: 1, col: 1, qty: 2 }],
    'only the linked column\'s quantity survives',
  )
})

test('PUT /api/chart: a column matches the catalogue ignoring case and extra spaces', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  await client.put('/api/chart', buildChartBody({ columns: [{ columnNumber: 1, medicineName: '  amoxicillin   cap ' }] }))

  const fetched = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(fetched.body.chart.columns.length, 1)
  assert.equal(fetched.body.chart.columns[0].medicine_name, 'Amoxicillin Cap')
})

test('PUT /api/chart: rejects an unknown ward name for the given floor', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const response = await client.put('/api/chart', buildChartBody({ ward: 'ردهة غير موجودة' }))
  assert.equal(response.status, 400)
})

test('PUT /api/chart: the extra slot is a separate chart for the same ward and date', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  await client.put('/api/chart', buildChartBody({ patients: [{ rowNumber: 1, name: 'Main sheet patient' }] }))
  const extra = await client.put('/api/chart', buildChartBody({ slot: 'extra', patients: [{ rowNumber: 1, name: 'Extra sheet patient' }] }))
  assert.equal(extra.status, 200)
  assert.equal(extra.body.version, 1, 'the extra chart starts its own version count')

  const main = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  const fetchedExtra = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}&slot=extra`)
  assert.equal(main.body.chart.patients[0].patient_name, 'Main sheet patient')
  assert.equal(fetchedExtra.body.chart.patients[0].patient_name, 'Extra sheet patient')

  // An unknown slot value falls back to 'main', never a third chart.
  const bogus = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}&slot=nonsense`)
  assert.equal(bogus.body.chart.patients[0].patient_name, 'Main sheet patient')
})

test('POST /api/charts/purge: removes both slots of a ward/date', async () => {
  const user = await loginAs({ role: 'user', floor: FLOOR })
  await user.put('/api/chart', buildChartBody())
  await user.put('/api/chart', buildChartBody({ slot: 'extra' }))

  const manager = await loginAs({ role: 'admin' })
  const purged = await manager.post('/api/charts/purge', { from: DATE, to: DATE, floors: [FLOOR] })
  assert.equal(purged.status, 200)
  assert.equal(purged.body.deleted, 2)
})

test('canAccessLocation via the API: a supervisor reaches a floor with no explicit assignment', async () => {
  const client = await loginAs({ role: 'supervisor' })
  const response = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(response.status, 200)
})

test('chart lock: one holder at a time, released and re-taken, and a stale lock is overwritable', async () => {
  const a = await loginAs({ role: 'user', floor: FLOOR })
  const b = await loginAs({ role: 'user', floor: FLOOR })
  const body = { floor: FLOOR, ward: WARD, date: DATE, slot: 'main' }
  const q = `floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}&slot=main`

  // A claims it (creating the ward row on the fly); B is refused and sees who holds it.
  assert.deepEqual((await a.post('/api/chart/lock', body)).body, { ok: true })
  const refused = await b.post('/api/chart/lock', body)
  assert.equal(refused.body.ok, false)
  assert.equal(refused.body.held, true)
  assert.equal(refused.body.mine, false)
  assert.match(refused.body.holder.name, /Test User/)

  // Heartbeat keeps A's lock; B's heartbeat is a no-op.
  assert.equal((await a.patch('/api/chart/lock', body)).body.ok, true)
  assert.equal((await b.patch('/api/chart/lock', body)).body.ok, false)

  // GET /api/chart carries the lock, flagged mine only for the holder.
  assert.equal((await a.get(`/api/chart?${q}`)).body.lock.mine, true)
  assert.equal((await b.get(`/api/chart?${q}`)).body.lock.mine, false)

  // A releases; B sees it free and takes it.
  await a.delete(`/api/chart/lock?${q}`)
  assert.equal((await b.get(`/api/chart/lock?${q}`)).body.held, false)
  assert.equal((await b.post('/api/chart/lock', body)).body.ok, true)

  // A lock whose heartbeat has gone stale can be overwritten by anyone.
  await pool.query("UPDATE chart_locks SET heartbeat_at = NOW() - interval '5 minutes'")
  assert.equal((await a.post('/api/chart/lock', body)).body.ok, true)
  assert.equal((await b.get(`/api/chart/lock?${q}`)).body.mine, false)
})

test('PATCH /api/chart/complete: marks a brand-new chart complete, round-trips through GET, and clears', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const body = { floor: FLOOR, ward: WARD, date: DATE, slot: 'main' }

  const marked = await client.patch('/api/chart/complete', { ...body, completed: true })
  assert.equal(marked.status, 200)
  assert.equal(marked.body.ok, true)
  assert.ok(marked.body.completedAt)
  assert.match(marked.body.completedByName, /Test User/)

  const fetched = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}&slot=main`)
  assert.ok(fetched.body.chart.completedAt)
  assert.match(fetched.body.chart.completedByName, /Test User/)

  const cleared = await client.patch('/api/chart/complete', { ...body, completed: false })
  assert.equal(cleared.body.completedAt, null)
  const refetched = await client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}&slot=main`)
  assert.equal(refetched.body.chart.completedAt, null)
})

test('PATCH /api/chart/complete: marking complete before any save still lets that first save succeed at expectedVersion 0', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  await client.patch('/api/chart/complete', { floor: FLOOR, ward: WARD, date: DATE, slot: 'main', completed: true })
  const saved = await client.put('/api/chart', buildChartBody())
  assert.equal(saved.status, 200)
  assert.equal(saved.body.version, 1)
})

test('PATCH /api/chart/complete: refuses an anonymous request and one for an unassigned floor', async () => {
  const anon = new ApiClient(baseUrl)
  const anonResponse = await anon.patch('/api/chart/complete', { floor: FLOOR, ward: WARD, date: DATE, slot: 'main', completed: true })
  assert.equal(anonResponse.status, 401)

  const client = await loginAs({ role: 'user', floor: OTHER_FLOOR })
  const wrongFloor = await client.patch('/api/chart/complete', { floor: FLOOR, ward: WARD, date: DATE, slot: 'main', completed: true })
  assert.equal(wrongFloor.status, 403)
})
