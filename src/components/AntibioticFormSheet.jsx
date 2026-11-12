import { useEffect, useRef, useState } from 'react'
import { apiUrl } from '../constants.js'
import { toEnglishDigits } from '../helpers.js'
import { forgetWrite, queueWrite } from '../storage.js'
import { cleanForm, missingAnswers, YES, NO, DEPARTMENTS, CHANGES, OUTCOMES, STILL_ADMITTED, FREQUENCIES, QUICK_DRUGS, QUICK_STRENGTHS, MAX_DRUGS } from '../../shared/antibiotic-form.js'
import { abxDraftKey, abxQueueKey, readAbxDraft, writeAbxDraft, dropAbxDraft, sameForm } from '../antibioticDraft.js'

// «استمارة صرف المضادات الحياتية» for one patient: one scrolling sheet in the Google Form's four parts (المريض ·
// المضادات · المراجعة · النتيجة), prefilled from the charts and the request forms. The head keeps how much is left
// and a jump to the first unanswered question in reach; the foot keeps the one save. Every edit is kept on the device
// (src/antibioticDraft.js) until the server has the save.

const DRUG_FIELDS = ['drug', 'medicine', 'strength', 'oral', 'injection', 'frequency', 'days', 'start', 'stop']
let drugSeq = 0
const withId = (drug) => { drugSeq += 1; return { ...Object.fromEntries(DRUG_FIELDS.map((key) => [key, drug?.[key] || ''])), id: `d${drugSeq}` } }
const plain = (form) => ({ name: form.name, patientId: form.patientId, fields: form.fields, drugs: form.drugs.map(({ id: _id, ...drug }) => drug) })
const dayMonth = (iso) => (iso ? `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}` : '')
const STATUS = { active: 'مستمر', stopped: 'متوقف', left: 'غادر الردهة', transferred: 'نُقل' }
const PATIENT_KEYS = ['name', 'age', 'department', 'diagnosis', 'stayDays', 'allergy']
const SECTIONS = [
  { id: 'patient', label: 'المريض', has: (key) => PATIENT_KEYS.includes(key) },
  { id: 'drugs', label: 'المضادات', has: (key) => key.startsWith('drug') },
  { id: 'review', label: 'المراجعة', has: (key) => ['culture', 'review48', 'changes'].includes(key) },
  { id: 'outcome', label: 'النتيجة', has: (key) => key === 'outcome' },
]

// Where the sheet starts: the saved form (an active course's stop and a longer day count brought up to date from the
// chart — a count the pharmacist set higher, for a course begun elsewhere, is kept), or a new one from what the chart and
// the request forms say. Allergy and culture are never filled in: they are hints.
const startForm = (entry, lastDepartment) => {
  const { candidate, form } = entry
  if (form) {
    return {
      name: form.name, patientId: form.patientId, fields: { ...form.fields },
      drugs: form.drugs.map((saved) => {
        const chart = !saved.stop && candidate?.drugs.find((drug) => drug.drug === saved.drug)
        const days = chart && Number(chart.days) > Number(saved.days || 0) ? chart.days : saved.days
        return withId(chart ? { ...saved, days, stop: chart.stop, start: saved.start || chart.start } : saved)
      }),
    }
  }
  const prefill = candidate?.prefill || {}
  return {
    name: candidate?.name || '', patientId: candidate?.patientId || '',
    fields: { ...cleanForm({}).fields, age: prefill.age?.value || '', diagnosis: prefill.diagnosis?.value || '', stayDays: prefill.stayDays?.value || '', department: lastDepartment || '' },
    drugs: (candidate?.drugs || []).map(withId),
  }
}

const Check = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 7.5 2.5 2.5L11 4" /></svg>
const Chip = ({ pressed, onClick, children, ...rest }) => <button type="button" className="req-chip" aria-pressed={pressed} onClick={onClick} {...rest}>{children}</button>
// Where a prefilled answer came from; shown while the answer is still that one.
const Source = ({ from, value }) => (from && from.value === value ? <small className="abx-source">من {from.source}{from.date ? ` · ${dayMonth(from.date)}` : ''}</small> : null)
// An earlier form's answer, offered and never chosen for the pharmacist.
const Hint = ({ hint, value, onAccept }) => (hint && value !== hint.answer
  ? <p className="abx-hint"><span>{hint.source} · {dayMonth(hint.date)}: <bdi>{hint.detail}</bdi></span><button type="button" className="text-button" onClick={() => onAccept(hint.answer)}>اعتمد «{hint.answer}»</button></p>
  : null)
