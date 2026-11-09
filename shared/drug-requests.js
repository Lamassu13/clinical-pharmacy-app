// The restricted-medicine request forms: «استمارة الميرونيم», «استمارة التايجيسايكلين», «استمارة الكوليستين», «استمارة IVIG» and «استمارة الالبومين». One spec per
// kind, read by the server (which fields and boxes it accepts) and by the app (the popup's fields, the
// paper form's boxes). The paper layouts themselves live in src/components/*Sheet.jsx.
import { MEROPENEM_PATTERN, TIGECYCLINE_PATTERN, COLISTIN_PATTERN, IVIG_PATTERN, doseText, strengthMg, colistinIU, tigecyclineDoseNumber, colistinDoseNumber } from './dose.js'

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
    // The day the form went live: a patient whose course began before it never had one (the follow-up does not ask for it).
    formsSince: '2026-11-02',
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
  tigecycline: {
    label: 'استمارة التايجيسايكلين',
    popupKicker: 'أول يوم تايجيسايكلين',
    offlineNote: 'تعذّر التحقق من يوم الكورس (لا يوجد اتصال) — املأها إن كان هذا اليوم الأول للتايجيسايكلين.',
    pattern: TIGECYCLINE_PATTERN,
    sqlPattern: '(tygacil|tigecycline|tigacyl)',
    // Asked on the first day of the course, like Meropenem.
    firstDayOnly: true,
    formsSince: '2026-11-09',
    fields: [
      { key: 'sex', label: 'الجنس', max: 10, choices: ['ذكر', 'أنثى'], required: true },
      // Whole years, digits only: the ministry's Google Form refuses anything else.
      { key: 'age', label: 'العمر', max: 3, digits: true, placeholder: 'مثال: 45', required: true },
      { key: 'diagnosis', label: 'التشخيص', max: 200, wide: true, auto: true },
      { key: 'weight', label: 'الوزن', unit: 'كغم', max: 20, decimal: true },
      { key: 'scr', label: 'S.Cr.', unit: 'mg/dL', max: 10, decimal: true },
      // A number only (the ministry's Google Form takes mg a day): 50, 100. Rows saved as «50mg × 2» read as 100.
      { key: 'dose', label: 'الجرعة المطلوبة يوميًا', unit: 'mg', max: 8, decimal: true, legacy: tigecyclineDoseNumber, placeholder: '100' },
      { key: 'duration', label: 'عدد الأيام المطلوب أخذ العلاج فيها', max: 120, wide: true, placeholder: 'مثال: 7 أيام', chips: ['5 أيام', '7 أيام', '10 أيام', '14 يومًا'] },
      // One of three (chips): the ministry's Google Form takes exactly these.
      { key: 'culture', label: 'نتيجة الزرع البكتيري', max: 20, choices: ['Resistant', 'Sensitive', 'Not done'] },
      // The antibiotics committee member the Google Form asks for (not printed on the paper form).
      { key: 'committee', label: 'اسم عضو لجنة المضادات الحياتية', max: 120, wide: true },
      // Printed above the specialist's signature («الطبيب الاختصاصي»).
      { key: 'doctor', label: 'اسم الطبيب الاختصاص', max: 120, wide: true },
      { key: 'hideDoctor', label: 'عدم طباعة اسم الطبيب', max: 1, noDialog: true },
    ],
    // The day's mg: 50mg vial × 2 → «100».
    prefill: (lines) => ({ dose: String(lines.reduce((sum, line) => sum + strengthMg(line.medicine) * line.quantity, 0) || '') }),
    // The paper form's two permitted cases; one is chosen.
    groups: [
      { id: 'indication', multiple: false, options: [
        { key: 'skin', text: 'Complicated **skin and soft tissue** infections (when other antibiotics are not suitable)' },
        { key: 'abdominal', text: 'Complicated **intra-abdominal** infections (when other antibiotics are not suitable)' },
      ] },
    ],
  },
  colistin: {
    label: 'استمارة الكوليستين',
    popupKicker: 'أول يوم كوليستين',
    offlineNote: 'تعذّر التحقق من يوم الكورس (لا يوجد اتصال) — املأها إن كان هذا اليوم الأول للكوليستين.',
    pattern: COLISTIN_PATTERN,
    sqlPattern: '(colistin|colistimethate|colomycin|coly-?mycin)',
    // Asked on the first day of the course, like Meropenem and Tigecycline.
    firstDayOnly: true,
    formsSince: '2026-11-09',
    fields: [
      { key: 'sex', label: 'الجنس', max: 10, choices: ['ذكر', 'أنثى'], required: true },
      // Whole years, digits only: the ministry's Google Form refuses anything else.
      { key: 'age', label: 'العمر', max: 3, digits: true, placeholder: 'مثال: 45', required: true },
      { key: 'diagnosis', label: 'التشخيص', max: 200, wide: true, auto: true },
      { key: 'weight', label: 'الوزن', unit: 'كغم', max: 20, decimal: true },
      { key: 'scr', label: 'S.Cr.', unit: 'mg/dL', max: 10, decimal: true },
      // A number only, in IU a day: 1000000, 6000000. Rows saved as «6 MU» read as 6000000.
      { key: 'dose', label: 'الجرعة المطلوبة يوميًا', unit: 'IU', max: 10, digits: true, legacy: colistinDoseNumber, placeholder: '1000000' },
      { key: 'duration', label: 'عدد الأيام المطلوب أخذ العلاج فيها', max: 120, wide: true, placeholder: 'مثال: 7 أيام', chips: ['5 أيام', '7 أيام', '10 أيام', '14 يومًا'] },
      // One of three (chips): the ministry's Google Form takes exactly these.
      { key: 'culture', label: 'نتيجة الزرع البكتيري', max: 20, choices: ['Resistant', 'Sensitive', 'Not done'] },
      // The antibiotics committee member the Google Form asks for (not printed on the paper form).
      { key: 'committee', label: 'اسم عضو لجنة المضادات الحياتية', max: 120, wide: true },
      // Printed above the specialist's signature («الطبيب الاختصاص»).
      { key: 'doctor', label: 'اسم الطبيب الاختصاص', max: 120, wide: true },
      { key: 'hideDoctor', label: 'عدم طباعة اسم الطبيب', max: 1, noDialog: true },
    ],
    // The day's IU: 6 vials of 1,000,000 IU → «6000000» (empty when the vial's strength is not in its name).
    prefill: (lines) => ({ dose: String(lines.reduce((sum, line) => sum + colistinIU(line.medicine) * line.quantity, 0) || '') }),
    // The paper form's two permitted cases; one is chosen.
    groups: [
      { id: 'indication', multiple: false, options: [
        { key: 'serious', text: 'Serious infections due to selected aerobic G-ve bacteria in patients with limited treatment options' },
        { key: 'cf', text: 'Management of chronic pulmonary infections due to Pseudomonas aeruginosa in patients with cystic fibrosis' },
      ] },
    ],
  },
  ivig: {
    label: 'استمارة IVIG',
    popupKicker: 'أول يوم IVIG',
    offlineNote: 'تعذّر التحقق من يوم الكورس (لا يوجد اتصال) — املأها إن كان هذا اليوم الأول للـIVIG.',
    pattern: IVIG_PATTERN,
    sqlPattern: '(ivig|immunoglobulin|immune globulin|gamma ?globulin|octagam|intratect|privigen|gammagard|kiovig|flebogamma|gamunex|sandoglobulin|nanogam|pentaglobin)',
    // Asked on the first day of the course, like Meropenem.
    firstDayOnly: true,
    formsSince: '2026-11-09',
    // The boxes are the ministry's Google Form's own (shared/ivig-google-form.js).
    fields: [
      { key: 'sex', label: 'الجنس', max: 10, choices: ['ذكر', 'أنثى'], required: true },
      // Years, up to 3 decimals (0.08 for a month): the form refuses anything else.
      { key: 'age', label: 'العمر (بالسنة)', max: 8, decimal: true, placeholder: 'مثال: 45', required: true },
      { key: 'vials', label: 'عدد الفيالات المصروفة', max: 4, digits: true, placeholder: 'مثال: 5' },
      // The specialist's name, which the Google Form asks (the form is not printed).
      { key: 'doctor', label: 'اسم الطبيب الاختصاص', max: 120, wide: true },
    ],
    // The vials given on the chart that day.
    prefill: (lines) => ({ vials: String(lines.reduce((sum, line) => sum + line.quantity, 0) || '') }),
    // The Google Form's diagnoses (its own wording, spelling kept), by part; one is chosen. «Others» opens a box
    // for what to specify (the request's `note`, English letters only — the form refuses anything else).
    groups: [
      { id: 'diagnosis', multiple: false, options: [
        { key: 'abmr', part: 'Part (nephrology)', text: 'biopsy proven acute antibody mediated rejection' },
        { key: 'cabmr', part: 'Part (nephrology)', text: 'biopsy proven chronic active antibody mediated rejection' },
        { key: 'desens', part: 'Part (nephrology)', text: 'pre transplant desensitization protocol for highly sensitized patients' },
        { key: 'bk', part: 'Part (nephrology)', text: 'transplant BK virus nephropathy / biopsy proven and resistant to standard therapy' },
        { key: 'lupus', part: 'Part (nephrology)', text: 'severe case of fulminant lupus nephritis not responding to therapy' },
        { key: 'caps', part: 'Part (nephrology)', text: 'catastrophic antiphospholipid syndrome' },
        { key: 'cytopenia', part: 'Part (nephrology)', text: 'severe cytopenia and sepsis during treatment of glomerulonephritis or SLE and transplantation receiving aggressive immunosuppression' },
        { key: 'itp', part: 'Part (hematology)', text: 'life threatening bleeding in immune thrombocytopenia' },
        { key: 'kawasaki', part: 'Part (hematology)', text: 'kawasaki vasculitis' },
        { key: 'hypogamma', part: 'Part (hematology)', text: 'replacement therapy in congenital hypogammaglobulinemia' },
        { key: 'gbs', part: 'Part (neurology)', text: 'guillian barrie syndrome in case plasmapheresis cannot be done or not available' },
        { key: 'mg', part: 'Part (neurology)', text: 'myasthenia gravis crisis as life saving measures when plasmapheresis cannot be done or not available' },
        { key: 'others', part: 'Others', text: 'Others (specify)' },
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
      // Whether the protocol indicates the albumin. «Not indicated» is not sent to the ministry's Google Form and is listed under «Not indicated»
      // on the albumin follow-up; empty counts as indicated (forms made before this was asked).
      { key: 'indicated', label: 'الاستطباب', max: 20, choices: ['Indicated', 'Not indicated'] },
      { key: 'reason', label: 'سبب عدم الاستطباب', max: 200, wide: true, showWhen: { key: 'indicated', value: 'Not indicated' } },
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
    prefill: (lines) => ({ count: String(lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0) || ''), indicated: 'Indicated' }),
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
  const text = field.legacy ? field.legacy(toEnglish(value)) : toEnglish(value)
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
