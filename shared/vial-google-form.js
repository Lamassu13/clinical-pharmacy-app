// The answers a «vial prescription» request makes to its ministry Google Form (tigecycline and colistin: the same
// two pages — the institution, then the details — with the same questions, only the ids and the case texts differ).
// Pure, so it is tested without Google. Each form's own config (ids, case texts) is in *-google-form.js. The form
// collects an email address: it is the unit's, passed in.
import { dailyMg } from './dose.js'

const HOSPITAL = 'مستشفى بغداد التعليمي العام'
const CULTURE = { Resistant: 'Resistant', Sensitive: 'sensetive', 'Not done': 'not done' }
const SEX = { 'ذكر': 'ذكر', 'أنثى': 'انثى' }
const DAYS_NOT_SET = 'غير محدد من قبل الطبيب'

// `config`: { ENTRY: question ids, DIAGNOSIS: tick key → the form's option text, doseLabel }. Returns the builder:
// (request, { ward, email }) → { ok: true, body: [[name, value], …], prefill } or { ok: false, missing | invalid }.
// `request`: one stored request (name, patientId, date, fields, ticks), `ward` its ward's label; `email` the unit's.
// The quantity dispensed is the daily dose and nothing is wasted; the sharing system is not applied — both decided
// with the pharmacists.
export const vialFormAnswers = ({ ENTRY, DIAGNOSIS, doseLabel }) => (request, { ward, email }) => {
  const { fields } = request
  const tick = request.ticks.find((key) => DIAGNOSIS[key])
  const mg = dailyMg(fields.dose)
  const missing = [
    [email, 'بريد النموذج (GOOGLE_FORM_EMAIL على الخادم)'], [request.name, 'اسم المريض'], [request.patientId, 'رقم الطبلة'], [fields.committee, 'اسم عضو لجنة المضادات'],
    [fields.doctor, 'اسم الطبيب الاختصاص'], [fields.sex && SEX[fields.sex], 'الجنس'], [fields.age, 'العمر'], [tick, 'الحالة المصرح بها (علّم مربعًا)'],
    [fields.weight, 'الوزن'], [mg, doseLabel], [fields.scr, 'S.Cr.'], [fields.culture && CULTURE[fields.culture], 'نتيجة الزرع البكتيري'],
  ].filter(([value]) => !value).map(([, label]) => label)
  if (missing.length) return { ok: false, missing }
  // The form's own rules for these boxes (read from it): the age whole digits only, the weight, S.Cr. and
  // رقم الطبلة a number. A value it would refuse is named here instead of failing after the send.
  const invalid = [
    [/^[0-9]+$/.test(fields.age), 'العمر: أرقام صحيحة فقط (النموذج يرفض الكسور والحروف)'],
    [/^\d+(\.\d+)?$/.test(fields.weight), 'الوزن: رقم فقط'],
    [/^\d+(\.\d+)?$/.test(fields.scr), 'S.Cr.: رقم فقط (بلا وحدة)'],
    [/^\d+$/.test(request.patientId), 'رقم الطبلة: أرقام فقط'],
  ].filter(([good]) => !good).map(([, message]) => message)
  if (invalid.length) return { ok: false, invalid }

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
  // The same answers as a pre-filled link takes them: its date is yyyy-mm-dd (a link with month and day parts
  // opened the form with the date empty), and the routing fields are left out.
  const start = `entry.${ENTRY.start}`
  const prefill = [...body.filter(([name]) => !name.startsWith(`${start}_`)), [start, request.date]]
  return { ok: true, body, prefill }
}
