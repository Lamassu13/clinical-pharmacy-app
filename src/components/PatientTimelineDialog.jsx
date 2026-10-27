import { useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'

// «التسلسل اليومي» — one patient, day by day: where they were charted and every medicine with its
// quantity. A day with no chart is marked, not skipped silently: Friday has no chart (Thursday
// holds its doses), and any other gap must not read as a discharge. Same modal chrome as the
// history dialog; fetched when opened.
const DAY_MS = 86400000
const at = (iso) => new Date(`${iso}T12:00:00`)
const formatDay = (iso) => at(iso).toLocaleDateString('ar-IQ', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' })
const wardText = (entry) => `${entry.floor ? `الطابق ${entry.floor} — ` : ''}${entry.ward}${entry.slot === 'extra' ? ' — الجارت الإضافي' : ''}`

// Between a newer and an older charted date: nothing, "Friday has no chart", or "N days with no chart".
function gapNote(newer, older) {
  const missing = Math.round((at(newer) - at(older)) / DAY_MS) - 1
  if (missing < 1) return null
  if (missing === 1 && at(older).getDay() === 4) return 'الجمعة — لا جارت (جرعات الخميس تغطّيها)'
  return `${missing} ${missing === 1 ? 'يوم' : 'أيام'} بلا جارت`
}

export default function PatientTimelineDialog({ patient, onClose }) {
  const [state, setState] = useState({ days: null, truncated: false, error: false })
  const [reload, setReload] = useState(0)
  useEffect(() => {
    if (!patient) return undefined
    let cancelled = false
    setState({ days: null, truncated: false, error: false })
    const params = new URLSearchParams(patient.patientId ? { id: patient.patientId } : { name: patient.name })
    fetch(`${apiUrl}/patients/timeline?${params}`, { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('timeline failed'))))
      .then((result) => { if (!cancelled) setState({ days: result.days, truncated: result.truncated, error: false }) })
      .catch(() => { if (!cancelled) setState({ days: null, truncated: false, error: true }) })
    return () => { cancelled = true }
  }, [patient, reload])
  if (!patient) return null
  const { days, truncated, error } = state
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="medicine-modal templates-modal" role="dialog" aria-modal="true" aria-labelledby="timeline-title"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }}>
      <h2 id="timeline-title">{patient.name || 'بلا اسم'}{patient.patientId && <small className="timeline-id"> · رقم الطبلة <bdi>{patient.patientId}</bdi></small>}</h2>
      <p className="templates-hint">كل يوم ظهر فيه المريض في جارت: الردهة وكل دواء وكميته، الأحدث أولًا. اليوم الذي لا جارت فيه يُعلَّم ولا يُعدّ خروجًا.</p>
      {error ? <div className="templates-empty">
        <span>تعذّر تحميل التسلسل — تحقّق من الاتصال.</span>
        <button type="button" className="secondary-button compact" onClick={() => setReload((n) => n + 1)}>إعادة المحاولة</button>
      </div>
        : days === null ? <p className="templates-empty" role="status">جارٍ التحميل…</p>
        : days.length === 0 ? <p className="templates-empty">لا توجد أيام مسجّلة لهذا المريض.</p>
        : <ol className="timeline-list">
          {days.map((day, index) => {
            const gap = index > 0 ? gapNote(days[index - 1].date, day.date) : null
            return <li key={day.date}>
              {gap && <p className="timeline-gap">{gap}</p>}
              <p className="timeline-day">{formatDay(day.date)}</p>
              {day.entries.map((entry) => <div key={`${entry.floor}|${entry.ward}|${entry.slot}`} className="timeline-entry">
                <span className="timeline-ward">{wardText(entry)}</span>
                {entry.medicines.length
                  ? <span className="patient-search-meds">{entry.medicines.map((medicine) => <span className="patient-search-med" key={medicine.name} dir="ltr">{medicine.name} <b>× {medicine.quantity}</b></span>)}</span>
                  : <span className="patient-search-meds patient-search-meds--none">لا أدوية مسجّلة</span>}
              </div>)}
            </li>
          })}
        </ol>}
      {truncated && <p className="templates-hint">يُعرض آخر 120 يومًا فقط.</p>}
      <div className="modal-actions">
        <button type="button" className="secondary-button" autoFocus onClick={onClose}>إغلاق</button>
      </div>
    </div>
  </div>
}
