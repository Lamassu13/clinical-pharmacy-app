import { useEffect, useMemo, useState } from 'react'
import { apiUrl } from '../constants.js'
import { pendingWrites } from '../storage.js'
import { abxQueueKey, pruneAbxDrafts } from '../antibioticDraft.js'
import AntibioticFormSheet from '../components/AntibioticFormSheet.jsx'
import { FORMS_FROM } from '../../shared/antibiotic-form.js'

// The form's start day in words, from FORMS_FROM: «الأحد 15/11/2026».
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const FROM_TEXT = `${WEEKDAYS[new Date(`${FORMS_FROM}T12:00:00`).getDay()]} ${Number(FORMS_FROM.slice(8, 10))}/${Number(FORMS_FROM.slice(5, 7))}/${FORMS_FROM.slice(0, 4)}`

// «استمارة صرف المضادات الحياتية» (GET /api/antibiotic-forms): the ward's patients on an antibiotic in the last two
// weeks, each with what the charts say and where their form stands — none yet, missing answers, or complete — plus
// forms added by hand. A row opens the patient's form (AntibioticFormSheet); `openKey` lives in App so the browser's
// Back closes the form first.
const STATUS = { active: 'مستمر', stopped: 'متوقف', left: 'غادر', transferred: 'نُقل' }
const FILTERS = [
  { key: 'all', label: 'الكل', match: () => true },
  { key: 'none', label: 'بلا استمارة', match: (item) => !item.form },
  { key: 'partial', label: 'ناقصة', match: (item) => item.form && item.form.missing.length > 0 },
  { key: 'done', label: 'مكتملة', match: (item) => item.form && !item.form.missing.length },
]
const Check = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 7.5 2.5 2.5L11 4" /></svg>
const Chevron = () => <svg className="abx-row-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg>

function FormStatus({ form, waiting }) {
  if (waiting) return <span className="card-status card-status--muted">بانتظار الإرسال</span>
  if (!form) return <span className="card-status card-status--pending">بلا استمارة</span>
  if (form.missing.length) return <span className="card-status card-status--partial">ناقصة · {form.missing.length}</span>
  return <span className="card-status card-status--done"><Check />مكتملة</span>
}

