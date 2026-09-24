import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, query } from './db.js'
import { STARTER_MEDICINES } from './starter-medicines.js'
import { SUPPLY_MATCH, SUPPLY_EXCEPT } from './validation.js'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const schema = await fs.readFile(path.join(serverDirectory, 'schema.sql'), 'utf8')
// Read before the schema adds it: the supply seed below must run only on the deploy that
// introduces the column, never again over an admin's own ticks and unticks.
const hadSupplyFlag = (await query("SELECT 1 FROM information_schema.columns WHERE table_name = 'medicines' AND column_name = 'is_supply'")).rowCount > 0
await query(schema)
console.log('Database schema is ready')
if (!hadSupplyFlag) {
  const flagged = await query('UPDATE medicines SET is_supply = TRUE WHERE name ~* $1 AND name !~* $2', [SUPPLY_MATCH, SUPPLY_EXCEPT])
  console.log(`Marked ${flagged.rowCount} catalogue entries as supplies`)
}

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
