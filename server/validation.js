// Pure request-validation helpers and the fixed option lists they check against.
// Kept out of index.js so they can be unit tested without booting the server.

export const ALLOWED_FLOORS = [2, 3, 4, 5, 6, 8, 9, 10]
export const MAX_PATIENT_ROWS = 41
export const SPECIAL_WARDS = ['ردهة الديلزة', 'ردهة العناية المركزة', 'ردهة الخدج']
// Ward names per floor. Keep in sync with `floors` in src/App.jsx. Charts may only
// reference a ward on this list, otherwise any string would mint a new wards row.
export const FLOOR_WARDS = {
  2: ['ردهة رجال', 'ردهة النساء', 'ردهة الخاص'],
  3: ['الردهة الجراحية', 'ردهة الخاص', 'ردهة CCU'],
  4: ['ردهة الحوامل', 'ردهة الجراحية'],
  5: ['ردهة رجال', 'ردهة النساء', 'ردهة الخاص'],
  6: ['ردهة الخاص', 'الوحدة الأولى', 'الوحدة الثالثة'],
  8: ['الردهة الخامسة', 'ردهة القسطرة', 'ردهة الخاص'],
  9: ['ردهة الخاص', 'الردهة الرابعة', 'الردهة الثانية'],
  10: ['الردهة العصبية', 'ردهة المفاصل', 'الردهة النفسية'],
}
export const isKnownWard = (floor, wardName) => (
  Number.isInteger(floor) ? (FLOOR_WARDS[floor] || []).includes(wardName) : SPECIAL_WARDS.includes(wardName)
)
// A medicine belongs on the pill administration form when its name names an oral solid.
export const PILL_FORM = /\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules)\b/i
// Fixed option lists for the pill form. Keep in sync with src/App.jsx.
export const DOSE_TIMES = ['٨ صباحًا', '٩ صباحًا', '١٠ صباحًا', '١١ صباحًا', '١٢ ظهرًا', '٢ ظهرًا', '٣ ظهرًا', '٤ عصرًا', '٥ عصرًا', '٦ مساءً', '٨ ليلًا', '٩ ليلًا', '١٠ ليلًا', '١٠ صباحًا - ١٠ مساءً', '١٢ ظهرًا - ١٢ ليلًا', '١٢ ظهرًا - ٨ ليلًا', '٨ صباحًا - ٤ عصرًا - ١٢ ليلًا', '٦ صباحًا - ١٢ ظهرًا - ٦ مساءً - ١٢ ليلًا']
export const USAGE_METHODS = ['حبة بعد الطعام مباشرة', 'حبة قبل الطعام بساعة أو بعده بساعتين', '٢ حبة بعد الطعام مباشرة', 'نصف حبة قبل الطعام', 'نصف حبة بعد الطعام']
export const NOTE_OPTIONS = ['الامتناع عن تناول منتجات الأجبان والألبان قبل وبعد الحبة بساعتين']
export const canAccessLocation = (user, floor, wardName) => {
  if (user.role === 'admin') return true
  if (Number.isInteger(floor)) return floor === user.assignedFloor
  return Array.isArray(user.assignedWards) && user.assignedWards.includes(wardName)
}
export const clampInt = (value, min, max) => {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}
export const isIsoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
export const cleanText = (value, maxLength) => String(value ?? '').slice(0, maxLength)
