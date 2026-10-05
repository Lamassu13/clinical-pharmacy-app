import { useRef, useState } from 'react'
import { medicineKey, medicineMatches, toEnglishDigits } from '../helpers.js'

// Phone-first entry form for ONE patient. It has no state of the chart's own: «إضافة إلى الجارت»
// hands the patient to App (onSubmit), which puts it into the same chart state the grid edits,
// so the lock, draft, autosave and conflict merge all apply. A name or ID that was on
// yesterday's chart offers the same copy-forward the grid does, filling this form instead.
const blankLine = () => ({ id: Math.random().toString(36).slice(2), med: '', qty: '' })

export default function ChartFormScreen({
  wardLabel, slot, onSlotChange, onClose, medicines, chartReady, lockState, lockHolder, chartSaveStatus, isOnline, loadError,
  onSubmit, onFindPrevious, askConfirm,
}) {
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [lines, setLines] = useState(() => [blankLine()])
  const [focusLine, setFocusLine] = useState(null)
  const [error, setError] = useState('')
  const [added, setAdded] = useState(null)
  const asked = useRef(new Set())
  const nameRef = useRef(null)
  const readOnly = lockState === 'readonly'
  const canEdit = chartReady && !readOnly && !loadError

  const canonical = (text) => medicines.find((item) => medicineKey(item) === medicineKey(text)) || ''
  const setLine = (lineId, patch) => { setError(''); setLines((current) => current.map((line) => (line.id === lineId ? { ...line, ...patch } : line))) }

  // Same rules as the grid: asked once per match, and any failure just means no offer.
  const offerPrevious = async (field) => {
    const value = field === 'id' ? id : name
    if (!canEdit || !isOnline || !String(value).trim()) return
    const found = await onFindPrevious(value, field)
    if (!found) return
    const { matchRow, prevName, prevId, prevDoses } = found
    if (!prevDoses.length && !(field === 'id' && prevName)) return
    const askedKey = `${slot}|${matchRow}`
    if (asked.current.has(askedKey)) return
    asked.current.add(askedKey)
    const who = field === 'id' ? `رقم المريض ${found.trimmed}${prevName ? ` («${prevName}»)` : ''}` : `«${found.trimmed}»`
    if (!(await askConfirm(`${who} موجود في جارت الأمس — هل تريد نسخ بياناته (الاسم والرقم والأدوية والكميات)؟`))) return
    if (prevName && !name.trim()) setName(prevName)
    if (prevId && !id) setId(prevId)
    setLines((current) => {
      const kept = current.filter((line) => line.med.trim() || line.qty)
      const have = new Set(kept.map((line) => medicineKey(line.med)))
      const carried = prevDoses
        .map(({ med, qty }) => ({ med: canonical(med), qty: String(qty) }))
        .filter(({ med }) => med && !have.has(medicineKey(med)))
        .map((dose) => ({ ...blankLine(), ...dose }))
      const next = [...kept, ...carried]
      return next.length ? next : [blankLine()]
    })
  }

  const submit = (event) => {
    event.preventDefault()
    setAdded(null)
    if (!name.trim()) { setError('اكتب اسم المريض أولًا.'); return }
    const filled = lines.filter((line) => line.med.trim() || line.qty)
    const unknown = filled.find((line) => line.med.trim() && !canonical(line.med))
    if (unknown) { setError(`«${unknown.med.trim()}» غير موجود في قائمة الأدوية — اختره من القائمة.`); return }
    if (filled.some((line) => !line.med.trim())) { setError('اختر الدواء لكل كمية مكتوبة.'); return }
    const result = onSubmit({ name, id, doses: filled.map((line) => ({ med: canonical(line.med), qty: line.qty })) })
    if (!result.ok) { setError(result.reason === 'full' ? 'الجارت ممتلئ — لا يوجد صف فارغ لمريض جديد.' : 'الجارت قيد التعديل من جهاز آخر.'); return }
    setAdded({ row: result.row + 1, name: name.trim() })
    setName(''); setId(''); setLines([blankLine()]); setError('')
    nameRef.current?.focus()
  }

  const saveText = chartSaveStatus === 'error' ? 'لم يُحفظ — سيُعاد المحاولة'
    : chartSaveStatus === 'saving' ? 'جارٍ الحفظ…'
    : chartSaveStatus === 'pending' ? 'لم يُحفظ بعد…'
    : 'محفوظ'
  const options = (line) => (focusLine === line.id ? medicineMatches(line.med, medicines).filter((item) => item !== line.med) : [])

  return <section className="entry-form-page" aria-label="إدخال مريض">
    <header className="entry-form-head">
      <button type="button" className="back-button" onClick={onClose}>→ الجارت</button>
      <div className="entry-form-title"><h1>إدخال مريض</h1><span>{wardLabel}</span></div>
      <span className={`save-state${chartSaveStatus === 'error' ? ' save-state-error' : ''}`} aria-live="polite">{chartReady ? saveText : ''}</span>
    </header>

    <div className="entry-form-slots" role="group" aria-label="الجارت">
      <button type="button" aria-pressed={slot === 'main'} onClick={() => slot !== 'main' && onSlotChange('main')}>الجارت</button>
      <button type="button" aria-pressed={slot === 'extra'} onClick={() => slot !== 'extra' && onSlotChange('extra')}>الجارت الإضافي</button>
    </div>

    {loadError && <p className="form-error" role="alert">تعذر تحميل الجارت — لا يمكن الإضافة الآن.</p>}
    {!loadError && !chartReady && <p className="entry-form-note" role="status">جارٍ تحميل الجارت…</p>}
    {readOnly && <p className="form-error" role="status">الجارت قيد التعديل — {lockHolder?.name || 'جهاز آخر'}. لا يمكن الإضافة حتى ينتهي.</p>}
    {!isOnline && chartReady && <p className="entry-form-note" role="status">لا يوجد اتصال — يُحفظ على هذا الجهاز ويُرسل عند عودة الإشارة.</p>}

    <form className="entry-form" onSubmit={submit} noValidate>
      <div className="entry-form-card">
        <label>اسم المريض
          <input ref={nameRef} value={name} autoComplete="off" disabled={!canEdit} onChange={(e) => { setError(''); setName(e.target.value) }} onBlur={() => offerPrevious('name')} />
        </label>
        <label>رقم الطبلة
          <input value={id} inputMode="numeric" autoComplete="off" disabled={!canEdit} onChange={(e) => { setError(''); setId(toEnglishDigits(e.target.value).replace(/\D/g, '').slice(0, 20)) }} onBlur={() => offerPrevious('id')} />
        </label>
      </div>

      <div className="entry-form-card">
        <h2>الأدوية</h2>
        <ul className="entry-lines">
          {lines.map((line, index) => (
            <li key={line.id} className="entry-line">
              <div className="entry-line-med">
                <input value={line.med} aria-label={`الدواء ${index + 1}`} placeholder="ابحث عن دواء" autoComplete="off" disabled={!canEdit}
                  onFocus={() => setFocusLine(line.id)}
                  onBlur={() => setTimeout(() => setFocusLine((current) => (current === line.id ? null : current)), 120)}
                  onChange={(e) => setLine(line.id, { med: e.target.value })} />
                {options(line).length > 0 && <ul className="entry-suggest" role="listbox" aria-label="أدوية مطابقة">
                  {options(line).map((option) => (
                    <li key={option} role="option" aria-selected="false">
                      <button type="button" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => { setLine(line.id, { med: option }); setFocusLine(null) }}>
                        <bdi dir="auto">{option}</bdi>
                      </button>
                    </li>
                  ))}
                </ul>}
              </div>
              <input className="entry-line-qty" value={line.qty} inputMode="numeric" aria-label={`الكمية ${index + 1}`} placeholder="الكمية" autoComplete="off" disabled={!canEdit}
                onChange={(e) => setLine(line.id, { qty: toEnglishDigits(e.target.value).replace(/\D/g, '').slice(0, 4) })} />
              <button type="button" className="entry-line-remove" aria-label={`حذف الدواء ${index + 1}`}
                onClick={() => setLines((current) => (current.length > 1 ? current.filter((item) => item.id !== line.id) : [blankLine()]))}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="secondary-button" disabled={!canEdit} onClick={() => setLines((current) => [...current, blankLine()])}>+ دواء آخر</button>
      </div>

      <div className="entry-form-bar">
        {error && <p className="form-error" role="alert">{error}</p>}
        {added && <p className="form-success" role="status">أُضيف «{added.name}» إلى الجارت — صف {added.row}</p>}
        <button type="submit" className="primary-button" disabled={!canEdit}>إضافة إلى الجارت</button>
      </div>
    </form>
  </section>
}
