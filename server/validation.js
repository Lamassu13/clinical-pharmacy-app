// Pure request-validation helpers and the fixed option lists they check against.
// Kept out of index.js so they can be unit tested without booting the server.

import { FLOORS, SPECIAL_WARDS, EXTRA_PILL_FLOORS, PATIENT_ROWS, MAX_CHART_COLUMNS, MAX_NOTE_LENGTH, DOSE_TIMES, USAGE_METHODS } from '../shared/options.js'

// The lists themselves live in shared/options.js, which the client imports too.
export { SPECIAL_WARDS, EXTRA_PILL_FLOORS, MAX_CHART_COLUMNS, MAX_NOTE_LENGTH, DOSE_TIMES, USAGE_METHODS }
export const ALLOWED_FLOORS = FLOORS.map((floor) => floor.number)
export const MAX_PATIENT_ROWS = PATIENT_ROWS
// Ward names per floor. Charts may only reference a ward on this list, otherwise any string
// would mint a new wards row.
export const FLOOR_WARDS = Object.fromEntries(FLOORS.map((floor) => [floor.number, floor.wards]))
export const isKnownWard = (floor, wardName) => (
  Number.isInteger(floor) ? (FLOOR_WARDS[floor] || []).includes(wardName) : SPECIAL_WARDS.includes(wardName)
)
// A medicine belongs on the pill administration form when its name names an oral solid.
export const PILL_FORM = /\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules)\b/i
// Two spellings of the same medicine are the same medicine to a pharmacist: "Amoxicillin Cap",
// "amoxicillin cap" and "Amoxicillin  Cap" all name one drug. Everything that has to match a
// typed chart column against the catalogue — or against a pill entry — compares this key
// instead of the raw text, which is what used to drop a whole column from the pill form.
export const normalizeMedicineKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
// The SQL twin of normalizeMedicineKey, for matching a JS-normalised key against a column.
// `column` is always a literal written here, never request data. Postgres `lower` and `\s`
// agree with the JS versions across the ASCII range, which is all a medicine name uses.
export const medicineKeySql = (column) => `lower(btrim(regexp_replace(${column}, '\\s+', ' ', 'g')))`
// Postgres `~*` patterns naming a consumable rather than a drug: the default for the catalogue's
// is_supply flag (new medicines, and the one-time seed in migrate.js), and the fallback for a
// chart column whose medicine was deleted from the catalogue. IV fluids count as supplies;
// "Clexane prefilled syringe" is a drug, hence the exception.
export const SUPPLY_MATCH = 'iv ?-?set|cannula|canula|كانيول|syringe|سرنج|ng tube|catheter|^n/s|^g/w|^g/s|ringer|^d\\.w'
export const SUPPLY_EXCEPT = 'prefilled|pfs'
export const canAccessLocation = (user, floor, wardName) => {
  // A supervisor oversees the whole unit, so every floor and ward is in scope for them too.
  if (user.role === 'admin' || user.role === 'supervisor') return true
  if (Number.isInteger(floor)) return floor === user.assignedFloor
  return Array.isArray(user.assignedWards) && user.assignedWards.includes(wardName)
}
export const clampInt = (value, min, max) => {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}
// A real calendar day: Date.parse alone accepts 2026-02-31 (rolling it to 3 March), which Postgres
// then rejects — a 500 instead of a 400.
export const isIsoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
export const cleanText = (value, maxLength) => String(value ?? '').slice(0, maxLength)
