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
  const [nonce, setNonce] = useState(0)
  const wardFloor = selected?.floor || ''
  const wardName = selected?.ward || ''

  useEffect(() => {
    if (!listKind) return undefined
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    setActionError('')
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

  // A tapped box: shown at once, then the whole set is sent. Taps on one form go out one after
  // another, so they reach the server in the order they were made. A refused or failed send reloads
  // the list (the boxes go back to what is saved) and says so.
  const chains = useRef(new Map())
  const setTicks = useCallback((request, ticks, note = request.note) => {
    setActionError('')
    setRequests((current) => current && current.map((item) => (item.id === request.id ? { ...item, ticks, note } : item)))
    const send = () => fetch(`${apiUrl}/drug-requests/${request.id}/ticks`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ticks, note }),
    }).then((response) => { if (!isExpired(response) && !response.ok) throw new Error('refused') })
    const next = (chains.current.get(request.id) || Promise.resolve()).catch(() => {}).then(send)
    chains.current.set(request.id, next)
    next.catch(() => {
      setActionError('لم يُحفظ آخر تحديد — تحقّق من الاتصال وأعِد الضغط.')
      setNonce((value) => value + 1)
    })
  }, [isExpired])

  const remove = useCallback(async (request) => {
    if (!(await askConfirm(`حذف ${DRUG_REQUESTS[request.kind].label} للمريض «${request.name}»؟`, { danger: true, confirmLabel: 'حذف' }))) return
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

  return { listKind, requests, loading, loadError, busy, actionError, check, save, setTicks, remove }
}
