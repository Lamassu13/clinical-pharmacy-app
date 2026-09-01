import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import hospitalLogo from './assets/hospital-logo.JPG'
import './App.css'

const floors = [
  { number: 2, wards: ['ردهة رجال', 'ردهة النساء', 'ردهة الخاص'] },
  { number: 3, wards: ['الردهة الجراحية', 'ردهة الخاص', 'ردهة CCU'] },
  { number: 4, wards: ['ردهة الحوامل', 'ردهة الجراحية'] },
  { number: 5, wards: ['ردهة رجال', 'ردهة النساء', 'ردهة الخاص'] },
  { number: 6, wards: ['ردهة الخاص', 'الوحدة الأولى', 'الوحدة الثالثة'] },
  { number: 8, wards: ['الردهة الخامسة', 'ردهة القسطرة', 'ردهة الخاص'] },
  { number: 9, wards: ['ردهة الخاص', 'الردهة الرابعة', 'الردهة الثانية'] },
  { number: 10, wards: ['الردهة العصبية', 'ردهة المفاصل', 'الردهة النفسية'] },
]
const specialWards = ['ردهة الديلزة', 'ردهة العناية المركزة', 'ردهة الخدج']
const PATIENT_ROWS = 41
const CHART_COLUMNS = 51
// Fixed pill-form option lists. Keep in sync with server/index.js.
const doseTimes = ['٨ صباحًا', '٩ صباحًا', '١٠ صباحًا', '١١ صباحًا', '١٢ ظهرًا', '٢ ظهرًا', '٣ ظهرًا', '٤ عصرًا', '٥ عصرًا', '٦ مساءً', '٨ ليلًا', '٩ ليلًا', '١٠ ليلًا', '١٠ صباحًا - ١٠ مساءً', '١٢ ظهرًا - ١٢ ليلًا', '١٢ ظهرًا - ٨ ليلًا', '٨ صباحًا - ٤ عصرًا - ١٢ ليلًا', '٦ صباحًا - ١٢ ظهرًا - ٦ مساءً - ١٢ ليلًا']
const usageMethods = ['حبة بعد الطعام مباشرة', 'حبة قبل الطعام بساعة أو بعده بساعتين', '٢ حبة بعد الطعام مباشرة', 'نصف حبة قبل الطعام', 'نصف حبة بعد الطعام']
const noteOptions = ['الامتناع عن تناول منتجات الأجبان والألبان قبل وبعد الحبة بساعتين']
const toEnglishDigits = (value) => value.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
const isoDate = (value) => {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const locationBody = (value) => {
  const asFloor = Number(value)
  if (floors.some((item) => item.number === asFloor)) return { floor: asFloor }
  if (specialWards.includes(value)) return { ward: value }
  return null
}
const apiUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api')

function MedicineRow({ item, onSave, onRemove, busy }) {
  const [name, setName] = useState(item.name)
  const [arabicName, setArabicName] = useState(item.arabic_name || '')
  const dirty = name.trim() !== item.name || arabicName.trim() !== (item.arabic_name || '')
  return <tr>
    <td><input value={name} onChange={(event) => setName(event.target.value)} /></td>
    <td><input value={arabicName} onChange={(event) => setArabicName(event.target.value)} placeholder="الاسم بالعربية" /></td>
    <td className="requests-actions"><button className="primary-button compact" disabled={!dirty || busy} onClick={() => onSave(item.id, name.trim(), arabicName.trim())}>حفظ</button><button className="danger-button compact" disabled={busy} onClick={() => onRemove(item.id, item.name)}>حذف</button></td>
  </tr>
}

function PillSelect({ value, options, onChange }) {
  return <div className="pill-select"><span className="pill-select-value">{value || '—'}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">—</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
}

function AppCredit() {
  return <div className="app-credit" aria-hidden="true"><strong>وحدة الصيدلة السريرية</strong><span>الحسين عبدالله</span></div>
}

function ThemeToggle({ theme, onToggle }) {
  return <button type="button" className="theme-toggle" onClick={onToggle} aria-pressed={theme === 'dark'} aria-label={theme === 'dark' ? 'إيقاف الوضع الليلي' : 'تشغيل الوضع الليلي'}>{theme === 'dark' ? '☀' : '🌙'}</button>
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [authView, setAuthView] = useState('login')
  const [credentials, setCredentials] = useState({ username: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [registerForm, setRegisterForm] = useState({ fullName: '', username: '', phone: '', email: '', fingerprintNumber: '', password: '' })
  const [registerError, setRegisterError] = useState('')
  const [registerSuccess, setRegisterSuccess] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [adminView, setAdminView] = useState(null)
  const [registrations, setRegistrations] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [pendingFloor, setPendingFloor] = useState({})
  const [registrationsError, setRegistrationsError] = useState('')
  const [adminSuccess, setAdminSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [floor, setFloor] = useState(null)
  const [selected, setSelected] = useState(null)
  const [medicines, setMedicines] = useState([])
  const [columnMedicines, setColumnMedicines] = useState(() => Array(CHART_COLUMNS).fill(''))
  const [showMedicineForm, setShowMedicineForm] = useState(false)
  // Row currently being typed into, for the patient banner above the grid. One state
  // change per focus move — far cheaper than the re-render every keystroke already costs.
  const [activeRow, setActiveRow] = useState(-1)
  const [activeColumn, setActiveColumn] = useState(-1)
  const [newMedicine, setNewMedicine] = useState('')
  const [patientNames, setPatientNames] = useState(() => Array.from({ length: PATIENT_ROWS }, () => ''))
  const [quantities, setQuantities] = useState(() => Array.from({ length: PATIENT_ROWS }, () => Array(CHART_COLUMNS).fill('')))
  // Which row was focused and what it held, so blur only collapses the row it started on.
  const editingRowStart = useRef({ row: -1, name: '' })
  // The chart is three strips: a header, the scrolling body, and the totals. Only the
  // doses half of the body scrolls sideways; the other two are pushed to match it.
  const chartFrameRef = useRef(null)
  const chartGridRef = useRef(null)
  const chartDosesRef = useRef(null)
  const chartHeadRef = useRef(null)
  const chartFootRef = useRef(null)
  const [selectedDate, setSelectedDate] = useState(() => isoDate(new Date()))
  const [chartLoading, setChartLoading] = useState(false)
  const [loadedChartKey, setLoadedChartKey] = useState(null)
  const [saveError, setSaveError] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [pillsData, setPillsData] = useState(null)
  const [pillEntries, setPillEntries] = useState({})
  const [pillRooms, setPillRooms] = useState({})
  const [pillsLoading, setPillsLoading] = useState(false)
  const [loadedPillsKey, setLoadedPillsKey] = useState(null)
  const [pillsSaveError, setPillsSaveError] = useState(false)
  const [pillsLoadError, setPillsLoadError] = useState(false)
  const [adminMedicines, setAdminMedicines] = useState([])
  const [medicineFilter, setMedicineFilter] = useState('')
  const today = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('ar-IQ')
  const editTime = new Date().toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' })
  const totals = useMemo(() => quantities[0].map((_, columnIndex) => quantities.reduce((sum, row) => sum + (Number(row[columnIndex]) || 0), 0)), [quantities])

  useEffect(() => {
    fetch(`${apiUrl}/auth/me`, { credentials: 'include' })
      .then((response) => response.json())
      .then((result) => { if (result.user) { setCurrentUser(result.user); setIsLoggedIn(true) } })
      .catch(() => undefined)
  }, [])

  const submitLogin = async (event) => {
    event.preventDefault()
    if (busy) return
    setLoginError(''); setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(credentials) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر تسجيل الدخول')
      setCurrentUser(result.user)
      setIsLoggedIn(true)
    } catch (error) { setLoginError(error.message || 'تعذر الاتصال بالخادم') } finally { setBusy(false) }
  }
  const submitRegister = async (event) => {
    event.preventDefault()
    if (busy) return
    setRegisterError('')
    setRegisterSuccess('')
    setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(registerForm) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر إنشاء الحساب')
      setRegisterSuccess(result.message || 'تم إنشاء الحساب، بانتظار موافقة المدير')
      setRegisterForm({ fullName: '', username: '', phone: '', email: '', fingerprintNumber: '', password: '' })
    } catch (error) { setRegisterError(error.message || 'تعذر الاتصال بالخادم') } finally { setBusy(false) }
  }
  const logout = useCallback(async () => {
    try { await fetch(`${apiUrl}/auth/logout`, { method: 'POST', credentials: 'include' }) } catch { /* ignore network errors on logout */ }
    setIsLoggedIn(false)
    setCurrentUser(null)
    setAdminView(null)
    setFloor(null)
    setSelected(null)
    setCredentials({ username: '', password: '' })
  }, [])
  const loadRegistrations = useCallback(async () => {
    setRegistrationsError('')
    try {
      const response = await fetch(`${apiUrl}/registrations`, { credentials: 'include' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر جلب الطلبات')
      setRegistrations(result.registrations)
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') }
  }, [])
  const loadUsers = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/users`, { credentials: 'include' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر جلب المستخدمين')
      setAllUsers(result.users)
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') }
  }, [])
  const approveRegistration = useCallback(async (id) => {
    const location = locationBody(pendingFloor[id])
    if (!location) { setAdminSuccess(''); setRegistrationsError('اختر الطابق أو الردهة قبل قبول الطلب'); return }
    setRegistrationsError(''); setAdminSuccess(''); setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/registrations/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status: 'active', ...location }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر قبول الطلب')
      setRegistrations((current) => current.filter((item) => item.id !== id))
      setAdminSuccess('تم قبول الطلب وتفعيل الحساب')
      loadUsers()
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') } finally { setBusy(false) }
  }, [pendingFloor, loadUsers])
  const rejectRegistration = useCallback(async (id) => {
    setRegistrationsError(''); setAdminSuccess(''); setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/registrations/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status: 'rejected' }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر رفض الطلب')
      setRegistrations((current) => current.filter((item) => item.id !== id))
      setAdminSuccess('تم رفض الطلب')
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') } finally { setBusy(false) }
  }, [])
  const assignLocationToUser = useCallback(async (id, value) => {
    const location = locationBody(value)
    if (!location) return
    setRegistrationsError(''); setAdminSuccess(''); setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/access/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(location) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر تعيين الموقع')
      setAllUsers((current) => current.map((user) => user.id === id ? { ...user, floors: location.floor ? [location.floor] : [], wards: location.ward ? [location.ward] : [] } : user))
      setAdminSuccess('تم تحديث الموقع — سيسجّل المستخدم الدخول من جديد')
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') } finally { setBusy(false) }
  }, [])
  const deleteUser = useCallback(async (id, name) => {
    if (!window.confirm(`حذف المستخدم "${name}" نهائيًا؟`)) return
    setRegistrationsError(''); setAdminSuccess(''); setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/users/${id}`, { method: 'DELETE', credentials: 'include' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر حذف المستخدم')
      setAllUsers((current) => current.filter((user) => user.id !== id))
      setAdminSuccess(`تم حذف المستخدم "${name}"`)
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') } finally { setBusy(false) }
  }, [])
  const loadMedicines = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/medicines`, { credentials: 'include' })
      const result = await response.json()
      if (!response.ok || !Array.isArray(result.medicines)) return
      // Replace, never merge: the catalogue is the only source of truth, so a deleted or
      // renamed medicine has to leave this list too.
      setMedicines(result.medicines.map((item) => item.name).sort((a, b) => a.localeCompare(b)))
    } catch { /* keep the current list on network error */ }
  }, [])
  const loadMedicinesAdmin = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/medicines`, { credentials: 'include' })
      const result = await response.json()
      if (!response.ok || !Array.isArray(result.medicines)) return
      setAdminMedicines(result.medicines)
    } catch { /* keep current list */ }
  }, [])
  const saveMedicine = useCallback(async (id, name, arabicName) => {
    setRegistrationsError(''); setAdminSuccess(''); setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/medicines/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name, arabicName }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر تحديث الدواء')
      setAdminMedicines((current) => current.map((item) => item.id === id ? result.medicine : item))
      setAdminSuccess(`تم حفظ "${result.medicine?.name || name}"`)
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') } finally { setBusy(false) }
  }, [])
  const removeMedicine = useCallback(async (id, name) => {
    if (!window.confirm(`حذف الدواء "${name}" من القائمة؟`)) return
    setRegistrationsError(''); setAdminSuccess(''); setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/medicines/${id}`, { method: 'DELETE', credentials: 'include' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر حذف الدواء')
      setAdminMedicines((current) => current.filter((item) => item.id !== id))
      setAdminSuccess(`تم حذف "${name}"`)
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') } finally { setBusy(false) }
  }, [])
  useEffect(() => {
    setRegistrationsError(''); setAdminSuccess('')
    if (adminView === 'requests') loadRegistrations()
    if (adminView === 'users') loadUsers()
    if (adminView === 'medicines') loadMedicinesAdmin()
  }, [adminView, loadRegistrations, loadUsers, loadMedicinesAdmin])
  // Success notices are transient; errors stay until the next action.
  useEffect(() => {
    if (!adminSuccess) return undefined
    const timer = setTimeout(() => setAdminSuccess(''), 4000)
    return () => clearTimeout(timer)
  }, [adminSuccess])
  const addMedicine = async (event) => {
    event.preventDefault()
    const medicine = newMedicine.trim()
    if (!medicine) return
    setRegistrationsError(''); setAdminSuccess(''); setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/medicines`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name: medicine }) })
      const result = await response.json().catch(() => ({}))
      if (response.status === 409) {
        // Already catalogued. Filter the table down to it so the admin can see the row
        // they were about to duplicate instead of just being told no.
        if (result.medicine?.name) setMedicineFilter(result.medicine.name)
        throw new Error(result.message || 'الدواء موجود في القائمة أصلًا')
      }
      if (!response.ok) throw new Error(result.message || 'تعذر إضافة الدواء')
      // Only reflect it locally once the server has actually accepted it.
      setMedicines((current) => [...new Set([...current, medicine])].sort((a, b) => a.localeCompare(b)))
      setNewMedicine('')
      setShowMedicineForm(false)
      setAdminSuccess(`تمت إضافة "${medicine}"`)
      if (adminView === 'medicines') loadMedicinesAdmin()
    } catch (error) {
      setRegistrationsError(error.message || 'تعذر الاتصال بالخادم')
    } finally { setBusy(false) }
  }
  const updateQuantity = (rowIndex, columnIndex, value) => setQuantities((current) => current.map((row, currentRow) => currentRow === rowIndex ? row.map((quantity, currentColumn) => currentColumn === columnIndex ? toEnglishDigits(value).replace(/\D/g, '') : quantity) : row))
  // Remove a patient row and pull every following row up one, keeping the grid at PATIENT_ROWS.
  const collapseRow = useCallback((rowIndex) => {
    setPatientNames((current) => { const next = current.filter((_, index) => index !== rowIndex); next.push(''); return next })
    setQuantities((current) => { const next = current.filter((_, index) => index !== rowIndex); next.push(Array(CHART_COLUMNS).fill('')); return next })
  }, [])
  const buildChartBody = useCallback((date) => ({
    floor: selected?.floor ?? null,
    ward: selected?.ward,
    date,
    patients: patientNames.map((name, index) => ({ rowNumber: index + 1, name })),
    columns: columnMedicines.map((medicineName, index) => ({ columnNumber: index + 1, medicineName })),
    quantities: quantities.flatMap((row, rowIndex) => row.map((quantity, columnIndex) => quantity ? ({ rowNumber: rowIndex + 1, columnNumber: columnIndex + 1, quantity: Number(quantity) }) : [])),
  }), [columnMedicines, patientNames, quantities, selected])
  // Fire an immediate save (survives navigation / tab close) — only once the grid is loaded,
  // so we never overwrite unknown server state with a blank grid.
  const flushChart = useCallback(() => {
    if (!selected || selected.mode === 'pills' || !isLoggedIn) return
    if (loadedChartKey !== `${selected.floor || 'special'}-${selected.ward}-${selectedDate}`) return
    try { fetch(`${apiUrl}/chart`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', keepalive: true, body: JSON.stringify(buildChartBody(selectedDate)) }) } catch { /* the debounced autosave or next visit will retry */ }
  }, [buildChartBody, isLoggedIn, loadedChartKey, selected, selectedDate])
  const flushPills = useCallback(() => {
    if (!selected || selected.mode !== 'pills' || !isLoggedIn || !pillsData) return
    if (loadedPillsKey !== `${selected.floor || 'special'}-${selected.ward}-${selectedDate}`) return
    const entries = Object.entries(pillEntries).map(([key, value]) => {
      const [patientRowNumber, medicineId] = key.split(':').map(Number)
      return { patientRowNumber, medicineId, doseTime: value.doseTime || '', usageMethod: value.usageMethod || '', note: value.note || '' }
    })
    try { fetch(`${apiUrl}/pills`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', keepalive: true, body: JSON.stringify({ floor: selected.floor, ward: selected.ward, date: selectedDate, entries, rooms: pillRooms }) }) } catch { /* retry on next visit */ }
  }, [isLoggedIn, loadedPillsKey, pillEntries, pillRooms, pillsData, selected, selectedDate])
  const goHome = useCallback(() => {
    if (selected?.mode === 'pills') flushPills(); else flushChart()
    setSelected(null)
    setFloor(null)
    setAdminView(null)
  }, [selected, flushChart, flushPills])
  // There is no router, so the tab title is the only cue for which screen is open.
  useEffect(() => {
    const base = 'وحدة الصيدلة السريرية'
    const ward = selected ? (selected.floor ? `الطابق ${selected.floor} - ${selected.ward}` : selected.ward) : ''
    let screen = 'اختر الطابق'
    if (!isLoggedIn) screen = authView === 'register' ? 'إنشاء حساب' : 'تسجيل الدخول'
    else if (adminView === 'requests') screen = 'طلبات الانضمام'
    else if (adminView === 'users') screen = 'جميع المستخدمين'
    else if (adminView === 'medicines') screen = 'إدارة الأدوية'
    else if (selected?.mode === 'pills') screen = `الحبوب — ${ward}`
    else if (selected) screen = `الجارت — ${ward}`
    else if (floor) screen = `الطابق ${floor.number} — اختر الردهة`
    document.title = `${screen} · ${base}`
  }, [isLoggedIn, authView, adminView, selected, floor])
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem('cpa-theme', next) } catch { /* storage unavailable */ }
      if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
      else document.documentElement.removeAttribute('data-theme')
      return next
    })
  }, [])

  useEffect(() => {
    const handler = () => { if (selected?.mode === 'pills') flushPills(); else flushChart() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [selected, flushChart, flushPills])

  useEffect(() => { if (isLoggedIn) loadMedicines() }, [isLoggedIn, loadMedicines])
  useEffect(() => {
    if (!selected || selected.mode === 'pills') return undefined
    loadMedicines()
    const timer = setInterval(loadMedicines, 60000)
    return () => clearInterval(timer)
  }, [selected, loadMedicines])

  useEffect(() => {
    if (!selected || selected.mode === 'pills') return undefined
    const chartKey = `${selected.floor || 'special'}-${selected.ward}-${selectedDate}`
    setChartLoading(true)
    setLoadedChartKey(null)
    setSaveError(false)
    setLoadError(false)
    let cancelled = false
    let retryTimer
    const load = async () => {
      try {
        const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, date: selectedDate })
        const response = await fetch(`${apiUrl}/chart?${params}`, { credentials: 'include' })
        if (!response.ok) throw new Error('load failed')
        const result = await response.json()
        if (cancelled) return
        if (!result.chart) {
          setPatientNames(Array.from({ length: PATIENT_ROWS }, () => ''))
          setQuantities(Array.from({ length: PATIENT_ROWS }, () => Array(CHART_COLUMNS).fill('')))
          setColumnMedicines(Array(CHART_COLUMNS).fill(''))
        } else {
          const nextPatients = Array(PATIENT_ROWS).fill('')
          result.chart.patients.forEach((patient) => { nextPatients[patient.row_number - 1] = patient.patient_name })
          const nextQuantities = Array.from({ length: PATIENT_ROWS }, () => Array(CHART_COLUMNS).fill(''))
          result.chart.quantities.forEach((quantity) => { nextQuantities[quantity.row_number - 1][quantity.column_number - 1] = String(quantity.quantity) })
          const nextColumns = Array(CHART_COLUMNS).fill('')
          result.chart.columns.forEach((column) => { nextColumns[column.column_number - 1] = column.medicine_name || '' })
          setPatientNames(nextPatients); setQuantities(nextQuantities); setColumnMedicines(nextColumns)
        }
        setLoadError(false)
        setLoadedChartKey(chartKey)
        setChartLoading(false)
      } catch {
        if (cancelled) return
        setLoadError(true)
        setChartLoading(false)
        retryTimer = setTimeout(load, 4000)
      }
    }
    load()
    return () => { cancelled = true; clearTimeout(retryTimer) }
  }, [selected, selectedDate])

  useEffect(() => {
    const chartKey = selected ? `${selected.floor || 'special'}-${selected.ward}-${selectedDate}` : null
    if (!selected || selected.mode === 'pills' || !isLoggedIn || chartLoading || loadedChartKey !== chartKey) return undefined
    let retryTimer
    const save = async () => {
      try {
        const response = await fetch(`${apiUrl}/chart`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(buildChartBody(selectedDate)) })
        if (!response.ok) throw new Error('save failed')
        setSaveError(false)
      } catch {
        setSaveError(true)
        retryTimer = setTimeout(save, 4000)
      }
    }
    const timer = setTimeout(save, 1200)
    return () => { clearTimeout(timer); clearTimeout(retryTimer) }
  }, [buildChartBody, chartLoading, isLoggedIn, loadedChartKey, selected, selectedDate])

  useEffect(() => {
    if (!selected || selected.mode !== 'pills') return undefined
    const pillsKey = `${selected.floor || 'special'}-${selected.ward}-${selectedDate}`
    setPillsLoading(true)
    setLoadedPillsKey(null)
    setPillsSaveError(false)
    setPillsLoadError(false)
    let cancelled = false
    let retryTimer
    const load = async () => {
      try {
        const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, date: selectedDate })
        const response = await fetch(`${apiUrl}/pills?${params}`, { credentials: 'include' })
        if (!response.ok) throw new Error('load failed')
        const result = await response.json()
        if (cancelled) return
        setPillsData(result.pills || null)
        const seed = {}
        ;(result.pills?.entries || []).forEach((entry) => { seed[`${entry.patientRowNumber}:${entry.medicineId}`] = { doseTime: entry.doseTime || '', usageMethod: entry.usageMethod || '', note: entry.note || '' } })
        setPillEntries(seed)
        setPillRooms(result.pills?.rooms || {})
        setPillsLoadError(false)
        setLoadedPillsKey(pillsKey)
        setPillsLoading(false)
      } catch {
        if (cancelled) return
        setPillsLoadError(true)
        setPillsLoading(false)
        retryTimer = setTimeout(load, 4000)
      }
    }
    load()
    return () => { cancelled = true; clearTimeout(retryTimer) }
  }, [selected, selectedDate])

  useEffect(() => {
    if (!selected || selected.mode !== 'pills' || !isLoggedIn || pillsLoading) return undefined
    const pillsKey = `${selected.floor || 'special'}-${selected.ward}-${selectedDate}`
    if (loadedPillsKey !== pillsKey || !pillsData) return undefined
    let retryTimer
    const save = async () => {
      const entries = Object.entries(pillEntries).map(([key, value]) => {
        const [patientRowNumber, medicineId] = key.split(':').map(Number)
        return { patientRowNumber, medicineId, doseTime: value.doseTime || '', usageMethod: value.usageMethod || '', note: value.note || '' }
      })
      try {
        const response = await fetch(`${apiUrl}/pills`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ floor: selected.floor, ward: selected.ward, date: selectedDate, entries, rooms: pillRooms }) })
        if (!response.ok) throw new Error('save failed')
        setPillsSaveError(false)
      } catch {
        setPillsSaveError(true)
        retryTimer = setTimeout(save, 4000)
      }
    }
    const timer = setTimeout(save, 1200)
    return () => { clearTimeout(timer); clearTimeout(retryTimer) }
  }, [isLoggedIn, loadedPillsKey, pillEntries, pillRooms, pillsData, pillsLoading, selected, selectedDate])

  const changeDate = useCallback((nextDate) => {
    flushChart()
    setSelectedDate(nextDate)
  }, [flushChart])
  const copyToNextDay = useCallback(async () => {
    const nextDate = isoDate(new Date(`${selectedDate}T12:00:00`).getTime() + 86400000)
    if (!window.confirm(`نسخ جارت ${today} إلى اليوم التالي؟ سيُستبدل أي جارت محفوظ في ذلك اليوم.`)) return
    flushChart()
    try {
      const response = await fetch(`${apiUrl}/chart`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(buildChartBody(nextDate)) })
      if (!response.ok) throw new Error('copy failed')
      setSelectedDate(nextDate)
    } catch { window.alert('تعذر نسخ الجارت') }
  }, [buildChartBody, flushChart, selectedDate, today])

  // Keep the latest handlers in refs. They are rebuilt on every patientNames change
  // (via buildChartBody -> flushChart), and depending on them directly made the effect
  // below tear down and re-create its DOM node on every single keystroke — a full
  // reflow of a 2756px table with 2000+ inputs, which is what smeared the sticky
  // patient column. The effect now only re-runs when the ward or date actually changes.
  // Opening the software keyboard on iOS does not shrink the layout viewport — it shrinks
  // and offsets the *visual* one. A pinned element still sits at the top of the layout
  // viewport, which by then is above what the eye can see, which is why the patient bar
  // vanished exactly when it was needed. Publish that offset so the bar can push itself
  // back down into the visible area. Zero on every platform that resizes properly, so the
  // translate costs nothing there.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return undefined
    const apply = () => document.documentElement.style.setProperty('--vv-offset', `${Math.max(0, viewport.offsetTop)}px`)
    viewport.addEventListener('resize', apply)
    viewport.addEventListener('scroll', apply)
    apply()
    return () => {
      viewport.removeEventListener('resize', apply)
      viewport.removeEventListener('scroll', apply)
      document.documentElement.style.removeProperty('--vv-offset')
    }
  }, [])

  // Keep the three strips on the same column. Whichever one the pharmacist drags leads and
  // the other two follow, so the header scrolls under a finger just like the quantities do.
  // The lock is what stops it looping: writing scrollLeft fires another scroll event, which
  // would otherwise bounce back at the pane that started it.
  // Also publish the width the vertical scrollbar steals from the body, so the strips
  // outside it reserve the same amount — otherwise every column sits off its own header on
  // platforms that give scrollbars width.
  useEffect(() => {
    const doses = chartDosesRef.current
    const grid = chartGridRef.current
    const frame = chartFrameRef.current
    if (!doses || !grid || !frame) return undefined
    const panes = [chartHeadRef.current, doses, chartFootRef.current].filter(Boolean)
    let locked = false
    const follow = (source) => () => {
      if (locked) return
      locked = true
      panes.forEach((pane) => { if (pane !== source) pane.scrollLeft = source.scrollLeft })
      requestAnimationFrame(() => { locked = false })
    }
    const handlers = panes.map((pane) => [pane, follow(pane)])
    handlers.forEach(([pane, handler]) => pane.addEventListener('scroll', handler, { passive: true }))
    const measureGutter = () => frame.style.setProperty('--chart-gutter', `${grid.offsetWidth - grid.clientWidth}px`)
    window.addEventListener('resize', measureGutter)
    panes.forEach((pane) => { if (pane !== doses) pane.scrollLeft = doses.scrollLeft })
    measureGutter()
    return () => {
      handlers.forEach(([pane, handler]) => pane.removeEventListener('scroll', handler))
      window.removeEventListener('resize', measureGutter)
    }
  }, [selected])

  const changeDateRef = useRef(changeDate)
  const copyToNextDayRef = useRef(copyToNextDay)
  useEffect(() => {
    changeDateRef.current = changeDate
    copyToNextDayRef.current = copyToNextDay
  })
  useEffect(() => {
    const meta = document.querySelector('.chart-meta')
    if (!meta || !selected || selected.mode === 'pills') return undefined
    const controls = document.createElement('span')
    controls.className = 'date-controls'
    controls.innerHTML = '<label>التاريخ <input type="date" aria-label="تاريخ الجارت"></label><button type="button">نسخ إلى اليوم التالي</button>'
    const dateInput = controls.querySelector('input')
    const copyButton = controls.querySelector('button')
    dateInput.value = selectedDate
    dateInput.addEventListener('change', (event) => changeDateRef.current(event.target.value))
    copyButton.addEventListener('click', () => copyToNextDayRef.current())
    meta.append(controls)
    return () => { controls.remove() }
  }, [selected, selectedDate])
  useEffect(() => {
    const cards = document.querySelectorAll('.location-card:not(.special)')
    cards.forEach((card) => {
      const number = Number(card.querySelector('.floor-number')?.textContent)
      card.hidden = currentUser?.role !== 'admin' && number !== currentUser?.assignedFloor
    })
    document.querySelectorAll('.location-card.special').forEach((card) => {
      const wardName = card.querySelector('strong')?.textContent
      card.hidden = currentUser?.role !== 'admin' && !(currentUser?.assignedWards || []).includes(wardName)
    })
  }, [currentUser, floor, selected])
  useEffect(() => {
    if (!showMedicineForm) return undefined
    const onKey = (event) => { if (event.key === 'Escape') setShowMedicineForm(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showMedicineForm])

  if (!isLoggedIn && authView === 'register') return <main className="login-shell"><AppCredit /><section className="login-card"><img className="hospital-logo login-logo" width="116" height="116" src={hospitalLogo} alt="شعار مستشفى بغداد التعليمي" /><p className="eyebrow">مستشفى بغداد التعليمي</p><h1>إنشاء حساب جديد</h1><p className="login-intro">أدخل بياناتك، وسيتم تفعيل الحساب بعد موافقة المدير</p><form onSubmit={submitRegister} className="login-form"><label>الاسم الكامل<input value={registerForm.fullName} onChange={(event) => setRegisterForm({ ...registerForm, fullName: event.target.value })} required /></label><label>اسم المستخدم<input value={registerForm.username} onChange={(event) => setRegisterForm({ ...registerForm, username: event.target.value })} required /></label><label>رقم الهاتف<input type="tel" value={registerForm.phone} onChange={(event) => setRegisterForm({ ...registerForm, phone: event.target.value })} required /></label><label>البريد الإلكتروني<input type="email" value={registerForm.email} onChange={(event) => setRegisterForm({ ...registerForm, email: event.target.value })} required /></label><label>رقم البصمة<input value={registerForm.fingerprintNumber} onChange={(event) => setRegisterForm({ ...registerForm, fingerprintNumber: event.target.value })} required /></label><label>كلمة المرور<input type="password" minLength={6} value={registerForm.password} onChange={(event) => setRegisterForm({ ...registerForm, password: event.target.value })} required /></label>{registerError && <p className="form-error" role="alert">{registerError}</p>}{registerSuccess && <p className="form-success" role="status">{registerSuccess}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'جارٍ الإرسال…' : <>إنشاء الحساب <span>←</span></>}</button></form><button type="button" className="text-button" onClick={() => { setAuthView('login'); setRegisterError(''); setRegisterSuccess('') }}>لديك حساب؟ تسجيل الدخول</button></section></main>

  if (!isLoggedIn) return <main className="login-shell"><AppCredit /><section className="login-card"><img className="hospital-logo login-logo" width="116" height="116" src={hospitalLogo} alt="شعار مستشفى بغداد التعليمي" /><p className="eyebrow">مستشفى بغداد التعليمي</p><h1>وحدة الصيدلة السريرية</h1><p className="login-intro">سجل الدخول للوصول إلى جداول الجارت اليومية</p><form onSubmit={submitLogin} className="login-form"><label>اسم المستخدم<input value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} required /></label><label>كلمة المرور<input type="password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} required /></label>{loginError && <p className="form-error" role="alert">{loginError}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'جارٍ الدخول…' : <>تسجيل الدخول <span>←</span></>}</button></form><button type="button" className="secondary-button" onClick={() => { setAuthView('register'); setLoginError('') }}>إنشاء حساب</button><p className="security-note">الحسابات الجديدة بانتظار موافقة المدير</p></section></main>

  const adminHeader = <header className="topbar"><button type="button" className="topbar-brand" onClick={goHome} aria-label="العودة إلى اختيار الطابق"><img className="hospital-logo header-logo" width="42" height="42" src={hospitalLogo} alt="" /><span><strong>الصيدلة السريرية</strong><small>مستشفى بغداد التعليمي</small></span></button><nav className="user-menu"><ThemeToggle theme={theme} onToggle={toggleTheme} /><button onClick={() => setAdminView('requests')} className={adminView === 'requests' ? 'secondary-button compact' : 'text-button'}>طلبات الانضمام</button><button onClick={() => setAdminView('medicines')} className={adminView === 'medicines' ? 'secondary-button compact' : 'text-button'}>إدارة الأدوية</button><button onClick={() => setAdminView('users')} className={adminView === 'users' ? 'secondary-button compact' : 'text-button'}>جميع المستخدمين</button><button onClick={() => setAdminView(null)} className="text-button">→ عودة</button></nav></header>

  if (adminView === 'requests' && currentUser?.role === 'admin') return <main className="app-shell"><AppCredit />{adminHeader}<section className="dashboard"><div className="section-heading"><div><p className="eyebrow">إدارة الحسابات</p><h1>طلبات الانضمام</h1><p>عند القبول اختر الطابق أو الردهة المسموح بها للمستخدم.</p></div><button className="secondary-button" onClick={loadRegistrations}>تحديث</button></div>{registrationsError && <p className="form-error" role="alert">{registrationsError}</p>}{adminSuccess && <p className="form-success" role="status">{adminSuccess}</p>}{registrations.length === 0 ? <div className="empty-state"><strong>لا توجد طلبات</strong><span>لا توجد طلبات انضمام قيد الانتظار حاليًا.</span></div> : <div className="table-frame"><table className="requests-table"><thead><tr><th>الاسم الكامل</th><th>اسم المستخدم</th><th>الهاتف</th><th>البريد الإلكتروني</th><th>رقم البصمة</th><th>الطابق / الردهة</th><th>إجراء</th></tr></thead><tbody>{registrations.map((item) => <tr key={item.id}><td>{item.full_name}</td><td>{item.username}</td><td>{item.phone}</td><td>{item.email}</td><td>{item.fingerprint_number}</td><td><select value={pendingFloor[item.id] || ''} onChange={(event) => setPendingFloor((current) => ({ ...current, [item.id]: event.target.value }))}><option value="">اختر</option><optgroup label="الطوابق">{floors.map((floorOption) => <option key={floorOption.number} value={floorOption.number}>الطابق {floorOption.number}</option>)}</optgroup><optgroup label="ردهات خاصة">{specialWards.map((ward) => <option key={ward} value={ward}>{ward}</option>)}</optgroup></select></td><td className="requests-actions"><button className="primary-button compact" disabled={busy} onClick={() => approveRegistration(item.id)}>قبول</button><button className="danger-button compact" disabled={busy} onClick={() => rejectRegistration(item.id)}>رفض</button></td></tr>)}</tbody></table></div>}</section></main>

  if (adminView === 'users' && currentUser?.role === 'admin') return <main className="app-shell"><AppCredit />{adminHeader}<section className="dashboard"><div className="section-heading"><div><p className="eyebrow">المستخدمون</p><h1>جميع المستخدمين</h1><p>الحسابات المسجلة في النظام. عيّن الطابق أو الردهة من القائمة بجانب كل مستخدم.</p></div><button className="secondary-button" onClick={loadUsers}>تحديث</button></div>{registrationsError && <p className="form-error" role="alert">{registrationsError}</p>}{adminSuccess && <p className="form-success" role="status">{adminSuccess}</p>}{allUsers.length === 0 ? <div className="empty-state"><strong>لا يوجد مستخدمون</strong><span>لم يُسجَّل أي مستخدم في النظام بعد.</span></div> : <div className="table-frame"><table className="requests-table"><thead><tr><th>الاسم الكامل</th><th>اسم المستخدم</th><th>البريد الإلكتروني</th><th>الهاتف</th><th>الدور</th><th>الحالة</th><th>الطابق / الردهة</th><th>إجراء</th></tr></thead><tbody>{allUsers.map((user) => <tr key={user.id}><td>{user.full_name}</td><td>{user.username}</td><td>{user.email}</td><td>{user.phone}</td><td><span className={user.role === 'admin' ? 'badge badge-warning' : 'badge badge-muted'}>{user.role === 'admin' ? 'مدير' : 'مستخدم'}</span></td><td><span className={'badge ' + (({ active: 'badge-success', pending: 'badge-warning', rejected: 'badge-danger', suspended: 'badge-danger' })[user.account_status] || 'badge-muted')}>{({ pending: 'قيد الانتظار', active: 'مفعل', rejected: 'مرفوض', suspended: 'موقوف' })[user.account_status] || user.account_status}</span></td><td><select value={(user.floors || [])[0] || (user.wards || [])[0] || ''} onChange={(event) => assignLocationToUser(user.id, event.target.value)}><option value="">بدون</option><optgroup label="الطوابق">{floors.map((floorOption) => <option key={floorOption.number} value={floorOption.number}>الطابق {floorOption.number}</option>)}</optgroup><optgroup label="ردهات خاصة">{specialWards.map((ward) => <option key={ward} value={ward}>{ward}</option>)}</optgroup></select></td><td className="requests-actions">{user.id !== currentUser.id && <button className="danger-button compact" disabled={busy} onClick={() => deleteUser(user.id, user.full_name)}>حذف</button>}</td></tr>)}</tbody></table></div>}</section></main>

  if (adminView === 'medicines' && currentUser?.role === 'admin') return <main className="app-shell"><AppCredit />{adminHeader}<section className="dashboard"><div className="section-heading"><div><p className="eyebrow">الأدوية</p><h1>إدارة الأدوية</h1><p>أضف دواءً، عدّل الاسم الإنجليزي أو العربي، أو احذفه. الاسم العربي يظهر في استمارة الحبوب.</p></div></div>{registrationsError && <p className="form-error" role="alert">{registrationsError}</p>}{adminSuccess && <p className="form-success" role="status">{adminSuccess}</p>}<form className="medicine-add-row" onSubmit={addMedicine}><input placeholder="اسم دواء جديد (إنجليزي)" value={newMedicine} onChange={(event) => setNewMedicine(event.target.value)} /><button className="primary-button compact" type="submit" disabled={busy || !newMedicine.trim()}>{busy ? 'جارٍ الإضافة…' : 'إضافة'}</button></form><input className="medicine-filter" placeholder="بحث في الأدوية…" value={medicineFilter} onChange={(event) => setMedicineFilter(event.target.value)} /><div className="table-frame"><table className="requests-table"><thead><tr><th>الاسم (إنجليزي)</th><th>الاسم بالعربية</th><th>إجراء</th></tr></thead><tbody>{adminMedicines.filter((item) => !medicineFilter.trim() || `${item.name} ${item.arabic_name || ''}`.toLowerCase().includes(medicineFilter.trim().toLowerCase())).map((item) => <MedicineRow key={`${item.id}:${item.name}:${item.arabic_name || ''}`} item={item} onSave={saveMedicine} onRemove={removeMedicine} busy={busy} />)}</tbody></table></div></section></main>

  const wardLabel = selected ? (selected.floor ? `الطابق ${selected.floor} - ${selected.ward}` : selected.ward) : ''
  if (selected && selected.mode === 'pills') return <main className="app-shell"><AppCredit /><header className="topbar"><button type="button" className="topbar-brand" onClick={goHome} aria-label="العودة إلى اختيار الطابق"><img className="hospital-logo header-logo" width="42" height="42" src={hospitalLogo} alt="" /><span><strong>الصيدلة السريرية</strong><small>مستشفى بغداد التعليمي</small></span></button><div className="user-menu"><ThemeToggle theme={theme} onToggle={toggleTheme} /><span>{currentUser?.fullName || 'مستخدم'}</span><button onClick={logout} className="text-button">تسجيل الخروج</button></div></header><section className="pills-page"><div className="chart-toolbar pills-toolbar"><button className="back-button" onClick={() => { flushPills(); setSelected(null) }}>→ العودة للردهات</button><div><p className="eyebrow">استمارة إعطاء الحبوب</p><h1>{wardLabel}</h1></div><div className="toolbar-actions"><label className="pills-date">التاريخ <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label><span aria-live="polite" className={(pillsSaveError || pillsLoadError) ? 'save-state save-state-error' : 'save-state'}>{pillsLoadError ? '⚠ تعذر تحميل الاستمارة — إعادة المحاولة…' : pillsSaveError ? '⚠ لم يُحفظ — تُعاد المحاولة…' : '● محفوظ تلقائيًا'}</span><button className="primary-button compact" onClick={() => window.print()}>طباعة</button></div></div>{pillsLoading ? <div className="empty-state"><span className="spinner" /><span>جارٍ تحميل الاستمارة…</span></div> : !pillsData ? <div className="empty-state"><strong>لا يوجد جارت لهذا اليوم</strong><span>سجّل جارت هذه الردهة أولًا، ثم ستُبنى استمارة الحبوب تلقائيًا.</span></div> : pillsData.patients.length === 0 ? <div className="empty-state"><strong>لا حبوب لعرضها</strong><span>لا يوجد مريض لديه علاج أقراص أو كبسولات (Tab / Cap) في جارت هذا اليوم.</span></div> : pillsData.patients.map((patient) => <article className="pill-form" key={patient.rowNumber}><div className="pill-form-head"><div className="pill-form-patient"><strong>{patient.name}</strong><span>{today}</span></div><label className="pill-room">رقم الغرفة <input value={pillRooms[patient.rowNumber] || ''} onChange={(event) => setPillRooms((current) => ({ ...current, [patient.rowNumber]: event.target.value }))} /></label><div className="pill-form-brand"><div className="pill-form-title"><strong>مستشفى بغداد التعليمي</strong><span>وحدة الصيدلة السريرية</span><span>{wardLabel}</span></div><img className="hospital-logo header-logo" width="42" height="42" src={hospitalLogo} alt="" /></div></div><div className="pill-table-scroll"><table className="pill-table"><thead><tr><th></th><th>العلاج</th><th>وقت الجرعة</th><th>طريقة الاستخدام</th><th>الملاحظات</th></tr></thead><tbody>{pillsData.medicines.filter((med) => (pillsData.matrix[patient.rowNumber] || []).includes(med.id)).map((med) => { const key = `${patient.rowNumber}:${med.id}`; const entry = pillEntries[key] || { doseTime: '', usageMethod: '', note: '' }; return <tr key={med.id}><td className="pill-lead-cell"></td><td>{med.arabicName || med.name}</td><td><PillSelect value={entry.doseTime} options={doseTimes} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, doseTime: nextValue } }))} /></td><td><PillSelect value={entry.usageMethod} options={usageMethods} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, usageMethod: nextValue } }))} /></td><td><PillSelect value={entry.note} options={noteOptions} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, note: nextValue } }))} /></td></tr> })}</tbody></table></div><div className="pill-form-foot"><span className="pill-sign">توقيع الصيدلاني السريري</span><span className="pill-edit-time">وقت التحرير: {editTime}</span></div></article>)}</section></main>

  return <main className="app-shell"><AppCredit /><header className="topbar"><button type="button" className="topbar-brand" onClick={goHome} aria-label="العودة إلى اختيار الطابق"><img className="hospital-logo header-logo" width="42" height="42" src={hospitalLogo} alt="" /><span><strong>الصيدلة السريرية</strong><small>مستشفى بغداد التعليمي</small></span></button><nav className="user-menu"><ThemeToggle theme={theme} onToggle={toggleTheme} />{currentUser?.role === 'admin' && <button className="text-button" onClick={() => setAdminView('requests')}>طلبات الانضمام</button>}{currentUser?.role === 'admin' && <button className="text-button" onClick={() => setAdminView('medicines')}>إدارة الأدوية</button>}{currentUser?.role === 'admin' && <button className="text-button" onClick={() => setAdminView('users')}>جميع المستخدمين</button>}<span>{currentUser?.fullName || 'مستخدم'}</span><button onClick={logout} className="text-button">تسجيل الخروج</button></nav></header>{!selected && !floor ? <section className="dashboard"><div className="section-heading"><div><p className="eyebrow">مساحة العمل اليومية</p><h1>اختر الطابق أو الردهة</h1><p>ابدأ باختيار موقع الجارت الذي تريد تسجيله أو مراجعته.</p></div><div className="date-chip"><span>اليوم</span><strong>{today}</strong></div></div><div className="location-grid">{floors.map((item) => <button className="location-card" key={item.number} onClick={() => setFloor(item)}><span className="floor-number">{item.number}</span><span><strong>الطابق {item.number}</strong><small>{item.wards.length} أروقة فرعية</small></span><span className="arrow">←</span></button>)}{specialWards.map((ward) => <div className="location-card special" key={ward}><span className="floor-number">✚</span><span><strong>{ward}</strong></span><span className="ward-card-actions"><button className="secondary-button compact" onClick={() => setSelected({ floor: null, ward, mode: 'chart' })}>الجارت</button><button className="primary-button compact" onClick={() => setSelected({ floor: null, ward, mode: 'pills' })}>الحبوب</button></span></div>)}</div></section> : !selected ? <section className="dashboard"><button className="back-button" onClick={() => setFloor(null)}>→ العودة للطوابق</button><div className="section-heading"><div><p className="eyebrow">الطابق {floor.number}</p><h1>اختر الردهة</h1><p>اختر «الجارت» لتسجيل الجرعات، أو «الحبوب» لاستمارة إعطاء الحبوب.</p></div></div><div className="location-grid">{floor.wards.map((ward) => <div className="location-card" key={ward}><span className="floor-number">{floor.number}</span><span><strong>{ward}</strong></span><span className="ward-card-actions"><button className="secondary-button compact" onClick={() => setSelected({ floor: floor.number, ward, mode: 'chart' })}>الجارت</button><button className="primary-button compact" onClick={() => setSelected({ floor: floor.number, ward, mode: 'pills' })}>الحبوب</button></span></div>)}</div></section> : <section className="chart-page"><div className="chart-toolbar"><button className="back-button" onClick={() => { flushChart(); setSelected(null) }}>→ العودة للردهات</button><div><p className="eyebrow">الجارت اليومي</p><h1>{wardLabel}</h1></div><div className="toolbar-actions">{currentUser?.role === 'admin' && <button className="secondary-button" onClick={() => { setRegistrationsError(''); setShowMedicineForm(true) }}>+ علاج جديد</button>}<button className="primary-button compact" onClick={() => window.print()}>طباعة A4</button></div></div><div className="chart-meta">{selected.floor && <span>الطابق: <b>{selected.floor}</b></span>}<span>الفرع: <b>{selected.ward}</b></span><span>التاريخ: <b>{today}</b></span><span aria-live="polite" className={(saveError || loadError) ? 'save-state save-state-error' : 'save-state'}>{loadError ? '⚠ تعذر تحميل الجارت — إعادة المحاولة…' : saveError ? '⚠ لم يُحفظ — تُعاد المحاولة…' : '● محفوظ تلقائيًا'}</span></div><datalist id="medicine-options">{medicines.map((medicine) => <option key={medicine} value={medicine} />)}</datalist><div className="active-patient-bar" aria-live="polite">{activeRow >= 0 ? <><span className="bar-item"><span className="bar-key">المريض</span><strong>{patientNames[activeRow]?.trim() || 'بلا اسم'}</strong><span className="bar-num">صف {activeRow + 1}</span></span>{activeColumn >= 0 && <span className="bar-item"><span className="bar-key">العلاج</span><strong>{columnMedicines[activeColumn]?.trim() || 'بلا اسم'}</strong><span className="bar-num">عمود {activeColumn + 1}</span></span>}</> : <span className="muted">اضغط داخل خلية ليظهر المريض والعلاج هنا</span>}</div><div className="chart-frame" ref={chartFrameRef}><div className="chart-head"><div className="chart-head-corner"><img className="patient-header-logo" src={hospitalLogo} alt="" /><span>مستشفى بغداد التعليمي</span><span>وحدة الصيدلة السريرية</span>{selected.floor && <span>الطابق {selected.floor}</span>}<span>{selected.ward}</span><span>{today}</span></div><div className="chart-head-scroll" ref={chartHeadRef}><table className="chart-table"><thead><tr>{Array.from({ length: CHART_COLUMNS }, (_, index) => <th key={index}><input className="medicine-select" list="medicine-options" value={columnMedicines[index]} onChange={(event) => setColumnMedicines((current) => current.map((medicine, medicineIndex) => medicineIndex === index ? event.target.value : medicine))} placeholder="دواء" title="اكتب أول حروف الدواء" /></th>)}</tr></thead></table></div></div><div className="chart-grid" ref={chartGridRef} onFocusCapture={(event) => { const row = event.target.closest('tr[data-row]'); if (row) setActiveRow(Number(row.dataset.row)); const cell = event.target.closest('td[data-col]'); setActiveColumn(cell ? Number(cell.dataset.col) : -1) }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setActiveRow(-1); setActiveColumn(-1) } }}><div className="chart-names"><table className="chart-table"><tbody>{patientNames.map((name, rowIndex) => <tr key={rowIndex} data-row={rowIndex} className={activeRow === rowIndex ? 'active-row' : undefined}><th className="patient-cell"><input value={name} onChange={(event) => setPatientNames((current) => current.map((patient, index) => index === rowIndex ? event.target.value : patient))} onFocus={() => { editingRowStart.current = { row: rowIndex, name } }} onBlur={() => { const start = editingRowStart.current; if (start.row === rowIndex && start.name.trim() && !name.trim()) collapseRow(rowIndex) }} placeholder={`مريض ${rowIndex + 1}`} /></th></tr>)}</tbody></table></div><div className="chart-doses" ref={chartDosesRef}><table className="chart-table"><tbody>{patientNames.map((name, rowIndex) => <tr key={rowIndex} data-row={rowIndex} className={activeRow === rowIndex ? 'active-row' : undefined}>{Array.from({ length: CHART_COLUMNS }, (_, columnIndex) => <td key={columnIndex} data-col={columnIndex}><input inputMode="numeric" pattern="[0-9]*" value={quantities[rowIndex][columnIndex]} onChange={(event) => updateQuantity(rowIndex, columnIndex, event.target.value)} /></td>)}</tr>)}</tbody></table></div></div><div className="chart-foot"><div className="chart-foot-corner">المجموع</div><div className="chart-foot-scroll" ref={chartFootRef}><table className="chart-table"><tfoot><tr>{totals.map((total, index) => <td key={index}>{total || ''}</td>)}</tr></tfoot></table></div></div></div>{showMedicineForm && <div className="modal-backdrop" onClick={() => setShowMedicineForm(false)}><form className="medicine-modal" role="dialog" aria-modal="true" aria-labelledby="add-medicine-title" onSubmit={addMedicine} onClick={(event) => event.stopPropagation()}><button type="button" className="close-button" aria-label="إغلاق" onClick={() => setShowMedicineForm(false)}>×</button><p className="eyebrow">قائمة الأدوية العامة</p><h2 id="add-medicine-title">إضافة علاج جديد</h2>{registrationsError && <p className="form-error" role="alert">{registrationsError}</p>}<label>اسم العلاج<input autoFocus value={newMedicine} onChange={(event) => setNewMedicine(event.target.value)} required /></label><button className="primary-button" type="submit">إضافة إلى القائمة</button></form></div>}</section>}</main>
}

export default App
