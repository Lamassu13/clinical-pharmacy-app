import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_SIZE || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
})

// A pooled client can fail while it is idle — the managed Postgres closes connections
// it considers stale, and the network drops. `pg` reports that on the pool itself, and
// an EventEmitter 'error' with no listener throws and takes the whole process down.
// The pool has already discarded the broken client by the time this runs, so logging
// is the correct response: the next checkout opens a fresh connection.
pool.on('error', (error) => {
  console.error('idle database client error (connection dropped, pool recovered):', error.message)
})

export const query = (text, params) => pool.query(text, params)

export const checkDatabase = async () => {
  const result = await query('SELECT NOW() AS server_time')
  return result.rows[0]
}
