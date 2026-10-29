import express from 'express'
import { query } from './db.js'
import { requireAdmin, requireAuth } from './auth.js'

// Errors from users' devices → admin list → Telegram. Adapted from the error-alerts skill, with
// Postgres in place of Firestore and the Render server in place of a scheduled job: a new error
// is saved first (so nothing is lost if Telegram is down), then at most one grouped Telegram
// message goes out per 3 hours, from this process. Both secrets live only in Render's environment.
const KEEP_DAYS = 30
const SEND_EVERY_MS = 3 * 3600 * 1000
const BATCH_MS = 2 * 60 * 1000 // a burst (one crash on many devices) goes out as one message
const RETRY_MS = 15 * 60 * 1000
const TELEGRAM_MAX = 3800
const PAGE = 100
const MAX_PER_USER_HOUR = 60
const TIME_ZONE = 'Asia/Baghdad'

const router = express.Router()
const str = (value, max) => String(value ?? '').trim().slice(0, max)

// MM-DD HH:MM in the unit's time zone.
export const shortTime = (iso, timeZone = TIME_ZONE) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((part) => [part.type, part.value]))
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

// The same message from many devices becomes one line with a count, most frequent first.
export const errorText = (rows, { appName = 'الصيدلة السريرية', hint = 'صفحة «الأخطاء» في التطبيق' } = {}) => {
  const groups = new Map()
  for (const row of rows) {
    const group = groups.get(row.msg) || { count: 0, last: 0, users: new Set(), places: new Set(), devices: new Set() }
    group.count += 1
    group.last = Math.max(group.last, new Date(row.at).getTime())
    if (row.username) group.users.add(row.username)
    if (row.screen || row.place) group.places.add(row.screen || row.place)
    if (row.device) group.devices.add(row.device)
    groups.set(row.msg, group)
  }
  const lines = [...groups].sort((a, b) => b[1].count - a[1].count).map(([msg, group]) =>
    `• ${group.count > 1 ? `×${group.count} ` : ''}${msg}\n   ${[[...group.users].join(', '), [...group.places].join(', '), [...group.devices].join(', '), `last ${shortTime(group.last)}`].filter(Boolean).join(' · ')}`)
  // One message only (Telegram rate-limits a run of chunks, and a retry would resend the early ones).
  const head = `🐞 ${appName} — ${rows.length} ${rows.length === 1 ? 'خطأ جديد' : 'أخطاء جديدة'}\n\n`
  const foot = `\n\nالتفاصيل: ${hint}`
  let body = ''
  let shown = 0
  for (const line of lines) {
    if (head.length + body.length + line.length + foot.length + 40 > TELEGRAM_MAX) break
    body += `${shown ? '\n' : ''}${line}`; shown += 1
  }
  return `${head}${body}${shown < lines.length ? `\n… +${lines.length - shown} رسائل أخرى` : ''}${foot}`
}

const sendTelegram = async (text) => {
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  })
  if (!response.ok) throw new Error(`Telegram ${response.status}`) // the token is never in the message
}

let lastSent = 0
let timer = null
// Sends every unsent error as one message. `send` is injectable for tests. Rows are marked only
// after the message went out, so a Telegram outage retries on the next window instead of losing them.
export const flushErrors = async (send = sendTelegram) => {
  const result = await query('SELECT id, at, msg, place, screen, username, device FROM app_errors WHERE NOT notified ORDER BY id LIMIT 300')
  if (!result.rows.length) return 0
  await send(errorText(result.rows))
  await query('UPDATE app_errors SET notified = TRUE WHERE id = ANY($1::bigint[])', [result.rows.map((row) => row.id)])
  lastSent = Date.now()
  return result.rows.length
}

// A new error schedules one send: after BATCH_MS, or when the 3 h window since the last message
// ends. The timer is cleared only once the flush has settled, so a second error arriving during a
// slow send cannot start a second flush of the same rows; a failed send retries after RETRY_MS.
// ponytail: only while the process is awake — a sleeping Render instance forgets the timer and
// the saved rows wait for the next error (fine for "tell me"; the admin page has them all), and
// the 3 h spacing restarts at 0 after a restart. Persist lastSent / poll if that ever matters.
const configured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
const scheduleSend = (delay = Math.max(BATCH_MS, lastSent + SEND_EVERY_MS - Date.now())) => {
  if (!configured() || timer) return
  timer = setTimeout(() => {
    flushErrors()
      .catch((error) => { console.error('telegram error alert failed, retrying later:', error.message); retry = true })
      .finally(() => { timer = null; if (retry) { retry = false; scheduleSend(RETRY_MS) } })
  }, delay)
  timer.unref?.()
}
let retry = false

const perUser = new Map() // userId -> { hour, count }
let lastPrune = 0

router.post('/errors', requireAuth, async (request, response) => {
  const msg = str(request.body?.msg, 300)
  if (!msg) return response.status(400).json({ message: 'الرسالة مطلوبة' })
  const hour = Math.floor(Date.now() / 3600000)
  const mine = perUser.get(request.session.user.id)
  const entry = mine?.hour === hour ? mine : { hour, count: 0 }
  perUser.set(request.session.user.id, entry)
  if (++entry.count > MAX_PER_USER_HOUR) return response.status(204).end()
  try {
    await query('INSERT INTO app_errors (kind, msg, place, screen, username, device) VALUES ($1, $2, $3, $4, $5, $6)',
      [str(request.body.kind, 20), msg, str(request.body.place, 200), str(request.body.screen, 100), str(request.session.user.username, 100), str(request.body.device, 20)])
    if (Date.now() - lastPrune > 24 * 3600 * 1000) { // piggybacks on an insert, so an idle API never wakes Neon
      lastPrune = Date.now()
      await query(`DELETE FROM app_errors WHERE at < NOW() - INTERVAL '${KEEP_DAYS} days'`)
    }
    scheduleSend()
  } catch (error) { console.error('saving an app error failed:', error.message) }
  response.status(204).end()
})

router.get('/errors', requireAdmin, async (_request, response) => {
  const result = await query('SELECT id, at, kind, msg, place, screen, username, device FROM app_errors ORDER BY id DESC LIMIT $1', [PAGE])
  response.json({ errors: result.rows.map((row) => ({ id: row.id, at: row.at, kind: row.kind, msg: row.msg, place: row.place, screen: row.screen, username: row.username, device: row.device })) })
})

// Deletes exactly the rows the admin was looking at, so an error that arrived meanwhile survives.
router.delete('/errors', requireAdmin, async (request, response) => {
  const ids = (Array.isArray(request.body?.ids) ? request.body.ids : []).slice(0, PAGE).map(Number).filter(Number.isSafeInteger)
  await query('DELETE FROM app_errors WHERE id = ANY($1::bigint[])', [ids])
  response.status(204).end()
})

export default router
