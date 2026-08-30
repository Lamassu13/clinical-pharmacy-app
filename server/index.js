import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import helmet from 'helmet'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import 'dotenv/config'
import { checkDatabase, pool, query } from './db.js'
import { authenticateUser, requireAdmin, requireAuth } from './auth.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const isProduction = process.env.NODE_ENV === 'production'

app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(helmet({ hsts: { maxAge: 31536000, includeSubDomains: true, preload: true } }))
// Force HTTPS behind the platform's TLS-terminating proxy
app.use((request, response, next) => {
  if (isProduction && request.headers['x-forwarded-proto'] === 'http') {
    return response.redirect(308, `https://${request.headers.host}${request.originalUrl}`)
  }
  next()
})
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }))
app.use(express.json({ limit: '2mb' }))
const PgSession = connectPgSimple(session)
app.use(session({
  name: 'cpa.sid',
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'development-only-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 8 * 60 * 60 * 1000 },
}))

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, skipSuccessfulRequests: true, message: { message: 'محاولات كثيرة، حاول لاحقًا بعد ١٥ دقيقة' } })
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { message: 'محاولات كثيرة لإنشاء حساب، حاول لاحقًا' } })
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false })
app.use('/api/', apiLimiter)

const ALLOWED_FLOORS = [2, 3, 4, 5, 6, 8, 9, 10]
const canAccessFloor = (user, floor) => user.role === 'admin' || (Number.isInteger(floor) && floor === user.assignedFloor)
const clampInt = (value, min, max) => {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}
const isIsoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
const cleanText = (value, maxLength) => String(value ?? '').slice(0, maxLength)

app.post('/api/auth/login', loginLimiter, async (request, response) => {
  try {
    const user = await authenticateUser(request.body.username, request.body.password)
    if (!user) return response.status(401).json({ message: 'بيانات الدخول غير صحيحة أو الحساب غير فعال' })
    request.session.user = user
    response.json({ user })
  } catch (error) { console.error('login failed:', error); response.status(500).json({ message: 'تعذر تسجيل الدخول' }) }
})
app.post('/api/auth/register', registerLimiter, async (request, response) => {
  const fullName = String(request.body.fullName || '').trim()
  const username = String(request.body.username || '').trim()
  const phone = String(request.body.phone || '').trim()
  const email = String(request.body.email || '').trim().toLowerCase()
  const fingerprintNumber = String(request.body.fingerprintNumber || '').trim()
  const password = String(request.body.password || '')
  if (!fullName || !username || !phone || !email || !fingerprintNumber || password.length < 6) {
    return response.status(400).json({ message: 'يرجى ملء جميع الحقول وكلمة مرور لا تقل عن ٦ أحرف' })
  }
  if (fullName.length > 120 || username.length > 60 || phone.length > 30 || email.length > 160 || fingerprintNumber.length > 40 || password.length > 200) {
    return response.status(400).json({ message: 'إحدى القيم أطول من المسموح' })
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) return response.status(400).json({ message: 'اسم المستخدم يقبل الحروف والأرقام و . _ - فقط' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ message: 'صيغة البريد الإلكتروني غير صحيحة' })
  if (!/^[0-9+()\s-]{5,30}$/.test(phone)) return response.status(400).json({ message: 'صيغة رقم الهاتف غير صحيحة' })
  try {
    const passwordHash = await bcrypt.hash(password, 12)
    await query('INSERT INTO users (full_name, username, phone, email, fingerprint_number, password_hash) VALUES ($1, $2, $3, $4, $5, $6)', [fullName, username, phone, email, fingerprintNumber, passwordHash])
    response.status(201).json({ message: 'تم إنشاء الحساب، بانتظار موافقة المدير' })
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ message: 'اسم المستخدم أو البريد الإلكتروني مستخدم بالفعل' })
    console.error('register failed:', error)
    response.status(500).json({ message: 'تعذر إنشاء الحساب' })
  }
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

