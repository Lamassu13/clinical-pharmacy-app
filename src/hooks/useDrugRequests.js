import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUrl } from '../constants.js'
import { forgetWrite, queueWrite } from '../storage.js'
import { DRUG_REQUESTS } from '../../shared/drug-requests.js'

// «استمارة الميرونيم» / «استمارة الالبومين» (shared/drug-requests.js): the ward's forms of one kind
// for a day (modes 'meropenem-forms' / 'albumin-forms'), plus the calls the patient-entry form makes
// when a patient is added on the medicine: check (course day, already filled?) and save. A new form
// saved with no connection is queued on the device and sent with the other queued writes; the server
// keeps one per kind, patient, ward and day, so a resend updates it rather than adding a second.
export const formModeOf = (kind) => `${kind}-forms`
export const kindOfMode = (mode) => Object.keys(DRUG_REQUESTS).find((kind) => formModeOf(kind) === mode) || null
const queueKeyOf = (body) => `drug-request:${body.kind}|${body.floor}|${body.ward}|${body.date}|${body.name.trim()}|${body.patientId || ''}`
const byCreated = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt))

export default function useDrugRequests({ selected, selectedDate, isExpired, userId, askConfirm }) {
  const listKind = kindOfMode(selected?.mode)
  const [requests, setRequests] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [manualUrl, setManualUrl] = useState('') // the Google Form pre-filled, offered when a send was refused
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
      setActionError(error.message || 'لم يُحفظ آخر تعديل — تحقّق من الاتصال وحاول مرة أخرى.')
      setNonce((value) => value + 1)
    })
  }, [])
  const putLocal = (id, change) => setRequests((current) => current && current.map((item) => (item.id === id ? { ...item, ...change } : item)))

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
      putLocal(request.id, result.request)
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
      if (!response.ok) { setActionError(result.message || 'تعذّر الإرسال — حاول مرة أخرى.'); setManualUrl(result.manualUrl || ''); return }
      if (result.dryRun) { setNotice('وضع التجربة: لم يُرسل شيء إلى Google.'); return }
      // Only the mark: the reply's other values could undo an edit still in the queue.
      putLocal(request.id, { googleSentAt: result.request.googleSentAt })
      setNotice(`أُرسلت استمارة «${request.name}» إلى نموذج وزارة الصحة.`)
    } catch {
      setActionError('لا يوجد اتصال — الإرسال يحتاج اتصالًا.')
    } finally { setBusy(false) }
  }, [askConfirm, isExpired])

  return { listKind, requests, loading, loadError, busy, actionError, notice, manualUrl, check, save, setTicks, saveField, remove, sendToGoogle }
}
