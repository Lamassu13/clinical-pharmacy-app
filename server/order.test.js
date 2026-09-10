import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'
import { numberToArabicWords } from './arabic-number.js'

const FLOOR = 5
const WARD = 'ردهة رجال'
const DATE = '2026-05-20'

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

const makeWard = async () => (await pool.query(
  'INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, false) RETURNING id', [FLOOR, WARD])).rows[0].id

// Direct chart seed on a given ward: columns = [{ n, medicineId?, customName? }], cells = [{ row, col, qty }].
const seedChart = async ({ wardId, slot = 'main', createdBy, columns, cells, patients = [1, 2] }) => {
  const chartId = (await pool.query(
    'INSERT INTO daily_charts (ward_id, chart_date, slot, created_by, updated_by, version) VALUES ($1, $2, $3, $4, $4, 1) RETURNING id',
    [wardId, DATE, slot, createdBy],
  )).rows[0].id
  for (const r of patients) await pool.query('INSERT INTO chart_patients (chart_id, row_number, patient_name) VALUES ($1, $2, $3)', [chartId, r, `مريض ${r}`])
  for (const c of columns) await pool.query('INSERT INTO chart_columns (chart_id, column_number, medicine_id, custom_name) VALUES ($1, $2, $3, $4)', [chartId, c.n, c.medicineId ?? null, c.customName ?? null])
  for (const cell of cells) await pool.query('INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) VALUES ($1, $2, $3, $4)', [chartId, cell.row, cell.col, cell.qty])
  return chartId
}

test('GET /api/order: one line per medicine, summed over the MAIN chart only, with Arabic words', async () => {
  const seeder = await createUser({ role: 'admin' })
  const med = (await pool.query("INSERT INTO medicines (name) VALUES ('Paracetamol 500mg Tab') RETURNING id")).rows[0].id
  const wardId = await makeWard()

  // main: col1 linked Paracetamol (10 + 8); col2 custom, same spelling (+5 → combines);
  //       col3 custom "Vitamin C" totals 0 → dropped; col4 blank name → dropped.
  await seedChart({
    wardId, slot: 'main', createdBy: seeder.id,
    columns: [{ n: 1, medicineId: med }, { n: 2, customName: 'Paracetamol 500mg Tab' }, { n: 3, customName: 'Vitamin C' }, { n: 4, customName: '' }],
    cells: [{ row: 1, col: 1, qty: 10 }, { row: 2, col: 1, qty: 8 }, { row: 1, col: 2, qty: 5 }, { row: 1, col: 3, qty: 0 }, { row: 2, col: 3, qty: 0 }],
  })
  // An extra-slot chart on the same ward/date must not be counted.
  await seedChart({ wardId, slot: 'extra', createdBy: seeder.id, columns: [{ n: 1, medicineId: med }], cells: [{ row: 1, col: 1, qty: 999 }] })

  const client = await loginAs({ role: 'user', floor: FLOOR })
  const res = await client.get(`/api/order?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.order.items, [
    { name: 'Paracetamol 500mg Tab', quantity: 23, quantityWords: 'ثلاثة وعشرون' },
  ])
})

test('GET /api/order: auth required, ward access enforced, missing chart is empty', async () => {
  const anon = new ApiClient(baseUrl)
  assert.equal((await anon.get(`/api/order?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)).status, 401)

  const outsider = await loginAs({ role: 'user', floor: 6 })
  assert.equal((await outsider.get(`/api/order?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)).status, 403)

  const insider = await loginAs({ role: 'user', floor: FLOOR })
  const res = await insider.get(`/api/order?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${DATE}`)
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.order.items, [])
})

test('numberToArabicWords: spells the quantities a requisition needs', () => {
  const cases = [
    [0, 'صفر'], [1, 'واحد'], [2, 'اثنان'], [3, 'ثلاثة'], [11, 'أحد عشر'], [20, 'عشرون'],
    [23, 'ثلاثة وعشرون'], [48, 'ثمانية وأربعون'], [100, 'مئة'], [200, 'مئتان'], [215, 'مئتان وخمسة عشر'],
    [1000, 'ألف'], [2000, 'ألفان'], [2026, 'ألفان وستة وعشرون'], [3000, 'ثلاثة آلاف'], [40320, 'أربعون ألفًا وثلاثمئة وعشرون'],
  ]
  for (const [n, want] of cases) assert.equal(numberToArabicWords(n), want, `${n}`)
})
