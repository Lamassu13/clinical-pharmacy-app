// Fixed option lists and layout limits shared across the app. The ward and pill-form lists
// are duplicated on the server (server/validation.js) because it validates against them too;
// keep the two in sync.
export const floors = [
  { number: 2, wards: ['ردهة رجال', 'ردهة النساء', 'ردهة الخاص'] },
  { number: 3, wards: ['الردهة الجراحية', 'ردهة الخاص', 'ردهة CCU'] },
  { number: 4, wards: ['ردهة الحوامل', 'ردهة الجراحية'] },
  { number: 5, wards: ['ردهة رجال', 'ردهة النساء', 'ردهة الخاص'] },
  { number: 6, wards: ['ردهة الخاص', 'الوحدة الأولى', 'الوحدة الثالثة'] },
  { number: 8, wards: ['الردهة الخامسة', 'ردهة القسطرة', 'ردهة الخاص'] },
  { number: 9, wards: ['ردهة الخاص', 'الردهة الرابعة', 'الردهة الثانية'] },
  { number: 10, wards: ['الردهة العصبية', 'ردهة المفاصل', 'الردهة النفسية'] },
]
export const specialWards = ['ردهة الديلزة', 'ردهة العناية المركزة', 'ردهة الخدج']
// Keep in sync with ASSIGNABLE_ROLES in server/index.js.
export const roleLabels = { admin: 'مدير', supervisor: 'مسؤول', user: 'مستخدم' }
export const PATIENT_ROWS = 41
export const CHART_COLUMNS = 51
// Safety ceiling for "+ عمود" (src/App.jsx's addColumn) — keep in sync with
// MAX_CHART_COLUMNS in server/validation.js and the CHECK constraints in server/schema.sql.
export const MAX_CHART_COLUMNS = 80
// Fixed pill-form option lists. Keep in sync with server/index.js.
export const doseTimes = ['٨ صباحًا', '٩ صباحًا', '١٠ صباحًا', '١١ صباحًا', '١٢ ظهرًا', '٢ ظهرًا', '٣ ظهرًا', '٤ عصرًا', '٥ عصرًا', '٦ مساءً', '٨ ليلًا', '٩ ليلًا', '١٠ ليلًا', '١٠ صباحًا - ١٠ مساءً', '١٢ ظهرًا - ١٢ ليلًا', '١٢ ظهرًا - ٨ ليلًا', '٨ صباحًا - ٤ عصرًا - ١٢ ليلًا', '٦ صباحًا - ١٢ ظهرًا - ٦ مساءً - ١٢ ليلًا']
export const usageMethods = ['حبة بعد الطعام مباشرة', 'حبة قبل الطعام بساعة أو بعده بساعتين', '٢ حبة بعد الطعام مباشرة', 'نصف حبة قبل الطعام', 'نصف حبة بعد الطعام', 'حبة قبل الفطور بساعة', 'كبسولة قبل الطعام بساعة أو بعده بساعتين', 'كبسولة بعد الطعام مباشرة', 'حبة مع الطعام', 'حبة تحت اللسان عند الحاجة', 'حبة ونصف بعد الطعام']
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
