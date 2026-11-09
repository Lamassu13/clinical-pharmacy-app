// The restricted-medicine request forms: «استمارة الميرونيم» and «استمارة الالبومين». One spec per
// kind, read by the server (which fields and boxes it accepts) and by the app (the popup's fields, the
// paper form's boxes). The paper layouts themselves live in src/components/*Sheet.jsx.
import { MEROPENEM_PATTERN, doseText } from './dose.js'

// Tick groups: `multiple` false means one choice at most (ticking another replaces it). Option keys
// are what is stored, so they must never change meaning; their text is the paper form's own.
export const DRUG_REQUESTS = {
  meropenem: {
    label: 'استمارة الميرونيم',
    popupKicker: 'أول يوم ميرونيم',
    offlineNote: 'تعذّر التحقق من يوم الكورس (لا يوجد اتصال) — املأها إن كان هذا اليوم الأول للميرونيم.',
    pattern: MEROPENEM_PATTERN,
    sqlPattern: '(meronem|meropenem)',
    // Asked on the first day of the course only; albumin is asked every day it is given.
    firstDayOnly: true,
    fields: [
      // A two-way choice (chips, no typing); on the on-screen sheet only — the paper form has no box for it.
      { key: 'sex', label: 'الجنس', max: 10, choices: ['ذكر', 'أنثى'], required: true },
      { key: 'age', label: 'العمر', max: 30, placeholder: 'مثال: 45', required: true },
      { key: 'weight', label: 'الوزن', unit: 'كغم', max: 20, decimal: true },
      { key: 'scr', label: 'S.cr', max: 30, ltr: true, placeholder: 'mg/dL' },
      { key: 'allergy', label: 'التحسس', max: 200, chips: ['لا يوجد'] },
      { key: 'dose', label: 'الجرعة', max: 120, wide: true, auto: true, placeholder: '1g × 3' },
      { key: 'duration', label: 'تحديد مدة الصرف', max: 120, wide: true, placeholder: 'مثال: 7 أيام', chips: ['5 أيام', '7 أيام', '10 أيام', '14 يومًا'] },
      // Printed above the specialist's signature («الطبيب الاخصائي» / «الطبيب الاختصاص»).
      { key: 'doctor', label: 'اسم الطبيب الاختصاص', max: 120, wide: true },
      // '1' = leave the name off the printed form (the signature line stays). Set from the form's screen, never asked in a dialog.
      { key: 'hideDoctor', label: 'عدم طباعة اسم الطبيب', max: 1, noDialog: true },
    ],
    // The dose as the follow-up form words it: 1g vial × 6 → «2g × 3».
    prefill: (lines) => ({ dose: lines.map((line) => doseText(line.medicine, line.quantity)).join(' + ') }),
    groups: [
      { id: 'diagnosis', multiple: true, options: [
        { key: 'mastoiditis', text: 'Acute mastoiditis' },
        { key: 'sinusitis', text: 'Acute rhinosinusitis due to Intubation' },
        { key: 'meningitis', text: 'Bacterial meningitis' },
        { key: 'blast', text: 'Contaminated blast injury (specify location and severity)' },
        { key: 'gangrene', text: 'Gangrenous cellulitis (necrotizing fasciitis or gas gangrene)' },
        { key: 'hap', text: 'HAP Post-op, Ventilator ESBL positive' },
        { key: 'bronchiectasis', text: 'Infective bronchiectasis exacerbation (with severe lung impairment)' },
        { key: 'lung-abscess', text: 'Lung abscess' },
        { key: 'nve', text: 'NVE - Acute presentation (severe sepsis with ESBL)' },
        { key: 'neutropenic', text: 'Neutropenic sepsis' },
        { key: 'empyema', text: 'Pleural empyema ESBL positive' },
        { key: 'pancreatitis', text: 'Proven acute pancreatitis' },
        { key: 'liver-abscess', text: 'Pyogenic liver abscess' },
        { key: 'resection', text: 'Radical resection performed' },
        { key: 'cap', text: 'Severe CAP admitted to ICU' },
        { key: 'diabetic-foot', text: 'Severe diabetic foot Infection' },
        { key: 'peritonitis', text: 'Severe secondary peritonitis' },
        { key: 'sepsis', text: 'Sepsis (specify the origin of Infection)' },
        { key: 'ssi', text: 'Surgical site infection' },
        // Ticking it opens a box for what to specify (the request's `note`).
        { key: 'others', text: 'Others (specify)' },
      ] },
      { id: 'culture', multiple: false, options: [
        { key: 'culture-after', text: 'Sent after antibiotics' },
        { key: 'culture-before', text: 'Sent before Antibiotics' },
        { key: 'culture-none', text: 'Not sent' },
      ] },
    ],
  },
  albumin: {
    label: 'استمارة الالبومين',
    popupKicker: 'صرف الالبومين',
    offlineNote: 'تعذّر حساب يوم العلاج (لا يوجد اتصال) — اكتبه بنفسك.',
    pattern: /albumin/i,
    sqlPattern: 'albumin',
    firstDayOnly: false,
    // The popup's «Treatment day» starts from the course day the follow-up rules give.
    dayField: 'treatmentDay',
    fields: [
      // Both are asked by the ministry's Google Form (shared/albumin-google-form.js); the age is in years, 0.08 for a month.
      { key: 'sex', label: 'الجنس', max: 10, choices: ['ذكر', 'أنثى'], required: true },
      { key: 'age', label: 'العمر (بالسنة)', max: 6, decimal: true, required: true, placeholder: 'مثال: 45' },
      { key: 'treatmentDay', label: 'Treatment day', max: 4, digits: true },
      { key: 'count', label: 'العدد المطلوب (رقما)', max: 4, digits: true },
      { key: 'serumAlbumin', label: 'Serum albumin', unit: 'g/dl', max: 20, decimal: true },
      { key: 'weight', label: 'Weight', unit: 'kg', max: 20, decimal: true },
      { key: 'scr', label: 'S.creatinine', max: 30, ltr: true, placeholder: 'mg/dL' },
      // Printed above the specialist's signature («الطبيب الاخصائي» / «الطبيب الاختصاص»).
      { key: 'doctor', label: 'اسم الطبيب الاختصاص', max: 120, wide: true },
      // '1' = leave the name off the printed form (the signature line stays). Set from the form's screen, never asked in a dialog.
      { key: 'hideDoctor', label: 'عدم طباعة اسم الطبيب', max: 1, noDialog: true },
      // Written on the form's screen («تعديل»), not asked in the popup.
      { key: 'diagnosis', label: 'Diagnosis', max: 200, wide: true, auto: true, screenOnly: true },
    ],
    prefill: (lines) => ({ count: String(lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0) || '') }),
    // The protocol's numbered indications. `title` prints bold, `inline` follows it in normal weight,
    // `lines` go underneath; **…** marks a bold word inside them, as on the paper form.
    groups: [
      { id: 'indication', multiple: true, options: [
        { key: 'i1', title: '1-Liver cirrhosis with Paracentesis of large volumes > 4 liters' },
        { key: 'i2', title: '2-Paracentesis <4 liters if S.Cr >= 1.5 or the condition is refractory to sodium restriction' },
        { key: 'i3', title: '3-Liver cirrhosis with ascites not responsive to diuretics' },
        { key: 'i4', title: '4-Liver cirrhosis with Hepatorenal syndrome' },
        { key: 'i5', title: '5- Liver cirrhosis with high risk spontaneous bacterial peritonitis' },
        { key: 'i6', title: '6-Acute severe peripheral or pulmonary edema with serum albumin < 2 g/dl' },
        { key: 'i7', title: '7-acute Nephrotic syndrome' },
        { key: 'i8', title: '8-Therapeutic plasmapheresis', lines: ['with large volume plasma exchange > 20ml/kg in one session'] },
        { key: 'i9', title: '9-Adult respiratory distress syndrome' },
        { key: 'i10', title: '10-Post cardio-pulmonary bypass' },
        { key: 'i11', title: '11-Extensive intestinal resection with serum albumin < 2 g/dl' },
        { key: 'i12', title: '12- >40% resection of the liver With serum albumin < 2 g/dl' },
        { key: 'i13', title: '13-Organ transplantation Postoperative liver transplant', lines: ['when **all** the conditions are met:', '-Serum albumin < 2.5 g/dl', '-Hematocrit is > 30%', '-Pulmonary capillary, wedge pressure < 12 mmHg'] },
        { key: 'i14', title: '14-Burns' },
        { key: 'i15', title: '15- Hyperbilirubinemia of the newborn' },
        { key: 'i16', title: '16-Malnutrition syndrome', inline: ' if **all** the following conditions are met', lines: ['-Significant diarrhea > 2 liters per day', '- serum albumin < 2 g/dl'] },
        { key: 'i17', title: '17-Second line in hypovolemic, bleeding and hemorrhage shock', inline: ' when solutions of crystalloids (use as first choice treatment) have already being used at maximum dosage without having produced a clinically adequate response.' },
      ] },
    ],
  },
}

