import { useCallback, useRef, useState } from 'react'
import { DRUG_REQUESTS } from '../../shared/drug-requests.js'

// When to open the request-form popups, for both places a dose is added: «إدخال مريض» (a patient
// added) and the chart grid (a quantity typed in a Meronem / albumin column, or carried over from
// yesterday). `ask(patient, lines)` checks each kind the lines need — Meropenem only on the course's
// first day, albumin every day, neither when today's form is already filled — and queues one dialog
// per form; App renders `current`. A patient + kind is asked once per ward and day on this device,
// so editing the cell again after «لاحقًا» does not ask twice.
// `check` and `save` are useDrugRequests'; `scope` is the ward and date being charted.
export default function useRequestPrompts({ check, save, scope }) {
  const [queue, setQueue] = useState([])
  const [saved, setSaved] = useState([])
  const asked = useRef(new Set())
  // Where focus was when the first dialog opened (the grid cell, the entry form's name box): it goes
  // back there when the last one closes.
  const opener = useRef(null)

  const ask = useCallback(async (patient, lines) => {
    if (!patient.name && !patient.patientId) return
    const asks = []
    for (const [kind, spec] of Object.entries(DRUG_REQUESTS)) {
      const mine = lines.filter((line) => Number(line.quantity) > 0 && spec.pattern.test(line.medicine))
      if (!mine.length) continue
      const key = `${scope}|${kind}|${patient.name}|${patient.patientId}`
      if (asked.current.has(key)) continue
      asked.current.add(key)
      const result = await check(kind, patient.name, patient.patientId)
      if (result && (result.requested || (spec.firstDayOnly && result.day !== 1))) continue
      const fields = { ...spec.prefill(mine), ...(spec.dayField && result ? { [spec.dayField]: String(result.day) } : {}) }
      asks.push({ id: `${key}|${Date.now()}`, kind, scope, ...patient, fields, note: result ? '' : spec.offlineNote })
    }
    if (!asks.length) return
    setQueue((current) => {
      if (!current.length) opener.current = document.activeElement
      return [...current, ...asks]
    })
  }, [check, scope])

  const next = useCallback(() => {
    setQueue((current) => {
      const rest = current.slice(1)
      if (!rest.length) {
        const element = opener.current
        opener.current = null
        if (element?.isConnected) setTimeout(() => element.focus(), 0)
      }
      return rest
    })
  }, [])

  const saveCurrent = useCallback(async (payload) => {
    const item = queue[0]
    const result = await save(item.kind, payload)
    if (result.ok) {
      setSaved((current) => [...current.filter((entry) => entry.kind !== item.kind), { kind: item.kind, name: payload.name, queued: Boolean(result.queued), scope: item.scope }])
      next()
    }
    return result
  }, [queue, save, next])

  const clearSaved = useCallback(() => setSaved([]), [])
  // A «حُفظت …» note belongs to the ward and day it was saved for.
  return { current: queue[0] || null, ask, saveCurrent, skipCurrent: next, saved: saved.filter((entry) => entry.scope === scope), clearSaved }
}
