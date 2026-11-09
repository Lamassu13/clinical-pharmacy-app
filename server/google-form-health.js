import { query } from './db.js'
import { GOOGLE_FORMS } from './google-forms.js'
import { DRUG_REQUESTS } from '../shared/drug-requests.js'
import { liveForm, mismatches, newRequired } from '../shared/google-form-check.js'

// Is each ministry Google Form still the one the app was written against? The live form is read (never posted to) and compared with
// sample answers that cover every case the app can send: a question or option that is gone or reworded, a NEW required question the
// app does not answer, or a changed sign-in setting. The result is kept in google_form_health (a few bytes a form), so the admin
// screen and the dashboard read it without going to Google; Google itself is asked only when a manager opens the follow-up screen and
// the last check is older than STALE_MS, on «فحص النماذج الآن» (at most once a minute), or when a send is refused (the form is
// already in hand then). Four pages of ~100 KB a check, a few times a day at most: server to Google, nothing to the devices.
const STALE_MS = 6 * 3600_000
const COOLDOWN_MS = 60_000
const SAMPLE_FIELDS = { sex: 'ذكر', age: '40', weight: '70', scr: '1.1', dose: '1000000', duration: '7 أيام', culture: 'Sensitive', committee: 'x', doctor: 'x', vials: '4', count: '2' }

// The answers a complete request of this kind would send, once per diagnosis/case it can tick (so every branch of the form is covered).
export const sampleBodies = (kind) => DRUG_REQUESTS[kind].groups.flatMap((group) => group.options.map((option) => option.key))
  .map((key) => GOOGLE_FORMS[kind].answers({ name: 'x', patientId: '1', date: '2026-11-09', fields: SAMPLE_FIELDS, ticks: [key], note: 'Test' }, 'x', false))
  .filter((result) => result.ok).map((result) => result.body)

// { status: 'ok' | 'changed', detail } for a live form (liveForm's answer) of this kind. Pure.
export const compareForm = (kind, live) => {
  const bodies = sampleBodies(kind)
  if (!bodies.length) return { status: 'changed', detail: 'تعذّر بناء إجابات الفحص' }
  const problems = []
  const gone = [...new Set(bodies.flatMap((body) => mismatches(body, live.entries)))]
  if (gone.length) problems.push(`لم يعد في النموذج: ${gone.slice(0, 3).join('، ')}${gone.length > 3 ? ` (+${gone.length - 3})` : ''}`)
  const added = newRequired(bodies, live)
  if (added.length) problems.push(`سؤال إلزامي جديد: ${added.slice(0, 3).join('، ')}${added.length > 3 ? ` (+${added.length - 3})` : ''}`)
  if (live.signIn !== GOOGLE_FORMS[kind].signIn) problems.push(live.signIn ? 'صار النموذج يشترط تسجيل الدخول' : 'لم يعد النموذج يشترط تسجيل الدخول')
  return problems.length ? { status: 'changed', detail: problems.join(' · ').slice(0, 300) } : { status: 'ok', detail: '' }
}

export const saveHealth = (kind, { status, detail }) => query(
  `INSERT INTO google_form_health (kind, status, detail, checked_at) VALUES ($1, $2, $3, NOW())
   ON CONFLICT (kind) DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail, checked_at = NOW()`,
  [kind, status, detail],
)

// One form, from Google: its verdict (and kept). A form that cannot be fetched or read is 'unreachable', which says nothing about the form.
const checkKind = async (kind) => {
  let verdict
  try {
    const html = await (await fetch(GOOGLE_FORMS[kind].url.replace(/formResponse$/, 'viewform'), { signal: AbortSignal.timeout(8000) })).text()
    const live = liveForm(html)
    verdict = live ? compareForm(kind, live) : { status: 'unreachable', detail: 'تعذّرت قراءة النموذج' }
  } catch { verdict = { status: 'unreachable', detail: 'تعذّر الوصول إلى Google' } }
  await saveHealth(kind, verdict).catch((error) => console.error('google form health: not saved:', error.message))
  return verdict
}

let running = null
let lastRun = 0
// For the tests: the next check may run at once.
export const allowCheckNow = () => { lastRun = 0 }

// Every form, at once; one run at a time (a second caller shares it), and not again within a minute (whoever asks).
export const checkAll = () => {
  if (running) return running
  if (Date.now() - lastRun < COOLDOWN_MS) return Promise.resolve()
  lastRun = Date.now()
  running = Promise.all(Object.keys(GOOGLE_FORMS).map(checkKind)).finally(() => { running = null })
  return running
}

// What is kept: { checkedAt (the oldest check), issues: [{ kind, status, detail }] } — the forms not ok (or never checked: status 'unchecked').
export const readHealth = async () => {
  const rows = (await query('SELECT kind, status, detail, checked_at FROM google_form_health')).rows
  const byKind = new Map(rows.map((row) => [row.kind, row]))
  const kinds = Object.keys(GOOGLE_FORMS)
  const issues = kinds.map((kind) => byKind.get(kind) || { kind, status: 'unchecked', detail: '', checked_at: null }).filter((row) => row.status !== 'ok')
    .map((row) => ({ kind: row.kind, status: row.status, detail: row.detail }))
  const times = kinds.map((kind) => byKind.get(kind)?.checked_at).filter(Boolean).map((at) => new Date(at).getTime())
  return { checkedAt: times.length === kinds.length ? new Date(Math.min(...times)).toISOString() : null, issues }
}

// Called when a manager opens the follow-up screen: starts a check in the background when the last one is old (the answer does not wait for it).
export const refreshIfStale = (health) => {
  if (!health.checkedAt || Date.now() - Date.parse(health.checkedAt) > STALE_MS) checkAll().catch((error) => console.error('google form health:', error.message))
}
