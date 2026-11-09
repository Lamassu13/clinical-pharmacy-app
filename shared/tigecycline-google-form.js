// «استمارة التايجيسايكلين» → the ministry's Google Form «tigecycline vial / دائرة صحة مدينة الطب»: the answers a request
// makes. Pure, so it is tested without Google. Two pages (the institution, then the details), no branching. The ids
// and option texts are the form's own, read from the live form on 2026-11-09 — if its questions are edited they must
// be refreshed or Google rejects the answers. (The answers are built by shared/vial-google-form.js.)
import { vialFormAnswers } from './vial-google-form.js'

export const FORM_ID = '1FAIpQLSeJ--Ngg5qrJmpgi8N2z-8QejxK4vEsCbjHmTt5Q10isMmN3Q'
export const FORM_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`

const ENTRY = {
  hospital: 1306251493, patient: 1406660343, committee: 1155462451, doctor: 1572102836, ward: 1720649116, sex: 610635236,
  age: 813402020, patientId: 772043536, diagnosis: 279852210, start: 1833893625, weight: 1336399327, daily: 1824282702,
  dispensed: 966710107, wasted: 1572352685, sharing: 1218916115, days: 1570470798, scr: 534253892, culture: 1619293670,
}
// The two permitted cases, as the form words them (its own spelling kept).
const DIAGNOSIS = {
  skin: 'complicated skin and soft tissue infections ( when other antibiotics are not sutible)',
  abdominal: 'complicated intra abdominal infection ( when other antibiotics are not sutible)',
}

export const tigecyclineFormAnswers = vialFormAnswers({ ENTRY, DIAGNOSIS, doseLabel: 'الجرعة المطلوبة يوميًا (رقم بالمليغرام، مثل 100)' })
