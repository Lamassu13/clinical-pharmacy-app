import { query } from './db.js'

// Per-user, per-day usage counters, kept in memory and written in one batch at most every few
// minutes — and only when a request arrives, so an idle API never wakes the Neon compute (see the
// polling notes in README). Unflushed counts are lost on a crash — ponytail: acceptable for a
// usage report; flush on SIGTERM covers deploys, and a report read flushes first.
const FLUSH_MS = 5 * 60 * 1000
let lastFlush = Date.now()
// Background traffic that is not the user doing something: the 30 s chart-lock heartbeat and sign-in.
const NOT_A_SAVE = /^\/api\/(chart\/lock|auth\/|errors)/
const pending = new Map() // `${userId}|${day}` -> counters

// Iraq has no DST, so a fixed UTC+3 shift gives the local day.
const localDay = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10)

export const usageMiddleware = (request, response, next) => {
  response.on('finish', () => {
    const userId = request.session?.user?.id
    if (!userId) return
    const key = `${userId}|${localDay()}`
    const entry = pending.get(key) || { requests: 0, writes: 0, bytesIn: 0, bytesOut: 0 }
    entry.requests += 1
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && response.statusCode < 400 && !NOT_A_SAVE.test(request.originalUrl)) entry.writes += 1
    entry.bytesIn += Number(request.headers['content-length']) || 0
    entry.bytesOut += Number(response.getHeader('content-length')) || 0
    pending.set(key, entry)
    if (Date.now() - lastFlush > FLUSH_MS) flushUsage()
  })
  next()
}

export const flushUsage = async () => {
  lastFlush = Date.now()
  if (!pending.size) return
  const batch = [...pending]
  pending.clear()
  const column = (pick) => batch.map(([, entry]) => pick(entry))
  try {
    await query(
      `INSERT INTO user_activity (user_id, day, requests, writes, bytes_in, bytes_out, last_seen)
       SELECT t.* FROM UNNEST($1::bigint[], $2::date[], $3::int[], $4::int[], $5::bigint[], $6::bigint[], $7::timestamptz[]) AS t(user_id, day, requests, writes, bytes_in, bytes_out, last_seen)
       WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id)
       ON CONFLICT (user_id, day) DO UPDATE SET requests = user_activity.requests + EXCLUDED.requests,
         writes = user_activity.writes + EXCLUDED.writes, bytes_in = user_activity.bytes_in + EXCLUDED.bytes_in,
         bytes_out = user_activity.bytes_out + EXCLUDED.bytes_out, last_seen = EXCLUDED.last_seen`,
      [batch.map(([key]) => key.split('|')[0]), batch.map(([key]) => key.split('|')[1]), column((e) => e.requests), column((e) => e.writes), column((e) => e.bytesIn), column((e) => e.bytesOut), batch.map(() => new Date().toISOString())],
    )
  } catch (error) {
    console.error('usage flush failed, keeping the counts for the next try:', error.message)
    for (const [key, entry] of batch) {
      const kept = pending.get(key)
      if (kept) { kept.requests += entry.requests; kept.writes += entry.writes; kept.bytesIn += entry.bytesIn; kept.bytesOut += entry.bytesOut } else pending.set(key, entry)
    }
  }
}

// One row per active account; accounts with no traffic in the period still appear (zeros), since
// "who is not using the app" is half of the question. `lastSeen` is all-time, the sums are windowed.
export const usageReport = async (days) => {
  await flushUsage()
  const since = new Date(Date.now() + 3 * 3600 * 1000 - (days - 1) * 86400000).toISOString().slice(0, 10)
  const result = await query(
    `SELECT u.id, u.full_name, u.username, u.role,
       COALESCE(SUM(a.requests) FILTER (WHERE a.day >= $1), 0) AS requests,
       COALESCE(SUM(a.writes) FILTER (WHERE a.day >= $1), 0) AS writes,
       COALESCE(SUM(a.bytes_in) FILTER (WHERE a.day >= $1), 0) AS bytes_in,
       COALESCE(SUM(a.bytes_out) FILTER (WHERE a.day >= $1), 0) AS bytes_out,
       COUNT(a.day) FILTER (WHERE a.day >= $1) AS active_days,
       MAX(a.last_seen) AS last_seen
     FROM users u LEFT JOIN user_activity a ON a.user_id = u.id
     WHERE u.account_status = 'active'
     GROUP BY u.id ORDER BY COALESCE(SUM(a.bytes_in + a.bytes_out) FILTER (WHERE a.day >= $1), 0) DESC, u.full_name`,
    [since],
  )
  return result.rows.map((row) => ({
    id: row.id, fullName: row.full_name, username: row.username, role: row.role,
    requests: Number(row.requests), writes: Number(row.writes), bytesIn: Number(row.bytes_in), bytesOut: Number(row.bytes_out),
    activeDays: Number(row.active_days), lastSeen: row.last_seen,
  }))
}
