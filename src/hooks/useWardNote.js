import { useCallback, useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'
import { forgetWrite, pendingWrites, queueWrite } from '../storage.js'

// `writesFlushed` is App's write-queue counter: a queued note that has just been sent reloads here.
export default function useWardNote({ selected, selectedDate, userId, writesFlushed, isExpired }) {
  // «ملاحظة التسليم»: the ward's note for this day (one per ward, shared by the main and extra
  // charts) and the previous one. `draft` is what the box shows; it saves on blur.
  // A save that cannot reach the server is queued on the device (storage.js queueWrite) and
  // shown as «queued» until App's write queue sends it.
  const [wardNote, setWardNote] = useState({ key: '', note: null, previous: null, draft: '', status: 'idle' })
  const wardNoteKey = selected && selected.mode === 'chart' ? `${selected.floor ?? ''}|${selected.ward}|${selectedDate}` : ''
  useEffect(() => {
    if (!wardNoteKey) return undefined
    let cancelled = false
    const pending = pendingWrites(userId).find((item) => item.key === `ward-note:${wardNoteKey}`)
    // Same ward/day again (a refresh after the write queue sent something): keep what is on
    // screen — the note box saves on blur, so it may hold text being typed right now.
    setWardNote((current) => (current.key === wardNoteKey ? current : { key: wardNoteKey, note: null, previous: null, draft: '', status: 'loading' }))
    const typing = (current) => current.key === wardNoteKey && ['idle', 'saving', 'save-error'].includes(current.status) && current.draft !== (current.note?.body || '')
    fetch(`${apiUrl}/ward-note?${new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, date: selectedDate })}`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : Promise.reject(new Error('load failed')) })
      .then((result) => {
        if (cancelled) return
        setWardNote((current) => (typing(current)
          ? { ...current, note: result.note, previous: result.previous }
          : { key: wardNoteKey, note: result.note, previous: result.previous, draft: pending ? pending.body.body : result.note?.body || '', status: pending ? 'queued' : 'idle' }))
      })
      .catch(() => {
        if (cancelled) return
        setWardNote((current) => {
          if (pending) return { ...current, draft: pending.body.body, status: 'queued' }
          // A failed refresh of a note already on screen leaves it usable.
          return current.key === wardNoteKey && current.status !== 'loading' ? current : { ...current, status: 'load-error' }
        })
      })
    return () => { cancelled = true }
  }, [wardNoteKey, selected?.floor, selected?.ward, selectedDate, userId, writesFlushed, isExpired])
  const saveWardNote = useCallback(async () => {
    const { key, draft, note } = wardNote
    const queueKey = `ward-note:${key}`
    if (!selected || key !== wardNoteKey) return
    if (draft.trim() === (note?.body || '') && !pendingWrites(userId).some((item) => item.key === queueKey)) return
    setWardNote((current) => ({ ...current, status: 'saving' }))
    const body = { floor: selected.floor || '', ward: selected.ward, date: selectedDate, body: draft }
    let response
    try {
      response = await fetch(`${apiUrl}/ward-note`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
    } catch {
      queueWrite({ key: queueKey, user: userId, method: 'PUT', path: '/ward-note', body, label: 'ملاحظة التسليم' })
      setWardNote((current) => (current.key === key ? { ...current, status: 'queued' } : current))
      return
    }
    if (isExpired(response)) { setWardNote((current) => (current.key === key ? { ...current, status: 'idle' } : current)); return }
    try {
      if (!response.ok) throw new Error('save failed')
      forgetWrite(queueKey)
      const result = await response.json()
      setWardNote((current) => (current.key === key ? { ...current, note: result.note, status: 'idle' } : current))
    } catch { setWardNote((current) => (current.key === key ? { ...current, status: 'save-error' } : current)) }
  }, [selected, selectedDate, wardNote, wardNoteKey, userId, isExpired])
  return { wardNote, setWardNote, wardNoteKey, saveWardNote }
}
