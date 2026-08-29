import bcrypt from 'bcryptjs'
import 'dotenv/config'
import { query, pool } from './db.js'

const [fullName, username, email, phone, fingerprintNumber, password] = process.argv.slice(2)
if (![fullName, username, email, phone, fingerprintNumber, password].every(Boolean)) {
  console.error('Usage: node server/create-admin.js "Full name" username email phone fingerprint password')
  process.exit(1)
}

const passwordHash = await bcrypt.hash(password, 12)
await query('INSERT INTO users (full_name, username, email, phone, fingerprint_number, password_hash, role, account_status) VALUES ($1, $2, $3, $4, $5, $6, \'admin\', \'active\')', [fullName, username, email, phone, fingerprintNumber, passwordHash])
console.log(`Admin account created for ${username}`)
await pool.end()
