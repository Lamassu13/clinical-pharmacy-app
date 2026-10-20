import webpush from 'web-push'
import { query } from './db.js'

// Web push is best effort and must never get in the way of a save, an announcement or a
// registration: every public function here resolves, whatever the push service does.

const VAPID_READY = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT)
let vapidApplied = false
// Tests swap this for a recorder so nothing goes over the network.
let sender = (subscription, body, options) => {
  if (!vapidApplied) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
    vapidApplied = true
  }
  return webpush.sendNotification(subscription, body, options)
}
let customSender = false
export const setPushSender = (fn) => { sender = fn; customSender = true }

export const pushPublicKey = () => (VAPID_READY() ? process.env.VAPID_PUBLIC_KEY : null)

// web-push POSTs to whatever endpoint it is handed, from this server, so a subscription may only
// point at the push services the browsers actually use.
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/]
export const isAllowedEndpoint = (value) => {
  if (typeof value !== 'string' || value.length > 1024) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((host) => host.test(url.hostname))
  } catch { return false }
}

// The hospital's calendar day, whatever the server's own clock zone is.
export const todayInBaghdad = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date())

const TITLE = 'وحدة الصيدلة السريرية'

// `roles` null = every active user. Audience, role and account status are read at send time,
// and only subscriptions whose login session is still alive receive anything.
export const notify = async ({ roles = null, exceptUserId = null, body, tag, ttl = 3600 }) => {
  try {
    if (!customSender && !VAPID_READY()) return
    const result = await query(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
         FROM push_subscriptions ps
         JOIN session s ON s.sid = ps.sid AND s.expire > NOW()
         JOIN users u ON u.id = ps.user_id AND u.account_status = 'active'
        WHERE ($1::text[] IS NULL OR u.role = ANY($1::text[]))
          AND ($2::bigint IS NULL OR ps.user_id <> $2)`,
      [roles, exceptUserId],
    )
    const payload = JSON.stringify({ title: TITLE, body, tag, url: '/' })
    await Promise.allSettled(result.rows.map(async (row) => {
      try {
        await sender({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, { TTL: ttl, timeout: 5000 })
      } catch (error) {
        // 404/410: the browser dropped the subscription for good.
        if (error?.statusCode === 404 || error?.statusCode === 410) await query('DELETE FROM push_subscriptions WHERE id = $1', [row.id])
        else console.error('push send failed:', error?.statusCode || error?.message)
      }
    }))
  } catch (error) { console.error('push failed:', error?.message) }
}

// Fire after the response is on its way: never awaited by a request, and it cannot throw.
export const notifyLater = (options) => { setImmediate(() => { notify(options).catch(() => {}) }) }

export const MANAGER_ROLES = ['admin', 'supervisor']
