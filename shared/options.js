// The fixed lists both sides use: the client offers them, the server validates against them.
// One copy, imported by src/constants.js and server/validation.js — it used to be two, kept in
// step by hand. server/schema.sql still spells the floors and the row/column caps out in its CHECK
// constraints; a change to those needs a matching migration there.

export const FLOORS = [
  { number: 2, wards: ['ردهة رجال', 'ردهة النساء', 'ردهة الخاص'] },
  { number: 3, wards: ['الردهة الجراحية', 'ردهة الخاص', 'ردهة CCU'] },
  { number: 4, wards: ['ردهة الحوامل', 'ردهة الجراحية'] },
  { number: 5, wards: ['ردهة رجال', 'ردهة النساء', 'ردهة الخاص'] },
  { number: 6, wards: ['ردهة الخاص', 'الوحدة الأولى', 'الوحدة الثالثة'] },
  { number: 8, wards: ['الردهة الخامسة', 'ردهة القسطرة', 'ردهة الخاص'] },
  { number: 9, wards: ['ردهة الخاص', 'الردهة الرابعة', 'الردهة الثانية'] },
  { number: 10, wards: ['الردهة العصبية', 'ردهة المفاصل', 'الردهة النفسية'] },
]
export const SPECIAL_WARDS = ['ردهة العناية المركزة']
// «استمارة الحبوب الإضافي» exists only on these floors.
export const EXTRA_PILL_FLOORS = [3, 6, 8, 9]

export const ROLE_LABELS = { admin: 'مدير', supervisor: 'مسؤول', user: 'مستخدم' }

// A chart starts with PATIENT_ROWS patient rows — what one printed A4 page holds — and «+ صف» adds blank rows up to
// MAX_PATIENT_ROWS. Past 41 the printed chart takes a second page, which carries the rows after the 41st and the totals
// (and the Thursday doubled row): at the first page's row height it holds up to 41 rows, so 80 is 41 + 39 data rows
// + the two totals rows. server/schema.sql spells the same cap out in its CHECKs.
export const PATIENT_ROWS = 41
export const MAX_PATIENT_ROWS = 80
// Safety ceiling for the chart's manual "+ عمود" (add column).
export const MAX_CHART_COLUMNS = 80
// What one note cell of the printed pills sheet holds (26 mm row): ~110 chars at 12px, 150 at
// 11px (PillsPrintTemplate shrinks a long note).
export const MAX_NOTE_LENGTH = 150

export const DOSE_TIMES = ['٨ صباحًا', '٩ صباحًا', '١٠ صباحًا', '١١ صباحًا', '١٢ ظهرًا', '٢ ظهرًا', '٣ ظهرًا', '٤ عصرًا', '٥ عصرًا', '٦ مساءً', '٨ ليلًا', '٩ ليلًا', '١٠ ليلًا', '١٠ صباحًا - ١٠ مساءً', '١٢ ظهرًا - ١٢ ليلًا', '١٢ ظهرًا - ٨ ليلًا', '٨ صباحًا - ٤ عصرًا - ١٢ ليلًا', '٦ صباحًا - ١٢ ظهرًا - ٦ مساءً - ١٢ ليلًا']
export const USAGE_METHODS = ['حبة بعد الطعام مباشرة', 'حبة قبل الطعام بساعة أو بعده بساعتين', '٢ حبة بعد الطعام مباشرة', '٣ حبة بعد الطعام مباشرة', 'نصف حبة قبل الطعام', 'نصف حبة بعد الطعام', 'حبة قبل الفطور بساعة', 'كبسولة قبل الطعام بساعة أو بعده بساعتين', 'كبسولة بعد الطعام مباشرة', 'حبة مع الطعام', 'حبة تحت اللسان عند الحاجة', 'حبة ونصف بعد الطعام']
