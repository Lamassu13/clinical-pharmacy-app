import { query } from './db.js'
import { memoizeByKey } from './cache.js'

// The two patient-per-day reads in GET /api/dashboard return one row per patient per day (thousands of rows,
// ~0.5-1.5 MB from Neon each) and every manager re-ran them on each return to the floors screen.
// Identical for every manager, so one short-lived copy serves them all; the widgets may lag a
// chart save by up to the TTL.
export const dashboardRows = memoizeByKey((text, params) => query(text, params), { ttlMs: 90_000, max: 10 })
