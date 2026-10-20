import { query } from './db.js'
import { memoizeAsync } from './cache.js'

// GET /api/medicines is read by every device on login and again every minute while a chart is open.
// It changes only through POST/PUT/DELETE /api/medicines, which invalidate it (server/index.js);
// the TTL covers anything that edits the table behind the app's back.
export const medicineCatalogue = memoizeAsync(
  async () => (await query('SELECT id, name, arabic_name, is_supply, no_thursday_double FROM medicines ORDER BY name ASC')).rows,
  { ttlMs: 5 * 60 * 1000 },
)
