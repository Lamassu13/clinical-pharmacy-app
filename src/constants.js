// Fixed option lists and layout limits used across the app. The ones the server validates too —
// floors and wards, roles, the pill-form options, the row/column/note caps — come from
// shared/options.js, the one copy both sides import.
import { FLOORS, SPECIAL_WARDS, EXTRA_PILL_FLOORS, ROLE_LABELS, PATIENT_ROWS, MAX_CHART_COLUMNS, MAX_NOTE_LENGTH, DOSE_TIMES, USAGE_METHODS } from '../shared/options.js'

export { EXTRA_PILL_FLOORS, PATIENT_ROWS, MAX_CHART_COLUMNS, MAX_NOTE_LENGTH }
export const floors = FLOORS
export const specialWards = SPECIAL_WARDS
export const roleLabels = ROLE_LABELS
// The grid's starting width; "+ عمود" grows a chart up to MAX_CHART_COLUMNS.
export const CHART_COLUMNS = 51
export const doseTimes = DOSE_TIMES
export const usageMethods = USAGE_METHODS
export const noteOptions = ['الامتناع عن تناول منتجات الأجبان والألبان قبل وبعد الحبة بساعتين', 'لا يؤخذ مع الخضراوات الورقية الخضراء']
// The 18 dose times are a flat list; grouped once here (rather than in each pill-form screen)
// so a single "٨ صباحًا" isn't buried among the "٨ صباحًا - ٤ عصرًا - ١٢ ليلًا" schedules.
export const doseTimeGroups = [
  ['أوقات مفردة', doseTimes.filter((time) => !time.includes(' - '))],
  ['جداول موزّعة', doseTimes.filter((time) => time.includes(' - '))],
]
// Optional chaining (not just a Vite habit): `import.meta.env` is undefined under plain
// `node --test`, which is how src/helpers.test.js imports this module — Vite itself always
// provides a real env object, so this is a no-op there.
export const apiUrl = import.meta.env?.VITE_API_URL || (import.meta.env?.DEV ? 'http://localhost:3001/api' : '/api')
