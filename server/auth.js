import bcrypt from 'bcryptjs'
import { query } from './db.js'

export const requireAuth = (request, response, next) => {
  if (!request.session.user) return response.status(401).json({ message: 'تسجيل الدخول مطلوب' })
  next()
}

export const requireAdmin = (request, response, next) => {
  if (request.session.user?.role !== 'admin') return response.status(403).json({ message: 'صلاحية المدير مطلوبة' })
  next()
}

export const authenticateUser = async (username, password) => {
  const result = await query('SELECT u.id, u.full_name, u.username, u.role, u.account_status, u.password_hash, MIN(ufa.floor_number) AS assigned_floor FROM users u LEFT JOIN user_floor_access ufa ON ufa.user_id = u.id WHERE u.username = $1 OR u.email = $1 GROUP BY u.id', [username])
  const user = result.rows[0]
  if (!user || user.account_status !== 'active' || !(await bcrypt.compare(password, user.password_hash))) return null
  return { id: user.id, fullName: user.full_name, username: user.username, role: user.role, assignedFloor: user.assigned_floor ? Number(user.assigned_floor) : null }
}
