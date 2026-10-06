import { useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'

// Every patient whose antibiotic course has run past 14 days as of `date`: hospital-wide on the
// managers' floor list, or just `floor` on that floor's ward list (everyone with access). The day
// numbers come from the same derivation as «متابعة المضادات الحيوية», which is where a tap goes.
// It always shows, so it is clear where the list lives: a loading line, «no one», or a retry,
// then the list.
export default function LongAntibioticPatients({ date, floor = null, onOpen, isExpired }) {
  const [list, setList] = useState(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!date) return undefined
    let cancelled = false
    ;(async () => {
      try {
        setFailed(false)
        const response = await fetch(`${apiUrl}/antibiotics/long?${new URLSearchParams({ date, ...(floor ? { floor } : {}) })}`, { credentials: 'include' })
        if (isExpired?.(response)) return
        if (!response.ok) throw new Error('failed')
        const result = await response.json()
        if (!cancelled) setList({ date, threshold: result.threshold, patients: result.patients })
      } catch { if (!cancelled) setFailed(true) }
    })()
    return () => { cancelled = true }
  }, [date, floor, isExpired, attempt])

  const ready = list && list.date === date
  const title = `مضادات حيوية لأكثر من ${ready ? list.threshold : 14} يومًا`
  if (!ready) return <div className="long-abx long-abx--note" role="status">
    <strong>{title}</strong>
    {failed
      ? <span>تعذّر التحميل <button type="button" className="text-button" onClick={() => setAttempt((n) => n + 1)}>إعادة المحاولة</button></span>
      : <span>جارٍ التحميل…</span>}
  </div>
  if (!list.patients.length) return <div className="long-abx long-abx--note"><strong>{title}</strong><span>لا يوجد مرضى</span></div>
  return <details className="long-abx" open={list.patients.length <= 5}>
    <summary>
      <span className="long-abx-count">{list.patients.length}</span>
      <strong>{title}</strong>
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
