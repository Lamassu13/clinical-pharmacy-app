import { useState } from 'react'
import { DRUG_REQUESTS, toggleTick } from '../../shared/drug-requests.js'
import { ChevronStart } from '../components/WardGlyph.jsx'
import DrugRequestDialog from '../components/DrugRequestDialog.jsx'
import MeropenemSheet from '../components/MeropenemSheet.jsx'
import AlbuminSheet from '../components/AlbuminSheet.jsx'
import TigecyclineSheet from '../components/TigecyclineSheet.jsx'
import RequestPrintTemplate from '../components/RequestPrintTemplate.jsx'
import usePdfSheets from '../usePdfSheets.js'

// «استمارة الميرونيم» / «استمارة الالبومين»: the ward's forms of one kind for a day, each drawn as its
// paper form. The patient-entry form and the chart fill them; here a value is corrected where it
// sits on the form and a box ticked with a tap — both save at once — and forms are added by hand,
// deleted, and printed: «طباعة» makes a PDF with one A4 portrait page per form, the same on every
// device (the pills form's route, usePdfSheets). Each patient is one row; tapping it drops their form
// open (and again to close it), so a ward with several patients reads as a list, not a stack of pages.
const SHEETS = { meropenem: MeropenemSheet, albumin: AlbuminSheet, tigecycline: TigecyclineSheet }
const savedAt = (iso) => new Date(iso).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })

export default function DrugRequestsScreen({ footer, dayLocked = false, kind, header, wardLabel, wardName, onBack, selectedDate, onChangeDate, isOnline, loading, loadError, requests, busy, actionError, notice, onSendToGoogle, onSave, onSetTicks, onSaveField, onDelete, confirmModal }) {
  const spec = DRUG_REQUESTS[kind]
  const Sheet = SHEETS[kind]
  const [adding, setAdding] = useState(false)
  const [openIds, setOpenIds] = useState(() => new Set())
  const setOpen = (id, open) => setOpenIds((current) => { const next = new Set(current); if (open) next.add(id); else next.delete(id); return next })
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
      {dayLocked && <p className="day-lock-note" role="status">ليست استمارات اليوم — للعرض والطباعة فقط. لا يُعدَّل إلا يوم اليوم.</p>}
      <div className="chart-toolbar order-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
        <div><p className="modal-kicker">{spec.label}</p><h1>{wardLabel}</h1></div>
        <div className="toolbar-actions">
          <label className="pills-date">التاريخ <input type="date" value={selectedDate} onChange={(event) => onChangeDate(event.target.value)} /></label>
          {!dayLocked && <button type="button" className="secondary-button compact" disabled={!isOnline || loadError || loading} onClick={() => setAdding(true)}>+ استمارة جديدة</button>}
          <button type="button" className="primary-button compact" disabled={!list.length || pdf.busy} onClick={() => print(list)}>{pdf.busy ? 'جارٍ التحضير…' : list.length > 1 ? 'طباعة الكل' : 'طباعة'}</button>
        </div>
      </div>

      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {notice && <p className="req-hint" role="status">{notice}</p>}
      {pdf.error && <p className="form-error" role="alert">{pdf.error}</p>}

      {loading ? <div className="empty-state"><span className="spinner" /><span>جارٍ تحميل الاستمارات…</span></div>
        : loadError ? <div className="empty-state"><strong>تعذّر تحميل الاستمارات</strong><span>{isOnline ? 'حدّث الصفحة وحاول مجددًا.' : 'لا يوجد اتصال — تُعرض الاستمارات عند عودته.'}</span></div>
        : !list.length ? <div className="empty-state"><strong>لا توجد {spec.label} لهذا اليوم</strong><span>تُملأ من «إدخال مريض» أو الجارت عند إضافة {kind === 'albumin' ? 'الالبومين لمريض' : `${kind === 'meropenem' ? 'Meronem' : 'Tygacil'} لمريض في أول يوم له`}، أو أضِفها من «+ استمارة جديدة».</span></div>
        : <>
            <p className="req-hint">المس اسم المريض لفتح استمارته، ثم اكتب في أي حقل لتعديله والمس أي مربع لوضع علامة ✓ أو إزالتها — يُحفظ كل ذلك فورًا.</p>
            <div className="req-sheets">
              {list.map((request) => {
                const open = openIds.has(request.id)
                return <article key={request.id} className="req-sheet" aria-label={`${spec.label} — ${request.name}`}>
                  <h2 className="req-sheet-head">
                    <button type="button" className="req-sheet-toggle" aria-expanded={open} aria-controls={`req-sheet-${request.id}`} onClick={() => setOpen(request.id, !open)}>
                      <strong>{request.name}</strong>
                      {request.patientId && <span>رقم الطبلة <bdi>{request.patientId}</bdi></span>}
                      <span className="req-sheet-chevron" aria-hidden="true"><ChevronStart /></span>
                    </button>
                  </h2>
                  {open && <div className="req-sheet-body" id={`req-sheet-${request.id}`}>
                    <div className="req-sheet-tools">
                      <p className="req-sheet-meta">{request.createdByName && <span>أدخلها {request.createdByName} · {savedAt(request.createdAt)}</span>}</p>
                      <span className="req-sheet-actions">
                        {kind === 'albumin' && <button type="button" className="secondary-button compact" disabled={busy || !isOnline} onClick={() => onSendToGoogle(request)}>{request.googleSentAt ? 'أُرسلت ✓ — إعادة الإرسال' : 'إرسال إلى نموذج الوزارة'}</button>}
                        <button type="button" className="secondary-button compact" disabled={pdf.busy} onClick={() => print([request])}>طباعة</button>
                        {!dayLocked && <button type="button" className="danger-button compact" disabled={busy} onClick={() => onDelete(request)}>حذف</button>}
                      </span>
                    </div>
                    <fieldset className="day-lock" disabled={dayLocked}><Sheet request={request} wardName={wardName} wardLabel={wardLabel}
                      onToggle={(key) => onSetTicks(request, toggleTick(kind, request.ticks, key))}
                      onNote={(note) => onSetTicks(request, request.ticks, note)}
                      onField={(patch) => onSaveField(request, patch)} /></fieldset>
                  </div>}
                </article>
              })}
            </div>
          </>}
    </section>
    {footer}

    {adding && <DrugRequestDialog kind={kind} screen initial={{}} kicker={wardLabel} title={`${spec.label} — جديدة`} saveLabel="حفظ" cancelLabel="إلغاء"
      onSave={async (payload) => { const result = await onSave(kind, payload); if (result.ok) { setAdding(false); if (result.request) setOpen(result.request.id, true) } return result }}
      onClose={() => setAdding(false)} />}
    {pdf.sheets && <RequestPrintTemplate ref={pdf.ref} sheets={pdf.sheets} />}
    {confirmModal}
  </main>
}
