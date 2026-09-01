import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, query } from './db.js'
import { STARTER_MEDICINES } from './starter-medicines.js'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const schema = await fs.readFile(path.join(serverDirectory, 'schema.sql'), 'utf8')
await query(schema)
console.log('Database schema is ready')

// Seed only into an empty catalogue. This runs on every deploy, and an unconditional
// insert resurrected every starter medicine an admin had deleted — and re-added the old
// name of any they had renamed, as a second row. Once the table has rows, the admin
// screen owns it.
const seeded = await query(
  'INSERT INTO medicines (name) SELECT name FROM UNNEST($1::text[]) AS s(name) WHERE NOT EXISTS (SELECT 1 FROM medicines) ON CONFLICT (name) DO NOTHING',
  [STARTER_MEDICINES],
)
console.log(seeded.rowCount
  ? `Seeded ${seeded.rowCount} starter medicines into an empty catalogue`
  : 'Medicines catalogue already has rows — left untouched')

await pool.end()
