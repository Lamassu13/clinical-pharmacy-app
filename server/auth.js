import bcrypt from 'bcryptjs'
import { query } from './db.js'

export const requireAuth = (request, response, next) => {
  if (!request.session.user) return response.status(401).json({ message: 'تسجيل الدخول مطلوب' })
  next()
}

// Reserved for what must stay with the manager alone: join requests, deleting users, and
// changing roles. A supervisor allowed to change roles could promote itself.
export const requireAdmin = (request, response, next) => {
  if (request.session.user?.role !== 'admin') return response.status(403).json({ message: 'صلاحية المدير مطلوبة' })
  next()
}

// The day-to-day administration a supervisor shares with the manager: the medicines
// catalogue, seeing the user list, and assigning where people work.
const MANAGER_ROLES = new Set(['admin', 'supervisor'])
export const requireManager = (request, response, next) => {
  if (!MANAGER_ROLES.has(request.session.user?.role)) return response.status(403).json({ message: 'صلاحية إدارية مطلوبة' })
  next()
}

// A password hash of a value nobody can ever type, spent only to give a "no such account"
// lookup the same bcrypt cost as a real one — without it, a non-existent username returns
// instantly while a real one always pays bcrypt's ~10-round cost, and that timing gap is
// enough to enumerate valid usernames/emails from the outside regardless of password.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('no-such-account', 10)

export const authenticateUser = async (username, password) => {
  // Registration lowercases and stores email as-is (server/index.js's /auth/register), but
  // never touches username case — so email must be matched case-insensitively here too, or a
  // correct password with the email typed in a different case (autocapitalize, copy-paste)
  // fails to match a row that's actually there.
  const result = await query('SELECT u.id, u.full_name, u.username, u.email, u.phone, u.role, u.account_status, u.password_hash, MIN(ufa.floor_number) AS assigned_floor FROM users u LEFT JOIN user_floor_access ufa ON ufa.user_id = u.id WHERE u.username = $1 OR LOWER(u.email) = LOWER($1) GROUP BY u.id', [username])
  const user = result.rows[0]
  if (!user) { await bcrypt.compare(password, DUMMY_PASSWORD_HASH); return null }
  if (user.account_status !== 'active' || !(await bcrypt.compare(password, user.password_hash))) return null
  const wards = await query('SELECT ward_name FROM user_ward_access WHERE user_id = $1 ORDER BY ward_name', [user.id])
  return { id: user.id, fullName: user.full_name, username: user.username, email: user.email, phone: user.phone, role: user.role, assignedFloor: user.assigned_floor ? Number(user.assigned_floor) : null, assignedWards: wards.rows.map((row) => row.ward_name) }
}
