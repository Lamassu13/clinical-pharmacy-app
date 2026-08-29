import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import helmet from 'helmet'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import 'dotenv/config'
import { checkDatabase, pool, query } from './db.js'
import { authenticateUser, requireAdmin, requireAuth } from './auth.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const projectRoot = path.dirname(fileURLToPath(import.meta.url))

app.use(helmet())
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }))
app.use(express.json({ limit: '100kb' }))
const PgSession = connectPgSimple(session)
app.use(session({ store: new PgSession({ pool, createTableIfMissing: true }), secret: process.env.SESSION_SECRET || 'development-only-change-me', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 } }))

app.post('/api/auth/login', async (request, response) => {
  try {
    const user = await authenticateUser(request.body.username, request.body.password)
    if (!user) return response.status(401).json({ message: 'بيانات الدخول غير صحيحة أو الحساب غير فعال' })
    request.session.user = user
    response.json({ user })
  } catch (error) { response.status(500).json({ message: 'تعذر تسجيل الدخول', error: error.message }) }
})
app.post('/api/auth/logout', (request, response) => request.session.destroy(() => response.status(204).end()))
app.get('/api/auth/me', (request, response) => response.json({ user: request.session.user || null }))

app.get('/api/medicines', requireAuth, async (_request, response) => {
  const result = await query('SELECT id, name FROM medicines ORDER BY name ASC')
  response.json({ medicines: result.rows })
})
app.post('/api/medicines', requireAuth, async (request, response) => {
  const name = String(request.body.name || '').trim()
  if (!name) return response.status(400).json({ message: 'اسم العلاج مطلوب' })
  const result = await query('INSERT INTO medicines (name, created_by) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id, name', [name, request.session.user.id])
  response.status(201).json({ medicine: result.rows[0] })
})

app.get('/api/access', requireAdmin, async (_request, response) => {
  const result = await query('SELECT u.id, u.username, u.full_name, ufa.floor_number FROM users u LEFT JOIN user_floor_access ufa ON ufa.user_id = u.id ORDER BY u.full_name')
  response.json({ access: result.rows })
})
app.put('/api/access/:userId', requireAdmin, async (request, response) => {
  const floor = Number(request.body.floor)
  if (![2, 3, 4, 5, 6, 8, 9, 10].includes(floor)) return response.status(400).json({ message: 'الطابق غير مسموح' })
  await query('INSERT INTO user_floor_access (user_id, floor_number, assigned_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, floor_number) DO UPDATE SET assigned_at = NOW()', [request.params.userId, floor, request.session.user.id])
  response.json({ ok: true })
})
app.put('/api/access/by-username', requireAdmin, async (request, response) => {
  const floor = Number(request.body.floor)
  if (![2, 3, 4, 5, 6, 8, 9, 10].includes(floor)) return response.status(400).json({ message: 'الطابق غير مسموح' })
  const userResult = await query('SELECT id FROM users WHERE username = $1 OR email = $1', [String(request.body.username || '').trim()])
  if (!userResult.rows[0]) return response.status(404).json({ message: 'المستخدم غير موجود' })
  await query('INSERT INTO user_floor_access (user_id, floor_number, assigned_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, floor_number) DO UPDATE SET assigned_at = NOW()', [userResult.rows[0].id, floor, request.session.user.id])
  response.json({ ok: true })
})

