import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(() => resetDatabase())

const loginAs = async (userOptions) => {
  const user = await createUser(userOptions)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}

// A chart with one patient, one column and one quantity, so the cascade has something to drop.
const seedChart = async ({ floor, ward, date, createdBy }) => {
  const wardRow = (await pool.query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, $3) RETURNING id', [floor, ward, floor === null])).rows[0]
  const chartRow = (await pool.query('INSERT INTO daily_charts (ward_id, chart_date, created_by, updated_by, version) VALUES ($1, $2, $3, $3, 1) RETURNING id', [wardRow.id, date, createdBy])).rows[0]
  await pool.query("INSERT INTO chart_patients (chart_id, row_number, patient_name) VALUES ($1, 1, 'مريض')", [chartRow.id])
  await pool.query('INSERT INTO chart_columns (chart_id, column_number, custom_name) VALUES ($1, 1, $2)', [chartRow.id, 'Med'])
  await pool.query('INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) VALUES ($1, 1, 1, 3)', [chartRow.id])
  await pool.query("INSERT INTO pill_entries (chart_id, patient_row_number, medicine_key, dose_time, usage_method, note) VALUES ($1, 1, 'med', '', '', '')", [chartRow.id])
  return chartRow.id
}
const chartCount = async () => (await pool.query('SELECT COUNT(*)::int AS c FROM daily_charts')).rows[0].c

test('POST /api/charts/purge: only a manager may call it', async () => {
  const anon = new ApiClient(baseUrl)
  assert.equal((await anon.post('/api/charts/purge', { from: '2026-01-01', to: '2026-01-31', all: true })).status, 403)

  const plainUser = await loginAs({ role: 'user', floor: 5 })
  assert.equal((await plainUser.post('/api/charts/purge', { from: '2026-01-01', to: '2026-01-31', all: true })).status, 403)

  const supervisor = await loginAs({ role: 'supervisor' })
  assert.equal((await supervisor.post('/api/charts/purge', { from: '2026-01-01', to: '2026-01-31', all: true })).status, 200)
})

test('POST /api/charts/purge: rejects a bad range or an empty target', async () => {
  const manager = await loginAs({ role: 'admin' })
  assert.equal((await manager.post('/api/charts/purge', { to: '2026-01-31', all: true })).status, 400)
  assert.equal((await manager.post('/api/charts/purge', { from: 'nope', to: '2026-01-31', all: true })).status, 400)
  assert.equal((await manager.post('/api/charts/purge', { from: '2026-02-01', to: '2026-01-01', all: true })).status, 400)
  // Neither `all` nor any floor/ward selected.
  assert.equal((await manager.post('/api/charts/purge', { from: '2026-01-01', to: '2026-01-31', floors: [], wards: [] })).status, 400)
  // Unknown floor numbers alone still count as "nothing selected".
  assert.equal((await manager.post('/api/charts/purge', { from: '2026-01-01', to: '2026-01-31', floors: [99] })).status, 400)
})

test('POST /api/charts/purge: deletes only charts inside the range on the chosen floors/wards, and cascades', async () => {
  const user = await createUser({ role: 'user', floor: 5 })
  const inFloor5 = await seedChart({ floor: 5, ward: 'ردهة رجال', date: '2026-05-10', createdBy: user.id })
  await seedChart({ floor: 5, ward: 'ردهة النساء', date: '2026-05-15', createdBy: user.id })
  const outOfRange = await seedChart({ floor: 5, ward: 'ردهة الخاص', date: '2026-06-01', createdBy: user.id })
  const otherFloor = await seedChart({ floor: 3, ward: 'ردهة CCU', date: '2026-05-12', createdBy: user.id })
  const specialWard = await seedChart({ floor: null, ward: 'ردهة الديلزة', date: '2026-05-12', createdBy: user.id })

  const manager = await loginAs({ role: 'admin' })
  const response = await manager.post('/api/charts/purge', { from: '2026-05-01', to: '2026-05-31', floors: [5], wards: ['ردهة الديلزة'] })
  assert.equal(response.status, 200)
  assert.equal(response.body.deleted, 3) // two floor-5 charts in May + the special ward

  const survivors = (await pool.query('SELECT id FROM daily_charts ORDER BY id')).rows.map((r) => Number(r.id))
  assert.deepEqual(survivors, [outOfRange, otherFloor].map(Number).sort((a, b) => a - b))
  // The cascade removed the children of every deleted chart.
  assert.equal((await pool.query('SELECT COUNT(*)::int AS c FROM chart_quantities WHERE chart_id = $1', [inFloor5])).rows[0].c, 0)
  assert.equal((await pool.query('SELECT COUNT(*)::int AS c FROM pill_entries WHERE chart_id = $1', [specialWard])).rows[0].c, 0)
  // A non-deleted chart keeps its rows.
  assert.equal((await pool.query('SELECT COUNT(*)::int AS c FROM chart_quantities WHERE chart_id = $1', [otherFloor])).rows[0].c, 1)
})

test('POST /api/charts/purge: all=true clears every ward in the range, numbered and special alike', async () => {
  const user = await createUser({ role: 'user', floor: 5 })
  await seedChart({ floor: 2, ward: 'ردهة رجال', date: '2026-07-05', createdBy: user.id })
  await seedChart({ floor: null, ward: 'ردهة الخدج', date: '2026-07-20', createdBy: user.id })
  await seedChart({ floor: 9, ward: 'الردهة الرابعة', date: '2026-08-02', createdBy: user.id }) // outside range

  const manager = await loginAs({ role: 'admin' })
  const response = await manager.post('/api/charts/purge', { from: '2026-07-01', to: '2026-07-31', all: true })
  assert.equal(response.status, 200)
  assert.equal(response.body.deleted, 2)
  assert.equal(await chartCount(), 1)
})
