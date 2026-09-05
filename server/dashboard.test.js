import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

const DATE = '2026-04-01'
const OTHER_DATE = '2026-04-02'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(() => resetDatabase())

const loginAs = async (userOptions) => {
  const user = await createUser(userOptions)
  const client = new ApiClient(baseUrl)
  const login = await client.post('/api/auth/login', { username: user.username, password: user.password })
  assert.equal(login.status, 200, 'test setup: login must succeed')
  return client
}

// Seeds one chart directly (bypassing the API) so the dashboard aggregation has real rows
// to read, independent of the chart-save logic already covered by chart.test.js.
const seedChart = async ({ floor, ward, date, createdBy, columns, quantities }) => {
  const wardRow = (await pool.query(
    'INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, $3) RETURNING id',
    [floor, ward, floor === null],
  )).rows[0]
  const chartRow = (await pool.query(
    'INSERT INTO daily_charts (ward_id, chart_date, created_by, updated_by, version) VALUES ($1, $2, $3, $3, 1) RETURNING id',
    [wardRow.id, date, createdBy],
  )).rows[0]
  for (const column of columns) {
    await pool.query('INSERT INTO chart_columns (chart_id, column_number, medicine_id, custom_name) VALUES ($1, $2, $3, $4)', [chartRow.id, column.columnNumber, column.medicineId ?? null, column.customName ?? null])
  }
  for (const quantity of quantities) {
    await pool.query('INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) VALUES ($1, $2, $3, $4)', [chartRow.id, quantity.rowNumber, quantity.columnNumber, quantity.quantity])
  }
  return chartRow.id
}

test('GET /api/dashboard: refuses an anonymous request and a missing/malformed date', async () => {
  const anon = new ApiClient(baseUrl)
  const anonResponse = await anon.get(`/api/dashboard?date=${DATE}`)
  assert.equal(anonResponse.status, 401)

  const client = await loginAs({ role: 'user' })
  const noDate = await client.get('/api/dashboard')
  assert.equal(noDate.status, 400)
  const badDate = await client.get('/api/dashboard?date=2026-13-40')
  assert.equal(badDate.status, 400)
})

test('GET /api/dashboard: reports which wards have a chart on the given date, and only that date', async () => {
  const user = await createUser({ role: 'user' })
  await seedChart({ floor: 5, ward: 'ردهة رجال', date: DATE, createdBy: user.id, columns: [], quantities: [] })
  await seedChart({ floor: null, ward: 'ردهة الديلزة', date: DATE, createdBy: user.id, columns: [], quantities: [] })
  // A chart on a different date must not count toward DATE's status.
  await seedChart({ floor: 3, ward: 'ردهة CCU', date: OTHER_DATE, createdBy: user.id, columns: [], quantities: [] })

  const client = await loginAs({ role: 'admin' })
  const response = await client.get(`/api/dashboard?date=${DATE}`)
  assert.equal(response.status, 200)
  const started = response.body.startedWards
  assert.equal(started.length, 2)
  assert.ok(started.some((item) => item.floor === 5 && item.ward === 'ردهة رجال'))
  assert.ok(started.some((item) => item.floor === null && item.ward === 'ردهة الديلزة'))
  assert.ok(!started.some((item) => item.ward === 'ردهة CCU'))
})

test('GET /api/dashboard: ranks medicines by total quantity across every ward on that date, using the catalogue name or the free-text column name', async () => {
  const user = await createUser({ role: 'user' })
  const medicine = (await pool.query("INSERT INTO medicines (name) VALUES ('Amoxicillin Cap') RETURNING id")).rows[0]

  await seedChart({
    floor: 5, ward: 'ردهة رجال', date: DATE, createdBy: user.id,
    columns: [{ columnNumber: 1, medicineId: medicine.id }, { columnNumber: 2, customName: 'Custom Syrup' }],
    quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 5 }, { rowNumber: 2, columnNumber: 1, quantity: 3 }, { rowNumber: 1, columnNumber: 2, quantity: 2 }],
  })
  await seedChart({
    floor: 6, ward: 'الوحدة الأولى', date: DATE, createdBy: user.id,
    columns: [{ columnNumber: 1, medicineId: medicine.id }],
    quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 10 }],
  })
  // A zero quantity must not count, and a different date must not contribute at all.
  await seedChart({
    floor: 8, ward: 'ردهة الخاص', date: DATE, createdBy: user.id,
    columns: [{ columnNumber: 1, medicineId: medicine.id }],
    quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 0 }],
  })

  const client = await loginAs({ role: 'admin' })
  const response = await client.get(`/api/dashboard?date=${DATE}`)
  assert.equal(response.status, 200)
  const byName = Object.fromEntries(response.body.topMedicines.map((item) => [item.name, item.quantity]))
  assert.equal(byName['Amoxicillin Cap'], 18) // 5 + 3 + 10, the zero-quantity row excluded
  assert.equal(byName['Custom Syrup'], 2)
  assert.equal(response.body.topMedicines[0].name, 'Amoxicillin Cap', 'the highest total must be ranked first')
})

test('GET/POST/DELETE /api/announcements: a plain user can only read; a manager can post and remove', async () => {
  const anon = new ApiClient(baseUrl)
  assert.equal((await anon.get('/api/announcements')).status, 401)
  // requireManager (like requireAdmin elsewhere) checks the role directly rather than first
  // checking for a session, so an anonymous request gets 403, not 401 — matches every other
  // requireManager/requireAdmin route in this app.
  assert.equal((await anon.post('/api/announcements', { message: 'x' })).status, 403)

  const plainUser = await loginAs({ role: 'user' })
  assert.equal((await plainUser.get('/api/announcements')).status, 200)
  const forbidden = await plainUser.post('/api/announcements', { message: 'محاولة من مستخدم عادي' })
  assert.equal(forbidden.status, 403)

  const manager = await loginAs({ role: 'supervisor' })
  const empty = await manager.get('/api/announcements')
  assert.deepEqual(empty.body.announcements, [])

  const blank = await manager.post('/api/announcements', { message: '   ' })
  assert.equal(blank.status, 400)

  const created = await manager.post('/api/announcements', { message: 'الرجاء التأكد من مطابقة الأسماء' })
  assert.equal(created.status, 201)
  assert.equal(created.body.announcement.message, 'الرجاء التأكد من مطابقة الأسماء')
  assert.ok(created.body.announcement.author_name)

  const listed = await plainUser.get('/api/announcements')
  assert.equal(listed.body.announcements.length, 1)
  assert.equal(listed.body.announcements[0].id, created.body.announcement.id)

  const deniedDelete = await plainUser.delete(`/api/announcements/${created.body.announcement.id}`)
  assert.equal(deniedDelete.status, 403)

  const deleted = await manager.delete(`/api/announcements/${created.body.announcement.id}`)
  assert.equal(deleted.status, 200)
  const afterDelete = await plainUser.get('/api/announcements')
  assert.deepEqual(afterDelete.body.announcements, [])

  const missing = await manager.delete('/api/announcements/999999')
  assert.equal(missing.status, 404)
})

test('DELETE /api/users/:id: does not fail on a user who posted an announcement', async () => {
  const manager = await loginAs({ role: 'admin' })
  const author = await createUser({ role: 'user' })
  await pool.query("INSERT INTO announcements (message, created_by) VALUES ('إعلان', $1)", [author.id])

  const response = await manager.delete(`/api/users/${author.id}`)
  assert.equal(response.status, 200)
  const row = await pool.query('SELECT created_by FROM announcements')
  assert.equal(row.rows[0].created_by, null)
})
