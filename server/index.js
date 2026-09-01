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
import {
  ALLOWED_FLOORS, MAX_PATIENT_ROWS, SPECIAL_WARDS, isKnownWard, PILL_FORM,
  DOSE_TIMES, USAGE_METHODS, NOTE_OPTIONS, canAccessLocation, clampInt, isIsoDate, cleanText,
} from './validation.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const isProduction = process.env.NODE_ENV === 'production'
const BCRYPT_COST = Number(process.env.BCRYPT_COST || 10)

// A public fallback secret would let anyone forge session cookies, so production
// refuses to boot without a real one rather than starting up quietly insecure.
if (isProduction && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET is required in production. Set it and restart.')
  process.exit(1)
}
if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET is unset — using the development fallback.')
const devClientOrigin = 'http://localhost:5173'
const clientOrigin = process.env.CLIENT_ORIGIN || devClientOrigin

app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(helmet({ hsts: { maxAge: 31536000, includeSubDomains: true, preload: true } }))
// Force HTTPS behind the platform's TLS-terminating proxy. The header can be a
// proxy chain ("http, https") and may be absent, so redirect on anything but https.
app.use((request, response, next) => {
  const proto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  if (isProduction && proto && proto !== 'https') {
    return response.redirect(308, `https://${request.headers.host}${request.originalUrl}`)
  }
  next()
})
app.use(cors({ origin: clientOrigin, credentials: true }))
app.use(express.json({ limit: '512kb' }))
const PgSession = connectPgSimple(session)
app.use(session({
  name: 'cpa.sid',
  store: new PgSession({ pool, createTableIfMissing: true, disableTouch: true }),
  secret: process.env.SESSION_SECRET || 'development-only-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 8 * 60 * 60 * 1000 },
}))

// CSRF defence in depth: SameSite=Lax already blocks cross-site state change, but
// a same-site attacker or a CLIENT_ORIGIN misconfiguration would slip past it.
// Login/register are exempt — they carry no session to abuse.
const CSRF_EXEMPT = new Set(['/api/auth/login', '/api/auth/register'])
app.use((request, response, next) => {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return next()
  if (CSRF_EXEMPT.has(request.path)) return next()
  const source = request.headers.origin || request.headers.referer
  if (!source) {
    if (!isProduction) return next()
    return response.status(403).json({ message: 'طلب غير موثوق' })
  }
  let origin
  try { origin = new URL(source).origin } catch { return response.status(403).json({ message: 'طلب غير موثوق' }) }
  const allowed = [clientOrigin, `https://${request.headers.host}`, `http://${request.headers.host}`]
  if (!allowed.includes(origin)) return response.status(403).json({ message: 'طلب غير موثوق' })
  next()
})

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, skipSuccessfulRequests: true, message: { message: 'محاولات كثيرة، حاول لاحقًا بعد ١٥ دقيقة' } })
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { message: 'محاولات كثيرة لإنشاء حساب، حاول لاحقًا' } })
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false })
app.use('/api/', apiLimiter)

// Session data is a snapshot taken at login, so a demoted, suspended or deleted
// user would keep their old privileges until the cookie expires. Drop their
// sessions from the store instead of re-reading the user on every request.
const revokeUserSessions = async (executor, userId) => {
  try {
    await executor.query("DELETE FROM session WHERE (sess->'user'->>'id')::bigint = $1", [userId])
  } catch (error) { console.error('failed to revoke sessions for user', userId, error) }
}

