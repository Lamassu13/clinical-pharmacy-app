import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUrl } from '../constants.js'
import { forgetWrite, queueWrite } from '../storage.js'
import { DRUG_REQUESTS } from '../../shared/drug-requests.js'
import { clearFollowup } from '../followupCache.js'

// «استمارة الميرونيم» / «استمارة الالبومين» (shared/drug-requests.js): the ward's forms of one kind
// for a day (modes 'meropenem-forms' / 'albumin-forms'), plus the calls the patient-entry form makes
// when a patient is added on the medicine: check (course day, already filled?) and save. A new form
// saved with no connection is queued on the device and sent with the other queued writes; the server
// keeps one per kind, patient, ward and day, so a resend updates it rather than adding a second.
export const formModeOf = (kind) => `${kind}-forms`
export const kindOfMode = (mode) => Object.keys(DRUG_REQUESTS).find((kind) => formModeOf(kind) === mode) || null
const queueKeyOf = (body) => `drug-request:${body.kind}|${body.floor}|${body.ward}|${body.date}|${body.name.trim()}|${body.patientId || ''}`
// What a reply says about the send (not its other values: they could undo an edit still in the queue).
const sendMark = (request) => ({ googleSentAt: request.googleSentAt, googleSentBy: request.googleSentBy, googleSentHow: request.googleSentHow, googleError: request.googleError })
// A send that did not go through: the form the reply carries (an unconfirmed one is marked sent, with its reason), else just
// the reason — except a 409 / 422, which are about the form as it stands, not about this try.
const refusedFor = (putLocal, id, response, result) => {
  if (result.request) putLocal(id, sendMark(result.request))
  else if (response.status !== 409 && response.status !== 422) putLocal(id, { googleError: result.message || '' })
}
const byCreated = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt))

