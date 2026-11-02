import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { DRUG_REQUESTS, toggleTick } from '../../shared/drug-requests.js'
import DrugRequestDialog from '../components/DrugRequestDialog.jsx'
import MeropenemSheet from '../components/MeropenemSheet.jsx'
import AlbuminSheet from '../components/AlbuminSheet.jsx'

// «استمارة الميرونيم» / «استمارة الالبومين»: the ward's forms of one kind for a day, each drawn as its
// paper form and printed one per A4 portrait page. The patient-entry form fills them; here they are
// added by hand, corrected, ticked, deleted and printed. A tapped box saves at once.
const SHEETS = { meropenem: MeropenemSheet, albumin: AlbuminSheet }
const savedAt = (iso) => new Date(iso).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })

export default function DrugRequestsScreen({ kind, header, wardLabel, wardName, onBack, selectedDate, onChangeDate, isOnline, loading, loadError, requests, busy, actionError, onSave, onSetTicks, onDelete, confirmModal }) {
  const spec = DRUG_REQUESTS[kind]
  const Sheet = SHEETS[kind]
  // The open dialog: { request } to correct one, { request: null } to add one by hand.
  const [editing, setEditing] = useState(null)
  // The one sheet a «طباعة» on a single form sends to paper; null prints them all.
  const [printOnly, setPrintOnly] = useState(null)
  useEffect(() => {
    const reset = () => setPrintOnly(null)
    window.addEventListener('afterprint', reset)
    return () => window.removeEventListener('afterprint', reset)
  }, [])
  const print = (id) => { flushSync(() => setPrintOnly(id)); window.print() }
  const list = requests || []

  return <main className="app-shell">
    {header}

    <section className="order-page req-page">
      <div className="chart-toolbar order-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
        <div><p className="modal-kicker">{spec.label}</p><h1>{wardLabel}</h1></div>
        <div className="toolbar-actions">
          <label className="pills-date">التاريخ <input type="date" value={selectedDate} onChange={(event) => onChangeDate(event.target.value)} /></label>
          <button type="button" className="secondary-button compact" disabled={!isOnline || loadError || loading} onClick={() => setEditing({ request: null })}>+ استمارة جديدة</button>
          <button type="button" className="primary-button compact" disabled={!list.length} onClick={() => print(null)}>{list.length > 1 ? 'طباعة الكل' : 'طباعة'}</button>
        </div>
      </div>

      {actionError && <p className="form-error" role="alert">{actionError}</p>}

      {loading ? <div className="empty-state"><span className="spinner" /><span>جارٍ تحميل الاستمارات…</span></div>
        : loadError ? <div className="empty-state"><strong>تعذّر تحميل الاستمارات</strong><span>{isOnline ? 'حدّث الصفحة وحاول مجددًا.' : 'لا يوجد اتصال — تُعرض الاستمارات عند عودته.'}</span></div>
        : !list.length ? <div className="empty-state"><strong>لا توجد {spec.label} لهذا اليوم</strong><span>تُملأ من «إدخال مريض» عند إضافة {kind === 'meropenem' ? 'Meronem لمريض في أول يوم له' : 'الالبومين لمريض'}، أو أضِفها من «+ استمارة جديدة».</span></div>
        : <>
            <p className="req-hint">المس أي مربع في الاستمارة لوضع علامة ✓ أو إزالتها — يُحفظ فورًا ويُطبع معها.</p>
            <div className={`req-sheets${printOnly ? ' req-sheets--one' : ''}`}>
              {list.map((request) => <article key={request.id} className={`req-sheet${printOnly === request.id ? ' req-sheet--print' : ''}`} aria-label={`${spec.label} — ${request.name}`}>
                <div className="req-sheet-tools">
                  <p className="req-sheet-meta">
                    <strong>{request.name}</strong>
                    {request.patientId && <span>رقم الطبلة <bdi>{request.patientId}</bdi></span>}
                    {request.createdByName && <span>أدخلها {request.createdByName} · {savedAt(request.createdAt)}</span>}
                  </p>
                  <span className="req-sheet-actions">
                    <button type="button" className="secondary-button compact" disabled={busy} onClick={() => setEditing({ request })}>تعديل</button>
                    <button type="button" className="secondary-button compact" onClick={() => print(request.id)}>طباعة</button>
                    <button type="button" className="danger-button compact" disabled={busy} onClick={() => onDelete(request)}>حذف</button>
                  </span>
                </div>
                <Sheet request={request} wardName={wardName} wardLabel={wardLabel}
                  onToggle={(key) => onSetTicks(request, toggleTick(kind, request.ticks, key))}
                  onNote={(note) => onSetTicks(request, request.ticks, note)} />
              </article>)}
            </div>
          </>}
    </section>

    {editing && <DrugRequestDialog kind={kind} screen initial={editing.request || {}} kicker={wardLabel}
      title={editing.request ? `تعديل ${spec.label}` : `${spec.label} — جديدة`} saveLabel="حفظ" cancelLabel="إلغاء"
      onSave={async (payload) => { const result = await onSave(kind, payload, editing.request?.id); if (result.ok) setEditing(null); return result }}
      onClose={() => setEditing(null)} />}
    {confirmModal}
  </main>
}
