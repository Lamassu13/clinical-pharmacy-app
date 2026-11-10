import { useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'

// Every patient whose antibiotic course has run past 14 days as of `date`: hospital-wide on the
// managers' floor list, or just `floor` on that floor's ward list (everyone with access). The day
// numbers come from the same course derivation as «متابعة الميروبينيم».
// It always shows, so it is clear where the list lives: a loading line, «no one», or a retry,
// then the list.
export default function LongAntibioticPatients({ date, floor = null, isExpired }) {
  const [list, setList] = useState(null)
  const [failed, setFailed] = useState(false)
  const [refusal, setRefusal] = useState('') // the server's own words when this date is not shown to a floor user
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!date) return undefined
    let cancelled = false
    ;(async () => {
      try {
        setFailed(false); setRefusal('')
        const response = await fetch(`${apiUrl}/antibiotics/long?${new URLSearchParams({ date, ...(floor ? { floor } : {}) })}`, { credentials: 'include' })
        if (isExpired?.(response)) return
        const result = await response.json()
        if (response.status === 403 && result.outOfRange) { if (!cancelled) setRefusal(result.message); return }
        if (!response.ok) throw new Error('failed')
        if (!cancelled) setList({ date, threshold: result.threshold, patients: result.patients })
      } catch { if (!cancelled) setFailed(true) }
    })()
    return () => { cancelled = true }
  }, [date, floor, isExpired, attempt])

  const ready = list && list.date === date
  const title = `مضادات حيوية لأكثر من ${ready ? list.threshold : 14} يومًا`
  if (!ready) return <div className="long-abx long-abx--note" role="status">
    <strong>{title}</strong>
    {refusal ? <span>{refusal}</span> : failed
      ? <span>تعذّر التحميل <button type="button" className="text-button" onClick={() => setAttempt((n) => n + 1)}>إعادة المحاولة</button></span>
      : <span>جارٍ التحميل…</span>}
  </div>
  if (!list.patients.length) return <div className="long-abx long-abx--note"><strong>{title}</strong><span>لا يوجد مرضى</span></div>
  return <details className="long-abx">
    <summary>
      <span className="long-abx-count">{list.patients.length}</span>
      <strong>{title}</strong>
    </summary>
    <ul className="long-abx-list">
      {list.patients.map((patient) => (
        <li key={`${patient.floor}|${patient.ward}|${patient.drugKey}|${patient.patientId}|${patient.name}`}>
          <div className="long-abx-row">
            <span className="long-abx-who">
              <strong>{patient.name || 'بلا اسم'}</strong>
              {patient.patientId && <span className="patient-search-id">رقم الطبلة <bdi>{patient.patientId}</bdi></span>}
            </span>
            <span className="long-abx-day">اليوم <b>{patient.day}</b></span>
            <span className="long-abx-meta"><bdi dir="ltr">{patient.drug}</bdi> · {patient.floor ? `الطابق ${patient.floor} — ` : ''}{patient.ward}</span>
          </div>
        </li>
      ))}
    </ul>
  </details>
}
