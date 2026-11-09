// «استمارة IVIG» → the ministry's Google Form «IVIG vial / دائرة مدينة الطب»: the answers a request makes. Pure, so it
// is tested without Google. Unlike the tigecycline and colistin forms it asks for no email (nothing to sign in to) and
// it branches: page 1 (the details) holds the diagnosis' part, and each part is its own page that submits. The ids,
// pages and option texts are the form's own, read from the live form on 2026-11-09 — if its questions are edited
// they must be refreshed or Google rejects the answers.
export const FORM_ID = '1FAIpQLSfswB5mpWZU4Hrh9BIimdgmNnDimBdHLrr6bHK0q9fOlpl25A'
export const FORM_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`

const ENTRY = {
  hospital: 700571695, season: 214137601, month: 1987280467, patient: 539442606, doctor: 1069499657, patientId: 1249769055,
  sex: 1595320943, age: 105603720, vials: 2018093175, part: 1082107107, other: 332421866,
}
const HOSPITAL = 'مستشفى بغداد التعليمي العام'
const SEX = { 'ذكر': 'ذكر', 'أنثى': 'انثى' }
const SEASONS = ['الفصل الاول', 'الفصل الثاني', 'الفصل الثالث', 'الفصل الرابع']
const MONTHS = ['الشهر الاول : كانون الثاني', 'الشهر الثاني: شباط', 'الشهر الثالث: اذار', 'الشهر الرابع: نيسان', 'الشهر الخامس: ايار', 'الشهر السادس: حزيران',
  'الشهر السابع: تموز', 'الشهر الثامن: آب', 'الشهر التاسع: ايلول', 'الشهر العاشر: تشرين الاول', 'الشهر الحادي عشر: تشرين الثاني', 'الشهر الثاني عشر: كانون الاول']
// The parts (the answer to the diagnosis' first question), the page each opens (its position in the form) and, per
// chosen diagnosis, the question on that page and the option's text.
const PARTS = {
  nephrology: { answer: 'Part ( nephrology )', page: 3, entry: 1537971111 },
  hematology: { answer: 'Part ( hematology )', page: 4, entry: 96234760 },
  neurology: { answer: 'Part ( neurology)', page: 5, entry: 601709297 },
  others: { answer: 'others', page: 2, entry: ENTRY.other },
}
const DIAGNOSIS = {
  abmr: ['nephrology', 'biopsy proven acute antibody mediated rejection'],
  cabmr: ['nephrology', 'biopsy proven chronic active antibody mediated rejection'],
  desens: ['nephrology', 'pre transplant desensitization protocol for highly sensitized patients'],
  bk: ['nephrology', 'transplant BK virus nephropathy / biopsy proven and resistant to standard therapy'],
  lupus: ['nephrology', 'severe case of fulminant lupus nephritis not responding to therapy'],
  caps: ['nephrology', 'catastrophic antiphospholipid syndrome'],
  cytopenia: ['nephrology', 'severe cytopenia and sepsis during treatment of glomerulonephritis or SLE and transplantation receiving aggressive immunosuppression'],
  itp: ['hematology', 'life threatening bleeding in immune thrombocytopenia'],
  kawasaki: ['hematology', 'kawasaki vasculitis'],
  hypogamma: ['hematology', 'replacement therapy in congenital hypogammaglobulinemia'],
  gbs: ['neurology', 'guillian barrie syndrome in case plasmapheresis cannot be done or not available'],
  mg: ['neurology', 'myasthenia gravis crisis as life saving measures when plasmapheresis cannot be done or not available'],
  others: ['others', null],
}

// { ok: true, body: [[name, value], …], prefill } or { ok: false, missing | invalid: [Arabic labels] }. `request`: one stored
// ivig request (name, patientId, date, fields, ticks, note). The form's «season» and «month» are the day's own (the
// quarter of its month) — the form asks when the vials were dispensed.
export function ivigFormAnswers(request) {
  const { fields } = request
  const tick = request.ticks.find((key) => DIAGNOSIS[key])
  const [part, text] = DIAGNOSIS[tick] || []
  const note = (request.note || '').trim()
  const missing = [
    [request.name, 'اسم المريض'], [request.patientId, 'رقم الطبلة'], [fields.doctor, 'اسم الطبيب الاختصاص'], [fields.sex && SEX[fields.sex], 'الجنس'],
    [fields.age, 'العمر'], [fields.vials, 'عدد الفيالات المصروفة'], [tick, 'التشخيص (علّم مربعًا)'], [tick !== 'others' || note, 'تفصيل «Others»'],
  ].filter(([value]) => !value).map(([, label]) => label)
  if (missing.length) return { ok: false, missing }
  // The form's own rules for these boxes (read from it): the age a number with up to 3 decimals, the vials and the
  // رقم الطبلة a number, the «other diagnosis» English letters only.
  const invalid = [
    [/^\d+(\.\d{1,3})?$/.test(fields.age), 'العمر: رقم بالسنة بثلاث خانات عشرية على الأكثر (0.08 لشهر)'],
    [/^\d+$/.test(fields.vials), 'عدد الفيالات: رقم صحيح'],
    [/^\d+$/.test(request.patientId), 'رقم الطبلة: أرقام فقط'],
    [tick !== 'others' || /^[A-Za-z\s]+$/.test(note), 'تفصيل «Others»: حروف إنجليزية فقط (النموذج يرفض غيرها)'],
  ].filter(([good]) => !good).map(([, message]) => message)
  if (invalid.length) return { ok: false, invalid }

  const month = Number(request.date.slice(5, 7))
  const entry = (key, value) => [`entry.${ENTRY[key]}`, String(value)]
  const { entry: partEntry, page, answer } = PARTS[part]
  const body = [
    entry('hospital', HOSPITAL), entry('season', SEASONS[Math.floor((month - 1) / 3)]), entry('month', MONTHS[month - 1]),
    entry('patient', request.name), entry('doctor', fields.doctor), entry('patientId', request.patientId), entry('sex', SEX[fields.sex]),
    entry('age', fields.age), entry('vials', fields.vials), entry('part', answer),
    // «Others» writes its own text; the other parts choose one of their diagnoses.
    [`entry.${partEntry}`, part === 'others' ? note : text],
    ['pageHistory', `0,1,${page}`], ['fvv', '1'],
  ]
  return { ok: true, body, prefill: body }
}