app.get('/api/registrations', requireAdmin, async (_request, response) => {
  const result = await query("SELECT id, full_name, username, phone, email, fingerprint_number, created_at FROM users WHERE account_status = 'pending' ORDER BY created_at ASC")
  response.json({ registrations: result.rows })
})
app.put('/api/registrations/:id', requireAdmin, async (request, response) => {
  const status = request.body.status
  const id = Number(request.params.id)
  const floor = Number(request.body.floor)
  if (!['active', 'rejected'].includes(status)) return response.status(400).json({ message: 'الحالة غير صحيحة' })
  if (!Number.isInteger(id) || id < 1) return response.status(400).json({ message: 'معرّف غير صحيح' })
  if (status === 'active' && !ALLOWED_FLOORS.includes(floor)) return response.status(400).json({ message: 'يجب اختيار طابق صحيح عند قبول الطلب' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query("UPDATE users SET account_status = $1, approved_at = NOW(), approved_by = $2 WHERE id = $3 AND account_status = 'pending' RETURNING id", [status, request.session.user.id, id])
    if (!result.rows[0]) { await client.query('ROLLBACK'); return response.status(404).json({ message: 'الطلب غير موجود أو تمت معالجته' }) }
    if (status === 'active') {
      await client.query('INSERT INTO user_floor_access (user_id, floor_number, assigned_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, floor_number) DO UPDATE SET assigned_at = NOW()', [id, floor, request.session.user.id])
    }
    await client.query('COMMIT')
    response.json({ ok: true })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('registration decision failed:', error)
    response.status(500).json({ message: 'تعذر تحديث الطلب' })
  } finally { client.release() }
})

app.get('/api/users', requireAdmin, async (_request, response) => {
  const result = await query(`SELECT u.id, u.full_name, u.username, u.email, u.phone, u.role, u.account_status,
    COALESCE(array_agg(ufa.floor_number ORDER BY ufa.floor_number) FILTER (WHERE ufa.floor_number IS NOT NULL), '{}') AS floors
    FROM users u LEFT JOIN user_floor_access ufa ON ufa.user_id = u.id
    GROUP BY u.id ORDER BY u.created_at DESC`)
  response.json({ users: result.rows })
})
app.delete('/api/users/:id', requireAdmin, async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isInteger(id) || id < 1) return response.status(400).json({ message: 'معرّف غير صحيح' })
  if (id === Number(request.session.user.id)) return response.status(400).json({ message: 'لا يمكنك حذف حسابك الخاص' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const target = await client.query('SELECT role FROM users WHERE id = $1', [id])
    if (!target.rows[0]) { await client.query('ROLLBACK'); return response.status(404).json({ message: 'المستخدم غير موجود' }) }
    if (target.rows[0].role === 'admin') {
      const admins = await client.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'")
      if (admins.rows[0].count <= 1) { await client.query('ROLLBACK'); return response.status(400).json({ message: 'لا يمكن حذف آخر مدير في النظام' }) }
    }
    const actingAdmin = request.session.user.id
    await client.query('UPDATE users SET approved_by = NULL WHERE approved_by = $1', [id])
    await client.query('UPDATE user_floor_access SET assigned_by = $1 WHERE assigned_by = $2', [actingAdmin, id])
    await client.query('UPDATE daily_charts SET created_by = $1 WHERE created_by = $2', [actingAdmin, id])
    await client.query('UPDATE daily_charts SET updated_by = $1 WHERE updated_by = $2', [actingAdmin, id])
    await client.query('UPDATE medicines SET created_by = NULL WHERE created_by = $1', [id])
    await client.query('DELETE FROM users WHERE id = $1', [id])
    await client.query('COMMIT')
    response.json({ ok: true })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('user delete failed:', error)
    response.status(500).json({ message: 'تعذر حذف المستخدم' })
  } finally { client.release() }
})

app.get('/api/access', requireAdmin, async (_request, response) => {
  const result = await query('SELECT u.id, u.username, u.full_name, ufa.floor_number FROM users u LEFT JOIN user_floor_access ufa ON ufa.user_id = u.id ORDER BY u.full_name')
  response.json({ access: result.rows })
})
app.put('/api/access/by-username', requireAdmin, async (request, response) => {
  const floor = Number(request.body.floor)
  if (![2, 3, 4, 5, 6, 8, 9, 10].includes(floor)) return response.status(400).json({ message: 'الطابق غير مسموح' })
  const userResult = await query('SELECT id FROM users WHERE username = $1 OR email = $1', [String(request.body.username || '').trim()])
  if (!userResult.rows[0]) return response.status(404).json({ message: 'المستخدم غير موجود' })
  await query('INSERT INTO user_floor_access (user_id, floor_number, assigned_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, floor_number) DO UPDATE SET assigned_at = NOW()', [userResult.rows[0].id, floor, request.session.user.id])
  response.json({ ok: true })
})
app.put('/api/access/:userId', requireAdmin, async (request, response) => {
  const floor = Number(request.body.floor)
  const userId = Number(request.params.userId)
  if (![2, 3, 4, 5, 6, 8, 9, 10].includes(floor)) return response.status(400).json({ message: 'الطابق غير مسموح' })
  if (!Number.isInteger(userId) || userId < 1) return response.status(400).json({ message: 'معرّف غير صحيح' })
  await query('INSERT INTO user_floor_access (user_id, floor_number, assigned_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, floor_number) DO UPDATE SET assigned_at = NOW()', [userId, floor, request.session.user.id])
  response.json({ ok: true })
})

