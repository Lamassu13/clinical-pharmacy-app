import { useState } from 'react'
import { DRUG_REQUESTS, toggleTick } from '../../shared/drug-requests.js'
import { ChevronStart } from '../components/WardGlyph.jsx'
import DrugRequestDialog from '../components/DrugRequestDialog.jsx'
import MeropenemSheet from '../components/MeropenemSheet.jsx'
import AlbuminSheet from '../components/AlbuminSheet.jsx'
import TigecyclineSheet from '../components/TigecyclineSheet.jsx'
import ColistinSheet from '../components/ColistinSheet.jsx'
import IvigSheet from '../components/IvigSheet.jsx'
import RequestPrintTemplate from '../components/RequestPrintTemplate.jsx'
import usePdfSheets from '../usePdfSheets.js'
import { formProblems, needsFollowUp, sendsToGoogle, isNotIndicated, GOOGLE_KINDS } from '../../shared/form-problems.js'

// «استمارة الميرونيم» / «استمارة الالبومين»: the ward's forms of one kind for a day, each drawn as its
// paper form. The patient-entry form and the chart fill them; here a value is corrected where it
// sits on the form and a box ticked with a tap — both save at once — and forms are added by hand,
// deleted, and printed: «طباعة» makes a PDF with one A4 portrait page per form, the same on every
// device (the pills form's route, usePdfSheets). Each patient is one row; tapping it drops their form
// open (and again to close it), so a ward with several patients reads as a list, not a stack of pages.
const SHEETS = { meropenem: MeropenemSheet, albumin: AlbuminSheet, tigecycline: TigecyclineSheet, colistin: ColistinSheet, ivig: IvigSheet }
const savedAt = (iso) => new Date(iso).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })
// Where a form stands, for its row — one chip, the most pressing first: a send Google may or may not have received (check its
// responses before sending again), a refused one, not sent yet, or sent (and how). A form still lacking something says so too.
const standing = (request, google, problems) => {
  if (isNotIndicated(request.kind, request)) return { tone: 'muted', text: 'غير مستطبّة — لا تُرسل', title: request.fields.reason }
  const lacking = problems.length ? `ناقصة: ${problems.join('، ')}` : ''
  if (google && request.googleSentAt && request.googleError) return { tone: 'pending', text: 'لم يتأكد الإرسال', title: request.googleError }
  if (google && request.googleError) return { tone: 'danger', text: 'تعذّر الإرسال', title: request.googleError }
  if (google && !request.googleSentAt) return { tone: 'pending', text: lacking || 'لم تُرسل' }
  if (google) return { tone: 'done', text: `${request.googleSentHow === 'manual' ? 'أُرسلت يدويًا' : 'أُرسلت'} ✓ ${savedAt(request.googleSentAt)}${lacking ? ` · ${lacking}` : ''}`, title: request.googleSentBy }
  return lacking ? { tone: 'pending', text: lacking } : null
}

