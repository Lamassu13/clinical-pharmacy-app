import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, query } from './db.js'
import { STARTER_MEDICINES } from './starter-medicines.js'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const schema = await fs.readFile(path.join(serverDirectory, 'schema.sql'), 'utf8')
await query(schema)
console.log('Database schema is ready')

await query('INSERT INTO medicines (name) SELECT UNNEST($1::text[]) ON CONFLICT (name) DO NOTHING', [STARTER_MEDICINES])
console.log(`Seeded starter medicines (${STARTER_MEDICINES.length} names; existing rows untouched)`)

await pool.end()