export default function AntibioticFormsScreen({ hub, header, footer, wardLabel, floor, ward, selectedDate, onChangeDate, onBack, isOnline, isExpired, userId, writesFlushed, openKey, onOpenKey, askConfirm, confirmModal }) {
  const wardKey = `${floor ?? ''}|${ward}`
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [stale, setStale] = useState(false)
  const [filter, setFilter] = useState('all')
  const [nonce, setNonce] = useState(0)

  useEffect(() => { pruneAbxDrafts() }, [])
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    fetch(`${apiUrl}/antibiotic-forms?${new URLSearchParams({ floor: floor || '', ward, date: selectedDate })}`, { credentials: 'include' })
      .then((response) => {
        if (isExpired(response)) return null
        if (!cancelled) setStale(response.headers.get('x-from-cache') === '1')
        return response.ok ? response.json() : Promise.reject(new Error('load'))
      })
      .then((result) => { if (!cancelled && result) { setData(result); setLoading(false) } })
      .catch(() => { if (!cancelled) { setLoadError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [floor, ward, selectedDate, isExpired, writesFlushed, nonce])

  // One row per patient on the list and per form added by hand.
  const items = useMemo(() => (data ? [
    ...data.patients.map((candidate) => ({ patientKey: candidate.key, name: candidate.name, patientId: candidate.patientId, candidate, form: candidate.form, drugs: candidate.drugs, inChart: candidate.inChart !== false })),
    ...data.manual.map((form) => ({ patientKey: `form:${form.id}`, name: form.name, patientId: form.patientId, candidate: null, form, drugs: form.drugs, manual: true, inChart: true })),
  ] : []), [data])
  const waiting = new Set(userId == null ? [] : pendingWrites(userId).map((entry) => entry.key))
  const waitingNew = [...waiting].some((key) => key.startsWith(abxQueueKey(wardKey, 'manual:new')))
  const active = FILTERS.find((item) => item.key === filter)
  const shown = items.filter(active.match)

  const open = openKey === 'manual:new' ? { patientKey: 'manual:new', candidate: null, form: null } : items.find((item) => item.patientKey === openKey) || null
  // A save's answer, put in place without a reload.
  const onSaved = (saved, entry) => setData((current) => {
    if (!current) return current
    if (entry.candidate) return { ...current, patients: current.patients.map((candidate) => (candidate.key === entry.candidate.key ? { ...candidate, form: saved } : candidate)) }
    const others = current.manual.filter((form) => form.id !== saved.id)
    return { ...current, manual: [saved, ...others] }
  })
  const onDeleted = (id) => setData((current) => current && {
    ...current,
    patients: current.patients.map((candidate) => (candidate.form?.id === id ? { ...candidate, form: null } : candidate)),
    manual: current.manual.filter((form) => form.id !== id),
  })

  const renderRow = (item) => <li key={item.patientKey}>
                <button type="button" className="abx-row" onClick={() => onOpenKey(item.patientKey)}>
                  <span className="abx-row-who">
                    <strong>{item.name}</strong>
                    {item.patientId && <span className="patient-search-id">رقم الطبلة <bdi>{item.patientId}</bdi></span>}
                    {item.manual && <span className="patient-search-id">أُضيف يدويًا</span>}
                  </span>
                  <FormStatus form={item.form} waiting={waiting.has(abxQueueKey(wardKey, item.patientKey))} />
                  <span className="abx-row-drugs">{item.drugs.map((drug, index) => <span key={`${drug.drug}|${index}`} className="abx-pill">
                    <bdi dir="ltr" lang="en">{drug.drug || '—'}</bdi>{drug.day ? <span> D{drug.day}{drug.status ? ` · ${STATUS[drug.status.kind] || ''}` : ''}</span> : null}
                  </span>)}</span>
                  {item.form?.missing.length > 0 && <span className="abx-row-missing">ناقص: {item.form.missing.slice(0, 3).join('، ')}{item.form.missing.length > 3 ? '…' : ''}</span>}
                  <Chevron />
                </button>
              </li>

  return <main className="app-shell">
    {header}

    <section className="order-page abx-page">
      <div className="chart-toolbar order-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
        <div><h1>{hub ? hub.title : 'استمارة صرف المضادات'}</h1><p className="receipts-ward">{hub ? hub.sub : wardLabel}</p></div>
        {hub?.controls}
        <div className="toolbar-actions">
          <label className="pills-date">التاريخ <input type="date" value={selectedDate} onChange={(event) => onChangeDate(event.target.value)} /></label>
        </div>
      </div>

      {loading && !data ? <div className="load-skeleton abx-skeleton" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <span key={index} className="skeleton-row" />)}</div>
        : loadError && !data ? <div className="empty-state"><strong>تعذّر تحميل القائمة</strong><span>{isOnline ? 'حدث خطأ في الخادم.' : 'لا يوجد اتصال، ولم تُفتح هذه القائمة على هذا الجهاز من قبل.'}</span><button type="button" className="secondary-button" onClick={() => setNonce((n) => n + 1)}>إعادة المحاولة</button></div>
        : <>
          <p className="abx-intro">كل مريض في الجارت الرئيسي أخذ مضادًا حياتيًا في هذه الردهة خلال آخر 14 يومًا (ابتداءً من {FROM_TEXT}). ما في الجارت واستمارات الطلب يُملأ مسبقًا — راجعه وأكمل الباقي.</p>
          {stale && <p className="abx-queued" role="status">لا يوجد اتصال — هذه آخر نسخة فُتحت على هذا الجهاز.</p>}
          {waitingNew && <p className="abx-queued" role="status">استمارة مريض أُضيف يدويًا محفوظة على هذا الجهاز بانتظار الإرسال.</p>}

          {items.length > 0 && <div className="filter-chips receipts-filters" role="group" aria-label="عرض المرضى حسب الاستمارة">
            {FILTERS.map((item) => <button key={item.key} type="button" className="filter-chip" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>
              {item.label} <span className="filter-chip-count">{items.filter(item.match).length}</span>
            </button>)}
          </div>}

          {!items.length ? <div className="empty-state">{selectedDate < FORMS_FROM
            ? <><strong>تبدأ هذه الاستمارة يوم {FROM_TEXT}</strong><span>يُدرج فيها كل مريض في الجارت الرئيسي يأخذ مضادًا حياتيًا من ذلك اليوم.</span></>
            : <><strong>لا يوجد مريض على مضاد حياتي</strong><span>لم يُسجَّل في الجارت الرئيسي لهذه الردهة مضاد حياتي خلال آخر 14 يومًا.{hub ? '' : ' يمكنك إضافة مريض يدويًا.'}</span></>}</div>
            : !shown.length ? <div className="empty-state"><strong>لا يوجد مرضى في «{active.label}»</strong></div>
            : <>
              {[{ title: 'في الردهة (في الجارت)', list: shown.filter((item) => item.inChart) }, { title: 'خرجوا (ليسوا في الجارت)', list: shown.filter((item) => !item.inChart) }]
                .filter((group) => group.list.length > 0).map((group) => <section key={group.title} aria-label={group.title}>
                  <h2 className="abx-group-title">{group.title} <span className="filter-chip-count">{group.list.length}</span></h2>
                  <ul className="abx-list">
                    {group.list.map(renderRow)}
                  </ul>
                </section>)}
            </>}

          {!hub && <button type="button" className="secondary-button abx-add-patient" onClick={() => onOpenKey('manual:new')}>+ مريض ليس في القائمة</button>}
        </>}
    </section>
    {footer}

    {open && <AntibioticFormSheet key={open.patientKey} entry={open} wardLabel={wardLabel} floor={floor} ward={ward} wardKey={wardKey} userId={userId} isOnline={isOnline} isExpired={isExpired}
      lastDepartment={data?.lastDepartment || ''} onClose={() => onOpenKey(null)} onSaved={onSaved} onDeleted={onDeleted} askConfirm={askConfirm} />}
    {confirmModal}
  </main>
}
