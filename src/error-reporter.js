import { apiUrl } from './constants.js'

// Sends crashes and failed saves from this device to POST /api/errors (admin list + Telegram).
// Adapted from the error-alerts skill. At most 20 reports per page load, each message once, and
// it never throws: a broken reporter must not break the app. Only the message (300 chars), the
// screen and the device are sent — never form contents, patient names or URLs.
const MAX = 20
const seen = new Set()
let sent = 0
const IGNORE = [/ResizeObserver/i, /Importing a module script failed|dynamically imported module/i, /^Script error/i, /\/api\/errors/i, /Failed to fetch|NetworkError|Load failed|network connection/i]
const device = () => { const agent = navigator.userAgent || ''; return /iPhone|iPad/.test(agent) ? 'iPhone/iPad' : /Android/.test(agent) ? 'Android' : 'Computer' }

export const reportError = (kind, message, place = '') => {
  try {
    // A JSON.parse error quotes the start of the bad input, which could be anything: keep the clause, drop the quote.
    const msg = String(message ?? '').replace(/("|').*\1/s, '$1…$1').trim().slice(0, 300)
    if (!msg || sent >= MAX || seen.has(msg) || !navigator.onLine || IGNORE.some((pattern) => pattern.test(msg))) return
    seen.add(msg); sent += 1
    fetch(`${apiUrl}/errors`, {
      method: 'POST', credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, msg, place: String(place).slice(0, 200), screen: document.title.split(' · ')[0], device: device() }),
    }).catch(() => {})
  } catch { /* never break the app */ }
}

export const initErrorReporter = () => {
  window.addEventListener('error', (event) => reportError('error', event.message, `${String(event.filename || '').split('/').pop() || 'app'}${event.lineno ? `:${event.lineno}` : ''}`))
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    reportError('promise', reason?.message || reason, String(reason?.stack || '').split('\n')[1]?.trim())
  })
}
