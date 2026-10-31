import dns from 'node:dns'
import pg from 'pg'
import 'dotenv/config'

// Render has no outbound IPv6 route: a host that resolves to an IPv6 address first fails with
// ENETUNREACH on port 5432. Try IPv4 first; nothing changes where IPv6 works.
dns.setDefaultResultOrder('ipv4first')

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_SIZE || 10),
  idleTimeoutMillis: 30_000,
  // A dead socket (dropped without a close) is noticed after 10s idle instead of the OS's ~2 hours.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  // Opening a connection to Neon now and then took over 5s ("Connection terminated due to
  // connection timeout" in the session lookup, a 500 on whatever request it was): a slow request
  // beats a failed one.
  connectionTimeoutMillis: 10_000,
  // Encrypted AND checked: without verifying Neon's certificate (a public CA's), anyone between
  // Render and Neon could pose as the database. An `sslmode=` in DATABASE_URL takes precedence
  // over this (pg applies the connection string last); Neon's `sslmode=require` also verifies.
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
})

// A pooled client can fail while it is idle — the managed Postgres closes connections
// it considers stale, and the network drops. `pg` reports that on the pool itself, and
// an EventEmitter 'error' with no listener throws and takes the whole process down.
// The pool has already discarded the broken client by the time this runs, so logging
// is the correct response: the next checkout opens a fresh connection.
pool.on('error', (error) => {
  console.error('idle database client error (connection dropped, pool recovered):', error.message)
})

// Rows and rough bytes each statement pulled out of Postgres since this process started, so the
// next "why is Neon's network transfer high" is answered by a table, not a guess. Patched on the
// Client prototype so pool.query and a checked-out transaction client are both counted.
// ponytail: bytes are an estimate (string length, 8 per other value), memory only, reset on
// restart; statements are grouped by their first 70 characters and capped at 300 groups.
const traffic = new Map()
const tally = (text, result) => {
  if (typeof text !== 'string' || !Array.isArray(result?.rows) || !result.rows.length) return
  const label = text.replace(/\s+/g, ' ').trim().slice(0, 70)
  let entry = traffic.get(label)
  if (!entry) {
    if (traffic.size >= 300) return
    entry = { calls: 0, rows: 0, bytes: 0 }
    traffic.set(label, entry)
  }
  let bytes = 0
  for (const row of result.rows) for (const value of Object.values(row)) bytes += typeof value === 'string' ? value.length : 8
  entry.calls += 1; entry.rows += result.rows.length; entry.bytes += bytes
}
const clientQuery = pg.Client.prototype.query
pg.Client.prototype.query = function (config, ...rest) {
  const text = typeof config === 'string' ? config : config?.text
  // pool.query hands the client a callback (and gets undefined back); a transaction client is
  // awaited. A throw in tally must never skip the callback, or the pool would never get the client back.
  if (typeof rest.at(-1) === 'function') {
    const done = rest.pop()
    return clientQuery.call(this, config, ...rest, (error, result) => { try { if (!error) tally(text, result) } catch { /* measurement only */ } done(error, result) })
  }
  const result = clientQuery.call(this, config, ...rest)
  if (typeof result?.then === 'function') result.then((done) => tally(text, done), () => {})
  return result
}
export const dbTraffic = () => [...traffic].map(([statement, entry]) => ({ statement, ...entry })).sort((a, b) => b.bytes - a.bytes).slice(0, 10)
export const trafficSince = new Date().toISOString()

export const query = (text, params) => pool.query(text, params)

export const checkDatabase = async () => {
  const result = await query('SELECT NOW() AS server_time')
  return result.rows[0]
}
