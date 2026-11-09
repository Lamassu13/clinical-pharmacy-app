import express from 'express'
import { query } from '../db.js'
import { requireAuth } from '../auth.js'
import { canAccessLocation, cleanText } from '../validation.js'
import { readLocation, readWritableLocation, refuse, loadCourseRows, loadOverrides } from './chart.js'
import { DAY_LOCKED, isDayLocked } from '../day-lock.js'
import { buildMeropenemForm, wardKeyOf } from '../meropenem.js'
import { numberToArabicWords } from '../arabic-number.js'
import { DRUG_REQUESTS, MAX_REQUEST_NOTE, cleanFields, cleanTicks } from '../../shared/drug-requests.js'
import { liveForm, mismatches, prefillUrl } from '../../shared/google-form-check.js'
import { needsFollowUp } from '../../shared/form-problems.js'
import { GOOGLE_FORMS } from '../google-forms.js'
import { compareForm, saveHealth } from '../google-form-health.js'

const router = express.Router()

// «استمارة الميرونيم» and «استمارة الالبومين» (../../shared/drug-requests.js). The patient-entry form
// fills one when the medicine is added; the form's screen lists a ward's forms of one kind for a day,
// edits them, ticks their boxes and prints them. Same access as the ward's chart.

const nameKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')
const idOf = (value) => String(value ?? '').replace(/\D/g, '').slice(0, 20)
const kindOf = (value) => (Object.hasOwn(DRUG_REQUESTS, value) ? value : null)
const BAD_KIND = { message: 'نوع الاستمارة غير معروف' }

const SELECT = `SELECT r.id, r.kind, r.ward_key, r.request_date::text AS date, r.patient_name, r.patient_id, r.fields, r.ticks, r.note, r.google_sent_at, r.google_sent_by_name, r.google_sent_how, r.google_error, r.google_attempt_at,
    r.created_at, r.updated_at, u.full_name AS created_by_name
  FROM drug_requests r LEFT JOIN users u ON u.id = r.created_by`
const toRequest = (row) => {
  const fields = cleanFields(row.kind, row.fields)
  const count = Number(fields.count)
  return {
    id: row.id, kind: row.kind, date: row.date, name: row.patient_name, patientId: row.patient_id,
    fields, ticks: cleanTicks(row.kind, row.ticks), note: row.note,
    // Albumin's «كتابة»: the count spelled out, as the requisition does.
    ...(row.kind === 'albumin' ? { words: Number.isInteger(count) && count > 0 ? numberToArabicWords(count) : '' } : {}),
    googleSentAt: row.google_sent_at, googleSentBy: row.google_sent_by_name, googleSentHow: row.google_sent_how, googleError: row.google_error, googleAttemptAt: row.google_attempt_at,
    createdByName: row.created_by_name || '', createdAt: row.created_at, updatedAt: row.updated_at,
  }
}
const loadRequest = async (id) => (await query(`${SELECT} WHERE r.id = $1`, [id])).rows[0]

// A stored form, access-checked against its ward: { row } or { status, message }.
const ownRequest = async (request) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return { status: 404, message: 'الاستمارة غير موجودة' }
  const row = await loadRequest(id)
  if (!row) return { status: 404, message: 'الاستمارة غير موجودة' }
  const [floorText, ...ward] = row.ward_key.split('|')
  if (!canAccessLocation(request.session.user, floorText ? Number(floorText) : null, ward.join('|'))) return { status: 403, message: 'لا تملك صلاحية لهذه الردهة' }
  return { row }
}
// The same, for a change: a form is edited, ticked or deleted on its own day only (../day-lock.js).
const ownWritableRequest = async (request) => {
  const own = await ownRequest(request)
  return own.row && isDayLocked(request.session.user, own.row.date) ? { status: 403, ...DAY_LOCKED } : own
}

