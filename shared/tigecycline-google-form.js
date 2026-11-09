// «استمارة التايجيسايكلين» → the ministry's Google Form «tigecycline vial / دائرة صحة مدينة الطب»: the answers a request
// makes. Pure, so it is tested without Google. Two pages (the institution, then the details), no branching. The ids
// and option texts are the form's own, read from the live form on 2026-11-09 — if its questions are edited they must
// be refreshed or Google rejects the answers. The form collects an email address: it is the unit's, passed in.
export const FORM_ID = '1FAIpQLSeJ--Ngg5qrJmpgi8N2z-8QejxK4vEsCbjHmTt5Q10isMmN3Q'
export const FORM_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`

const ENTRY = {
  hospital: 1306251493, patient: 1406660343, committee: 1155462451, doctor: 1572102836, ward: 1720649116, sex: 610635236,
  age: 813402020, patientId: 772043536, diagnosis: 279852210, start: 1833893625, weight: 1336399327, daily: 1824282702,
  dispensed: 966710107, wasted: 1572352685, sharing: 1218916115, days: 1570470798, scr: 534253892, culture: 1619293670,
}
const HOSPITAL = 'مستشفى بغداد التعليمي العام'
// The two permitted cases, as the form words them (its own spelling kept).
const DIAGNOSIS = {
  skin: 'complicated skin and soft tissue infections ( when other antibiotics are not sutible)',
  abdominal: 'complicated intra abdominal infection ( when other antibiotics are not sutible)',
}
const CULTURE = { Resistant: 'Resistant', Sensitive: 'sensetive', 'Not done': 'not done' }
const SEX = { 'ذكر': 'ذكر', 'أنثى': 'انثى' }
const DAYS_NOT_SET = 'غير محدد من قبل الطبيب'

// The mg a day, from the dose as the form's screen words it («50mg × 2», several joined with +): each «strength × times»
// summed; a bare number is already mg. null when it can be read neither way.
export const dailyMg = (text) => {
  const dose = String(text ?? '').trim()
  let total = 0
  let found = false
  for (const match of dose.matchAll(/(\d+(?:\.\d+)?)\s*(mg|gm|g)?\s*[×xX*]\s*(\d+)/g)) {
    total += Number(match[1]) * (/^g/i.test(match[2] || '') ? 1000 : 1) * Number(match[3])
    found = true
  }
  if (found) return total
  return /^\d+(\.\d+)?$/.test(dose) ? Number(dose) : null
}

// { ok: true, body: [[name, value], …] } or { ok: false, missing: [Arabic labels] }. `request`: one stored tigecycline
// request (name, patientId, date, fields, ticks), `ward` its ward's label; `email` the unit's address.
// The quantity dispensed is the daily dose (whole vials) and nothing is wasted; the sharing system is not applied —
// both decided with the pharmacists.
export function tigecyclineFormAnswers(request, { ward, email }) {
  const { fields } = request
  const tick = request.ticks.find((key) => DIAGNOSIS[key])
  const mg = dailyMg(fields.dose)
  const missing = [
    [email, 'بريد النموذج (GOOGLE_FORM_EMAIL على الخادم)'], [request.name, 'اسم المريض'], [request.patientId, 'رقم الطبلة'], [fields.committee, 'اسم عضو لجنة المضادات'],
    [fields.doctor, 'اسم الطبيب الاختصاص'], [fields.sex && SEX[fields.sex], 'الجنس'], [fields.age, 'العمر'], [tick, 'الحالة المصرح بها (علّم مربعًا)'],
    [fields.weight, 'الوزن'], [mg, 'الجرعة المطلوبة يوميًا (مثل 50mg × 2)'], [fields.scr, 'S.Cr.'], [fields.culture && CULTURE[fields.culture], 'نتيجة الزرع البكتيري'],
  ].filter(([value]) => !value).map(([, label]) => label)
  if (missing.length) return { ok: false, missing }

  const days = (String(fields.duration || '').match(/\d+/) || [])[0]
  const entry = (key, value) => [`entry.${ENTRY[key]}`, String(value)]
  const body = [
    entry('hospital', HOSPITAL), entry('patient', request.name), entry('committee', fields.committee), entry('doctor', fields.doctor),
    entry('ward', ward), entry('sex', SEX[fields.sex]), entry('age', fields.age), entry('patientId', request.patientId),
    entry('diagnosis', DIAGNOSIS[tick]),
    // A date with no year on the form: the month and the day.
    [`entry.${ENTRY.start}_month`, String(Number(request.date.slice(5, 7)))], [`entry.${ENTRY.start}_day`, String(Number(request.date.slice(8, 10)))],
    entry('weight', fields.weight), entry('daily', mg), entry('dispensed', mg), entry('wasted', 0), entry('sharing', 'لا'),
    // «Other» on a multiple choice is written as the marker plus the typed answer.
    ...(days ? [entry('days', '__other_option__'), [`entry.${ENTRY.days}.other_option_response`, days]] : [entry('days', DAYS_NOT_SET)]),
    entry('scr', fields.scr), entry('culture', CULTURE[fields.culture]),
    ['emailAddress', email], ['pageHistory', '0,1'], ['fvv', '1'],
  ]
  return { ok: true, body }
}
