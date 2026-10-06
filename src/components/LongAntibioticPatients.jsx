import { useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'

// Manager card on the floor list: every patient whose antibiotic course has run past 14 days as of
// `date`, hospital-wide. The day numbers come from the same derivation as «متابعة المضادات
// الحيوية», which is where a tap goes. Quiet by design: nothing renders while loading, on any
// failure, offline, or when there is no one to list.
export default function LongAntibioticPatients({ date, onOpen, isExpired }) {
  const [list, setList] = useState(null)

  useEffect(() => {
    if (!date || !navigator.onLine) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch(`${apiUrl}/antibiotics/long?${new URLSearchParams({ date })}`, { credentials: 'include' })
        if (isExpired?.(response) || !response.ok) return
        const result = await response.json()
        if (!cancelled) setList({ date, threshold: result.threshold, patients: result.patients })
      } catch { /* no card is better than a broken one */ }
    })()
    return () => { cancelled = true }
  }, [date, isExpired])

  if (!list || list.date !== date || !list.patients.length) return null
  return <details className="long-abx" open={list.patients.length <= 5}>
    <summary>
      <span className="long-abx-count">{list.patients.length}</span>
      <strong>مضادات حيوية لأكثر من {list.threshold} يومًا</strong>
    </summary>
    <ul className="long-abx-list">
      {list.patients.map((patient) => (
        <li key={`${patient.floor}|${patient.ward}|${patient.drugKey}|${patient.patientId}|${patient.name}`}>
          <button type="button" className="long-abx-row" onClick={() => onOpen({ floor: patient.floor, ward: patient.ward, mode: 'antibiotics' })}>
            <span className="long-abx-who">
              <strong>{patient.name || 'بلا اسم'}</strong>
              {patient.patientId && <span className="patient-search-id">رقم الطبلة <bdi>{patient.patientId}</bdi></span>}
            </span>
            <span className="long-abx-day">اليوم <b>{patient.day}</b></span>
            <span className="long-abx-meta"><bdi dir="ltr">{patient.drug}</bdi> · {patient.floor ? `الطابق ${patient.floor} — ` : ''}{patient.ward}</span>
          </button>
        </li>
      ))}
    </ul>
  </details>
}
