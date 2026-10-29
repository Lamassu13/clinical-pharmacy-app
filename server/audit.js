import { query } from './db.js'

// Admin audit log: who did a consequential admin action, when, to what. Best-effort by design —
// a failed insert is logged and swallowed, never failing the action it records. The actor is a
// snapshot (name), not a users(id) reference, so deleting an account neither breaks nor loses it.
const KEEP_DAYS = 365
const PRUNE_EVERY_MS = 24 * 3600 * 1000
let lastPrune = 0 // per process; piggybacks on an insert, so an idle API never wakes Neon

export { ROLE_LABELS as ROLE_AR } from '../shared/options.js'

export const recordAudit = async (request, action, target = '', detail = '') => {
  const actor = request.session?.user
  try {
    await query(
      'INSERT INTO audit_log (actor_id, actor_name, action, target, detail) VALUES ($1, $2, $3, $4, $5)',
      [actor?.id ?? null, actor ? `${actor.fullName || ''} (${actor.username || actor.id})` : '', action, String(target).slice(0, 200), String(detail).slice(0, 500)],
    )
    if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
      lastPrune = Date.now()
      await query(`DELETE FROM audit_log WHERE at < NOW() - INTERVAL '${KEEP_DAYS} days'`)
    }
  } catch (error) { console.error('audit log failed (the action itself is kept):', error.message) }
}

export const PAGE = 200
// Newest first; `before` is the id of the last row already shown. One extra row says "more".
export const readAudit = async (before) => {
  const result = await query(
    'SELECT id, at, actor_name, action, target, detail FROM audit_log WHERE ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT $2',
    [before, PAGE + 1],
  )
  return { entries: result.rows.slice(0, PAGE).map((row) => ({ id: row.id, at: row.at, actor: row.actor_name, action: row.action, target: row.target, detail: row.detail })), more: result.rows.length > PAGE }
}
