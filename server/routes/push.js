import express from 'express'
import { query } from '../db.js'
import { requireAuth } from '../auth.js'
import { isAllowedEndpoint, pushPublicKey } from '../push.js'

const router = express.Router()
const MAX_PER_USER = 10
const B64URL = /^[A-Za-z0-9_-]+$/

router.get('/push/key', requireAuth, (_request, response) => response.json({ key: pushPublicKey() }))

router.post('/push/subscribe', requireAuth, async (request, response) => {
  const { endpoint, keys } = request.body || {}
  const p256dh = keys?.p256dh
  const auth = keys?.auth
  if (!isAllowedEndpoint(endpoint)
    || typeof p256dh !== 'string' || p256dh.length < 20 || p256dh.length > 200 || !B64URL.test(p256dh)
    || typeof auth !== 'string' || auth.length < 10 || auth.length > 50 || !B64URL.test(auth)) {
    return response.status(400).json({ message: 'اشتراك الإشعارات غير صالح' })
  }
  const userId = request.session.user.id
  // Rows left by sessions that have since ended (sign-out is cleaned up, a lapsed cookie is not) and
  // by browsers that issued a new endpoint must not count toward the cap: the device re-registers on
  // its next sign-in anyway.
  await query('DELETE FROM push_subscriptions ps WHERE ps.user_id = $1 AND NOT EXISTS (SELECT 1 FROM session s WHERE s.sid = ps.sid AND s.expire > NOW())', [userId])
  const others = await query('SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id = $1 AND endpoint <> $2', [userId, endpoint])
  if (others.rows[0].n >= MAX_PER_USER) return response.status(400).json({ message: 'عدد الأجهزة المفعّلة وصل الحد الأقصى' })
  // Same device, new person: the endpoint moves to whoever is signed in on it now.
  await query(
    `INSERT INTO push_subscriptions (user_id, sid, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, sid = EXCLUDED.sid, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [userId, request.sessionID, endpoint, p256dh, auth],
  )
  response.status(201).json({ ok: true })
})

router.delete('/push/subscribe', requireAuth, async (request, response) => {
  const endpoint = request.body?.endpoint
  if (typeof endpoint !== 'string') return response.status(400).json({ message: 'اشتراك غير صالح' })
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, request.session.user.id])
  response.json({ ok: true })
})

export default router