app.get('/api/charts/:wardId/:date', requireAuth, async (request, response) => {
  const result = await query('SELECT * FROM daily_charts WHERE ward_id = $1 AND chart_date = $2', [request.params.wardId, request.params.date])
  response.json({ chart: result.rows[0] || null })
})
app.get('/api/chart', requireAuth, async (request, response) => {
  const floor = request.query.floor ? Number(request.query.floor) : null
  const wardName = String(request.query.ward || '').trim()
  const chartDate = request.query.date
  const wardResult = await query('SELECT id, floor_number, name FROM wards WHERE floor_number IS NOT DISTINCT FROM $1 AND name = $2', [floor, wardName])
  if (!wardResult.rows[0]) return response.json({ chart: null })
  const chartResult = await query('SELECT id FROM daily_charts WHERE ward_id = $1 AND chart_date = $2', [wardResult.rows[0].id, chartDate])
  if (!chartResult.rows[0]) return response.json({ chart: null })
  const chartId = chartResult.rows[0].id
  const [patients, columns, quantities] = await Promise.all([
    query('SELECT row_number, patient_name FROM chart_patients WHERE chart_id = $1 ORDER BY row_number', [chartId]),
    query('SELECT cc.column_number, cc.medicine_id, m.name AS medicine_name FROM chart_columns cc LEFT JOIN medicines m ON m.id = cc.medicine_id WHERE cc.chart_id = $1 ORDER BY cc.column_number', [chartId]),
    query('SELECT row_number, column_number, quantity FROM chart_quantities WHERE chart_id = $1', [chartId]),
  ])
  response.json({ chart: { patients: patients.rows, columns: columns.rows, quantities: quantities.rows } })
})
app.put('/api/chart', requireAuth, async (request, response) => {
  const floor = request.body.floor ? Number(request.body.floor) : null
  const wardName = String(request.body.ward || '').trim()
  const chartDate = request.body.date
  const patients = Array.isArray(request.body.patients) ? request.body.patients : []
  const columns = Array.isArray(request.body.columns) ? request.body.columns : []
  const quantities = Array.isArray(request.body.quantities) ? request.body.quantities : []
  if (!wardName || !chartDate) return response.status(400).json({ message: 'بيانات الردهة والتاريخ مطلوبة' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const wardResult = await client.query('INSERT INTO wards (floor_number, name) VALUES ($1, $2) ON CONFLICT (floor_number, name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [floor, wardName])
    const chartResult = await client.query('INSERT INTO daily_charts (ward_id, chart_date, created_by, updated_by) VALUES ($1, $2, $3, $3) ON CONFLICT (ward_id, chart_date) DO UPDATE SET updated_by = EXCLUDED.updated_by, updated_at = NOW() RETURNING id', [wardResult.rows[0].id, chartDate, request.session.user.id])
    const chartId = chartResult.rows[0].id
    await client.query('DELETE FROM chart_patients WHERE chart_id = $1', [chartId])
    await client.query('DELETE FROM chart_columns WHERE chart_id = $1', [chartId])
    await client.query('DELETE FROM chart_quantities WHERE chart_id = $1', [chartId])
    for (const patient of patients) await client.query('INSERT INTO chart_patients (chart_id, row_number, patient_name) VALUES ($1, $2, $3)', [chartId, patient.rowNumber, patient.name || ''])
    for (const column of columns) {
      let medicineId = null
      if (column.medicineName) {
        const medicineResult = await client.query('INSERT INTO medicines (name, created_by) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [column.medicineName, request.session.user.id])
        medicineId = medicineResult.rows[0].id
      }
      await client.query('INSERT INTO chart_columns (chart_id, column_number, medicine_id) VALUES ($1, $2, $3)', [chartId, column.columnNumber, medicineId])
    }
    for (const quantity of quantities) await client.query('INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) VALUES ($1, $2, $3, $4)', [chartId, quantity.rowNumber, quantity.columnNumber, quantity.quantity])
    await client.query('COMMIT')
    response.json({ ok: true, chartId })
  } catch (error) { await client.query('ROLLBACK'); response.status(400).json({ message: 'تعذر حفظ الجارت', error: error.message }) } finally { client.release() }
})
app.put('/api/charts/:wardId/:date', requireAuth, async (request, response) => {
  const wardId = Number(request.params.wardId)
  const chartDate = request.params.date
  const patients = Array.isArray(request.body.patients) ? request.body.patients : []
  const columns = Array.isArray(request.body.columns) ? request.body.columns : []
  const quantities = Array.isArray(request.body.quantities) ? request.body.quantities : []
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const chartResult = await client.query('INSERT INTO daily_charts (ward_id, chart_date, created_by, updated_by) VALUES ($1, $2, $3, $3) ON CONFLICT (ward_id, chart_date) DO UPDATE SET updated_by = EXCLUDED.updated_by, updated_at = NOW() RETURNING id', [wardId, chartDate, request.session.user.id])
    const chartId = chartResult.rows[0].id
    await client.query('DELETE FROM chart_patients WHERE chart_id = $1', [chartId])
    await client.query('DELETE FROM chart_columns WHERE chart_id = $1', [chartId])
    await client.query('DELETE FROM chart_quantities WHERE chart_id = $1', [chartId])
    for (const patient of patients) await client.query('INSERT INTO chart_patients (chart_id, row_number, patient_name) VALUES ($1, $2, $3)', [chartId, patient.rowNumber, patient.name || ''])
    for (const column of columns) await client.query('INSERT INTO chart_columns (chart_id, column_number, medicine_id) VALUES ($1, $2, $3)', [chartId, column.columnNumber, column.medicineId || null])
    for (const quantity of quantities) await client.query('INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) VALUES ($1, $2, $3, $4)', [chartId, quantity.rowNumber, quantity.columnNumber, quantity.quantity])
    await client.query('COMMIT')
    response.json({ ok: true, chartId })
  } catch (error) {
    await client.query('ROLLBACK')
    response.status(400).json({ message: 'تعذر حفظ الجارت', error: error.message })
  } finally { client.release() }
})

app.get('/api/health', async (_request, response) => {
  try {
    const database = await checkDatabase()
    response.json({ ok: true, database: 'connected', serverTime: database.server_time })
  } catch (error) {
    response.status(503).json({ ok: false, database: 'unavailable', message: error.message })
  }
})

app.use(express.static(path.join(projectRoot, '..', 'dist')))
app.use((request, response, next) => {
  if (request.path.startsWith('/api/')) return next()
  response.sendFile(path.join(projectRoot, '..', 'dist', 'index.html'))
})

app.listen(port, () => {
  console.log(`Clinical Pharmacy API listening on http://localhost:${port}`)
})