// رقم الطبلة as the ward's charts for that day carry it (main chart first), by the patient's name:
// a form saved before the ID was typed on the chart still shows it. name -> ID.
const chartIds = async (floor, wardName, chartDate) => new Map((await query(
  `SELECT DISTINCT ON (name) regexp_replace(btrim(cp.patient_name), '\\s+', ' ', 'g') AS name, cp.patient_id
   FROM daily_charts dc
   JOIN wards w ON w.id = dc.ward_id
   JOIN chart_patients cp ON cp.chart_id = dc.id
   WHERE w.floor_number IS NOT DISTINCT FROM $1 AND w.name = $2 AND dc.chart_date = $3
     AND cp.patient_id <> '' AND btrim(cp.patient_name) <> ''
   ORDER BY name, (dc.slot = 'main') DESC, cp.row_number`,
  [floor, wardName, chartDate],
)).rows.map((row) => [row.name, row.patient_id]))

router.get('/drug-requests', requireAuth, async (request, response) => {
  const kind = kindOf(request.query.kind)
  if (!kind) return response.status(400).json(BAD_KIND)
  const location = readLocation(request.query, request.session.user)
  if (location.status) return response.status(location.status).json({ message: location.message })
  const { floor, wardName, chartDate } = location
  const result = await query(`${SELECT} WHERE r.kind = $1 AND r.ward_key = $2 AND r.request_date = $3 ORDER BY r.created_at, r.id`, [kind, wardKeyOf(floor, wardName), chartDate])
  // A stored رقم الطبلة (typed in the popup's patient, or on the form) wins; otherwise the chart's.
  const ids = result.rows.some((row) => !row.patient_id) ? await chartIds(floor, wardName, chartDate) : new Map()
  response.json({ requests: result.rows.map((row) => toRequest({ ...row, patient_id: row.patient_id || ids.get(row.patient_name) || '' })) })
})

// How many forms the ward has on `date`, per kind, for the ward page's rows and the steps bar — so it never ships the
// forms themselves — and, under `attention`, how many of them need following up: still lacking something the ministry's
// form (or «مواقف القسم», for Meropenem) wants, or a Google form not sent yet / not confirmed (shared/form-problems.js).
router.get('/drug-requests/counts', requireAuth, async (request, response) => {
  const location = readLocation(request.query, request.session.user)
  if (location.status) return response.status(location.status).json({ message: location.message })
  const { floor, wardName, chartDate } = location
  const forms = (await query('SELECT kind, patient_name, patient_id, fields, ticks, note, google_sent_at, google_error FROM drug_requests WHERE kind = ANY($3) AND ward_key = $1 AND request_date = $2', [wardKeyOf(floor, wardName), chartDate, Object.keys(DRUG_REQUESTS)])).rows
  // A form with no رقم الطبلة of its own takes the chart's, as the form's screen and the send do.
  const ids = forms.some((row) => !row.patient_id) ? await chartIds(floor, wardName, chartDate) : new Map()
  const counts = Object.fromEntries(Object.keys(DRUG_REQUESTS).map((kind) => [kind, 0]))
  const attention = { ...counts }
  forms.forEach((row) => {
    counts[row.kind] += 1
    const patientId = row.patient_id || ids.get(row.patient_name) || ''
    const form = { name: row.patient_name, patientId, date: chartDate, fields: cleanFields(row.kind, row.fields), ticks: cleanTicks(row.kind, row.ticks), note: row.note, googleSentAt: row.google_sent_at, googleError: row.google_error }
    if (needsFollowUp(row.kind, form)) attention[row.kind] += 1
  })
  response.json({ ...counts, attention })
})

// The patient's course day for this medicine on `date`, and whether today's form is already filled.
// The course is the follow-up form's own (../meropenem.js): the patient is counted as if charted on
// it here today — their chart save may still be on its way — so a patient who had it yesterday, here
// or on the ward they were transferred from, is past day 1. Meropenem asks only on day 1; albumin
// asks every day and starts «Treatment day» from this number.
router.get('/drug-requests/check', requireAuth, async (request, response) => {
  const kind = kindOf(request.query.kind)
  if (!kind) return response.status(400).json(BAD_KIND)
  const location = readLocation(request.query, request.session.user)
  if (location.status) return response.status(location.status).json({ message: location.message })
  const name = nameKey(cleanText(request.query.name, 200))
  const patientId = idOf(request.query.id)
  if (!name && !patientId) return response.status(400).json({ message: 'اسم المريض أو رقمه مطلوب' })
  const { floor, wardName, chartDate } = location
  const rows = await loadCourseRows(location, { pattern: DRUG_REQUESTS[kind].sqlPattern, keepIds: [patientId] })
  const probe = { date: chartDate, floor, ward: wardName, name, patientId, medicine: kind, quantity: 1 }
  const form = buildMeropenemForm({ ...rows, cells: [...rows.cells, probe], overrides: await loadOverrides(kind) })
  const patient = form.patients.find((row) => (patientId ? row.patientId === patientId : row.name === name))
  const requested = await query(
    `SELECT 1 FROM drug_requests WHERE kind = $1 AND ward_key = $2 AND request_date = $3
       AND (($4 <> '' AND patient_id = $4) OR patient_name = $5) LIMIT 1`,
    [kind, wardKeyOf(floor, wardName), chartDate, patientId, name],
  )
  response.json({ day: patient?.days[chartDate] ?? 1, requested: requested.rowCount > 0 })
})