const YesNo = ({ q, label, value, onChange, children }) => (
  <div className="abx-q" data-q={q} role="group" aria-label={label}>
    <span className="abx-q-label">{label}</span>
    <div className="req-chips">{[YES, NO].map((answer) => <Chip key={answer} pressed={value === answer} onClick={() => onChange(value === answer ? '' : answer)}>{answer}</Chip>)}</div>
    {children}
  </div>
)

function DrugCard({ drug, index, chart, onChange, onRemove }) {
  const [picking, setPicking] = useState(!drug.drug)
  const [otherFrequency, setOtherFrequency] = useState(Boolean(drug.frequency) && !FREQUENCIES.includes(drug.frequency))
  const q = (field) => `drug:${index}:${field}`
  const toggleRoute = (key) => {
    const other = key === 'oral' ? 'injection' : 'oral'
    onChange({ [key]: drug[key] === YES ? NO : YES, [other]: drug[other] || NO })
  }
  const title = drug.drug || `المضاد ${index + 1}`
  return <article className="entry-form-card abx-drug" aria-label={title}>
    <header className="abx-drug-head">
      {drug.drug && !picking
        ? <><bdi className="abx-drug-name" dir="ltr" lang="en">{drug.drug}</bdi><button type="button" className="text-button" onClick={() => setPicking(true)}>تغيير</button></>
        : <span className="abx-q-label">اختر المضاد</span>}
      <button type="button" className="entry-line-remove" aria-label={`حذف ${title} من الاستمارة`} onClick={onRemove}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
    </header>
    {chart && <p className="abx-chart-line">من الجارت: D{chart.day} · {STATUS[chart.status?.kind] || ''}{chart.medicine && <> · <bdi dir="ltr" lang="en">{chart.medicine}</bdi></>}</p>}

    {(picking || !drug.drug) && <div className="abx-q" data-q={q('drug')}>
      <div className="req-chips">{QUICK_DRUGS.map((item) => <Chip key={item.name} pressed={drug.drug === item.name} dir="ltr" lang="en" onClick={() => { onChange({ drug: item.name }); setPicking(false) }}>{item.name}</Chip>)}</div>
      <label>مضاد غير موجود في القائمة
        <input dir="ltr" lang="en" autoComplete="off" value={drug.drug} placeholder="e.g. linezolid" onChange={(event) => onChange({ drug: event.target.value.slice(0, 60) })} onKeyDown={(event) => { if (event.key === 'Enter' && drug.drug) { event.preventDefault(); setPicking(false) } }} />
      </label>
      {drug.drug && <button type="button" className="secondary-button abx-done-pick" onClick={() => setPicking(false)}>تم</button>}
    </div>}

    <div className="abx-q" data-q={q('route')} role="group" aria-label={`طريق الإعطاء — ${title}`}>
      <span className="abx-q-label">طريق الإعطاء</span>
      <div className="req-chips">
        <Chip pressed={drug.injection === YES} onClick={() => toggleRoute('injection')}>حقن</Chip>
        <Chip pressed={drug.oral === YES} onClick={() => toggleRoute('oral')}>فموي</Chip>
      </div>
    </div>

    <div className="abx-q" data-q={q('strength')}>
      <span className="abx-q-label" id={`abx-strength-${drug.id}`}>الجرعة</span>
      <div className="req-chips" role="group" aria-labelledby={`abx-strength-${drug.id}`}>{QUICK_STRENGTHS.map((strength) => <Chip key={strength} dir="ltr" pressed={drug.strength === strength} onClick={() => onChange({ strength: drug.strength === strength ? '' : strength })}>{strength}</Chip>)}</div>
      <input dir="ltr" lang="en" autoComplete="off" aria-labelledby={`abx-strength-${drug.id}`} placeholder="أو اكتبها: 2 g" value={drug.strength} onChange={(event) => onChange({ strength: event.target.value.slice(0, 40) })} />
    </div>

    <div className="abx-q" data-q={q('frequency')} role="group" aria-label={`التكرار — ${title}`}>
      <span className="abx-q-label">التكرار <small>مرات في اليوم</small></span>
      <div className="req-chips">
        {FREQUENCIES.map((times) => <Chip key={times} pressed={!otherFrequency && drug.frequency === times} onClick={() => { setOtherFrequency(false); onChange({ frequency: drug.frequency === times && !otherFrequency ? '' : times }) }}>{times}</Chip>)}
        <Chip pressed={otherFrequency} onClick={() => { setOtherFrequency(!otherFrequency); onChange({ frequency: '' }) }}>أخرى</Chip>
      </div>
      {otherFrequency && <input inputMode="numeric" autoComplete="off" aria-label="عدد المرات في اليوم" value={drug.frequency} onChange={(event) => onChange({ frequency: toEnglishDigits(event.target.value).replace(/\D/g, '').slice(0, 2) })} />}
      {chart?.unitsPerDay > 0 && <small className="abx-source">على الجارت {chart.unitsPerDay} في اليوم — عدد الوحدات لا يحدّد التكرار، اختره أنت.</small>}
    </div>

    <div className="abx-dates">
      <label>تاريخ البدء<input type="date" value={drug.start} onChange={(event) => onChange({ start: event.target.value })} /></label>
      <label>تاريخ الإيقاف<input type="date" value={drug.stop} onChange={(event) => onChange({ stop: event.target.value })} /></label>
      <label className="abx-q" data-q={q('days')}>فترة البقاء (يوم)<input inputMode="numeric" autoComplete="off" value={drug.days} onChange={(event) => onChange({ days: toEnglishDigits(event.target.value).replace(/\D/g, '').slice(0, 3) })} /></label>
    </div>
    {!drug.stop && <small className="abx-source">بلا تاريخ إيقاف: المضاد مستمر.</small>}
  </article>
}

