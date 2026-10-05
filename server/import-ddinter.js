// Loads the DDInter drug-drug interaction CSVs into drug_interactions (reference data, no patient
// data). Download the files from https://ddinter.scbdd.com/download/ (CC BY-NC-SA 4.0) into
// data/ddinter/, then:  node --env-file=.env server/import-ddinter.js [folder-or-files...]
// Safe to re-run: existing pairs are kept. Afterwards it lists catalogue medicines that matched no
// pair, so a missing brand->generic mapping in server/generic-names.js shows up.
import fs from 'node:fs/promises'
import path from 'node:path'
import { pool, query } from './db.js'
import { genericName } from './generic-names.js'

const LEVELS = new Set(['major', 'moderate', 'minor'])

// One CSV line, honouring double-quoted fields.
const splitCsv = (line) => {
  const cells = []
  let cell = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) { if (char === '"') { if (line[i + 1] === '"') { cell += '"'; i++ } else quoted = false } else cell += char }
    else if (char === '"') quoted = true
    else if (char === ',') { cells.push(cell); cell = '' }
    else cell += char
  }
  cells.push(cell)
  return cells.map((value) => value.trim())
}

const inputs = process.argv.slice(2)
if (!inputs.length) inputs.push('data/ddinter')
const files = []
for (const input of inputs) {
  const stat = await fs.stat(input)
  if (stat.isDirectory()) (await fs.readdir(input)).filter((name) => name.toLowerCase().endsWith('.csv')).sort().forEach((name) => files.push(path.join(input, name)))
  else files.push(input)
}
if (!files.length) { console.error('No CSV files found.'); process.exit(1) }

const pairs = new Map()
let skipped = 0
for (const file of files) {
  const lines = (await fs.readFile(file, 'utf8')).replace(/^﻿/, '').split(/\r?\n/).filter(Boolean)
  const header = splitCsv(lines[0]).map((value) => value.toLowerCase())
  const colA = header.findIndex((value) => /^drug_?a$/.test(value)), colB = header.findIndex((value) => /^drug_?b$/.test(value)), colLevel = header.findIndex((value) => value === 'level')
  if (colA < 0 || colB < 0 || colLevel < 0) { console.error(`${file}: expected Drug_A, Drug_B and Level columns, found: ${header.join(', ')}`); process.exit(1) }
  lines.slice(1).forEach((line) => {
    const cells = splitCsv(line)
    const level = (cells[colLevel] || '').toLowerCase()
    const a = (cells[colA] || '').toLowerCase().replace(/\s+/g, ' '), b = (cells[colB] || '').toLowerCase().replace(/\s+/g, ' ')
    if (!a || !b || a === b || !LEVELS.has(level)) { skipped += 1; return } // "Unknown" level carries no signal
    const [first, second] = a < b ? [a, b] : [b, a]
    pairs.set(`${first}|${second}`, { first, second, level })
  })
  console.log(`read ${file}`)
}

const rows = [...pairs.values()]
for (let i = 0; i < rows.length; i += 5000) {
  const batch = rows.slice(i, i + 5000)
  await query('INSERT INTO drug_interactions (drug_a, drug_b, level) SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[]) ON CONFLICT DO NOTHING', [batch.map((row) => row.first), batch.map((row) => row.second), batch.map((row) => row.level)])
}
const count = (await query('SELECT COUNT(*)::int AS n, pg_size_pretty(pg_total_relation_size(\'drug_interactions\')) AS size FROM drug_interactions')).rows[0]
console.log(`${rows.length} pairs read (${skipped} lines skipped); table now holds ${count.n} pairs, ${count.size}`)

const known = new Set((await query('SELECT drug_a AS g FROM drug_interactions UNION SELECT drug_b FROM drug_interactions')).rows.map((row) => row.g))
const unmatched = (await query('SELECT name FROM medicines WHERE NOT is_supply ORDER BY name')).rows.map((row) => row.name).filter((name) => !known.has(genericName(name)))
console.log(unmatched.length ? `${unmatched.length} catalogue medicines match no DDInter drug (add a brand->generic line to server/generic-names.js, or they have no recorded interactions):\n  ${unmatched.join('\n  ')}` : 'Every catalogue medicine matches a DDInter drug.')
await pool.end()
