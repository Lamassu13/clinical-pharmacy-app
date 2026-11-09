// «استمارة الكوليستين» → the ministry's Google Form «colistin vial / دائرة صحة مدينة الطب». The same questions as the
// tigecycline form's (shared/vial-google-form.js builds the answers); its own ids and case texts, read from the live
// form on 2026-11-09 — if its questions are edited they must be refreshed or Google rejects the answers.
import { vialFormAnswers } from './vial-google-form.js'

export const FORM_ID = '1FAIpQLScKnP4IrG9HDHYlHnGr7AYPIVwAMRQTWEYRzm8J0P9fd1B20w'
export const FORM_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`

const ENTRY = {
  hospital: 2071414154, patient: 841377494, committee: 194226785, doctor: 1248618096, ward: 890134783, sex: 1032199192,
  age: 586078480, patientId: 1154502244, diagnosis: 1668545535, start: 120145077, weight: 698258849, daily: 275553482,
  dispensed: 703290303, wasted: 1765020922, sharing: 2011704287, days: 1332799288, scr: 1949051570, culture: 78709220,
}
// The two permitted cases, as the form words them (its own spelling kept).
const DIAGNOSIS = {
  serious: 'serious infections due to selected aerobic Gram negative bacteria in patients with limited treatment options',
  cf: 'management of chronic pulmonary infection due to pseudomonas aeruginosa in patient with cystic fibrosis',
}
export const colistinFormAnswers = vialFormAnswers({ ENTRY, DIAGNOSIS, doseLabel: 'الجرعة المطلوبة يوميًا (رقم، مثل 1000000)' })