// Create — or, for the same patient, kind, ward and day, update the typed fields (the ticks stay):
// a form saved offline and sent twice must not print twice.
router.post('/drug-requests', requireAuth, async (request, response) => {
  const kind = kindOf(request.body.kind)
  if (!kind) return response.status(400).json(BAD_KIND)
  const location = readWritableLocation(request.body, request.session.user)
  if (location.status) return refuse(response, location)
  const name = nameKey(cleanText(request.body.name, 200))
  if (!name) return response.status(400).json({ message: 'اسم المريض مطلوب' })
  const { floor, wardName, chartDate } = location
  // A client that predates a box (the sex, the age) or an offline save from before it sends no such key: keep
  // the stored value (the merge below only overwrites keys that are present) instead of blanking it on a resend.
  const fields = cleanFields(kind, request.body.fields)
  Object.keys(fields).forEach((key) => { if (!(key in (request.body.fields || {}))) delete fields[key] })
  const result = await query(
    `INSERT INTO drug_requests (kind, ward_key, request_date, patient_name, patient_id, fields, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (kind, ward_key, request_date, patient_name, patient_id) DO UPDATE SET fields = drug_requests.fields || EXCLUDED.fields, updated_at = NOW()
     RETURNING id, (xmax = 0) AS created`,
    [kind, wardKeyOf(floor, wardName), chartDate, name, idOf(request.body.patientId), JSON.stringify(fields), request.session.user.id],
  )
  response.status(result.rows[0].created ? 201 : 200).json({ request: toRequest(await loadRequest(result.rows[0].id)) })
})

router.put('/drug-requests/:id', requireAuth, async (request, response) => {
  const own = await ownWritableRequest(request)
  if (own.status) return refuse(response, own)
  const name = nameKey(cleanText(request.body.name, 200))
  if (!name) return response.status(400).json({ message: 'اسم المريض مطلوب' })
  try {
    await query(
      'UPDATE drug_requests SET patient_name = $2, patient_id = $3, fields = $4, updated_at = NOW() WHERE id = $1',
      [own.row.id, name, idOf(request.body.patientId), JSON.stringify(cleanFields(own.row.kind, request.body.fields))],
    )
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ message: 'توجد استمارة أخرى لهذا المريض في هذا اليوم' })
    throw error
  }
  response.json({ request: toRequest(await loadRequest(own.row.id)) })
})

// The ticked boxes, sent whole on each tap (last tap wins), and the «Others (specify)» text.
router.patch('/drug-requests/:id/ticks', requireAuth, async (request, response) => {
  const own = await ownWritableRequest(request)
  if (own.status) return refuse(response, own)
  const ticks = cleanTicks(own.row.kind, request.body.ticks)
  const note = request.body.note === undefined ? own.row.note : cleanText(request.body.note, MAX_REQUEST_NOTE).trim()
  await query('UPDATE drug_requests SET ticks = $2, note = $3, updated_at = NOW() WHERE id = $1', [own.row.id, JSON.stringify(ticks), note])
  response.json({ request: toRequest(await loadRequest(own.row.id)) })
})