app.post('/api/auth/login', loginLimiter, async (request, response) => {
  // Cap the inputs before bcrypt sees them: bcryptjs is pure JS and runs on the
  // event loop, so an oversized password would be a cheap CPU-exhaustion vector.
  const username = cleanText(request.body.username, 80).trim()
  const password = cleanText(request.body.password, 200)
  if (!username || !password) return response.status(400).json({ message: 'اسم المستخدم وكلمة المرور مطلوبان' })
  try {
    const user = await authenticateUser(username, password)
    if (!user) return response.status(401).json({ message: 'بيانات الدخول غير صحيحة أو الحساب غير فعال' })
    // Regenerate first so the pre-login session id cannot be reused after the
    // privilege upgrade (session fixation).
    await new Promise((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()))
    request.session.user = user
    await new Promise((resolve, reject) => request.session.save((error) => error ? reject(error) : resolve()))
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
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
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
  const result = await query('SELECT id, name, arabic_name FROM medicines ORDER BY name ASC')
  response.json({ medicines: result.rows })
})
// Admin-only: the medicines catalogue is shared, and PUT/DELETE on it are already
// admin-only, so a normal user must not be able to write rows they cannot clean up.
// Names differing only in case are the same medicine to a pharmacist, but not to the
// UNIQUE constraint. Checking here rather than with a unique index on lower(name):
// production may already hold such pairs from the old re-seed, and creating the index
// would fail inside the build and take the deploy down with it.
const findMedicineByName = (name, exceptId = null) => query(
  'SELECT id, name, arabic_name FROM medicines WHERE lower(name) = lower($1) AND ($2::bigint IS NULL OR id <> $2)',
  [name, exceptId],
)
app.post('/api/medicines', requireAdmin, async (request, response) => {
  const name = cleanText(request.body.name, 200).trim()
  if (!name) return response.status(400).json({ message: 'اسم العلاج مطلوب' })
  try {
    const existing = await findMedicineByName(name)
    if (existing.rows[0]) return response.status(409).json({ message: `"${existing.rows[0].name}" موجود في القائمة أصلًا`, medicine: existing.rows[0] })
    const result = await query('INSERT INTO medicines (name, created_by) VALUES ($1, $2) RETURNING id, name, arabic_name', [name, request.session.user.id])
    response.status(201).json({ medicine: result.rows[0] })
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ message: `"${name}" موجود في القائمة أصلًا` })
    console.error('medicine insert failed:', error)
    response.status(500).json({ message: 'تعذر إضافة الدواء' })
  }
})
app.put('/api/medicines/:id', requireAdmin, async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isInteger(id) || id < 1) return response.status(400).json({ message: 'معرّف غير صحيح' })
  const name = request.body.name === undefined ? null : cleanText(request.body.name, 200).trim()
  const arabicName = request.body.arabicName === undefined ? null : cleanText(request.body.arabicName, 200).trim()
  if (name !== null && !name) return response.status(400).json({ message: 'اسم العلاج مطلوب' })
  try {
    if (name !== null) {
      const clash = await findMedicineByName(name, id)
      if (clash.rows[0]) return response.status(409).json({ message: `"${clash.rows[0].name}" موجود في القائمة أصلًا`, medicine: clash.rows[0] })
    }
    const result = await query('UPDATE medicines SET name = COALESCE($2, name), arabic_name = COALESCE($3, arabic_name) WHERE id = $1 RETURNING id, name, arabic_name', [id, name, arabicName])
    if (!result.rows[0]) return response.status(404).json({ message: 'الدواء غير موجود' })
    response.json({ medicine: result.rows[0] })
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ message: 'اسم الدواء مستخدم بالفعل' })
    console.error('medicine update failed:', error)
    response.status(500).json({ message: 'تعذر تحديث الدواء' })
  }
})
app.delete('/api/medicines/:id', requireAdmin, async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isInteger(id) || id < 1) return response.status(400).json({ message: 'معرّف غير صحيح' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const target = await client.query('SELECT id, name FROM medicines WHERE id = $1', [id])
    if (!target.rows[0]) { await client.query('ROLLBACK'); return response.status(404).json({ message: 'الدواء غير موجود' }) }
    // Keep the name on the charts that already used it. Reading a chart falls back to
    // custom_name, which is NULL while a column is linked to the catalogue — so nulling
    // medicine_id alone would blank the column header of every past chart and leave the
    // quantities under it with nothing to name them.
    await client.query('UPDATE chart_columns SET custom_name = $2, medicine_id = NULL WHERE medicine_id = $1', [id, target.rows[0].name])
    await client.query('DELETE FROM pill_entries WHERE medicine_id = $1', [id])
    await client.query('DELETE FROM medicines WHERE id = $1', [id])
    await client.query('COMMIT')
    response.json({ ok: true })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('medicine delete failed:', error)
    response.status(500).json({ message: 'تعذر حذف الدواء' })
  } finally { client.release() }
})

