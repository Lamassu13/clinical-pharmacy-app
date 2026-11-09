// What a saved request form still lacks, in Arabic labels ([] = nothing): the follow-up of the forms, read by the server
// (the day's counts, the admin follow-up) and by the form screens. One function for every kind:
// - Google kinds: whatever the ministry's Google Form would refuse — the answer builders already name it.
// - Meropenem (sent nowhere): what «مواقف القسم» shows from it — the sex, the age and a diagnosis.
import { DRUG_REQUESTS } from './drug-requests.js'
import { albuminFormAnswers } from './albumin-google-form.js'
import { tigecyclineFormAnswers } from './tigecycline-google-form.js'
import { colistinFormAnswers } from './colistin-google-form.js'
import { ivigFormAnswers } from './ivig-google-form.js'

// The kinds that go to a ministry Google Form. (The tigecycline and colistin builders also want the unit's email and the
// ward, which are the server's: a placeholder here, so only the form's own boxes are judged.)
const UNIT = { ward: '', email: 'unit@example.invalid' }
const GOOGLE_BUILDERS = {
  albumin: (request) => albuminFormAnswers(request),
  tigecycline: (request) => tigecyclineFormAnswers(request, UNIT),
  colistin: (request) => colistinFormAnswers(request, UNIT),
  ivig: (request) => ivigFormAnswers(request),
}
export const GOOGLE_KINDS = Object.keys(GOOGLE_BUILDERS)

const MEROPENEM_DIAGNOSES = new Set(DRUG_REQUESTS.meropenem.groups.find((group) => group.id === 'diagnosis').options.map((option) => option.key))

// `request`: { name, patientId, date, fields, ticks, note, googleSentAt, googleError } as the server and the screens hold it.
export const formProblems = (kind, request) => {
  if (kind === 'meropenem') {
    const diagnosed = request.ticks.some((key) => MEROPENEM_DIAGNOSES.has(key))
    return [
      [request.fields.sex, 'الجنس'], [request.fields.age, 'العمر'], [diagnosed, 'التشخيص'],
      [!request.ticks.includes('others') || (request.note || '').trim(), 'تفصيل «Others»'],
    ].filter(([value]) => !value).map(([, label]) => label)
  }
  const result = GOOGLE_BUILDERS[kind]?.(request)
  return !result || result.ok ? [] : result.missing || result.invalid
}

// A Google form not sent (or sent but unconfirmed: the post may not have arrived) needs following up; once Google has taken it
// that is settled — what the app's own copy still lacks no longer matters, and on a past day cannot be edited. Meropenem is
// sent nowhere: it needs following up while it lacks what «مواقف القسم» shows. Used by the counts, the screens and the steps bar.
export const needsFollowUp = (kind, request) => (GOOGLE_KINDS.includes(kind)
  ? !request.googleSentAt || Boolean(request.googleError)
  : formProblems(kind, request).length > 0)