// «استمارة الالبومين», «استمارة التايجيسايكلين» and «استمارة الكوليستين» sent to their ministry Google Forms from here, so nobody retypes
// them there (../google-forms.js lists the forms and ../../shared/*-google-form.js build the answers; the tigecycline and colistin
// forms also need the unit's email, GOOGLE_FORM_EMAIL). Sending is off unless GOOGLE_FORM_SEND=1; otherwise the answers that would go are returned
// and nothing leaves the server. A form already sent is refused unless `resend` is true, so a double tap cannot
// file the patient twice with the ministry.
// The reason kept on a form whose post may or may not have reached Google (see the claim below).
const UNCONFIRMED = 'لم يتأكد الإرسال — راجع ردود النموذج'
// Errors that prove the request never left: nothing reached Google, so the mark can be undone.
const NOT_SENT_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT'])
// Who is sending, as the follow-up shows it.
const senderName = (request) => request.session.user.fullName || request.session.user.username || ''
router.post('/drug-requests/:id/google-form', requireAuth, async (request, response) => {
  const own = await ownRequest(request)
  if (own.status) return refuse(response, own)
  const target = GOOGLE_FORMS[own.row.kind]
  if (!target) return response.status(400).json({ message: 'هذه الاستمارة لا تُرسل إلى نموذج Google' })
  // Sent by hand from the pre-filled form (the form asks for a sign-in): the pharmacist says so, and the form is marked.
  if (request.body?.confirmManual === true) {
    await query("UPDATE drug_requests SET google_sent_at = NOW(), google_sent_by_name = $2, google_sent_how = 'manual', google_error = '' WHERE id = $1", [own.row.id, senderName(request)])
    return response.json({ request: toRequest(await loadRequest(own.row.id)) })
  }
  // The رقم الطبلة the screen shows (the stored one, else the day's chart's) is the one sent.
  const [floorText, ...ward] = own.row.ward_key.split('|')
  const patientId = own.row.patient_id || (await chartIds(floorText ? Number(floorText) : null, ward.join('|'), own.row.date)).get(own.row.patient_name) || ''
  const form = toRequest({ ...own.row, patient_id: patientId })
  const sending = process.env.GOOGLE_FORM_SEND === '1'
  const answers = target.answers(form, `${floorText ? `الطابق ${floorText} — ` : ''}${ward.join('|')}`, sending)
  if (!answers.ok) return response.status(422).json({ message: answers.invalid ? `صحّح أولًا: ${answers.invalid.join('، ')}` : `أكمل أولًا: ${answers.missing.join('، ')}`, missing: answers.missing, invalid: answers.invalid })
  if (!sending) return response.json({ dryRun: true, answers: answers.body })
  // A form that collects verified emails makes every filler sign in: the server cannot post to it. Nothing is sent
  // and nothing is marked; the pre-filled form is offered, to be submitted from the pharmacist's own browser.
  let live = null
  try { live = liveForm(await (await fetch(target.url.replace(/formResponse$/, 'viewform'), { signal: AbortSignal.timeout(8000) })).text()) } catch { /* unread: try the post */ }
  if (live?.signIn) {
    return response.json({ signIn: true, manualUrl: prefillUrl(target.url, answers.prefill || answers.body), message: 'نموذج Google هذا يشترط تسجيل الدخول بحساب Google، فلا يمكن إرساله من التطبيق. افتح النموذج المُعبّأ وأرسله من متصفحك، ثم سجّل أنه أُرسل.' })
  }
  // The form is marked sent BEFORE it is posted, in one statement, so two taps (or two devices) cannot both
  // post it, and an answer Google recorded but we never heard about cannot be posted again by a retry.
  // The mark is undone only when the send definitely did not happen. `resend` allows a form already sent.
  const resend = request.body?.resend === true
  // While the post is out the form reads «لم يتأكد الإرسال»: if the server dies before Google answers, or the answer never
  // reaches us, that is what the follow-up shows (never «sent» or «refused»); a clear answer replaces it.
  const claimed = await query("UPDATE drug_requests SET google_sent_at = NOW(), google_sent_by_name = $3, google_sent_how = 'auto', google_error = $4, google_attempt_at = NOW() WHERE id = $1 AND (google_sent_at IS NULL OR $2::boolean) RETURNING google_sent_at::text AS claimed", [own.row.id, resend, senderName(request), UNCONFIRMED])
  if (!claimed.rowCount) return response.status(409).json({ message: 'أُرسلت هذه الاستمارة من قبل', sentAt: form.googleSentAt })
  const mine = claimed.rows[0].claimed
  // The mark is put back as it was, and why this try failed is kept for the follow-up — but only while it is still this
  // try's own mark (another device may have recorded a hand-send meanwhile: that stays).
  const release = (why) => query('UPDATE drug_requests SET google_sent_at = $2, google_sent_by_name = $3, google_sent_how = $4, google_error = $5, google_attempt_at = NOW() WHERE id = $1 AND google_sent_at = $6::timestamptz',
    [own.row.id, own.row.google_sent_at, own.row.google_sent_by_name, own.row.google_sent_how, why, mine]).catch(() => {})
  const unconfirmed = async () => response.status(504).json({ message: 'لم يتأكد الإرسال — راجع ردود النموذج قبل إعادة الإرسال.', request: toRequest(await loadRequest(own.row.id)) })
  let reply
  try {
    reply = await fetch(target.url, { method: 'POST', body: new URLSearchParams(answers.body), signal: AbortSignal.timeout(15000) })
  } catch (error) {
    console.error('google form: no answer:', error.name, error.cause?.code || '')
    // Only an error from before the request left (no such host, refused, no route) proves nothing was sent. A timeout or
    // a connection dropped later may have come after Google recorded it: the mark stays, and the form says it is unconfirmed.
    if (!NOT_SENT_CODES.has(error.cause?.code ?? error.code)) return unconfirmed()
    await release('تعذّر الوصول إلى Google')
    return response.status(502).json({ message: 'تعذّر الوصول إلى Google — حاول مرة أخرى.' })
  }
  // Checked live on 2026-11-06: an accepted answer comes back 200 from …/formResponse («your response has been
  // recorded»); a refused one (a required question missing, an option text the form no longer has) 400 with the
  // form drawn again. A redirect (the form now asks for a sign-in, or is closed) is a 200 page too, but not from there.
  if (!reply.ok || reply.redirected || !new URL(reply.url).pathname.endsWith('/formResponse')) {
    // Why: read the live form and compare. The form changed (a question or option the app sends is gone), or it is
    // the same and one of the values was refused. Either way a link opens the form with the answers filled in,
    // so the send can be finished by hand there — Google then says itself which box it did not accept.
    let changed = []
    // (A form that could not be read is not a form that changed.)
    changed = live ? mismatches(answers.body, live.entries) : []
    // The form is in hand: its health verdict is kept too (the dashboard shows a changed form at once), and a NEW required
    // question the app does not answer is named — before, it read as «a value was refused».
    const verdict = live ? compareForm(own.row.kind, live) : null
    if (verdict) saveHealth(own.row.kind, verdict).catch(() => {})
    console.error('google form: refused:', reply.status, reply.redirected, changed, verdict?.detail || '')
    const why = changed.length
      ? `تغيّر نموذج Google ولم تعد الاستمارة تطابقه (${changed.join('، ')}) — أخبر المسؤول، ويمكنك إكمال الإرسال يدويًا.`
      : verdict?.status === 'changed'
        ? `تغيّر نموذج Google (${verdict.detail}) — أخبر المسؤول، ويمكنك إكمال الإرسال يدويًا.`
        : 'رفض نموذج Google إحدى القيم (راجع العمر أرقام صحيحة، والوزن وS.Cr أرقام) — صحّحها أو أكمل الإرسال يدويًا.'
    await release(why.slice(0, 300))
    return response.status(502).json({
      message: why,
      manualUrl: prefillUrl(target.url, answers.prefill || answers.body),
    })
  }
  await query("UPDATE drug_requests SET google_error = '' WHERE id = $1 AND google_sent_at = $2::timestamptz", [own.row.id, mine])
  response.json({ request: toRequest(await loadRequest(own.row.id)) })
})

router.delete('/drug-requests/:id', requireAuth, async (request, response) => {
  const own = await ownWritableRequest(request)
  if (own.status) return refuse(response, own)
  await query('DELETE FROM drug_requests WHERE id = $1', [own.row.id])
  response.json({ ok: true })
})

export default router