export const DRUG_REQUEST_KINDS = Object.keys(DRUG_REQUESTS)
export const MAX_REQUEST_NOTE = 300

const toEnglish = (value) => String(value ?? '').replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))

// One field's typed value, cleaned the same way on both sides.
export const cleanField = (field, value) => {
  const text = toEnglish(value)
  if (field.choices) return field.choices.includes(text.trim()) ? text.trim() : ''
  if (field.digits) return text.replace(/\D/g, '').slice(0, field.max)
  // A comma (or the Arabic ٫) is a decimal point: «1,8» is 1.8, never 18.
  if (field.decimal) return text.replace(/[٫,]/g, '.').replace(/[^\d.]/g, '').slice(0, field.max)
  return text.slice(0, field.max).trim()
}
export const cleanFields = (kind, values) => Object.fromEntries(DRUG_REQUESTS[kind].fields.map((field) => [field.key, cleanField(field, values?.[field.key])]))

const groupOf = (kind, key) => DRUG_REQUESTS[kind].groups.find((group) => group.options.some((option) => option.key === key))

// Known keys only, each once, in the spec's order; a one-choice group keeps the last one given.
export const cleanTicks = (kind, ticks) => {
  const given = Array.isArray(ticks) ? ticks.map(String) : []
  const kept = new Set()
  given.forEach((key) => {
    const group = groupOf(kind, key)
    if (!group) return
    if (!group.multiple) group.options.forEach((option) => kept.delete(option.key))
    kept.add(key)
  })
  return DRUG_REQUESTS[kind].groups.flatMap((group) => group.options.map((option) => option.key)).filter((key) => kept.has(key))
}

// Ticking a box: on/off, and a one-choice group drops its other choice.
export const toggleTick = (kind, ticks, key) => (ticks.includes(key)
  ? ticks.filter((item) => item !== key)
  : cleanTicks(kind, [...ticks, key]))
