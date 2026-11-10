import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool, dbTraffic } from './db.js'
import { forgetSavedCharts, saveFailureStatus } from './routes/chart.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

// The save keeps what it last wrote in memory so it need not read the old rows back (see
// savedCharts in routes/chart.js). That memory feeds the change history only; these tests pin
// that the history is the same with and without it, and that the cached medicine catalogue
// never makes a save drop a column or fail for good.

const FLOOR = 5
const WARD = 'ردهة رجال'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(async () => {
  await resetDatabase()
  await pool.query("INSERT INTO medicines (name) VALUES ('Amoxicillin Cap'), ('Cefixime Tab')")
})

const loginAs = async (userOptions) => {
  const user = await createUser(userOptions)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}
const body = (date, overrides = {}) => ({
  floor: FLOOR, ward: WARD, date, expectedVersion: 0,
  patients: [{ rowNumber: 1, name: 'Patient One' }],
  columns: [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }],
  quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 2 }],
  ...overrides,
})
const chartFor = (client, date) => client.get(`/api/chart?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${date}`)
const returningCalls = () => dbTraffic(Infinity).filter((row) => /^DELETE FROM chart_(patients|quantities) .*RETURNING/.test(row.statement)).reduce((sum, row) => sum + row.calls, 0)

// Two same-named patients on purpose: the history pairs those by order, the easiest thing to get differently.
const steps = [
  { patients: [{ rowNumber: 1, name: 'Ali', patientId: '11' }, { rowNumber: 2, name: 'Twin' }, { rowNumber: 3, name: 'Twin' }, { rowNumber: 4, name: 'Zaid', patientId: '44' }],
    columns: [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }, { columnNumber: 2, medicineName: 'Cefixime Tab' }],
    quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 1 }, { rowNumber: 2, columnNumber: 1, quantity: 2 }, { rowNumber: 3, columnNumber: 2, quantity: 3 }, { rowNumber: 4, columnNumber: 1, quantity: 4 }] },
  { patients: [{ rowNumber: 1, name: 'Ali', patientId: '11' }, { rowNumber: 2, name: 'Twin' }, { rowNumber: 3, name: 'Twin' }, { rowNumber: 4, name: 'Zaid K', patientId: '44' }],
    columns: [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }, { columnNumber: 2, medicineName: 'Cefixime Tab' }],
    quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 1 }, { rowNumber: 2, columnNumber: 1, quantity: 5 }, { rowNumber: 3, columnNumber: 2, quantity: 3 }, { rowNumber: 4, columnNumber: 1, quantity: 4 }] },
  // Ali discharged: every row below moves up one.
  { patients: [{ rowNumber: 1, name: 'Twin' }, { rowNumber: 2, name: 'Twin' }, { rowNumber: 3, name: 'Zaid K', patientId: '44' }],
    columns: [{ columnNumber: 1, medicineName: 'Amoxicillin Cap' }],
    quantities: [{ rowNumber: 1, columnNumber: 1, quantity: 5 }, { rowNumber: 3, columnNumber: 1, quantity: 6 }] },
]
const historyOf = async (date) => (await pool.query(
  `SELECT c.version, c.kind, c.row_number, c.column_number, c.patient, c.medicine, c.old_value, c.new_value
   FROM chart_changes c JOIN daily_charts d ON d.id = c.chart_id WHERE d.chart_date = $1 ORDER BY c.version, c.kind, c.row_number, c.column_number, c.old_value, c.new_value`, [date])).rows

test('history is identical whether a save remembers the last one or reads the old rows back, and remembering sends nothing back', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const before = returningCalls()
  for (const [date, cold] of [['2026-02-01', false], ['2026-02-02', true]]) {
    let version = 0
    for (const step of steps) {
      if (cold) forgetSavedCharts()
      const saved = await client.put('/api/chart', body(date, { ...step, expectedVersion: version }))
      assert.equal(saved.status, 200)
      version = saved.body.version
    }
  }
  assert.deepEqual(await historyOf('2026-02-01'), await historyOf('2026-02-02'))
  assert.ok((await historyOf('2026-02-01')).length > 5, 'test setup: the sequence must have produced history')
  // The first save of a chart has no old rows; of the other four, only the two cold ones read rows
  // back, and each reads two tables (patients, quantities). The warm chart's saves read none.
  assert.equal(returningCalls() - before, 4)
})