export default function useDrugRequests({ selected, selectedDate, isExpired, userId, askConfirm }) {
  const listKind = kindOfMode(selected?.mode)
  const [requests, setRequests] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [manualUrl, setManualUrl] = useState('') // the Google Form pre-filled, offered when it cannot be posted
  const [manualId, setManualId] = useState(null) // the form that link is for
  const [nonce, setNonce] = useState(0)
  const wardFloor = selected?.floor || ''
  const wardName = selected?.ward || ''

  useEffect(() => {
    if (!listKind) return undefined
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    setActionError('')
    setNotice('')
    // A pre-filled Google link is for the form it was made for: it never follows to another ward, day or kind.
    setManualUrl('')
    setManualId(null)
    const params = new URLSearchParams({ kind: listKind, floor: wardFloor, ward: wardName, date: selectedDate })
    fetch(`${apiUrl}/drug-requests?${params}`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : null })
      .then((result) => {
        if (cancelled) return
        setRequests(result ? result.requests : null)
        setLoadError(!result)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setRequests(null); setLoadError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [listKind, wardFloor, wardName, selectedDate, isExpired, nonce])

  // { day, requested } for the patient on the chart's date, or null when it could not be asked
  // (no connection) — the entry form then opens the popup anyway and says it could not check.
  const check = useCallback(async (kind, name, patientId) => {
    if (!wardName) return null
    try {
      const params = new URLSearchParams({ kind, floor: wardFloor, ward: wardName, date: selectedDate, name, id: patientId || '' })
      const response = await fetch(`${apiUrl}/drug-requests/check?${params}`, { credentials: 'include' })
      if (isExpired(response) || !response.ok) return null
      return await response.json()
    } catch { return null }
  }, [wardFloor, wardName, selectedDate, isExpired])

  // Saves a form ({ name, patientId, fields }): a new one (POST, queued offline) or an edit of `id`
  // (PUT, needs a connection). Resolves { ok, queued? } or { ok: false, message }.
  const save = useCallback(async (kind, payload, id = null) => {
    if (!wardName) return { ok: false, message: 'لا توجد ردهة محددة' }
    const body = { kind, floor: wardFloor, ward: wardName, date: selectedDate, ...payload }
    setBusy(true)
    setActionError('')
    try {
      const response = await fetch(`${apiUrl}/drug-requests${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body),
      })
      if (isExpired(response)) return { ok: false, message: 'انتهت الجلسة — سجّل الدخول ثم احفظ مجددًا.' }
      const result = await response.json().catch(() => ({}))
      if (!response.ok) return { ok: false, message: result.message || 'تعذّر حفظ الاستمارة — حاول مرة أخرى.' }
      clearFollowup()
      if (!id) forgetWrite(queueKeyOf(body))
      if (kind === listKind) setRequests((current) => (current ? [...current.filter((item) => item.id !== result.request.id), result.request].sort(byCreated) : current))
      return { ok: true, request: result.request }
    } catch {
      if (id) return { ok: false, message: 'لا يوجد اتصال — التعديل يحتاج اتصالًا.' }
      queueWrite({ key: queueKeyOf(body), user: userId, method: 'POST', path: '/drug-requests', body, label: DRUG_REQUESTS[kind].label })
      return { ok: true, queued: true }
    } finally { setBusy(false) }
  }, [wardFloor, wardName, selectedDate, isExpired, userId, listKind])

  // Changes made on a form's screen — a tapped box, a value edited in place — are shown at once and
  // sent one after another per form, so they reach the server in the order they were made. A refused
  // or failed send reloads the list (the form goes back to what is saved) and says why.
  const chains = useRef(new Map())
  const enqueue = useCallback((id, send) => {
    const next = (chains.current.get(id) || Promise.resolve()).catch(() => {}).then(send)
    chains.current.set(id, next)
    next.catch((error) => {
      // The list reloads (the form back to what is saved): the failed edit is over, so it must not block this form's next send.
      if (chains.current.get(id) === next) chains.current.delete(id)
      setActionError(error.message || 'لم يُحفظ آخر تعديل — تحقّق من الاتصال وحاول مرة أخرى.')
      setNonce((value) => value + 1)
    })
  }, [])
  // Any change to a form makes the managers' follow-up list (followupCache.js) out of date.
  const putLocal = (id, change) => { clearFollowup(); setRequests((current) => current && current.map((item) => (item.id === id ? { ...item, ...change } : item))) }
  const refusedMark = (id, response, result) => refusedFor(putLocal, id, response, result)

  const setTicks = useCallback((request, ticks, note = request.note) => {
    setActionError('')
    putLocal(request.id, { ticks, note })
    enqueue(request.id, () => fetch(`${apiUrl}/drug-requests/${request.id}/ticks`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ticks, note }),
    }).then((response) => { if (!isExpired(response) && !response.ok) throw new Error('') }))
  }, [isExpired, enqueue])

  // A value edited in place: { name } / { patientId } / { fields: { key: value } }. The reply replaces
  // the form (albumin's «كتابة» follows the count).
  const saveField = useCallback((request, patch) => {
    setActionError('')
    const next = { name: patch.name ?? request.name, patientId: patch.patientId ?? request.patientId, fields: { ...request.fields, ...patch.fields } }
    putLocal(request.id, next)
    enqueue(request.id, async () => {
      const response = await fetch(`${apiUrl}/drug-requests/${request.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(next),
      })
      if (isExpired(response)) return
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(response.status === 409 ? `${result.message} — أُعيدت الاستمارة كما كانت.` : '')
      // Only what the server adds (albumin's «كتابة»): the rest of the reply could roll back an edit — a tick, a field — still on its way
      // after this one (the values on screen are already cleaned as typed).
      putLocal(request.id, { words: result.request.words })
    })
  }, [isExpired, enqueue])

  const remove = useCallback(async (request) => {
    const sent = request.googleSentAt ? ' (أُرسلت إلى نموذج وزارة الصحة — الحذف لا يسحبها من هناك)' : ''
    if (!(await askConfirm(`حذف ${DRUG_REQUESTS[request.kind].label} للمريض «${request.name}»؟${sent}`, { danger: true, confirmLabel: 'حذف' }))) return
    setBusy(true)
    setActionError('')
    try {
      const response = await fetch(`${apiUrl}/drug-requests/${request.id}`, { method: 'DELETE', credentials: 'include' })
      if (isExpired(response)) return
      if (!response.ok && response.status !== 404) throw new Error('delete failed')
      clearFollowup()
      setRequests((current) => current && current.filter((item) => item.id !== request.id))
    } catch {
      setActionError('تعذّر حذف الاستمارة — تحقّق من الاتصال وحاول مرة أخرى.')
    } finally { setBusy(false) }
  }, [askConfirm, isExpired])

  // «إرسال إلى نموذج الوزارة»: the server files the albumin form with the ministry's Google Form. Asks first
  // (it leaves the app), and again before sending one that already went.
  const sendToGoogle = useCallback(async (request) => {
    const resend = Boolean(request.googleSentAt)
    const question = resend ? `أُرسلت استمارة «${request.name}» من قبل. إرسالها مرة ثانية يسجّل المريض مرتين عند الوزارة — متأكد؟` : `إرسال استمارة «${request.name}» إلى نموذج وزارة الصحة؟`
    if (!(await askConfirm(question, { confirmLabel: 'إرسال' }))) return
    setBusy(true)
    setActionError('')
    setNotice('')
    setManualUrl('')
    setManualId(null)
    try {
      // The server sends what it has stored: wait for the edits still on their way for this form (the field
      // being typed saved when the button was tapped), and do not send if one of them failed.
      try { await chains.current.get(request.id) } catch { return }
      const response = await fetch(`${apiUrl}/drug-requests/${request.id}/google-form`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ resend }),
      })
      if (isExpired(response)) return
      const result = await response.json().catch(() => ({}))
      if (response.status === 409) putLocal(request.id, { googleSentAt: result.sentAt })
      if (!response.ok) { setActionError(result.message || 'تعذّر الإرسال — حاول مرة أخرى.'); setManualUrl(result.manualUrl || ''); setManualId(request.id); refusedMark(request.id, response, result); return }
      if (result.dryRun) { setNotice('وضع التجربة: لم يُرسل شيء إلى Google.'); return }
      if (result.signIn) { setNotice(result.message); setManualUrl(result.manualUrl); setManualId(request.id); return }
      putLocal(request.id, sendMark(result.request))
      setNotice(`أُرسلت استمارة «${request.name}» إلى نموذج وزارة الصحة.`)
    } catch {
      setActionError('لا يوجد اتصال — الإرسال يحتاج اتصالًا.')
    } finally { setBusy(false) }
  }, [askConfirm, isExpired])

  // «إرسال المتبقي»: every form of the day not sent yet, one after another, in the order they were made. It stops
  // at the first that cannot be posted — one the Google Form wants a sign-in for (the pre-filled link is shown, to be
  // finished by hand and marked) or one it refused — and says how far it got. One question for the whole run.
  const sendAll = useCallback(async (unsent) => {
    if (!unsent.length) return
    if (!(await askConfirm(unsent.length === 1 ? `إرسال استمارة «${unsent[0].name}» إلى نموذج وزارة الصحة؟` : `إرسال ${unsent.length} استمارات إلى نموذج وزارة الصحة، واحدة بعد الأخرى؟`, { confirmLabel: 'إرسال' }))) return
    setBusy(true)
    setActionError('')
    setNotice('')
    setManualUrl('')
    setManualId(null)
    let sent = 0
    try {
      for (const request of unsent) {
        try { await chains.current.get(request.id) } catch { setActionError(`${sent ? `أُرسلت ${sent}. ` : ''}لم يُحفظ آخر تعديل على استمارة «${request.name}» — صحّحها ثم أعد المحاولة.`); return }
        const response = await fetch(`${apiUrl}/drug-requests/${request.id}/google-form`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({}) })
        if (isExpired(response)) return
        const result = await response.json().catch(() => ({}))
        if (result.dryRun) { setNotice('وضع التجربة: لم يُرسل شيء إلى Google.'); return }
        if (result.signIn) { setNotice(`${sent ? `أُرسلت ${sent}. ` : ''}استمارة «${request.name}» تحتاج إكمالًا يدويًا: ${result.message}`); setManualUrl(result.manualUrl); setManualId(request.id); return }
        // Already sent meanwhile (another device, or a tap before): take the mark and go on to the next.
        if (response.status === 409) { putLocal(request.id, { googleSentAt: result.sentAt }); continue }
        if (!response.ok) { setActionError(`${sent ? `أُرسلت ${sent}. ` : ''}«${request.name}»: ${result.message || 'تعذّر الإرسال — حاول مرة أخرى.'}`); setManualUrl(result.manualUrl || ''); setManualId(request.id); refusedMark(request.id, response, result); return }
        putLocal(request.id, sendMark(result.request))
        sent += 1
      }
      setNotice(`أُرسلت ${sent} ${sent === 1 ? 'استمارة' : 'استمارات'} إلى نموذج وزارة الصحة.`)
    } catch {
      setActionError(`${sent ? `أُرسلت ${sent}. ` : ''}لا يوجد اتصال — الإرسال يحتاج اتصالًا.`)
    } finally { setBusy(false) }
  }, [askConfirm, isExpired])

  // «مرضى بلا استمارة»: the patients given this kind's medicine today on this ward with no form of the kind for them. Only
  // when asked (one small request), never on opening the screen. Resolves { ok, patients } or { ok: false, message }.
  const findMissing = useCallback(async (kind) => {
    try {
      const params = new URLSearchParams({ kind, floor: wardFloor, ward: wardName, date: selectedDate })
      const response = await fetch(`${apiUrl}/drug-requests/missing?${params}`, { credentials: 'include' })
      if (isExpired(response)) return { ok: false, message: 'انتهت الجلسة — سجّل الدخول ثم أعد المحاولة.' }
      const result = await response.json().catch(() => ({}))
      return response.ok ? { ok: true, patients: result.patients } : { ok: false, message: result.message || 'تعذّر البحث — حاول مرة أخرى.' }
    } catch { return { ok: false, message: 'لا يوجد اتصال — البحث يحتاج اتصالًا.' } }
  }, [wardFloor, wardName, selectedDate, isExpired])

  // «أُرسلت من Google»: the pharmacist submitted the pre-filled form by hand; the form is marked sent here too.
  const confirmManualSent = useCallback(async (request) => {
    if (!request) { setManualUrl(''); setManualId(null); return }
    setBusy(true)
    setActionError('')
    try {
      const response = await fetch(`${apiUrl}/drug-requests/${request.id}/google-form`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ confirmManual: true }) })
      if (isExpired(response)) return
      const result = await response.json().catch(() => ({}))
      if (!response.ok) { setActionError(result.message || 'تعذّر التسجيل — حاول مرة أخرى.'); return }
      putLocal(request.id, sendMark(result.request))
      setManualUrl('')
      setManualId(null)
      setNotice(`سُجّلت استمارة «${request.name}» كمُرسلة.`)
    } catch { setActionError('لا يوجد اتصال — التسجيل يحتاج اتصالًا.') } finally { setBusy(false) }
  }, [isExpired])

  return { listKind, requests, loading, loadError, busy, actionError, notice, manualUrl, manualId, confirmManualSent, check, save, setTicks, saveField, remove, sendToGoogle, sendAll, findMissing }
}
