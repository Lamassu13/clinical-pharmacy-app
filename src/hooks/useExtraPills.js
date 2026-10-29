import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUrl } from '../constants.js'
import { applyExtraPillsQueue, blankExtraPillForm, enqueueExtraPillsOp, sameOp, settleExtraPillsOp } from '../helpers.js'
import { storage } from '../storage.js'

// استمارة الحبوب الإضافي has no chart-style version/lock machinery on the server (every PUT
// just overwrites), so unlike chart/pills there's nothing to merge — only one offline write
// per form is ever queued at a time (see enqueueExtraPillsOp), stored here keyed by ward so a
// reload before reconnecting doesn't lose it.
const extraPillsQueueKey = (floorValue, ward) => `cpa-extra-pills-queue:${floorValue || 'special'}-${ward}`
const readExtraPillsQueue = (key) => { try { return JSON.parse(storage.getItem(key) || '[]') } catch { return [] } }
const writeExtraPillsQueue = (key, queue) => {
  try { if (queue.length) storage.setItem(key, JSON.stringify(queue)); else storage.removeItem(key) } catch { /* best effort */ }
}

// `setEditedAt` is App's: the printed sheet's «وقت التحرير», stamped when a list loads.
export default function useExtraPills({ selected, isOnline, isExpired, userId, askConfirm, setEditedAt }) {
  // استمارة الحبوب الإضافي (mode 'extra-pills') — a standalone, per-ward list of manually
  // created pill forms with no chart behind them at all.
  const [extraPillsForms, setExtraPillsForms] = useState([])
  const [extraPillsLoading, setExtraPillsLoading] = useState(false)
  const [extraPillsError, setExtraPillsError] = useState(false)
  const [extraPillsBusy, setExtraPillsBusy] = useState(false)
  const [extraPillsActionError, setExtraPillsActionError] = useState('')

  const createExtraPillForm = useCallback(async () => {
    if (!selected || selected.mode !== 'extra-pills') return
    setExtraPillsBusy(true)
    setExtraPillsActionError('')
    try {
      const response = await fetch(`${apiUrl}/extra-pills`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ floor: selected.floor, ward: selected.ward }) })
      isExpired(response)
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      setExtraPillsForms((current) => [...current, result.form])
    } catch (error) {
      if (error instanceof TypeError) {
        // Offline: show a blank editable card immediately and queue its creation for reconnect
        // — there's no real id yet, so edits to it (below) fold into this same queued op.
        const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        setExtraPillsForms((current) => [...current, { id: tempId, ...blankExtraPillForm(selected.floor, selected.ward) }])
        const queueKey = extraPillsQueueKey(selected.floor, selected.ward)
        writeExtraPillsQueue(queueKey, enqueueExtraPillsOp(readExtraPillsQueue(queueKey), { key: tempId, op: 'create', floor: selected.floor, ward: selected.ward, patch: null, user: userId }))
      } else {
        setExtraPillsActionError('تعذّر إنشاء الاستمارة — حاول مرة أخرى')
      }
    } finally { setExtraPillsBusy(false) }
  }, [selected, isExpired, userId])

  const saveExtraPillForm = useCallback(async (id, patch) => {
    const isTemp = typeof id === 'string' && id.startsWith('temp-')
    const form = extraPillsForms.find((item) => item.id === id)
    if (isTemp) {
      // Still waiting on its own creation to reach the server — fold the edit into the queued
      // create instead of PUTting to an id the server has never seen.
      setExtraPillsForms((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
      if (form) {
        const queueKey = extraPillsQueueKey(form.floor, form.ward)
        writeExtraPillsQueue(queueKey, enqueueExtraPillsOp(readExtraPillsQueue(queueKey), { key: id, op: 'create', floor: form.floor, ward: form.ward, patch, user: userId }))
      }
      return
    }
    setExtraPillsBusy(true)
    setExtraPillsActionError('')
    try {
      const response = await fetch(`${apiUrl}/extra-pills/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(patch) })
      isExpired(response)
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      setExtraPillsForms((current) => current.map((item) => (item.id === id ? result.form : item)))
    } catch (error) {
      if (error instanceof TypeError) {
        setExtraPillsForms((current) => current.map((item) => (item.id === id ? { ...item, ...patch, pending: true } : item)))
        if (form) {
          const queueKey = extraPillsQueueKey(form.floor, form.ward)
          writeExtraPillsQueue(queueKey, enqueueExtraPillsOp(readExtraPillsQueue(queueKey), { key: String(id), op: 'update', id, patch, user: userId }))
        }
      } else {
        setExtraPillsActionError('تعذّر حفظ الاستمارة — حاول مرة أخرى')
      }
    } finally { setExtraPillsBusy(false) }
  }, [isExpired, extraPillsForms, userId])

  const deleteExtraPillForm = useCallback(async (id) => {
    if (!(await askConfirm('حذف هذه الاستمارة؟', { danger: true }))) return
    const isTemp = typeof id === 'string' && id.startsWith('temp-')
    const form = extraPillsForms.find((item) => item.id === id)
    if (isTemp) {
      // Never reached the server — drop the local card and cancel its queued creation outright.
      setExtraPillsForms((current) => (current ?? []).filter((item) => item.id !== id))
      if (form) {
        const queueKey = extraPillsQueueKey(form.floor, form.ward)
        writeExtraPillsQueue(queueKey, enqueueExtraPillsOp(readExtraPillsQueue(queueKey), { key: id, op: 'delete', id: null, user: userId }))
      }
      return
    }
    setExtraPillsBusy(true)
    setExtraPillsActionError('')
    try {
      const response = await fetch(`${apiUrl}/extra-pills/${id}`, { method: 'DELETE', credentials: 'include' })
      isExpired(response)
      if (!response.ok && response.status !== 404) throw new Error()
      setExtraPillsForms((current) => (current ?? []).filter((item) => item.id !== id))
    } catch (error) {
      if (error instanceof TypeError) {
        setExtraPillsForms((current) => (current ?? []).filter((item) => item.id !== id))
        if (form) {
          const queueKey = extraPillsQueueKey(form.floor, form.ward)
          writeExtraPillsQueue(queueKey, enqueueExtraPillsOp(readExtraPillsQueue(queueKey), { key: String(id), op: 'delete', id, user: userId }))
        }
      } else {
        setExtraPillsActionError('تعذّر حذف الاستمارة — حاول مرة أخرى')
      }
    } finally { setExtraPillsBusy(false) }
  }, [askConfirm, isExpired, extraPillsForms, userId])

  // Replays queued extra-pills writes in order once the network is back — there's no fixed
  // retry timer for this screen (see the constant above), so reconnecting is the trigger.
  // Only this user's ops (and untagged ones queued before ops carried a user) are sent, so a
  // shared iPad never posts one pharmacist's offline edits under the next one's session. The
  // queue is re-read after every request: an edit made while a request was in flight replaced
  // that op, and must stay queued rather than be overwritten by a stale copy. One flush per ward
  // at a time — a second caller (the loader, a reconnect) waits for the running one.
  const extraPillsFlushes = useRef(new Map())
  const flushExtraPillsQueue = useCallback((floorValue, ward) => {
    const queueKey = extraPillsQueueKey(floorValue, ward)
    if (extraPillsFlushes.current.has(queueKey)) return extraPillsFlushes.current.get(queueKey)
    const mine = (item) => item.user == null || item.user === userId
    const run = async () => {
      // ponytail: 100 ops per flush is far above one ward's offline backlog; the rest go next time.
      for (let step = 0; step < 100; step += 1) {
        const entry = readExtraPillsQueue(queueKey).find(mine)
        if (!entry) return
        let created = null
        let patchSent = true
        try {
          if (entry.op === 'create') {
            const response = await fetch(`${apiUrl}/extra-pills`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ floor: floorValue, ward }) })
            if (isExpired(response)) return
            if (!response.ok) throw new Error()
            created = (await response.json()).form
            if (entry.patch) {
              const putResponse = await fetch(`${apiUrl}/extra-pills/${created.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(entry.patch) })
              if (putResponse.ok) created = (await putResponse.json()).form
              else patchSent = false
            }
          } else if (entry.op === 'update') {
            const response = await fetch(`${apiUrl}/extra-pills/${entry.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(entry.patch) })
            if (isExpired(response)) return
            if (!response.ok) throw new Error()
            const { form } = await response.json()
            // An edit queued while this PUT was in flight is newer than the server's answer.
            if (sameOp(readExtraPillsQueue(queueKey).find((item) => item.key === entry.key), entry)) {
              setExtraPillsForms((current) => current.map((item) => (item.id === entry.id ? form : item)))
            }
          } else if (entry.op === 'delete' && entry.id) {
            const response = await fetch(`${apiUrl}/extra-pills/${entry.id}`, { method: 'DELETE', credentials: 'include' })
            if (isExpired(response)) return
            if (!response.ok && response.status !== 404) throw new Error()
          }
        } catch {
          return // still offline / still failing — leave the rest queued for next time
        }
        const { queue: next, card } = settleExtraPillsOp(readExtraPillsQueue(queueKey), entry, created, patchSent)
        writeExtraPillsQueue(queueKey, next)
        if (card) setExtraPillsForms((current) => current.map((item) => (item.id === entry.key ? card : item)))
      }
    }
    const flush = run().finally(() => extraPillsFlushes.current.delete(queueKey))
    extraPillsFlushes.current.set(queueKey, flush)
    return flush
  }, [isExpired, userId])

  useEffect(() => {
    if (!selected || selected.mode !== 'extra-pills' || !isOnline) return undefined
    flushExtraPillsQueue(selected.floor, selected.ward)
  }, [selected, isOnline, flushExtraPillsQueue])

  // استمارة الحبوب الإضافي: one standing list per ward — no date scoping, since these aren't a
  // daily/reset artifact like the chart or the real pills form. `applyExtraPillsQueue` layers
  // in whatever create/edit/delete didn't reach the server yet (see the callbacks above), so a
  // pending offline change still shows right after this GET — including one served from the
  // service worker's cache while genuinely offline.
  useEffect(() => {
    if (!selected || selected.mode !== 'extra-pills') return undefined
    let cancelled = false
    setExtraPillsLoading(true)
    setExtraPillsError(false)
    const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward })
    const queueKey = extraPillsQueueKey(selected.floor, selected.ward)
    const mine = (item) => item.user == null || item.user === userId
    ;(navigator.onLine ? flushExtraPillsQueue(selected.floor, selected.ward) : Promise.resolve())
      .then(() => fetch(`${apiUrl}/extra-pills?${params}`, { credentials: 'include' }))
      .then((response) => { isExpired(response); return response.ok ? response.json() : null })
      .then((result) => {
        if (cancelled) return
        if (result) { setExtraPillsForms(applyExtraPillsQueue(result.forms, readExtraPillsQueue(queueKey).filter(mine))); setExtraPillsError(false); setEditedAt(new Date()) }
        else { setExtraPillsForms([]); setExtraPillsError(true) }
        setExtraPillsLoading(false)
      })
      .catch(() => { if (!cancelled) { setExtraPillsError(true); setExtraPillsLoading(false) } })
    return () => { cancelled = true }
  }, [selected, isExpired, userId, flushExtraPillsQueue, setEditedAt])
  return { extraPillsForms, extraPillsLoading, extraPillsError, extraPillsBusy, extraPillsActionError, createExtraPillForm, saveExtraPillForm, deleteExtraPillForm }
}
