import { useState } from 'react'
import { DRUG_REQUESTS, toggleTick } from '../../shared/drug-requests.js'
import DrugRequestDialog from '../components/DrugRequestDialog.jsx'
import MeropenemSheet from '../components/MeropenemSheet.jsx'
import AlbuminSheet from '../components/AlbuminSheet.jsx'
import RequestPrintTemplate from '../components/RequestPrintTemplate.jsx'
import usePdfSheets from '../usePdfSheets.js'

// «استمارة الميرونيم» / «استمارة الالبومين»: the ward's forms of one kind for a day, each drawn as its
// paper form. The patient-entry form and the chart fill them; here a value is corrected where it
// sits on the form and a box ticked with a tap — both save at once — and forms are added by hand,
// deleted, and printed: «طباعة» makes a PDF with one A4 portrait page per form, the same on every
// device (the pills form's route, usePdfSheets).
const SHEETS = { meropenem: MeropenemSheet, albumin: AlbuminSheet }
const savedAt = (iso) => new Date(iso).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })

export default function DrugRequestsScreen({ kind, header, wardLabel, wardName, onBack, selectedDate, onChangeDate, isOnline, loading, loadError, requests, busy, actionError, onSave, onSetTicks, onSaveField, onDelete, confirmModal }) {
  const spec = DRUG_REQUESTS[kind]
  const Sheet = SHEETS[kind]
  const [adding, setAdding] = useState(false)
  const pdf = usePdfSheets()
  const list = requests || []
  const print = (forms) => {
    // A value still being typed is saved by its blur first, so the page carries it.
    document.activeElement?.blur?.()
    pdf.run(forms.map((request) => ({ key: request.id, kind, request, wardName, wardLabel })), `${spec.label} — ${wardLabel} — ${selectedDate}${forms.length === 1 ? ` — ${forms[0].name}` : ''}`)
  }

  return <main className="app-shell">
    {header}

    <section className="order-page req-page">
      <div className="chart-toolbar order-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
        <div><p className="modal-kicker">{spec.label}</p><h1>{wardLabel}</h1></div>
        <div className="toolbar-actions">
          <label className="pills-date">التاريخ <input type="date" value={selectedDate} onChange={(event) => onChangeDate(event.target.value)} /></label>
          <button type="button" className="secondary-button compact" disabled={!isOnline || loadError || loading} onClick={() => setAdding(true)}>+ استمارة جديدة</button>
          <button type="button" className="primary-button compact" disabled={!list.length || pdf.busy} onClick={() => print(list)}>{pdf.busy ? 'جارٍ التحضير…' : list.length > 1 ? 'طباعة الكل' : 'طباعة'}</button>
        </div>
      </div>

      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {pdf.error && <p className="form-error" role="alert">{pdf.error}</p>}

      {loading ? <div className="empty-state"><span className="spinner" /><span>جارٍ تحميل الاستمارات…</span></div>
        : loadError ? <div className="empty-state"><strong>تعذّر تحميل الاستمارات</strong><span>{isOnline ? 'حدّث الصفحة وحاول مجددًا.' : 'لا يوجد اتصال — تُعرض الاستمارات عند عودته.'}</span></div>
        : !list.length ? <div className="empty-state"><strong>لا توجد {spec.label} لهذا اليوم</strong><span>تُملأ من «إدخال مريض» أو الجارت عند إضافة {kind === 'meropenem' ? 'Meronem لمريض في أول يوم له' : 'الالبومين لمريض'}، أو أضِفها من «+ استمارة جديدة».</span></div>
        : <>
            <p className="req-hint">اكتب في أي حقل من الاستمارة لتعديله، والمس أي مربع لوضع علامة ✓ أو إزالتها — يُحفظ كل ذلك فورًا.</p>
            <div className="req-sheets">
              {list.map((request) => <article key={request.id} className="req-sheet" aria-label={`${spec.label} — ${request.name}`}>
                <div className="req-sheet-tools">
                  <p className="req-sheet-meta">
                    <strong>{request.name}</strong>
                    {request.patientId && <span>رقم الطبلة <bdi>{request.patientId}</bdi></span>}
                    {request.createdByName && <span>أدخلها {request.createdByName} · {savedAt(request.createdAt)}</span>}
                  </p>
                  <span className="req-sheet-actions">
                    <button type="button" className="secondary-button compact" disabled={pdf.busy} onClick={() => print([request])}>طباعة</button>
                    <button type="button" className="danger-button compact" disabled={busy} onClick={() => onDelete(request)}>حذف</button>
                  </span>
                </div>
                <Sheet request={request} wardName={wardName} wardLabel={wardLabel}
                  onToggle={(key) => onSetTicks(request, toggleTick(kind, request.ticks, key))}
                  onNote={(note) => onSetTicks(request, request.ticks, note)}
                  onField={(patch) => onSaveField(request, patch)} />
              </article>)}
            </div>
          </>}
    </section>

    {adding && <DrugRequestDialog kind={kind} screen initial={{}} kicker={wardLabel} title={`${spec.label} — جديدة`} saveLabel="حفظ" cancelLabel="إلغاء"
      onSave={async (payload) => { const result = await onSave(kind, payload); if (result.ok) setAdding(false); return result }}
      onClose={() => setAdding(false)} />}
    {pdf.sheets && <RequestPrintTemplate ref={pdf.ref} sheets={pdf.sheets} />}
    {confirmModal}
  </main>
}