export default function AntibioticFormSheet({ entry, wardLabel, floor, ward, wardKey, userId, isOnline, isExpired, lastDepartment, onClose, onSaved, onDeleted, askConfirm }) {
  const editable = !entry.form || entry.form.editable !== false
  // A new hand-added form becomes «form:<id>» once saved, so its draft and queue entry follow it.
  const [patientKey, setPatientKey] = useState(entry.patientKey)
  const draftKey = abxDraftKey(userId, wardKey, patientKey)
  const queueKey = abxQueueKey(wardKey, patientKey)
  const [init] = useState(() => {
    const fresh = startForm(entry, lastDepartment)
    const draft = editable ? readAbxDraft(draftKey) : null
    const restored = Boolean(draft?.form) && !sameForm(draft.form, plain(fresh))
    return { fresh, restored, form: restored ? { ...draft.form, drugs: draft.form.drugs.map(withId) } : fresh, base: restored ? draft.base ?? null : entry.form?.updatedAt || null }
  })
  const [form, setForm] = useState(init.form)
  const [base, setBase] = useState(init.base) // the stored version these edits started from
  const [formId, setFormId] = useState(entry.form?.id || null)
  const [restored, setRestored] = useState(init.restored)
  const [dirty, setDirty] = useState(init.restored)
  const [status, setStatus] = useState(null) // { kind: saving | saved | queued | error | conflict, text, server }
  const pageRef = useRef(null)
  const formRef = useRef(form) // the latest edits, for a save's answer to compare with what it sent
  useEffect(() => { formRef.current = form }, [form])

  // The device draft, 400 ms after the last edit, and at once if the sheet closes before that.
  const pending = useRef(null)
  useEffect(() => {
    if (!dirty || !editable) return undefined
    pending.current = { form: plain(form), base }
    const timer = setTimeout(() => { writeAbxDraft(draftKey, pending.current); pending.current = null }, 400)
    return () => clearTimeout(timer)
  }, [form, base, dirty, editable, draftKey])
  useEffect(() => () => { if (pending.current) writeAbxDraft(draftKey, pending.current) }, [draftKey])

  // The list came back with this form saved as these edits stand (a queued save was sent meanwhile): go on from that version,
  // so the next save is not taken for another device's.
  useEffect(() => {
    const saved = entry.form
    if (!saved || (saved.id === formId && saved.updatedAt === base) || !sameForm(saved, plain(form))) return
    pending.current = null
    dropAbxDraft(draftKey)
    setFormId(saved.id); setBase(saved.updatedAt); setDirty(false); setRestored(false)
  }, [entry.form, form, formId, base, draftKey])

  const update = (change) => { setForm(change); setDirty(true); if (status?.kind !== 'conflict') setStatus(null) }
  const setField = (key, value) => update((current) => ({ ...current, fields: { ...current.fields, [key]: value } }))
  const setDrug = (id, patch) => update((current) => ({ ...current, drugs: current.drugs.map((drug) => (drug.id === id ? { ...drug, ...patch } : drug)) }))
  // A chip group answered at all is answered whole: the untouched ones are «لا».
  const setGroup = (keys, key, value) => update((current) => {
    const fields = { ...current.fields, [key]: value }
    keys.forEach((other) => { if (!fields[other]) fields[other] = NO })
    return { ...current, fields }
  })
  const changeKeys = CHANGES.map((item) => item.key)
  const outcomeKeys = OUTCOMES.map((item) => item.key)
  const noChange = changeKeys.every((key) => form.fields[key] === NO)
  const stillAdmitted = form.fields[STILL_ADMITTED] === YES

  // (cleanForm drops a card left blank, so a missing answer's card number is mapped back to the card on screen.)
  const filled = form.drugs.map((drug, index) => ({ drug, index })).filter(({ drug }) => DRUG_FIELDS.some((key) => drug[key]))
  const missing = missingAnswers(cleanForm(plain(form))).map((item) => ({ ...item, key: item.key.replace(/^drug:(\d+):/, (whole, n) => (filled[Number(n)] ? `drug:${filled[Number(n)].index}:` : whole)) }))
  // What missingAnswers asks: eleven questions for the patient, the review and the outcome, five per antibiotic.
  const total = 11 + 5 * filled.length
  const answered = Math.max(0, total - missing.length)
  const candidate = entry.candidate
  const chartOf = (drug) => candidate?.drugs.find((block) => block.drug === drug.drug) || null
  const notAdded = (candidate?.drugs || []).filter((block) => !form.drugs.some((drug) => drug.drug === block.drug))

  const jumpTo = (key) => {
    const target = pageRef.current?.querySelector(`[data-q="${key}"]`) || pageRef.current?.querySelector(`#abx-${key}`)
    if (!target) return
    target.scrollIntoView({ block: 'center' })
    const control = target.matches('input') ? target : target.querySelector('input:not(:disabled), button.req-chip:not(:disabled)')
    if (control) control.focus()
  }
  const showSection = (id) => pageRef.current?.querySelector(`#abx-${id}`)?.scrollIntoView({ block: 'start' })

  const save = async (startedFrom = base, id = formId) => {
    if (status?.kind === 'saving' || !editable) return
    const payload = { floor, ward, ...(id ? { id } : {}), updatedAt: startedFrom, ...plain(form) }
    const name = cleanForm(payload).name
    if (!name) { setStatus({ kind: 'error', text: 'اكتب اسم المريض أولًا.' }); jumpTo('name'); return }
    // Each patient added by hand gets its own draft and queue entry at its first save: two added offline must not share one.
    const key = patientKey === 'manual:new' ? `manual:new:${name}` : patientKey
    const thisDraft = abxDraftKey(userId, wardKey, key)
    const thisQueue = abxQueueKey(wardKey, key)
    if (key !== patientKey) { pending.current = null; dropAbxDraft(draftKey); setPatientKey(key) }
    setStatus({ kind: 'saving' })
    let response
    try {
      response = await fetch(`${apiUrl}/antibiotic-forms`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    } catch {
      // No signal: queued, and sent by the app's flush loop when it returns. The draft stays until the server has it.
      writeAbxDraft(thisDraft, { form: plain(form), base: startedFrom })
      queueWrite({ key: thisQueue, user: userId, method: 'POST', path: '/antibiotic-forms', body: payload, label: `استمارة المضادات — ${name}`, draftKey: thisDraft })
      setStatus({ kind: 'queued', text: 'لا يوجد اتصال — حُفظت على هذا الجهاز وتُرسل وحدها عند عودة الإشارة.' })
      return
    }
    if (isExpired(response)) { setStatus(null); return }
    const result = await response.json().catch(() => ({}))
    if (response.ok && result.form) {
      forgetWrite(thisQueue)
      const saved = result.form
      setFormId(saved.id)
      setBase(saved.updatedAt)
      setRestored(false)
      if (sameForm(formRef.current ? plain(formRef.current) : payload, payload)) { pending.current = null; dropAbxDraft(thisDraft); setDirty(false) }
      if (key.startsWith('manual:new')) { pending.current = null; dropAbxDraft(thisDraft); setPatientKey(`form:${saved.id}`) }
      onSaved(saved, entry)
      if (!saved.missing.length) { onClose(); return }
      setStatus({ kind: 'saved', text: `حُفظت — بقي ${saved.missing.length}: ${saved.missing.slice(0, 3).join('، ')}${saved.missing.length > 3 ? '…' : ''}` })
    } else if (response.status === 409 && result.form) {
      setStatus({ kind: 'conflict', text: result.message, server: result.form })
    } else setStatus({ kind: 'error', text: result.message || 'تعذّر الحفظ — حاول مرة أخرى.' })
  }
  // The conflict's two ways out: send these edits over the newer version, or take the newer version.
  const keepMine = () => { const server = status.server; setFormId(server.id); setBase(server.updatedAt); setStatus(null); save(server.updatedAt, server.id) }
  const takeTheirs = () => {
    const server = status.server
    setForm({ name: server.name, patientId: server.patientId, fields: { ...server.fields }, drugs: server.drugs.map(withId) })
    setFormId(server.id); setBase(server.updatedAt); pending.current = null; dropAbxDraft(draftKey); setDirty(false); setStatus(null); setRestored(false)
  }
  // Throwing the device's edits away also takes back their queued save.
  const discardDraft = () => { setForm(init.fresh); setBase(entry.form?.updatedAt || null); pending.current = null; dropAbxDraft(draftKey); forgetWrite(queueKey); setDirty(false); setRestored(false) }
  const remove = async () => {
    if (!formId || !(await askConfirm(`حذف استمارة «${form.name}»؟ لا يمكن التراجع.`, { danger: true, confirmLabel: 'حذف' }))) return
    try {
      const response = await fetch(`${apiUrl}/antibiotic-forms/${formId}`, { method: 'DELETE', credentials: 'include' })
      if (isExpired(response)) return
      const result = await response.json().catch(() => ({}))
      if (!response.ok) { setStatus({ kind: 'error', text: result.message || 'تعذّر الحذف.' }); return }
      pending.current = null; dropAbxDraft(draftKey); forgetWrite(queueKey)
      onDeleted(formId)
      onClose()
    } catch { setStatus({ kind: 'error', text: 'تعذّر الحذف — يحتاج اتصالًا.' }) }
  }

  const prefill = candidate?.prefill || {}
  const hints = candidate?.hints || {}
  const departmentFrom = !entry.form && lastDepartment ? { value: lastDepartment, source: 'آخر استمارة في الردهة' } : null
  const sectionMissing = (section) => missing.filter((item) => section.has(item.key)).length

  return <section className="entry-form-page abx-sheet" aria-label="استمارة صرف المضادات" ref={pageRef}>
    <header className="abx-sheet-top">
      <div className="entry-form-head">
        <button type="button" className="back-button" onClick={onClose}>→ القائمة</button>
        <div className="entry-form-title"><h1>استمارة صرف المضادات</h1><span>{form.name || 'مريض جديد'}{form.patientId ? ` · ${form.patientId}` : ''} — {wardLabel}</span></div>
        {missing.length
          ? <button type="button" className="text-button abx-jump" onClick={() => jumpTo(missing[0].key)}>الناقص <b>{missing.length}</b></button>
          : <span className="card-status card-status--done"><Check />مكتملة</span>}
      </div>
      <nav className="abx-tabs" aria-label="أقسام الاستمارة">
        {SECTIONS.map((section) => {
          const left = sectionMissing(section)
          return <button key={section.id} type="button" onClick={() => showSection(section.id)}>
            <span>{section.label}</span>
            {left ? <small className="abx-tab-left">ناقص {left}</small> : <small className="abx-tab-done"><Check />تم</small>}
          </button>
        })}
      </nav>
      <div className="abx-track" role="progressbar" aria-label="الأسئلة المُجابة" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}><i style={{ width: `${Math.round((answered / total) * 100)}%` }} /></div>
    </header>

    {!editable && <p className="day-lock-note abx-note">اكتملت هذه الاستمارة في يوم سابق — للعرض فقط. يعدّلها المسؤول.</p>}
    {restored && <p className="abx-restored" role="status"><span>استُرجعت تعديلات على هذا الجهاز لم تصل إلى الخادم بعد.</span><button type="button" className="text-button" onClick={discardDraft}>تجاهلها</button></p>}

    {/* Enter in a box is not «save» (a half-typed name would make a form): only the button saves. */}
    <form className="entry-form abx-form" onSubmit={(event) => { event.preventDefault(); save() }} onKeyDown={(event) => { if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.preventDefault() }} noValidate>
      <fieldset className="day-lock" disabled={!editable}>
        <section className="abx-section" id="abx-patient" aria-labelledby="abx-patient-h">
          <h2 id="abx-patient-h">المريض</h2>
          <div className="entry-form-card abx-card">
            <label className="abx-q" data-q="name">اسم المريض
              <input autoComplete="off" value={form.name} onChange={(event) => update((current) => ({ ...current, name: event.target.value.slice(0, 200) }))} />
            </label>
            <div className="abx-pair">
              <label className="abx-q">رقم الطبلة
                <input inputMode="numeric" autoComplete="off" value={form.patientId} onChange={(event) => update((current) => ({ ...current, patientId: toEnglishDigits(event.target.value).replace(/\D/g, '').slice(0, 20) }))} />
              </label>
              <label className="abx-q" data-q="age">العمر (سنة)
                <input inputMode="decimal" autoComplete="off" value={form.fields.age} onChange={(event) => setField('age', toEnglishDigits(event.target.value).replace(/[٫,]/g, '.').replace(/[^\d.]/g, '').slice(0, 6))} />
                <Source from={prefill.age} value={form.fields.age} />
              </label>
            </div>
            <div className="abx-q" data-q="department" role="group" aria-label="الردهة (القسم)">
              <span className="abx-q-label">الردهة <small>القسم</small></span>
              <div className="req-chips">{DEPARTMENTS.map((department) => <Chip key={department} pressed={form.fields.department === department} onClick={() => setField('department', form.fields.department === department ? '' : department)}>{department}</Chip>)}</div>
              <Source from={departmentFrom} value={form.fields.department} />
            </div>
            <label className="abx-q" data-q="diagnosis">التشخيص (باللغة الانكليزية)
              <input dir="ltr" lang="en" autoComplete="off" value={form.fields.diagnosis} onChange={(event) => setField('diagnosis', event.target.value.slice(0, 300))} />
              <Source from={prefill.diagnosis} value={form.fields.diagnosis} />
            </label>
            <label className="abx-q" data-q="stayDays">فترة الرقود (يوم)
              <input inputMode="numeric" autoComplete="off" value={form.fields.stayDays} onChange={(event) => setField('stayDays', toEnglishDigits(event.target.value).replace(/[^\d+]/g, '').slice(0, 4))} />
              <Source from={prefill.stayDays} value={form.fields.stayDays} />
            </label>
            <YesNo q="allergy" label="الحساسية" value={form.fields.allergy} onChange={(value) => setField('allergy', value)}>
              <Hint hint={hints.allergy} value={form.fields.allergy} onAccept={(value) => setField('allergy', value)} />
            </YesNo>
          </div>
        </section>

        <section className="abx-section" id="abx-drugs" aria-labelledby="abx-drugs-h">
          <h2 id="abx-drugs-h">المضادات <span className="entry-count">{form.drugs.length}</span></h2>
          {!form.drugs.length && <p className="abx-empty" data-q="drugs">لا مضاد في الاستمارة — أضف ما وُصف للمريض.</p>}
          {form.drugs.map((drug, index) => <DrugCard key={drug.id} drug={drug} index={index} chart={chartOf(drug)} onChange={(patch) => setDrug(drug.id, patch)} onRemove={() => update((current) => ({ ...current, drugs: current.drugs.filter((item) => item.id !== drug.id) }))} />)}
          {notAdded.length > 0 && <div className="abx-suggest">
            <span>على الجارت وليس في الاستمارة:</span>
            <div className="req-chips">{notAdded.map((block) => <button key={block.drugKey} type="button" className="req-chip" dir="ltr" lang="en" disabled={form.drugs.length >= MAX_DRUGS} onClick={() => update((current) => ({ ...current, drugs: [...current.drugs, withId(block)] }))}>+ {block.drug}</button>)}</div>
          </div>}
          <button type="button" className="secondary-button abx-add" disabled={form.drugs.length >= MAX_DRUGS} onClick={() => update((current) => ({ ...current, drugs: [...current.drugs, withId({})] }))}>+ إضافة مضاد</button>
        </section>

        <section className="abx-section" id="abx-review" aria-labelledby="abx-review-h">
          <h2 id="abx-review-h">المراجعة</h2>
          <div className="entry-form-card abx-card">
            <YesNo q="culture" label="وجود زرع" value={form.fields.culture} onChange={(value) => setField('culture', value)}>
              <Hint hint={hints.culture} value={form.fields.culture} onAccept={(value) => setField('culture', value)} />
            </YesNo>
            <YesNo q="review48" label="مراجعة وصف المضاد بعد 48-72 ساعة" value={form.fields.review48} onChange={(value) => setField('review48', value)} />
            <div className="abx-q" data-q="changes" role="group" aria-label="ما الذي تم بعد المراجعة">
              <span className="abx-q-label">ما الذي تم بعد المراجعة <small>اختر كل ما ينطبق</small></span>
              <div className="req-chips">
                {CHANGES.map((item) => <Chip key={item.key} pressed={form.fields[item.key] === YES} onClick={() => setGroup(changeKeys, item.key, form.fields[item.key] === YES ? NO : YES)}>{item.label.replace(/\s+/g, ' ')}</Chip>)}
                <Chip pressed={noChange} onClick={() => update((current) => ({ ...current, fields: { ...current.fields, ...Object.fromEntries(changeKeys.map((key) => [key, noChange ? '' : NO])) } }))}>لا تغيير</Chip>
              </div>
            </div>
          </div>
        </section>

        <section className="abx-section" id="abx-outcome" aria-labelledby="abx-outcome-h">
          <h2 id="abx-outcome-h">النتيجة</h2>
          <div className="entry-form-card abx-card">
            <div className="abx-q" data-q="outcome" role="group" aria-label="النتيجة">
              <span className="abx-q-label">النتيجة <small>تبقى الاستمارة مفتوحة حتى تُختار نتيجة</small></span>
              <div className="req-chips">
                {OUTCOMES.map((item) => <Chip key={item.key} pressed={form.fields[item.key] === YES} onClick={() => setGroup([...outcomeKeys, STILL_ADMITTED], item.key, form.fields[item.key] === YES ? NO : YES)}>{item.label}</Chip>)}
                <Chip pressed={stillAdmitted} onClick={() => update((current) => ({ ...current, fields: { ...current.fields, [STILL_ADMITTED]: stillAdmitted ? '' : YES, ...Object.fromEntries(outcomeKeys.map((key) => [key, stillAdmitted ? '' : NO])) } }))}>لا يزال في الردهة</Chip>
              </div>
            </div>
          </div>
          {formId && editable && <button type="button" className="danger-button abx-delete" onClick={remove}>حذف الاستمارة</button>}
        </section>
      </fieldset>

      {editable && <div className="entry-form-bar abx-bar">
        {status?.kind === 'conflict' && <div className="abx-conflict" role="alert">
          <p>{status.text} احفظ تعديلاتك فوقها، أو اعرض النسخة المحفوظة.</p>
          <div><button type="button" className="secondary-button" onClick={keepMine}>احفظ تعديلاتي</button><button type="button" className="text-button" onClick={takeTheirs}>اعرض المحفوظ</button></div>
        </div>}
        {status?.kind === 'error' && <p className="form-error" role="alert">{status.text}</p>}
        {(status?.kind === 'saved' || status?.kind === 'queued') && <p className={status.kind === 'saved' ? 'form-success' : 'abx-queued'} role="status">{status.text}</p>}
        {!isOnline && !status && <p className="abx-queued" role="status">لا يوجد اتصال — يُحفظ على هذا الجهاز ويُرسل عند عودة الإشارة.</p>}
        <button type="submit" className="primary-button" disabled={status?.kind === 'saving'}>{status?.kind === 'saving' ? 'جارٍ الحفظ…' : missing.length ? `حفظ — بقي ${missing.length}` : 'حفظ الاستمارة'}</button>
      </div>}
    </form>
  </section>
}
