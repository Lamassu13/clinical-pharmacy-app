import { useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'

// A patient ID on this chart that another ward's chart also carries today — a transfer nobody
// recorded, or a mistyped ID. Information only (a real transfer is normal): it names the other
// ward, never its patient. Checked a moment after the ID is typed (the autosave is 1.2 s, so the
// server has it by then), and not at all while there is nothing to check or the device is offline.
const wardLabel = (clash) => (clash.floor ? `الطابق ${clash.floor} — ${clash.ward}` : clash.ward)

// { id, wards[] } per clashing ID, minus what the pharmacist already dismissed for this chart.
export function useIdClashes(selected, selectedDate, patientIds) {
  const [clashes, setClashes] = useState([])
  const [hidden, setHidden] = useState('')
  const ids = patientIds.filter(Boolean).join(',')
  const where = `${selected.floor || ''}|${selected.ward}|${selected.slot || 'main'}|${selectedDate}`
  useEffect(() => {
    setClashes([])
    if (!ids) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date: selectedDate })
      fetch(`${apiUrl}/chart/id-clashes?${params}`, { credentials: 'include' })
        .then((response) => (response.ok ? response.json() : null))
        .then((result) => { if (!cancelled && result) setClashes(result.clashes) })
        .catch(() => { /* offline or transient: the next ID edit checks again */ })
    }, 2500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [ids, where, selected, selectedDate])
  const byId = new Map()
  for (const clash of clashes) byId.set(clash.patientId, [...(byId.get(clash.patientId) || []), wardLabel(clash)])
  const list = [...byId].map(([id, wards]) => ({ id, wards }))
  const signature = `${where}#${list.map((item) => `${item.id}:${item.wards.join('/')}`).join(';')}`
  return { list: hidden === signature ? [] : list, dismiss: () => setHidden(signature) }
}

// The full note, below the grid with the other notices (so the grid never shifts under a finger).
export default function IdClashNote({ list, dismiss, patientNames, patientIds }) {
  if (!list.length) return null
  return <div className="chart-clash-note" role="status">
    <span>
      {list.map(({ id, wards }) => {
        const name = patientNames[patientIds.indexOf(id)]?.trim()
        return <span key={id} className="id-clash-line">رقم الطبلة <bdi>{id}</bdi>{name ? ` (${name})` : ''} مسجّل اليوم أيضًا في: {wards.join('، ')} — إن لم يكن نقلًا فراجع الرقم.</span>
      })}
    </span>
    <button type="button" className="text-button compact" aria-label="إخفاء" onClick={dismiss}>حسنًا</button>
  </div>
}
