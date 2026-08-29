import bcrypt from 'bcryptjs'
import 'dotenv/config'
import { pool, query } from './db.js'

const username = process.argv[2] || 'username'
const password = process.env.ADMIN_PASSWORD
if (!password) {
  console.error('Set ADMIN_PASSWORD in the current shell before running this command.')
  process.exit(1)
}

const passwordHash = await bcrypt.hash(password, 12)
const result = await query("UPDATE users SET password_hash = $1, account_status = 'active', role = 'admin' WHERE username = $2 OR email = $2 RETURNING username, email", [passwordHash, username])
if (!result.rowCount) {
  console.error('Admin account was not found.')
  process.exitCode = 1
} else {
  console.log(`Password reset for ${result.rows[0].username}`)
}
await pool.end()
