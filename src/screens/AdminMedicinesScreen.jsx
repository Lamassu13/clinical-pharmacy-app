import { useCallback, useEffect, useRef, useState } from 'react'
import MedicineEditor, { MedicineItem } from '../components/MedicineRow.jsx'

// The catalogue as a read-only list: scan names, filter by what is set, tap one row to edit it.
// Only one editor is open at a time, and it stays on screen whatever the search or filter, so
// narrowing the list can never throw an unsaved edit away.
const FLAG_FILTERS = [
  { key: 'all', label: 'الكل', test: () => true },
  { key: 'supply', label: 'مستلزمات', test: (item) => item.is_supply },
  { key: 'noDouble', label: 'لا يُضاعف يوم الخميس', test: (item) => item.no_thursday_double },
  { key: 'noArabic', label: 'بلا اسم عربي', test: (item) => !item.arabic_name },
]

function SearchIcon() {
  return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="6.5" fill="currentColor" fillOpacity=".14" /><path d="m20 20-4.2-4.2" /></svg>
}

export default function AdminMedicinesScreen({
  adminHeader, adminMedicines, visibleMedicines, medicinesStatus, onRetryMedicines,
  medicineSearch, medicineFilter, setMedicineFilter, newMedicine, setNewMedicine,
  editingMedicineId, setEditingMedicineId, askConfirm,
  registrationsError, adminSuccess, busy, onAddMedicine, onSaveMedicine, onRemoveMedicine, confirmModal,
}) {
  const [flagFilter, setFlagFilter] = useState('all')
  const [savedId, setSavedId] = useState(null)
  const dirtyRef = useRef(false)
  const onDirtyChange = useCallback((dirty) => { dirtyRef.current = dirty }, [])

  // Leaving the page closes the editor, so coming back starts on the plain list.
  useEffect(() => () => setEditingMedicineId(null), [setEditingMedicineId])
  useEffect(() => {
    if (!savedId) return undefined
    const timer = setTimeout(() => setSavedId(null), 3000)
    return () => clearTimeout(timer)
  }, [savedId])

  const editing = adminMedicines.find((item) => item.id === editingMedicineId) ?? null
  const flag = FLAG_FILTERS.find((entry) => entry.key === flagFilter)
  const listed = visibleMedicines.filter(flag.test)
  // The open editor is always listed, even when the search or a filter would hide it.
  const rows = editing && !listed.some((item) => item.id === editing.id) ? [editing, ...listed] : listed

  const openEditor = async (item) => {
    if (editing && editing.id !== item.id && dirtyRef.current
      && !(await askConfirm(`تجاهل التعديلات غير المحفوظة على «${editing.name}»؟`, { confirmLabel: 'تجاهل التعديلات' }))) return
    dirtyRef.current = false
    setEditingMedicineId(item.id)
  }
  const closeEditor = () => { dirtyRef.current = false; setEditingMedicineId(null) }
  const save = async (item, fields) => {
    if (await onSaveMedicine(item, fields)) { closeEditor(); setSavedId(item.id) }
  }
  const remove = async (item) => {
    if (await onRemoveMedicine(item.id, item.name)) closeEditor()
  }

  const searchTerm = medicineFilter.trim()
  const loaded = medicinesStatus === 'ready' || adminMedicines.length > 0

  return <main className="app-shell">{adminHeader}<section className="dashboard medicines-page">
    <div className="section-heading">
      <div><h1>إدارة الأدوية</h1></div>
      <div className="date-chip">
        <span>{medicineSearch || flagFilter !== 'all' ? 'المعروض' : 'عدد الأدوية'}</span>
        <strong>{medicineSearch || flagFilter !== 'all' ? `${listed.length} / ${adminMedicines.length}` : adminMedicines.length}</strong>
      </div>
    </div>

    <form className="medicine-add" onSubmit={onAddMedicine}>
      <label htmlFor="medicine-add-name">إضافة دواء جديد
        <span className="medicine-add-hint">بالاسم الإنجليزي كما يُكتب على الجارت، مع التركيز والشكل (مثل Meronem 1000gm Vial).</span>
      </label>
      <div className="medicine-add-row">
        <input id="medicine-add-name" dir="ltr" placeholder="Medicine name" value={newMedicine} onChange={(event) => setNewMedicine(event.target.value)} autoComplete="off" />
        <button className="primary-button compact" type="submit" disabled={busy || !newMedicine.trim()}>{busy ? 'جارٍ الإضافة…' : 'إضافة'}</button>
      </div>
    </form>

    {!editing && registrationsError && <p className="form-error" role="alert">{registrationsError}</p>}
    {adminSuccess && <p className="form-success" role="status">{adminSuccess}</p>}

    <div className="medicine-tools">
      <label className="search-field">
        <SearchIcon />
        <input type="search" value={medicineFilter} onChange={(event) => setMedicineFilter(event.target.value)} placeholder="ابحث في الأدوية بالاسم الإنجليزي أو العربي" aria-label="ابحث في الأدوية" autoComplete="off" enterKeyHint="search" />
      </label>
      <div className="filter-chips" role="group" aria-label="تصفية الأدوية">
        {FLAG_FILTERS.map((entry) => (
          <button key={entry.key} type="button" className="filter-chip" aria-pressed={flagFilter === entry.key} onClick={() => setFlagFilter(entry.key)}>
            {entry.label} <span className="filter-chip-count">{adminMedicines.filter(entry.test).length}</span>
          </button>
        ))}
      </div>
    </div>

    {!loaded && medicinesStatus === 'loading' && <p className="medicine-list-note" role="status">جارٍ تحميل قائمة الأدوية…</p>}
    {!loaded && medicinesStatus === 'error' && (
      <div className="empty-state">
        <strong>تعذّر تحميل قائمة الأدوية</strong>
        <span>تحقّق من الاتصال ثم أعِد المحاولة.</span>
        <button type="button" className="secondary-button compact" onClick={onRetryMedicines}>إعادة المحاولة</button>
      </div>
    )}

    {loaded && rows.length === 0 && (
      <div className="empty-state">
        {searchTerm ? <>
          <strong>لا يوجد دواء يطابق «<bdi>{searchTerm}</bdi>»{flagFilter !== 'all' ? ` ضمن «${flag.label}»` : ''}</strong>
          {flagFilter !== 'all' && <button type="button" className="text-button" onClick={() => setFlagFilter('all')}>البحث في كل الأدوية</button>}
          {flagFilter === 'all' && <button type="button" className="secondary-button compact" disabled={busy} onClick={() => onAddMedicine(null, searchTerm)}><span>إضافة «<bdi>{searchTerm}</bdi>» كدواء جديد</span></button>}
        </> : <>
          <strong>لا توجد أدوية ضمن «{flag.label}»</strong>
          <button type="button" className="text-button" onClick={() => setFlagFilter('all')}>عرض كل الأدوية</button>
        </>}
      </div>
    )}

    {rows.length > 0 && <ul className="medicine-list">
      {rows.map((item) => <li key={item.id}>
        {editing?.id === item.id
          ? <MedicineEditor
              item={item} busy={busy} error={registrationsError}
              onSave={(fields) => save(item, fields)} onCancel={closeEditor} onRemove={() => remove(item)} onDirtyChange={onDirtyChange}
            />
          : <MedicineItem item={item} saved={savedId === item.id} onEdit={() => openEditor(item)} />}
      </li>)}
    </ul>}
  </section>{confirmModal}</main>
}
