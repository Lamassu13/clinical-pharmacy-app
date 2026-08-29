import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, query } from './db.js'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const schema = await fs.readFile(path.join(serverDirectory, 'schema.sql'), 'utf8')
await query(schema)
console.log('Database schema is ready')
await pool.end()
