import { FORM_URL as ALBUMIN_FORM_URL, albuminFormAnswers } from '../shared/albumin-google-form.js'
import { FORM_URL as TIGECYCLINE_FORM_URL, tigecyclineFormAnswers } from '../shared/tigecycline-google-form.js'
import { FORM_URL as COLISTIN_FORM_URL, colistinFormAnswers } from '../shared/colistin-google-form.js'
import { FORM_URL as IVIG_FORM_URL, ivigFormAnswers } from '../shared/ivig-google-form.js'

// The ministry's Google Forms the request forms are sent to: where each is, how its answers are built, and whether it asks every
// filler to sign in (`signIn`: the form collects verified emails — the server cannot post to it). Read by the send
// (routes/drug-requests.js) and by the health check (google-form-health.js).
// `answers(form, ward, sending)`: the tigecycline and colistin forms also need the unit's email, GOOGLE_FORM_EMAIL (a placeholder in a dry run).
const unitEmail = (sending) => process.env.GOOGLE_FORM_EMAIL || (sending ? '' : 'dry-run@example.invalid')
export const GOOGLE_FORMS = {
  albumin: { url: ALBUMIN_FORM_URL, signIn: false, answers: (form) => albuminFormAnswers(form) },
  tigecycline: { url: TIGECYCLINE_FORM_URL, signIn: true, answers: (form, ward, sending) => tigecyclineFormAnswers(form, { ward, email: unitEmail(sending) }) },
  colistin: { url: COLISTIN_FORM_URL, signIn: true, answers: (form, ward, sending) => colistinFormAnswers(form, { ward, email: unitEmail(sending) }) },
  // The IVIG form asks for no email: nothing to sign in to, and nothing from the unit's address.
  ivig: { url: IVIG_FORM_URL, signIn: false, answers: (form) => ivigFormAnswers(form) },
}