app.get('/api/chart', requireAuth, async (request, response) => {
  const floor = request.query.floor ? clampInt(request.query.floor, 2, 10) : null
  const wardName = cleanText(request.query.ward, 120).trim()
  const chartDate = request.query.date
  if (request.query.floor && (floor === null || !ALLOWED_FLOORS.includes(floor))) return response.status(400).json({ message: 'الطابق غير مسموح' })
  if (!wardName || !isIsoDate(chartDate)) return response.status(400).json({ message: 'بيانات الردهة والتاريخ مطلوبة' })
  if (!canAccessFloor(request.session.user, floor)) return response.status(403).json({ message: 'لا تملك صلاحية لهذه الردهة' })
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
  const floor = request.body.floor ? clampInt(request.body.floor, 2, 10) : null
  const wardName = cleanText(request.body.ward, 120).trim()
  const chartDate = request.body.date
  if (request.body.floor && (floor === null || !ALLOWED_FLOORS.includes(floor))) return response.status(400).json({ message: 'الطابق غير مسموح' })
  if (!wardName || !isIsoDate(chartDate)) return response.status(400).json({ message: 'بيانات الردهة والتاريخ مطلوبة' })
  if (!canAccessFloor(request.session.user, floor)) return response.status(403).json({ message: 'لا تملك صلاحية لهذه الردهة' })

  const patients = (Array.isArray(request.body.patients) ? request.body.patients : [])
    .map((patient) => ({ rowNumber: clampInt(patient?.rowNumber, 1, 36), name: cleanText(patient?.name, 200) }))
    .filter((patient) => patient.rowNumber !== null)
  const columns = (Array.isArray(request.body.columns) ? request.body.columns : [])
    .map((column) => ({ columnNumber: clampInt(column?.columnNumber, 1, 51), medicineName: cleanText(column?.medicineName, 200).trim() }))
    .filter((column) => column.columnNumber !== null)
  const quantities = (Array.isArray(request.body.quantities) ? request.body.quantities : [])
    .map((entry) => ({ rowNumber: clampInt(entry?.rowNumber, 1, 36), columnNumber: clampInt(entry?.columnNumber, 1, 51), quantity: clampInt(entry?.quantity, 0, 1_000_000) }))
    .filter((entry) => entry.rowNumber !== null && entry.columnNumber !== null && entry.quantity !== null)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const wardResult = await client.query('INSERT INTO wards (floor_number, name) VALUES ($1, $2) ON CONFLICT (floor_number, name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [floor, wardName])
    const chartResult = await client.query('INSERT INTO daily_charts (ward_id, chart_date, created_by, updated_by) VALUES ($1, $2, $3, $3) ON CONFLICT (ward_id, chart_date) DO UPDATE SET updated_by = EXCLUDED.updated_by, updated_at = NOW() RETURNING id', [wardResult.rows[0].id, chartDate, request.session.user.id])
    const chartId = chartResult.rows[0].id
    await client.query('DELETE FROM chart_patients WHERE chart_id = $1', [chartId])
    await client.query('DELETE FROM chart_columns WHERE chart_id = $1', [chartId])
    await client.query('DELETE FROM chart_quantities WHERE chart_id = $1', [chartId])
    for (const patient of patients) await client.query('INSERT INTO chart_patients (chart_id, row_number, patient_name) VALUES ($1, $2, $3)', [chartId, patient.rowNumber, patient.name])
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
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('chart save failed:', error)
    response.status(400).json({ message: 'تعذر حفظ الجارت' })
  } finally { client.release() }
})

app.get('/api/health', async (_request, response) => {
  try {
    const database = await checkDatabase()
    response.json({ ok: true, database: 'connected', serverTime: database.server_time })
  } catch (error) {
    console.error('health check failed:', error)
    response.status(503).json({ ok: false, database: 'unavailable' })
  }
})

app.use(express.static(path.join(projectRoot, '..', 'dist')))
app.use((request, response, next) => {
  if (request.path.startsWith('/api/')) return next()
  response.sendFile(path.join(projectRoot, '..', 'dist', 'index.html'))
})

// eslint-disable-next-line no-unused-vars
app.use((error, request, response, next) => {
  console.error('unhandled error:', error)
  if (response.headersSent) return
  response.status(500).json({ message: 'حدث خطأ غير متوقع' })
})

app.listen(port, () => {
  console.log(`Clinical Pharmacy API listening on http://localhost:${port}`)
})
