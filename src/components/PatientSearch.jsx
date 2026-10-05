import { useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'
import { toEnglishDigits } from '../helpers.js'

// Find a patient by name or «رقم الطبلة» across one day's main and extra charts — the
// pharmacist's own floor (`floor`), or the whole unit for a manager (`floor` null).
// Tapping a result opens that ward's chart. A manager (no `floor`) can switch to «كل التواريخ»:
// every saved date, one card per patient with their ward stays; a stay opens on its last date.
const formatDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('ar-IQ')
const wardText = (stay) => `${stay.floor ? `الطابق ${stay.floor} — ` : ''}${stay.ward}${stay.slot === 'extra' ? ' — الجارت الإضافي' : ''}`

export default function PatientSearch({ floor = null, date, onOpen, isExpired }) {
  const [q, setQ] = useState('')
  const [allDates, setAllDates] = useState(false)
  const history = allDates && !floor
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')
  const term = toEnglishDigits(q).trim()
  const active = term.length >= 2

  useEffect(() => {
    if (term.length < 2) return undefined
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const params = history ? new URLSearchParams({ q: term }) : new URLSearchParams({ date, q: term, ...(floor ? { floor } : {}) })
        const response = await fetch(`${apiUrl}/patients/${history ? 'history' : 'search'}?${params}`, { credentials: 'include' })
        if (isExpired?.(response)) return
        const result = await response.json()
        if (!response.ok) throw new Error(result.message)
        if (!cancelled) { setResults({ history, patients: result.patients }); setError('') }
      } catch (caught) {
        if (!cancelled) { setResults(null); setError(navigator.onLine ? (caught.message || 'تعذّر البحث') : 'البحث يحتاج اتصالاً') }
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [term, floor, date, isExpired, history])

  const shown = results && results.history === history ? results.patients : null
  return <div className="patient-search">
    {!floor && <div className="filter-chips patient-search-scope" role="group" aria-label="نطاق البحث">
      <button type="button" className="filter-chip" aria-pressed={!allDates} onClick={() => setAllDates(false)}>هذا اليوم</button>
      <button type="button" className="filter-chip" aria-pressed={allDates} onClick={() => setAllDates(true)}>كل التواريخ</button>
    </div>}
    <label className="search-field">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="6.5" fill="currentColor" fillOpacity=".14" /><path d="m20 20-4.2-4.2" /></svg>
      <input
        type="search" value={q} onChange={(event) => setQ(event.target.value)}
        placeholder="ابحث عن مريض بالاسم أو رقم الطبلة" aria-label="ابحث عن مريض بالاسم أو رقم الطبلة"
        autoComplete="off" enterKeyHint="search"
      />
    </label>
    {active && error && <p className="patient-search-note" role="alert">{error}</p>}
    {active && !error && shown && shown.length === 0 && <p className="patient-search-note">{history ? 'لا يوجد مريض بهذا الاسم أو الرقم في أي جارت محفوظ' : 'لا يوجد مريض بهذا الاسم أو الرقم في جارتات هذا اليوم'}</p>}
    {active && !error && history && shown && shown.length > 0 && <ul className="patient-search-results">
      {shown.map((patient) => (
        <li key={`${patient.patientId}|${patient.name}|${patient.first}`} className="patient-search-result patient-search-history">
          <span className="patient-search-who">
            <strong>{patient.name || 'بلا اسم'}</strong>
            {patient.patientId && <span className="patient-search-id">رقم الطبلة <bdi>{patient.patientId}</bdi></span>}
          </span>
          <span className="patient-search-where">من {formatDay(patient.first)} إلى {formatDay(patient.last)} · {patient.days} {patient.days === 1 ? 'يوم' : 'أيام'}</span>
          <ul className="patient-search-stays">
            {patient.stays.map((stay) => <li key={`${stay.floor}|${stay.ward}|${stay.slot}`}>
              <button type="button" className="patient-search-stay" onClick={() => onOpen({ floor: stay.floor, ward: stay.ward, mode: 'chart', slot: stay.slot, date: stay.last })}>
                <span>{wardText(stay)}</span>
                <span className="patient-search-stay-dates">{stay.first === stay.last ? formatDay(stay.last) : `${formatDay(stay.first)} – ${formatDay(stay.last)}`}</span>
              </button>
            </li>)}
          </ul>
        </li>
      ))}
    </ul>}
    {active && !error && !history && shown && shown.length > 0 && <ul className="patient-search-results">
      {shown.map((patient) => (
        <li key={`${patient.floor}-${patient.ward}-${patient.slot}-${patient.rowNumber}`}>
          <button type="button" className="patient-search-result" onClick={() => onOpen({ floor: patient.floor, ward: patient.ward, mode: 'chart', slot: patient.slot })}>
            <span className="patient-search-who">
              <strong>{patient.name || 'بلا اسم'}</strong>
              {patient.patientId && <span className="patient-search-id">رقم الطبلة <bdi>{patient.patientId}</bdi></span>}
            </span>
            <span className="patient-search-where">
              {patient.floor && !floor ? `الطابق ${patient.floor} — ${patient.ward}` : patient.ward}
              {patient.slot === 'extra' ? ' — الجارت الإضافي' : ''} · سطر {patient.rowNumber}
            </span>
            {patient.medicines.length > 0
              ? <span className="patient-search-meds">{patient.medicines.map((medicine) => <span className="patient-search-med" key={medicine.name} dir="ltr">{medicine.name} <b>× {medicine.quantity}</b></span>)}</span>
              : <span className="patient-search-meds patient-search-meds--none">لا أدوية مسجّلة</span>}
          </button>
        </li>
      ))}
    </ul>}
  </div>
}
