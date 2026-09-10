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
import { authenticateUser, requireAdmin, requireAuth, requireManager } from './auth.js'
import {
  ALLOWED_FLOORS, MAX_PATIENT_ROWS, SPECIAL_WARDS, isKnownWard, PILL_FORM,
  DOSE_TIMES, USAGE_METHODS, NOTE_OPTIONS, canAccessLocation, clampInt, isIsoDate, cleanText,
  normalizeMedicineKey, medicineKeySql,
} from './validation.js'
import chartRoutes, { resolveChartId, readSlot } from './routes/chart.js'

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
// pruneSessionInterval defaults to 900s — a DELETE every 15 min, day and night, which alone
// keeps the Neon compute endpoint from ever autosuspending. Expired rows are ignored on read
// anyway, so turn the timer off and prune once, ~30s after boot (past createTableIfMissing),
// which covers every deploy/restart. Stale rows between restarts are a handful and harmless.
const sessionStore = new PgSession({ pool, createTableIfMissing: true, disableTouch: true, pruneSessionInterval: false })
setTimeout(() => sessionStore.pruneSessions((error) => { if (error) console.error('session prune failed:', error) }), 30_000).unref?.()
app.use(session({
  name: 'cpa.sid',
  store: sessionStore,
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
  `SELECT id, name, arabic_name FROM medicines WHERE ${medicineKeySql('name')} = $1 AND ($2::bigint IS NULL OR id <> $2)`,
  [normalizeMedicineKey(name), exceptId],
)
app.post('/api/medicines', requireManager, async (request, response) => {
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
app.put('/api/medicines/:id', requireManager, async (request, response) => {
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
app.delete('/api/medicines/:id', requireManager, async (request, response) => {
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
    // pill_entries are keyed by the medicine's name, not its catalogue id, so the dose times
    // and usage methods on every past form survive the catalogue row going away.
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

app.get('/api/users', requireManager, async (_request, response) => {
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
    await client.query('UPDATE announcements SET created_by = NULL WHERE created_by = $1', [id])
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

// Manager-only, never requireManager: a supervisor able to reach this could promote itself to
// admin, which would make the whole distinction decorative.
const ASSIGNABLE_ROLES = ['admin', 'supervisor', 'user']
app.put('/api/users/:id/role', requireAdmin, async (request, response) => {
  const id = Number(request.params.id)
  const role = request.body.role
  if (!Number.isInteger(id) || id < 1) return response.status(400).json({ message: 'معرّف غير صحيح' })
  if (!ASSIGNABLE_ROLES.includes(role)) return response.status(400).json({ message: 'الدور غير صحيح' })
  // Changing your own role is how an admin locks itself out by accident, and it is the one
  // case the last-admin count below cannot protect against on its own.
  if (id === Number(request.session.user.id)) return response.status(400).json({ message: 'لا يمكنك تغيير دور حسابك الخاص' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const target = await client.query('SELECT role FROM users WHERE id = $1', [id])
    if (!target.rows[0]) { await client.query('ROLLBACK'); return response.status(404).json({ message: 'المستخدم غير موجود' }) }
    if (target.rows[0].role === role) { await client.query('ROLLBACK'); return response.json({ ok: true, role }) }
    if (target.rows[0].role === 'admin') {
      const admins = await client.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'")
      if (admins.rows[0].count <= 1) { await client.query('ROLLBACK'); return response.status(400).json({ message: 'لا يمكن تنزيل آخر مدير في النظام' }) }
    }
    await client.query('UPDATE users SET role = $2 WHERE id = $1', [id, role])
    await client.query('COMMIT')
    // The role lives in the session snapshot, so without this a demoted admin keeps admin
    // rights until their cookie expires — up to eight hours.
    await revokeUserSessions(pool, id)
    response.json({ ok: true, role })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('role change failed:', error)
    response.status(500).json({ message: 'تعذر تغيير الدور' })
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
app.put('/api/access/by-username', requireManager, async (request, response) => {
  const location = resolveLocation(request.body)
  if (!location) return response.status(400).json({ message: 'الطابق أو الردهة غير مسموح' })
  const userResult = await query('SELECT id FROM users WHERE username = $1 OR email = $1', [String(request.body.username || '').trim()])
  if (!userResult.rows[0]) return response.status(404).json({ message: 'المستخدم غير موجود' })
  await setUserAccess(userResult.rows[0].id, location, request.session.user.id)
  await revokeUserSessions(pool, userResult.rows[0].id)
  response.json({ ok: true })
})
app.put('/api/access/:userId', requireManager, async (request, response) => {
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

// The dashboard shown right after login. Two parts:
//  - startedWards: which known floors/wards have a chart for `date` that a pharmacist has
//    actually begun — at least one named patient AND at least one entered quantity, so a
//    chart that was only opened (the first autosave writes an empty row) does not count.
//  - topMedicines: the highest-quantity medicines. A manager sees every ward over a chosen
//    window (today / week / month); anyone else sees only their own floor or wards, for the
//    day. No patient names in either — the floor/ward grid is already visible to everyone.
const PERIOD_DAYS = { today: 1, week: 7, month: 30 }
app.get('/api/dashboard', requireAuth, async (request, response) => {
  const date = request.query.date
  if (!isIsoDate(date)) return response.status(400).json({ message: 'التاريخ مطلوب' })
  const user = request.session.user
  const isManager = user.role === 'admin' || user.role === 'supervisor'
  const days = isManager ? (PERIOD_DAYS[request.query.period] ?? PERIOD_DAYS.month) : PERIOD_DAYS.today
  // The per-floor patient widget (manager-only, إدارة الطوابق) carries its own period toggle.
  const patientDays = isManager ? (PERIOD_DAYS[request.query.patientsPeriod] ?? PERIOD_DAYS.month) : PERIOD_DAYS.today

  // A non-manager's medicine totals are scoped to whatever they can actually reach.
  let scopeClause = ''
  const medicineParams = [date, days]
  if (!isManager) {
    if (Number.isInteger(user.assignedFloor)) {
      medicineParams.push(user.assignedFloor)
      scopeClause = `AND w.floor_number = $${medicineParams.length}`
    } else if (Array.isArray(user.assignedWards) && user.assignedWards.length) {
      medicineParams.push(user.assignedWards)
      scopeClause = `AND w.floor_number IS NULL AND w.name = ANY($${medicineParams.length}::text[])`
    } else {
      scopeClause = 'AND FALSE'
    }
  }

  const pending = [
    query(
      `SELECT w.floor_number, w.name
       FROM wards w
       JOIN daily_charts dc ON dc.ward_id = w.id
       WHERE dc.chart_date = $1
         AND EXISTS (SELECT 1 FROM chart_patients cp WHERE cp.chart_id = dc.id AND cp.patient_name <> '')
         AND EXISTS (SELECT 1 FROM chart_quantities cq WHERE cq.chart_id = dc.id AND cq.quantity > 0)`,
      [date],
    ),
    query(
      `SELECT COALESCE(m.name, cc.custom_name) AS name, SUM(cq.quantity)::int AS quantity
       FROM chart_quantities cq
       JOIN chart_columns cc ON cc.chart_id = cq.chart_id AND cc.column_number = cq.column_number
       JOIN daily_charts dc ON dc.id = cq.chart_id
       JOIN wards w ON w.id = dc.ward_id
       LEFT JOIN medicines m ON m.id = cc.medicine_id
       WHERE dc.chart_date > ($1::date - $2::int) AND dc.chart_date <= $1::date AND cq.quantity > 0 ${scopeClause}
       GROUP BY COALESCE(m.name, cc.custom_name)
       ORDER BY quantity DESC
       LIMIT 5`,
      medicineParams,
    ),
    // Cumulative patient-days per numbered floor, over the widget's own window. Managers only.
    isManager
      ? query(
        `SELECT w.floor_number AS floor, COUNT(*)::int AS count
         FROM chart_patients cp
         JOIN daily_charts dc ON dc.id = cp.chart_id
         JOIN wards w ON w.id = dc.ward_id
         WHERE cp.patient_name <> ''
           AND w.floor_number IS NOT NULL
           AND dc.chart_date > ($1::date - $2::int) AND dc.chart_date <= $1::date
         GROUP BY w.floor_number
         ORDER BY w.floor_number`,
        [date, patientDays],
      )
      : Promise.resolve({ rows: [] }),
  ]
  const [started, topMedicines, patientsByFloor] = await Promise.all(pending)
  response.json({
    startedWards: started.rows.map((row) => ({ floor: row.floor_number, ward: row.name })),
    topMedicines: topMedicines.rows.filter((row) => row.name).map((row) => ({ name: row.name, quantity: row.quantity })),
    medicinesPeriod: isManager ? (PERIOD_DAYS[request.query.period] ? request.query.period : 'month') : 'today',
    medicinesScope: isManager ? 'all' : 'own',
    patientsByFloor: patientsByFloor.rows.map((row) => ({ floor: row.floor, count: row.count })),
    patientsPeriod: isManager ? (PERIOD_DAYS[request.query.patientsPeriod] ? request.query.patientsPeriod : 'month') : 'today',
  })
})

// created_by is kept for the audit trail and the user-deletion cascade, but the dashboard
// shows every notice under one unit signature, not the individual poster's name.
const ANNOUNCEMENT_MAX_LENGTH = 500
app.get('/api/announcements', requireAuth, async (_request, response) => {
  const result = await query('SELECT id, message, created_at FROM announcements ORDER BY created_at DESC LIMIT 5')
  response.json({ announcements: result.rows })
})
app.post('/api/announcements', requireManager, async (request, response) => {
  const message = cleanText(request.body.message, ANNOUNCEMENT_MAX_LENGTH).trim()
  if (!message) return response.status(400).json({ message: 'نص الإعلان مطلوب' })
  const result = await query(
    'INSERT INTO announcements (message, created_by) VALUES ($1, $2) RETURNING id, message, created_at',
    [message, request.session.user.id],
  )
  response.status(201).json({ announcement: result.rows[0] })
})
app.patch('/api/announcements/:id', requireManager, async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isInteger(id) || id < 1) return response.status(400).json({ message: 'معرّف غير صحيح' })
  const message = cleanText(request.body.message, ANNOUNCEMENT_MAX_LENGTH).trim()
  if (!message) return response.status(400).json({ message: 'نص الإعلان مطلوب' })
  const result = await query(
    'UPDATE announcements SET message = $1 WHERE id = $2 RETURNING id, message, created_at',
    [message, id],
  )
  if (!result.rows[0]) return response.status(404).json({ message: 'الإعلان غير موجود' })
  response.json({ announcement: result.rows[0] })
})
app.delete('/api/announcements/:id', requireManager, async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isInteger(id) || id < 1) return response.status(400).json({ message: 'معرّف غير صحيح' })
  const result = await query('DELETE FROM announcements WHERE id = $1 RETURNING id', [id])
  if (!result.rows[0]) return response.status(404).json({ message: 'الإعلان غير موجود' })
  response.json({ ok: true })
})

app.use('/api', chartRoutes)

app.get('/api/pills', requireAuth, async (request, response) => {
  const floor = request.query.floor ? clampInt(request.query.floor, 2, 10) : null
  const wardName = cleanText(request.query.ward, 120).trim()
  const chartDate = request.query.date
  if (request.query.floor && (floor === null || !ALLOWED_FLOORS.includes(floor))) return response.status(400).json({ message: 'الطابق غير مسموح' })
  if (!wardName || !isIsoDate(chartDate)) return response.status(400).json({ message: 'بيانات الردهة والتاريخ مطلوبة' })
  if (!isKnownWard(floor, wardName)) return response.status(400).json({ message: 'الردهة غير معروفة' })
  if (!canAccessLocation(request.session.user, floor, wardName)) return response.status(403).json({ message: 'لا تملك صلاحية لهذه الردهة' })
  const chartId = await resolveChartId(floor, wardName, chartDate, readSlot(request.query.slot))
  if (!chartId) return response.json({ pills: null })
  // LEFT JOIN, not JOIN: a column whose text is not in the catalogue has a NULL medicine_id
  // and lives in custom_name. An inner join dropped those columns outright, which is how a
  // medicine the pharmacist could plainly see in the chart never appeared on the pill form.
  const [columns, patients, quantities, entries, rooms] = await Promise.all([
    query('SELECT cc.column_number, cc.custom_name, m.name, m.arabic_name FROM chart_columns cc LEFT JOIN medicines m ON m.id = cc.medicine_id WHERE cc.chart_id = $1', [chartId]),
    query("SELECT row_number, patient_name FROM chart_patients WHERE chart_id = $1 AND patient_name <> '' ORDER BY row_number", [chartId]),
    query('SELECT row_number, column_number, quantity FROM chart_quantities WHERE chart_id = $1 AND quantity > 0', [chartId]),
    query('SELECT patient_row_number, medicine_key, dose_time, usage_method, note, pill_qty, pill_name FROM pill_entries WHERE chart_id = $1', [chartId]),
    query('SELECT patient_row_number, room_number FROM pill_patient_meta WHERE chart_id = $1', [chartId]),
  ])
  // Whatever the column is called on the chart is what names the medicine here.
  const pillColumns = columns.rows
    .map((column) => ({ columnNumber: column.column_number, name: column.name || column.custom_name || '', arabicName: column.arabic_name || '' }))
    .filter((column) => PILL_FORM.test(column.name))
  // CCU runs in English: its pill form always shows the catalogue name and never a
  // translation, even for medicines that have one.
  const englishOnly = /\bccu\b/i.test(wardName)
  if (englishOnly) {
    pillColumns.forEach((column) => { column.arabicName = '' })
  } else {
    // An unlinked column may still name a catalogue medicine (an old chart saved before the
    // matching was case-insensitive). Look those up by key so they keep their Arabic name.
    const unresolved = [...new Set(pillColumns.filter((column) => !column.arabicName).map((column) => normalizeMedicineKey(column.name)))]
    if (unresolved.length) {
      const found = await query(`SELECT name, arabic_name FROM medicines WHERE ${medicineKeySql('name')} = ANY($1::text[])`, [unresolved])
      const arabicByKey = new Map(found.rows.map((row) => [normalizeMedicineKey(row.name), row.arabic_name || '']))
      // Only fill the blanks — a column already linked to the catalogue has the right name.
      pillColumns.forEach((column) => {
        if (!column.arabicName) column.arabicName = arabicByKey.get(normalizeMedicineKey(column.name)) || ''
      })
    }
  }
  const keyByColumn = new Map(pillColumns.map((column) => [column.columnNumber, normalizeMedicineKey(column.name)]))
  const nameByRow = new Map(patients.rows.map((patient) => [patient.row_number, patient.patient_name]))
  const matrix = {}
  const usedKeys = new Set()
  // The chart quantity behind each (patient, medicine) cell — the seed value for the pill-count
  // field on the form. Summed because two chart columns can spell the same medicine.
  const quantityByCell = {}
  quantities.rows.forEach((cell) => {
    const medicineKey = keyByColumn.get(cell.column_number)
    if (medicineKey === undefined || !nameByRow.has(cell.row_number)) return
    if (!matrix[cell.row_number]) matrix[cell.row_number] = []
    if (!matrix[cell.row_number].includes(medicineKey)) matrix[cell.row_number].push(medicineKey)
    usedKeys.add(medicineKey)
    const cellKey = `${cell.row_number}:${medicineKey}`
    quantityByCell[cellKey] = (quantityByCell[cellKey] || 0) + cell.quantity
  })
  // Two chart columns can spell one medicine differently; the first spelling names it.
  const medicineInfo = new Map()
  pillColumns.forEach((column) => {
    const key = normalizeMedicineKey(column.name)
    if (!medicineInfo.has(key)) medicineInfo.set(key, { key, name: column.name, arabicName: column.arabicName })
  })
  const result = {
    patients: patients.rows.filter((patient) => matrix[patient.row_number]).map((patient) => ({ rowNumber: patient.row_number, name: patient.patient_name })),
    medicines: [...usedKeys].map((key) => medicineInfo.get(key)).filter(Boolean).sort((a, b) => (a.arabicName || a.name).localeCompare(b.arabicName || b.name, 'ar')),
    matrix,
    quantityByCell,
    entries: entries.rows.map((row) => ({ patientRowNumber: row.patient_row_number, medicineKey: row.medicine_key, doseTime: row.dose_time, usageMethod: row.usage_method, note: row.note, pillQty: row.pill_qty, pillName: row.pill_name })),
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
  const chartId = await resolveChartId(floor, wardName, chartDate, readSlot(request.body.slot))
  if (!chartId) return response.status(404).json({ message: 'لا يوجد جارت لهذا اليوم' })
  const byKey = new Map()
  ;(Array.isArray(request.body.entries) ? request.body.entries : []).forEach((entry) => {
    const patientRowNumber = clampInt(entry?.patientRowNumber, 1, MAX_PATIENT_ROWS)
    const medicineKey = normalizeMedicineKey(cleanText(entry?.medicineKey, 200))
    if (patientRowNumber === null || !medicineKey) return
    const doseTime = DOSE_TIMES.includes(entry?.doseTime) ? entry.doseTime : ''
    const usageMethod = USAGE_METHODS.includes(entry?.usageMethod) ? entry.usageMethod : ''
    const note = NOTE_OPTIONS.includes(entry?.note) ? entry.note : ''
    const pillQty = String(entry?.pillQty ?? '').replace(/\D/g, '').slice(0, 9)
    const pillName = cleanText(entry?.pillName, 200).trim()
    if (!doseTime && !usageMethod && !note && !pillQty && !pillName) return
    byKey.set(`${patientRowNumber}:${medicineKey}`, { patientRowNumber, medicineKey, doseTime, usageMethod, note, pillQty, pillName })
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
        'INSERT INTO pill_entries (chart_id, patient_row_number, medicine_key, dose_time, usage_method, note, pill_qty, pill_name) SELECT $1, prn, mk, dt, um, nt, pq, pn FROM UNNEST($2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) AS u(prn, mk, dt, um, nt, pq, pn)',
        [chartId, rows.map((row) => row.patientRowNumber), rows.map((row) => row.medicineKey), rows.map((row) => row.doseTime), rows.map((row) => row.usageMethod), rows.map((row) => row.note), rows.map((row) => row.pillQty), rows.map((row) => row.pillName)],
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

// Liveness only — no DB round-trip, so Render's frequent health pings don't hold the Neon
// compute endpoint awake. A real DB outage still surfaces on the first genuine request.
app.get('/api/health', (_request, response) => {
  response.json({ ok: true, serverTime: new Date().toISOString() })
})
// Readiness — checks the database. Deliberately NOT render.yaml's healthCheckPath; for
// manual/ops diagnostics only.
app.get('/api/health/db', async (_request, response) => {
  try {
    const database = await checkDatabase()
    response.json({ ok: true, database: 'connected', serverTime: database.server_time })
  } catch (error) {
    console.error('db health check failed:', error)
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

// Guarded so tests can `import app from './index.js'` and drive it with a real HTTP
// client on an ephemeral port, without a second server also bound to `port`.
if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(port, () => {
    console.log(`Clinical Pharmacy API listening on http://localhost:${port}`)
  })
}

export default app