app.get('/api/registrations', requireAdmin, async (_request, response) => {
  const result = await query("SELECT id, full_name, username, phone, email, fingerprint_number, created_at FROM users WHERE account_status = 'pending' ORDER BY created_at ASC")
  response.json({ registrations: result.rows })
})
app.put('/api/registrations/:id', requireAdmin, async (request, response) => {
  const status = request.body.status
  const id = Number(request.params.id)
  const location = status === 'active' ? resolveLocation(request.body) : null
  if (!['active', 'rejected'].includes(status)) return response.status(400).json({ message: 'الحالة غير صحيحة' })
  if (!Number.isInteger(id) || id < 1) return response.status(400).json({ message: 'معرّف غير صحيح' })
  if (status === 'active' && !location) return response.status(400).json({ message: 'يجب اختيار طابق أو ردهة صحيحة عند قبول الطلب' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query("UPDATE users SET account_status = $1, approved_at = NOW(), approved_by = $2 WHERE id = $3 AND account_status = 'pending' RETURNING id", [status, request.session.user.id, id])
    if (!result.rows[0]) { await client.query('ROLLBACK'); return response.status(404).json({ message: 'الطلب غير موجود أو تمت معالجته' }) }
    if (status === 'active') {
      await client.query('DELETE FROM user_floor_access WHERE user_id = $1', [id])
      await client.query('DELETE FROM user_ward_access WHERE user_id = $1', [id])
      if (location.floor !== null) {
        await client.query('INSERT INTO user_floor_access (user_id, floor_number, assigned_by) VALUES ($1, $2, $3)', [id, location.floor, request.session.user.id])
      } else {
        await client.query('INSERT INTO user_ward_access (user_id, ward_name, assigned_by) VALUES ($1, $2, $3)', [id, location.ward, request.session.user.id])
      }
    }
    await client.query('COMMIT')
    if (status === 'rejected') await revokeUserSessions(pool, id)
    response.json({ ok: true })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('registration decision failed:', error)
    response.status(500).json({ message: 'تعذر تحديث الطلب' })
  } finally { client.release() }
})

app.get('/api/users', requireAdmin, async (_request, response) => {
  const result = await query(`SELECT u.id, u.full_name, u.username, u.email, u.phone, u.role, u.account_status,
    COALESCE((SELECT array_agg(floor_number ORDER BY floor_number) FROM user_floor_access WHERE user_id = u.id), '{}') AS floors,
    COALESCE((SELECT array_agg(ward_name ORDER BY ward_name) FROM user_ward_access WHERE user_id = u.id), '{}') AS wards
    FROM users u ORDER BY u.created_at DESC`)
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
    await client.query('UPDATE user_ward_access SET assigned_by = $1 WHERE assigned_by = $2', [actingAdmin, id])
    await client.query('UPDATE daily_charts SET created_by = $1 WHERE created_by = $2', [actingAdmin, id])
    await client.query('UPDATE daily_charts SET updated_by = $1 WHERE updated_by = $2', [actingAdmin, id])
    await client.query('UPDATE medicines SET created_by = NULL WHERE created_by = $1', [id])
    await client.query('DELETE FROM users WHERE id = $1', [id])
    await client.query('COMMIT')
    await revokeUserSessions(pool, id)
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
// Resolve an access request that carries either { floor } or { ward } into
// a single normalised assignment, or null if it is not valid.
const resolveLocation = (body) => {
  const floor = Number(body.floor)
  const ward = typeof body.ward === 'string' ? body.ward.trim() : ''
  if (ALLOWED_FLOORS.includes(floor)) return { floor, ward: null }
  if (SPECIAL_WARDS.includes(ward)) return { floor: null, ward }
  return null
}
const setUserAccess = async (userId, location, assignedBy) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM user_floor_access WHERE user_id = $1', [userId])
    await client.query('DELETE FROM user_ward_access WHERE user_id = $1', [userId])
    if (location.floor !== null) {
      await client.query('INSERT INTO user_floor_access (user_id, floor_number, assigned_by) VALUES ($1, $2, $3)', [userId, location.floor, assignedBy])
    } else {
      await client.query('INSERT INTO user_ward_access (user_id, ward_name, assigned_by) VALUES ($1, $2, $3)', [userId, location.ward, assignedBy])
    }
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
app.put('/api/access/by-username', requireAdmin, async (request, response) => {
  const location = resolveLocation(request.body)
  if (!location) return response.status(400).json({ message: 'الطابق أو الردهة غير مسموح' })
  const userResult = await query('SELECT id FROM users WHERE username = $1 OR email = $1', [String(request.body.username || '').trim()])
  if (!userResult.rows[0]) return response.status(404).json({ message: 'المستخدم غير موجود' })
  await setUserAccess(userResult.rows[0].id, location, request.session.user.id)
  await revokeUserSessions(pool, userResult.rows[0].id)
  response.json({ ok: true })
})
app.put('/api/access/:userId', requireAdmin, async (request, response) => {
  const location = resolveLocation(request.body)
  const userId = Number(request.params.userId)
  if (!location) return response.status(400).json({ message: 'الطابق أو الردهة غير مسموح' })
  if (!Number.isInteger(userId) || userId < 1) return response.status(400).json({ message: 'معرّف غير صحيح' })
  const userResult = await query('SELECT id FROM users WHERE id = $1', [userId])
  if (!userResult.rows[0]) return response.status(404).json({ message: 'المستخدم غير موجود' })
  await setUserAccess(userId, location, request.session.user.id)
  await revokeUserSessions(pool, userId)
  response.json({ ok: true })
})

app.get('/api/chart', requireAuth, async (request, response) => {
  const floor = request.query.floor ? clampInt(request.query.floor, 2, 10) : null
  const wardName = cleanText(request.query.ward, 120).trim()
  const chartDate = request.query.date
  if (request.query.floor && (floor === null || !ALLOWED_FLOORS.includes(floor))) return response.status(400).json({ message: 'الطابق غير مسموح' })
  if (!wardName || !isIsoDate(chartDate)) return response.status(400).json({ message: 'بيانات الردهة والتاريخ مطلوبة' })
  if (!isKnownWard(floor, wardName)) return response.status(400).json({ message: 'الردهة غير معروفة' })
  if (!canAccessLocation(request.session.user, floor, wardName)) return response.status(403).json({ message: 'لا تملك صلاحية لهذه الردهة' })
  const wardResult = await query('SELECT id, floor_number, name FROM wards WHERE floor_number IS NOT DISTINCT FROM $1 AND name = $2 ORDER BY id LIMIT 1', [floor, wardName])
  if (!wardResult.rows[0]) return response.json({ chart: null })
  const chartResult = await query('SELECT id FROM daily_charts WHERE ward_id = $1 AND chart_date = $2', [wardResult.rows[0].id, chartDate])
  if (!chartResult.rows[0]) return response.json({ chart: null })
  const chartId = chartResult.rows[0].id
  const [patients, columns, quantities] = await Promise.all([
    query('SELECT row_number, patient_name FROM chart_patients WHERE chart_id = $1 ORDER BY row_number', [chartId]),
    query('SELECT cc.column_number, cc.medicine_id, COALESCE(m.name, cc.custom_name) AS medicine_name FROM chart_columns cc LEFT JOIN medicines m ON m.id = cc.medicine_id WHERE cc.chart_id = $1 ORDER BY cc.column_number', [chartId]),
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
  if (!isKnownWard(floor, wardName)) return response.status(400).json({ message: 'الردهة غير معروفة' })
  if (!canAccessLocation(request.session.user, floor, wardName)) return response.status(403).json({ message: 'لا تملك صلاحية لهذه الردهة' })

  const patients = (Array.isArray(request.body.patients) ? request.body.patients : [])
    .map((patient) => ({ rowNumber: clampInt(patient?.rowNumber, 1, MAX_PATIENT_ROWS), name: cleanText(patient?.name, 200) }))
    .filter((patient) => patient.rowNumber !== null)
  const columns = (Array.isArray(request.body.columns) ? request.body.columns : [])
    .map((column) => ({ columnNumber: clampInt(column?.columnNumber, 1, 51), medicineName: cleanText(column?.medicineName, 200).trim() }))
    .filter((column) => column.columnNumber !== null)
  const quantities = (Array.isArray(request.body.quantities) ? request.body.quantities : [])
    .map((entry) => ({ rowNumber: clampInt(entry?.rowNumber, 1, MAX_PATIENT_ROWS), columnNumber: clampInt(entry?.columnNumber, 1, 51), quantity: clampInt(entry?.quantity, 0, 1_000_000) }))
    .filter((entry) => entry.rowNumber !== null && entry.columnNumber !== null && entry.quantity !== null)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Select-then-insert: ON CONFLICT (floor_number, name) never matches when
    // floor_number IS NULL (special wards), which would create duplicates.
    let wardRow = (await client.query('SELECT id FROM wards WHERE floor_number IS NOT DISTINCT FROM $1 AND name = $2 ORDER BY id LIMIT 1', [floor, wardName])).rows[0]
    if (!wardRow) {
      wardRow = (await client.query('INSERT INTO wards (floor_number, name, is_special) VALUES ($1, $2, $3) RETURNING id', [floor, wardName, floor === null])).rows[0]
    }
    const chartResult = await client.query('INSERT INTO daily_charts (ward_id, chart_date, created_by, updated_by) VALUES ($1, $2, $3, $3) ON CONFLICT (ward_id, chart_date) DO UPDATE SET updated_by = EXCLUDED.updated_by, updated_at = NOW() RETURNING id', [wardRow.id, chartDate, request.session.user.id])
    const chartId = chartResult.rows[0].id
    await client.query('DELETE FROM chart_patients WHERE chart_id = $1', [chartId])
    await client.query('DELETE FROM chart_columns WHERE chart_id = $1', [chartId])
    await client.query('DELETE FROM chart_quantities WHERE chart_id = $1', [chartId])

    // Batched set-based inserts (UNNEST) instead of one query per row: a full
    // 36x51 chart is ~8 round-trips instead of ~2000, so the pooled connection
    // is held for milliseconds. De-dupe on the natural keys first so a single
    // repeated key in the payload can't abort the whole save.
    const patientByRow = new Map(patients.map((patient) => [patient.rowNumber, patient.name]))
    if (patientByRow.size) {
      await client.query('INSERT INTO chart_patients (chart_id, row_number, patient_name) SELECT $1, rn, name FROM UNNEST($2::int[], $3::text[]) AS u(rn, name)', [chartId, [...patientByRow.keys()], [...patientByRow.values()]])
    }

    // Link a column to a medicine only when its text exactly matches an existing
    // catalogue entry. Anything else is kept as free text on the column itself, so
    // typing in the chart never adds rows to the shared medicines list.
    const medicineByColumn = new Map(columns.map((column) => [column.columnNumber, column.medicineName]))
    const wantedMedicines = [...new Set([...medicineByColumn.values()].filter(Boolean))]
    const idByMedicine = new Map()
    if (wantedMedicines.length) {
      const known = await client.query('SELECT id, name FROM medicines WHERE name = ANY($1::text[])', [wantedMedicines])
      known.rows.forEach((row) => idByMedicine.set(row.name, row.id))
    }
    if (medicineByColumn.size) {
      const columnNumbers = [...medicineByColumn.keys()]
      const medicineIds = columnNumbers.map((columnNumber) => idByMedicine.get(medicineByColumn.get(columnNumber)) ?? null)
      const customNames = columnNumbers.map((columnNumber) => {
        const text = medicineByColumn.get(columnNumber)
        return text && !idByMedicine.has(text) ? text : null
      })
      await client.query('INSERT INTO chart_columns (chart_id, column_number, medicine_id, custom_name) SELECT $1, cn, mid, cname FROM UNNEST($2::int[], $3::bigint[], $4::text[]) AS u(cn, mid, cname)', [chartId, columnNumbers, medicineIds, customNames])
    }

    const quantityByCell = new Map(quantities.map((entry) => [`${entry.rowNumber}:${entry.columnNumber}`, entry]))
    const quantityList = [...quantityByCell.values()]
    if (quantityList.length) {
      await client.query('INSERT INTO chart_quantities (chart_id, row_number, column_number, quantity) SELECT $1, rn, cn, qty FROM UNNEST($2::int[], $3::int[], $4::int[]) AS u(rn, cn, qty)', [chartId, quantityList.map((entry) => entry.rowNumber), quantityList.map((entry) => entry.columnNumber), quantityList.map((entry) => entry.quantity)])
    }
    await client.query('COMMIT')
    response.json({ ok: true, chartId })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('chart save failed:', error)
    response.status(400).json({ message: 'تعذر حفظ الجارت' })
  } finally { client.release() }
})

const resolveChartId = async (floor, wardName, chartDate) => {
  const wardResult = await query('SELECT id FROM wards WHERE floor_number IS NOT DISTINCT FROM $1 AND name = $2 ORDER BY id LIMIT 1', [floor, wardName])
  if (!wardResult.rows[0]) return null
  const chartResult = await query('SELECT id FROM daily_charts WHERE ward_id = $1 AND chart_date = $2', [wardResult.rows[0].id, chartDate])
  return chartResult.rows[0] ? chartResult.rows[0].id : null
}

app.get('/api/pills', requireAuth, async (request, response) => {
  const floor = request.query.floor ? clampInt(request.query.floor, 2, 10) : null
  const wardName = cleanText(request.query.ward, 120).trim()
  const chartDate = request.query.date
  if (request.query.floor && (floor === null || !ALLOWED_FLOORS.includes(floor))) return response.status(400).json({ message: 'الطابق غير مسموح' })
  if (!wardName || !isIsoDate(chartDate)) return response.status(400).json({ message: 'بيانات الردهة والتاريخ مطلوبة' })
  if (!isKnownWard(floor, wardName)) return response.status(400).json({ message: 'الردهة غير معروفة' })
  if (!canAccessLocation(request.session.user, floor, wardName)) return response.status(403).json({ message: 'لا تملك صلاحية لهذه الردهة' })
  const chartId = await resolveChartId(floor, wardName, chartDate)
  if (!chartId) return response.json({ pills: null })
  const [columns, patients, quantities, entries, rooms] = await Promise.all([
    query('SELECT cc.column_number, cc.medicine_id, m.name, m.arabic_name FROM chart_columns cc JOIN medicines m ON m.id = cc.medicine_id WHERE cc.chart_id = $1', [chartId]),
    query("SELECT row_number, patient_name FROM chart_patients WHERE chart_id = $1 AND patient_name <> '' ORDER BY row_number", [chartId]),
    query('SELECT row_number, column_number, quantity FROM chart_quantities WHERE chart_id = $1 AND quantity > 0', [chartId]),
    query('SELECT patient_row_number, medicine_id, dose_time, usage_method, note FROM pill_entries WHERE chart_id = $1', [chartId]),
    query('SELECT patient_row_number, room_number FROM pill_patient_meta WHERE chart_id = $1', [chartId]),
  ])
  const pillColumns = columns.rows.filter((column) => PILL_FORM.test(column.name || ''))
  const medicineByColumn = new Map(pillColumns.map((column) => [column.column_number, column.medicine_id]))
  const nameByRow = new Map(patients.rows.map((patient) => [patient.row_number, patient.patient_name]))
  const matrix = {}
  const usedMedicineIds = new Set()
  quantities.rows.forEach((cell) => {
    const medicineId = medicineByColumn.get(cell.column_number)
    if (medicineId === undefined || !nameByRow.has(cell.row_number)) return
    if (!matrix[cell.row_number]) matrix[cell.row_number] = []
    if (!matrix[cell.row_number].includes(medicineId)) matrix[cell.row_number].push(medicineId)
    usedMedicineIds.add(medicineId)
  })
  const medicineInfo = new Map(pillColumns.map((column) => [column.medicine_id, { id: column.medicine_id, name: column.name, arabicName: column.arabic_name || '' }]))
  const result = {
    patients: patients.rows.filter((patient) => matrix[patient.row_number]).map((patient) => ({ rowNumber: patient.row_number, name: patient.patient_name })),
    medicines: [...usedMedicineIds].map((id) => medicineInfo.get(id)).filter(Boolean).sort((a, b) => (a.arabicName || a.name).localeCompare(b.arabicName || b.name, 'ar')),
    matrix,
    entries: entries.rows.map((row) => ({ patientRowNumber: row.patient_row_number, medicineId: row.medicine_id, doseTime: row.dose_time, usageMethod: row.usage_method, note: row.note })),
    rooms: Object.fromEntries(rooms.rows.map((row) => [row.patient_row_number, row.room_number])),
  }
  response.json({ pills: result })
})
app.put('/api/pills', requireAuth, async (request, response) => {
  const floor = request.body.floor ? clampInt(request.body.floor, 2, 10) : null
  const wardName = cleanText(request.body.ward, 120).trim()
  const chartDate = request.body.date
  if (request.body.floor && (floor === null || !ALLOWED_FLOORS.includes(floor))) return response.status(400).json({ message: 'الطابق غير مسموح' })
  if (!wardName || !isIsoDate(chartDate)) return response.status(400).json({ message: 'بيانات الردهة والتاريخ مطلوبة' })
  if (!isKnownWard(floor, wardName)) return response.status(400).json({ message: 'الردهة غير معروفة' })
  if (!canAccessLocation(request.session.user, floor, wardName)) return response.status(403).json({ message: 'لا تملك صلاحية لهذه الردهة' })
  const chartId = await resolveChartId(floor, wardName, chartDate)
  if (!chartId) return response.status(404).json({ message: 'لا يوجد جارت لهذا اليوم' })
  const byKey = new Map()
  ;(Array.isArray(request.body.entries) ? request.body.entries : []).forEach((entry) => {
    const patientRowNumber = clampInt(entry?.patientRowNumber, 1, MAX_PATIENT_ROWS)
    const medicineId = clampInt(entry?.medicineId, 1, Number.MAX_SAFE_INTEGER)
    if (patientRowNumber === null || medicineId === null) return
    const doseTime = DOSE_TIMES.includes(entry?.doseTime) ? entry.doseTime : ''
    const usageMethod = USAGE_METHODS.includes(entry?.usageMethod) ? entry.usageMethod : ''
    const note = NOTE_OPTIONS.includes(entry?.note) ? entry.note : ''
    if (!doseTime && !usageMethod && !note) return
    byKey.set(`${patientRowNumber}:${medicineId}`, { patientRowNumber, medicineId, doseTime, usageMethod, note })
  })
  const rows = [...byKey.values()]
  const roomRows = Object.entries(request.body.rooms && typeof request.body.rooms === 'object' ? request.body.rooms : {})
    .map(([key, value]) => ({ patientRowNumber: clampInt(key, 1, MAX_PATIENT_ROWS), roomNumber: cleanText(value, 40).trim() }))
    .filter((room) => room.patientRowNumber !== null && room.roomNumber)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM pill_entries WHERE chart_id = $1', [chartId])
    await client.query('DELETE FROM pill_patient_meta WHERE chart_id = $1', [chartId])
    if (rows.length) {
      await client.query(
        'INSERT INTO pill_entries (chart_id, patient_row_number, medicine_id, dose_time, usage_method, note) SELECT $1, prn, mid, dt, um, nt FROM UNNEST($2::int[], $3::bigint[], $4::text[], $5::text[], $6::text[]) AS u(prn, mid, dt, um, nt)',
        [chartId, rows.map((row) => row.patientRowNumber), rows.map((row) => row.medicineId), rows.map((row) => row.doseTime), rows.map((row) => row.usageMethod), rows.map((row) => row.note)],
      )
    }
    if (roomRows.length) {
      await client.query(
        'INSERT INTO pill_patient_meta (chart_id, patient_row_number, room_number) SELECT $1, prn, rn FROM UNNEST($2::int[], $3::text[]) AS u(prn, rn)',
        [chartId, roomRows.map((room) => room.patientRowNumber), roomRows.map((room) => room.roomNumber)],
      )
    }
    await client.query('COMMIT')
    response.json({ ok: true })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('pill save failed:', error)
    response.status(400).json({ message: 'تعذر حفظ الاستمارة' })
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
app.use((request, response) => {
  // A bare next() would skip the 4-arg error handler below and fall through to
  // Express's default HTML 404, which the JSON-only client cannot parse.
  if (request.path.startsWith('/api/')) return response.status(404).json({ message: 'المسار غير موجود' })
  response.sendFile(path.join(projectRoot, '..', 'dist', 'index.html'))
})

// eslint-disable-next-line no-unused-vars
app.use((error, request, response, next) => {
  if (response.headersSent) return
  if (error?.type === 'entity.too.large') return response.status(413).json({ message: 'حجم الطلب كبير جدًا' })
  if (error?.type === 'entity.parse.failed') return response.status(400).json({ message: 'صيغة الطلب غير صحيحة' })
  console.error('unhandled error:', error)
  response.status(500).json({ message: 'حدث خطأ غير متوقع' })
})

app.listen(port, () => {
  console.log(`Clinical Pharmacy API listening on http://localhost:${port}`)
})
