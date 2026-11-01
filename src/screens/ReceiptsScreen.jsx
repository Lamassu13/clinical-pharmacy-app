import { useState } from 'react'
import { receiptKey } from '../hooks/useWardViews.js'

// «متابعة الاستلام» (GET /api/receipts): the day's patients on the main chart (not the extra one),
// with their room first since that is where the doses are carried, each marked استلم or لم يستلم
// once the doses go round. Rows stay in chart order whatever their mark,
// so nothing moves under a gloved finger; the chips above narrow the list instead. Tapping the
// pressed mark again clears it.
const FILTERS = [
  { key: 'all', label: 'الكل', match: () => true },
  { key: 'missed', label: 'لم يستلم', match: (patient) => patient.received === false },
  { key: 'open', label: 'لم يُحدَّد', match: (patient) => patient.received === null },
  { key: 'given', label: 'استلم', match: (patient) => patient.received === true },
]

const Icon = ({ children }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
const GivenIcon = () => <Icon><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>
const MissedIcon = () => <Icon><path d="M7 7l10 10M17 7L7 17" /></Icon>

export default function ReceiptsScreen({ header, wardLabel, roomLabel, onBack, selectedDate, onChangeDate, loading, patients, loadError, saveError, savingRows, onSetReceived }) {
  const [filter, setFilter] = useState('all')
  const all = patients || []
  const active = FILTERS.find((item) => item.key === filter)
  const shown = all.filter(active.match)

  return <main className="app-shell">
    {header}

    <section className="order-page receipts-page">
      <div className="chart-toolbar order-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
        <div><h1>متابعة الاستلام</h1><p className="receipts-ward">{wardLabel}</p></div>
        <div className="toolbar-actions">
          <label className="pills-date">التاريخ <input type="date" value={selectedDate} onChange={(event) => onChangeDate(event.target.value)} /></label>
        </div>
      </div>

      {loading ? <div className="empty-state"><span className="spinner" /><span>جارٍ تحميل المرضى…</span></div>
        : loadError ? <div className="empty-state"><strong>تعذّر تحميل المرضى</strong><span>تحقّق من الاتصال، ثم حدّث الصفحة.</span></div>
        : !all.length ? <div className="empty-state"><strong>لا يوجد مرضى في جارت هذا اليوم</strong><span>سجّل الجارت الرئيسي لهذه الردهة أولًا، ثم يظهر مرضاه هنا لتحديد من استلم جرعاته.</span></div>
        : <>
          <div className="filter-chips receipts-filters" role="group" aria-label="عرض المرضى حسب الاستلام">
            {FILTERS.map((item) => <button key={item.key} type="button" className="filter-chip" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>
              {item.label} <span className="filter-chip-count">{all.filter(item.match).length}</span>
            </button>)}
          </div>

          {saveError && <p className="form-error" role="alert">{saveError}</p>}

          {!shown.length ? <div className="empty-state"><strong>لا يوجد مرضى في «{active.label}»</strong></div>
            : <ul className="medicine-list receipts-list">
              {shown.map((patient) => {
                const busy = savingRows.has(receiptKey(patient))
                // Ignored rather than disabled while its save is in flight: a disabled button drops
                // focus and flashes grey for the ~200ms the request takes.
                const mark = (value) => { if (!busy) onSetReceived(patient, patient.received === value ? null : value) }
                return <li key={patient.rowNumber} className="receipts-row" aria-busy={busy || undefined}>
                  <span className="receipts-room">
                    <span>{roomLabel}</span>
                    {patient.room ? <bdi>{patient.room}</bdi> : <b aria-label="غير مسجّل">—</b>}
                  </span>
                  <div className="receipts-who">
                    <strong className="receipts-name">{patient.name}</strong>
                    {patient.patientId && <span className="patient-search-id">رقم الطبلة <bdi>{patient.patientId}</bdi></span>}
                  </div>
                  <div className="receipts-toggle" role="group" aria-label={`استلام ${patient.name}`}>
                    <button type="button" className="receipts-btn receipts-btn--given" aria-pressed={patient.received === true} title={patient.received === true ? 'اضغط مجددًا لإلغاء التحديد' : undefined} onClick={() => mark(true)}><GivenIcon />استلم</button>
                    <button type="button" className="receipts-btn receipts-btn--missed" aria-pressed={patient.received === false} title={patient.received === false ? 'اضغط مجددًا لإلغاء التحديد' : undefined} onClick={() => mark(false)}><MissedIcon />لم يستلم</button>
                  </div>
                </li>
              })}
            </ul>}
        </>}
    </section>
  </main>
}