export default function DrugRequestsScreen({ hub, footer, dayLocked = false, kind, header, wardLabel, wardName, onBack, selectedDate, onChangeDate, isOnline, loading, loadError, requests, busy, actionError, notice, manualUrl, manualId, onConfirmManual, onSendToGoogle, onSendAll, onFindMissing, onSave, onSetTicks, onSaveField, onDelete, confirmModal }) {
  const spec = DRUG_REQUESTS[kind]
  const Sheet = SHEETS[kind]
  const [adding, setAdding] = useState(false)
  // The patient a form is being added for from «مرضى بلا استمارة» (null: a blank form).
  const [addFor, setAddFor] = useState(null)
  const [missing, setMissing] = useState(null)
  const [missingBusy, setMissingBusy] = useState(false)
  const searchMissing = async () => {
    setMissingBusy(true)
    setMissing({ ...(await onFindMissing(kind)), date: selectedDate })
    setMissingBusy(false)
  }
  const [openIds, setOpenIds] = useState(() => new Set())
  const setOpen = (id, open) => setOpenIds((current) => { const next = new Set(current); if (open) next.add(id); else next.delete(id); return next })
  const pdf = usePdfSheets()
  const list = requests || []
  const google = GOOGLE_KINDS.includes(kind)
  // The IVIG form is not printed: it only goes to the ministry's Google Form.
  const printable = kind !== 'ivig'
  const problemsOf = new Map(list.map((request) => [request.id, formProblems(kind, request)]))
  const sends = (request) => sendsToGoogle(kind, request)
  const unsent = list.filter((request) => sends(request) && !request.googleSentAt)
  // «إرسال المتبقي» sends the unsent forms that are complete (an incomplete one is refused before it leaves, and would stop the run).
  const sendable = unsent.filter((request) => !problemsOf.get(request.id).length)
  const unconfirmed = list.filter((request) => sends(request) && request.googleSentAt && request.googleError)
  const incomplete = list.filter((request) => problemsOf.get(request.id).length && needsFollowUp(kind, request))
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
        {/* In «مواقف القسم» (`hub`: its title, the floor, and the ward / form controls) the controls come before the day's
            actions: the ward and the form are chosen first, then acted on. */}
        {hub ? <div><h1>{hub.title}</h1><p className="receipts-ward">{hub.sub}</p></div> : <div><p className="modal-kicker">{spec.label}</p><h1>{wardLabel}</h1></div>}
        {hub?.controls}
        <div className="toolbar-actions">
          <label className="pills-date">التاريخ <input type="date" value={selectedDate} onChange={(event) => onChangeDate(event.target.value)} /></label>
          {!dayLocked && <button type="button" className="secondary-button compact" disabled={!isOnline || loadError || loading} onClick={() => { setAddFor(null); setAdding(true) }}>+ استمارة جديدة</button>}
          {printable && <button type="button" className="primary-button compact" disabled={!list.length || pdf.busy} onClick={() => print(list)}>{pdf.busy ? 'جارٍ التحضير…' : list.length > 1 ? 'طباعة الكل' : 'طباعة'}</button>}
        </div>
      </div>

      {spec.firstDayOnly && !dayLocked && !loading && !loadError && <div className="req-missing">
        <button type="button" className="text-button" disabled={!isOnline || missingBusy} onClick={searchMissing}>{missingBusy ? 'جارٍ البحث…' : 'مرضى بلا استمارة؟'}</button>
        {missing?.date === selectedDate && !missing.ok && <span className="form-error" role="alert">{missing.message}</span>}
        {missing?.date === selectedDate && missing.ok && (missing.patients.length === 0
          ? <span className="req-hint">لا يوجد مريض بدأ {spec.label.replace('استمارة ', '')} في هذا اليوم بلا استمارة.</span>
          : <ul className="req-missing-list">{missing.patients.map((patient) => <li key={`${patient.name}|${patient.patientId}`}>
            <span>{patient.name}{patient.patientId && <small> · <bdi>{patient.patientId}</bdi></small>}</span>
            <button type="button" className="secondary-button compact" disabled={busy} onClick={() => { setAddFor(patient); setAdding(true) }}>+ استمارة</button>
          </li>)}</ul>)}
      </div>}
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {notice && <p className="req-hint" role="status">{notice}</p>}
      {manualUrl && <p className="req-hint req-manual">
        <a className="secondary-button compact" href={manualUrl} target="_blank" rel="noopener noreferrer">فتح نموذج Google مُعبّأ لإكمال الإرسال يدويًا</a>
        {manualId && <button type="button" className="secondary-button compact" disabled={busy} onClick={() => onConfirmManual(list.find((item) => item.id === manualId))}>أرسلتها من Google — سجّلها كمُرسلة</button>}
      </p>}
      {pdf.error && <p className="form-error" role="alert">{pdf.error}</p>}

      {loading ? <div className="empty-state"><span className="spinner" /><span>جارٍ تحميل الاستمارات…</span></div>
        : loadError ? <div className="empty-state"><strong>تعذّر تحميل الاستمارات</strong><span>{isOnline ? 'حدّث الصفحة وحاول مجددًا.' : 'لا يوجد اتصال — تُعرض الاستمارات عند عودته.'}</span></div>
        : !list.length ? <div className="empty-state"><strong>لا توجد {spec.label} لهذا اليوم</strong><span>تُملأ من «إدخال مريض» أو الجارت عند إضافة {kind === 'albumin' ? 'الالبومين لمريض' : `${{ meropenem: 'Meronem', tigecycline: 'Tygacil', colistin: 'Colistin', ivig: 'IVIG' }[kind]} لمريض في أول يوم له`}، أو أضِفها من «+ استمارة جديدة».</span></div>
        : <>
            {(unsent.length > 0 || incomplete.length > 0 || unconfirmed.length > 0) && <p className="req-hint req-attention" role="status">
              <strong>{[unsent.length > 0 && `${unsent.length} لم تُرسل`, incomplete.length > 0 && `${incomplete.length} ناقصة`, unconfirmed.length > 0 && `${unconfirmed.length} لم يتأكد إرسالها — راجع ردود النموذج`].filter(Boolean).join(' · ')}</strong>
              {sendable.length > 0 && <button type="button" className="secondary-button compact" disabled={busy || !isOnline} onClick={() => onSendAll(sendable)}>{sendable.length === 1 ? 'إرسالها' : `إرسال المتبقي (${sendable.length})`}</button>}
            </p>}
            <p className="req-hint">المس اسم المريض لفتح استمارته، ثم اكتب في أي حقل لتعديله والمس أي مربع لوضع علامة ✓ أو إزالتها — يُحفظ كل ذلك فورًا.</p>
            <div className="req-sheets">
              {list.map((request) => {
                const open = openIds.has(request.id)
                return <article key={request.id} className="req-sheet" aria-label={`${spec.label} — ${request.name}`}>
                  <h2 className="req-sheet-head">
                    <button type="button" className="req-sheet-toggle" aria-expanded={open} aria-controls={`req-sheet-${request.id}`} onClick={() => setOpen(request.id, !open)}>
                      <strong>{request.name}</strong>
                      {request.patientId && <span>رقم الطبلة <bdi>{request.patientId}</bdi></span>}
                      {(() => { const state = standing(request, google, problemsOf.get(request.id)); return state && <span className={`card-status card-status--${state.tone}`} title={state.title}>{state.text}</span> })()}
                      <span className="req-sheet-chevron" aria-hidden="true"><ChevronStart /></span>
                    </button>
                  </h2>
                  {open && <div className="req-sheet-body" id={`req-sheet-${request.id}`}>
                    <div className="req-sheet-tools">
                      <p className="req-sheet-meta">{request.createdByName && <span>أدخلها {request.createdByName} · {savedAt(request.createdAt)}</span>}{sends(request) && request.googleSentAt && request.googleSentBy && <span>{request.googleSentHow === 'manual' ? 'أكمل إرسالها يدويًا' : 'أرسلها'} {request.googleSentBy}</span>}{request.googleError && <span className="req-error-note">{request.googleError}</span>}</p>
                      <span className="req-sheet-actions">
                        {sends(request) && <button type="button" className="secondary-button compact" disabled={busy || !isOnline} onClick={() => onSendToGoogle(request)}>{request.googleSentAt ? 'أُرسلت ✓ — إعادة الإرسال' : 'إرسال إلى نموذج الوزارة'}</button>}
                        {printable && <button type="button" className="secondary-button compact" disabled={pdf.busy} onClick={() => print([request])}>طباعة</button>}
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

    {adding && <DrugRequestDialog kind={kind} screen initial={addFor ? { name: addFor.name, patientId: addFor.patientId } : {}} kicker={wardLabel} title={`${spec.label} — جديدة`} saveLabel="حفظ" cancelLabel="إلغاء"
      onSave={async (payload) => { const result = await onSave(kind, payload); if (result.ok) { setAdding(false); if (addFor) setMissing((current) => current?.ok ? { ...current, patients: current.patients.filter((patient) => patient !== addFor) } : current); if (result.request) setOpen(result.request.id, true) } return result }}
      onClose={() => setAdding(false)} />}
    {pdf.sheets && <RequestPrintTemplate ref={pdf.ref} sheets={pdf.sheets} />}
    {confirmModal}
  </main>
}