test('a column survives a medicine deleted through the app between two saves that use the remembered chart', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  const first = await client.put('/api/chart', body('2026-02-03'))
  const admin = await loginAs({ role: 'admin' })
  const medicineId = (await pool.query("SELECT id FROM medicines WHERE name = 'Amoxicillin Cap'")).rows[0].id
  assert.equal((await admin.delete(`/api/medicines/${medicineId}`)).status, 200)
  const resaved = await client.put('/api/chart', body('2026-02-03', { expectedVersion: first.body.version }))
  assert.equal(resaved.status, 200)
  const chart = (await chartFor(client, '2026-02-03')).body.chart
  assert.deepEqual(chart.columns.map((column) => column.medicine_name), ['Amoxicillin Cap'])
  assert.equal(chart.quantities.length, 1)
})

test('a medicine added straight to the table (not through the app) still links, though the catalogue cache has not seen it', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  await client.get('/api/medicines') // fills the cache without the new one
  await pool.query("INSERT INTO medicines (name) VALUES ('Brand New Syrup')")
  const saved = await client.put('/api/chart', body('2026-02-04', { columns: [{ columnNumber: 1, medicineName: 'Brand New Syrup' }] }))
  assert.equal(saved.status, 200)
  assert.deepEqual((await chartFor(client, '2026-02-04')).body.chart.columns.map((column) => column.medicine_name), ['Brand New Syrup'])
})

test('a medicine deleted straight from the table fails one save, then the retry works against the real table', async () => {
  const client = await loginAs({ role: 'user', floor: FLOOR })
  await client.get('/api/medicines')
  await pool.query("DELETE FROM medicines WHERE name = 'Cefixime Tab'")
  const stale = await client.put('/api/chart', body('2026-02-05', { columns: [{ columnNumber: 1, medicineName: 'Cefixime Tab' }] }))
  assert.equal(stale.status, 400)
  const retry = await client.put('/api/chart', body('2026-02-05', { columns: [{ columnNumber: 1, medicineName: 'Cefixime Tab' }, { columnNumber: 2, medicineName: 'Amoxicillin Cap' }], quantities: [] }))
  assert.equal(retry.status, 200)
  assert.deepEqual((await chartFor(client, '2026-02-05')).body.chart.columns.map((column) => column.medicine_name), ['Amoxicillin Cap'])
})

test('the older of two medicines sharing a name is the one a column links to (ids compared as numbers, not text)', async () => {
  await pool.query("INSERT INTO medicines (name) SELECT 'Padding ' || g FROM generate_series(1, 6) g")
  await pool.query("INSERT INTO medicines (name) VALUES ('Twin Drug')") // id 9; its duplicate below gets 10, which sorts before "9" as text
  const older = (await pool.query("SELECT id FROM medicines WHERE name = 'Twin Drug'")).rows[0].id
  await pool.query("INSERT INTO medicines (name) VALUES ('twin  drug')")
  const client = await loginAs({ role: 'user', floor: FLOOR })
  await client.put('/api/chart', body('2026-02-06', { columns: [{ columnNumber: 1, medicineName: 'Twin Drug' }] }))
  const linked = (await pool.query("SELECT medicine_id FROM chart_columns cc JOIN daily_charts d ON d.id = cc.chart_id WHERE d.chart_date = '2026-02-06'")).rows[0].medicine_id
  assert.equal(String(linked), String(older))
})

test('a failed save answers 400 only when the database refused the data, 500 for its own failures', () => {
  assert.equal(saveFailureStatus({ code: '23503' }), 400) // a broken constraint
  assert.equal(saveFailureStatus({ code: '22001' }), 400) // a value that does not fit
  assert.equal(saveFailureStatus({ code: '57014' }), 500) // a statement timeout
  assert.equal(saveFailureStatus({ code: '08006' }), 500) // the connection failed
  assert.equal(saveFailureStatus(new Error('Connection terminated unexpectedly')), 500)
})
