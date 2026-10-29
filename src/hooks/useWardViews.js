import { useCallback, useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'
import { interactionsForChart, parseChartRows } from '../helpers.js'
import { INTERACTION_RULES } from '../interactions.js'
import { forgetWrite, queueWrite } from '../storage.js'

// The read-only ward screens: each loads when its mode opens for the selected ward and date.

export function useOrder({ selected, selectedDate, isExpired }) {
  // The requisition view (mode 'order') — read-only, derived from the main chart.
  const [orderData, setOrderData] = useState(null)
  const [orderLoading, setOrderLoading] = useState(false)
  const [orderError, setOrderError] = useState(false)
  // The requisition — a plain read-only fetch on ward/date change. No autosave, no lock.
  useEffect(() => {
    if (!selected || selected.mode !== 'order') return undefined
    let cancelled = false
    setOrderLoading(true)
    setOrderError(false)
    const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date: selectedDate })
    fetch(`${apiUrl}/order?${params}`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : null })
      .then((result) => {
        if (cancelled) return
        if (result) { setOrderData(result.order || { items: [] }); setOrderError(false) }
        else { setOrderData(null); setOrderError(true) }
        setOrderLoading(false)
      })
      .catch(() => { if (!cancelled) { setOrderError(true); setOrderLoading(false) } })
    return () => { cancelled = true }
  }, [selected, selectedDate, isExpired])
  return { orderData, orderLoading, orderError }
}

export function useMeropenemOrder({ selected, selectedDate, isExpired }) {
  const [meroOrderData, setMeroOrderData] = useState(null)
  const [meroOrderLoading, setMeroOrderLoading] = useState(false)
  const [meroOrderError, setMeroOrderError] = useState(false)
  // «طلبية الميرونيم» — the same plain read-only fetch, from the main chart.
  useEffect(() => {
    if (!selected || selected.mode !== 'meropenem-order') return undefined
    let cancelled = false
    setMeroOrderLoading(true)
    setMeroOrderError(false)
    const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, date: selectedDate })
    fetch(`${apiUrl}/meropenem-order?${params}`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : null })
      .then((result) => {
        if (cancelled) return
        setMeroOrderData(result ? result.order || { items: [] } : null)
        setMeroOrderError(!result)
        setMeroOrderLoading(false)
      })
      .catch(() => { if (!cancelled) { setMeroOrderError(true); setMeroOrderLoading(false) } })
    return () => { cancelled = true }
  }, [selected, selectedDate, isExpired])
  return { meroOrderData, meroOrderLoading, meroOrderError }
}

// «متابعة الميروبينيم» and «متابعة المضادات الحيوية»: one form, plus the typed course day.
// refreshCourseForms reloads it — App's write queue calls it after sending a queued course day.
export function useCourseForms({ selected, selectedDate, isExpired, userId }) {
  // «متابعة الميروبينيم» — read-only, derived from the ward's charts for the chosen date's month.
  const [meropenemData, setMeropenemData] = useState(null)
  const [meropenemLoading, setMeropenemLoading] = useState(false)
  const [meropenemError, setMeropenemError] = useState(false)
  const [meropenemNonce, setMeropenemNonce] = useState(0)
  useEffect(() => {
    // «متابعة المضادات الحيوية» is the same form for every followed antibiotic; it shares this state.
    if (!selected || (selected.mode !== 'meropenem' && selected.mode !== 'antibiotics')) return undefined
    let cancelled = false
    setMeropenemData(null)
    setMeropenemLoading(true)
    setMeropenemError(false)
    const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, date: selectedDate })
    fetch(`${apiUrl}/${selected.mode}?${params}`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : null })
      .then((result) => {
        if (cancelled) return
        if (result) { setMeropenemData(result.form || result); setMeropenemError(false) }
        else { setMeropenemData(null); setMeropenemError(true) }
        setMeropenemLoading(false)
      })
      .catch(() => { if (!cancelled) { setMeropenemError(true); setMeropenemLoading(false) } })
    return () => { cancelled = true }
  }, [selected, selectedDate, isExpired, meropenemNonce])
  // Retype a course's first shown day on the follow-up forms; the days after it count on from it.
  const saveCourseDay = useCallback(async (patient, anchorDate, n) => {
    const body = { floor: selected.floor || '', ward: selected.ward, date: selectedDate, patientKey: patient.key, drugKey: patient.drugKey, anchorDate, n }
    const queueKey = `course-day:${body.floor}|${body.ward}|${body.patientKey}|${body.drugKey}`
    try {
      const response = await fetch(`${apiUrl}/course-day`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
      if (!isExpired(response) && response.ok) forgetWrite(queueKey)
    } catch {
      // Offline: kept on the device and sent when the connection is back (the header counts it).
      queueWrite({ key: queueKey, user: userId, method: 'PUT', path: '/course-day', body, label: 'يوم الكورس' })
    }
    setMeropenemNonce((value) => value + 1)
  }, [selected, selectedDate, isExpired, userId])
  const refreshCourseForms = useCallback(() => setMeropenemNonce((value) => value + 1), [])
  return { meropenemData, meropenemLoading, meropenemError, saveCourseDay, refreshCourseForms }
}

export function useInteractions({ selected, selectedDate, isExpired }) {
  const [interactionsData, setInteractionsData] = useState(null)
  const [interactionsLoading, setInteractionsLoading] = useState(false)
  const [interactionsError, setInteractionsError] = useState(false)
  // «التداخلات الدوائية»: the ward's main and extra charts for the day, checked in the browser
  // against the DDInter reference pairs and the bundled rule list — read-only, nothing is saved.
  useEffect(() => {
    if (!selected || selected.mode !== 'interactions') return undefined
    let cancelled = false
    setInteractionsLoading(true)
    setInteractionsError(false)
    const load = (slot) => fetch(`${apiUrl}/chart?${new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, slot, date: selectedDate })}`, { credentials: 'include' })
      .then((response) => { isExpired(response); if (!response.ok) throw new Error('load failed'); return response.json() })
      .then((result) => ({ slot, rows: parseChartRows(result.chart) }))
    Promise.all([load('main'), load('extra')])
      .then(async (charts) => {
        // One reference-data lookup for every medicine given to anyone on the ward. If it fails
        // the hand-written rules still run, so the screen degrades rather than breaks.
        const given = [...new Set(charts.flatMap(({ rows }) => rows.columnMedicines.filter((medicine, column) => medicine.trim() && rows.quantities.some((row) => Number(row[column]) > 0))))]
        let dbPairs = [], duplicates = []
        if (given.length > 1) {
          try {
            const response = await fetch(`${apiUrl}/interactions?${new URLSearchParams(given.map((name) => ['name', name]))}`, { credentials: 'include' })
            if (response.ok) ({ pairs: dbPairs = [], duplicates = [] } = await response.json())
          } catch { /* rules only */ }
        }
        return charts.map(({ slot, rows }) => ({ slot, patients: interactionsForChart(rows, INTERACTION_RULES, dbPairs, duplicates) }))
      })
      .then((charts) => { if (!cancelled) { setInteractionsData(charts); setInteractionsLoading(false) } })
      .catch(() => { if (!cancelled) { setInteractionsData(null); setInteractionsError(true); setInteractionsLoading(false) } })
    return () => { cancelled = true }
  }, [selected, selectedDate, isExpired])
  return { interactionsData, interactionsLoading, interactionsError }
}
