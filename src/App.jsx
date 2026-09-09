import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import hospitalLogo from './assets/hospital-logo.png'
import { roleLabels, PATIENT_ROWS, CHART_COLUMNS, apiUrl } from './constants.js'
import { mergeChartSnapshots, parseChartRows, toEnglishDigits, medicineKey, nearestMedicine, UNIT_ONE, isSyringe, VIAL_AMP, SYRINGE_EXCLUDE, isoDate, locationBody, pillEntryList } from './helpers.js'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import AppHeader from './components/AppHeader.jsx'
import LoginScreen from './screens/LoginScreen.jsx'
import RegisterScreen from './screens/RegisterScreen.jsx'
import SessionExpiredScreen from './screens/SessionExpiredScreen.jsx'
import AdminRequestsScreen from './screens/AdminRequestsScreen.jsx'
import AdminUsersScreen from './screens/AdminUsersScreen.jsx'
import AdminMedicinesScreen from './screens/AdminMedicinesScreen.jsx'
import AdminFloorsScreen from './screens/AdminFloorsScreen.jsx'
import PillsScreen from './screens/PillsScreen.jsx'
import FloorPickerScreen from './screens/FloorPickerScreen.jsx'
import WardPickerScreen from './screens/WardPickerScreen.jsx'
import ChartScreen from './screens/ChartScreen.jsx'
import './App.css'

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
  // The floor-picker dashboard: today's ward-status/top-medicines summary and the
  // manager's announcements. Loaded only while that screen is actually showing.
  const [dashboardData, setDashboardData] = useState(null)
  // Set when GET /api/dashboard fails or returns nothing. Without it, dashboardData === null
  // during a slow load renders as a real "0 wards started, no medicines" state — a false alarm
  // that looks identical to a genuine quiet day. dashboardReloadKey lets the retry button
  // re-run the loader effect below.
  const [dashboardError, setDashboardError] = useState(false)
  const [dashboardReloadKey, setDashboardReloadKey] = useState(0)
  const retryDashboard = useCallback(() => { setDashboardData(null); setDashboardError(false); setDashboardReloadKey((key) => key + 1) }, [])
  const [announcements, setAnnouncements] = useState([])
  const [announcementDraft, setAnnouncementDraft] = useState('')
  const [announcementError, setAnnouncementError] = useState('')
  const [announcementBusy, setAnnouncementBusy] = useState(false)
  // Manager-only window for the top-medicines widget (a plain user's is always the day).
  const [medicinesPeriod, setMedicinesPeriod] = useState('month')
  const [medicines, setMedicines] = useState([])
  const [columnMedicines, setColumnMedicines] = useState(() => Array(CHART_COLUMNS).fill(''))
  // Set when a chart column is left holding a name not in the catalogue:
  // { column, text, suggestion } — suggestion is a one-tap near-miss fix, or ''.
  const [columnMedicineNotice, setColumnMedicineNotice] = useState(null)
  const [showMedicineForm, setShowMedicineForm] = useState(false)
  // A styled stand-in for window.confirm — an alertdialog with a focus trap, Escape-to-cancel
  // and focus return (see ConfirmDialog). Call sites keep the exact
  // `if (!(await askConfirm(...))) return` shape a plain window.confirm() had; irreversible
  // ones pass `{ danger: true }` for the red confirm button.
  const [confirmDialog, setConfirmDialog] = useState(null)
  // opener: the control that raised the dialog, so focus can return to it on close instead of
  // falling to <body>. danger: turns the confirm button danger-styled for irreversible actions.
  const askConfirm = useCallback((message, { danger = false } = {}) => new Promise((resolve) => setConfirmDialog({ message, danger, opener: document.activeElement, resolve })), [])
  const resolveConfirm = useCallback((value) => { setConfirmDialog((current) => { current?.resolve(value); current?.opener?.focus?.(); return null }) }, [])
  // Set for one beat right after a real login succeeds, so the dashboard can dissolve in
  // instead of cutting to it instantly. Cleared on a timer rather than left mounted, so
  // navigating between the dashboard and the admin/chart/pills screens afterward — which all
  // share the same app-shell wrapper — never re-triggers it.
  const [justLoggedIn, setJustLoggedIn] = useState(false)
  // Row currently being typed into, for the patient banner above the grid. One state
  // change per focus move — far cheaper than the re-render every keystroke already costs.
  const [activeRow, setActiveRow] = useState(-1)
  const [activeColumn, setActiveColumn] = useState(-1)
  // The medicine label sits above the cell being typed into, or below it when that
  // cell is at the very top of the grid and there is no room above.
  const [labelBelow, setLabelBelow] = useState(false)
  const [newMedicine, setNewMedicine] = useState('')
  const [patientNames, setPatientNames] = useState(() => Array.from({ length: PATIENT_ROWS }, () => ''))
  const [quantities, setQuantities] = useState(() => Array.from({ length: PATIENT_ROWS }, () => Array(CHART_COLUMNS).fill('')))
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
  // The autosave lifecycle, shown verbatim in the chart's status line: 'pending' (edits not
  // yet flushed — the 1.2s debounce is running), 'saving' (a PUT is in flight), 'saved' (the
  // server has confirmed), 'error' (the PUT failed and is being retried). It starts at
  // 'saved' so a freshly loaded, untouched chart does not claim unsaved work.
  const [chartSaveStatus, setChartSaveStatus] = useState('saved')
  const [loadError, setLoadError] = useState(false)
  const [copyError, setCopyError] = useState(false)
  // Optimistic-concurrency bookkeeping for PUT /api/chart (see server/schema.sql's
  // daily_charts.version comment): the version last confirmed by the server, and the exact
  // snapshot that version corresponds to. On a 409, diffing the current grid against this
  // snapshot tells "edits made here since the last sync" apart from "edits made elsewhere
  // that haven't reached this tab yet" — the first kind survives a merge, the second adopts
  // the fresher server value, instead of one whole-chart snapshot silently winning over
  // the other on a shared iPad.
  const chartVersionRef = useRef(0)
  const lastSyncedChartRef = useRef({ patientNames: [], columnMedicines: [], quantities: [] })
  // Set by reconcileChartConflict after a cross-device merge: { changes }. Each change is a
  // per-field record of a cell this tab's value lost to another device. null while there is
  // nothing to acknowledge; unlike a transient notice it stays up until the pharmacist
  // resolves it. While it is set the grid is inert, so the panel behaves as a modal.
  const [chartConflict, setChartConflict] = useState(null)
  // The cell that had focus when a 409 arrived — captured before the grid goes inert (which
  // blurs it to <body>), restored after the panel closes.
  const conflictReturnFocusRef = useRef(null)
  const [pillsData, setPillsData] = useState(null)
  const [pillEntries, setPillEntries] = useState({})
  const [pillRooms, setPillRooms] = useState({})
  const [pillsLoading, setPillsLoading] = useState(false)
  const [loadedPillsKey, setLoadedPillsKey] = useState(null)
  // saved | pending (edited, debounce running) | saving (PUT in flight) | error — mirrors
  // chartSaveStatus so the pills toolbar chip can tell "saved" from "not saved yet".
  const [pillsSaveStatus, setPillsSaveStatus] = useState('saved')
  const [pillsLoadError, setPillsLoadError] = useState(false)
  // Which patients go on paper. Every form stays on screen either way — the unpicked ones
  // are only dropped from the printed output, so ticking a box never hides a patient's data.
  const [pillSelection, setPillSelection] = useState(() => new Set())
  const [printScope, setPrintScope] = useState('all')
  const togglePillPatient = useCallback((rowNumber) => setPillSelection((current) => {
    const next = new Set(current)
    if (next.has(rowNumber)) next.delete(rowNumber); else next.add(rowNumber)
    return next
  }), [])
  // window.print() reads the DOM synchronously, so the scope has to be committed before it
  // runs — a plain setState would still be queued and the browser would snapshot the previous
  // selection. flushSync commits it first, which is exactly what it is for.
  const startPillsPrint = useCallback((scope) => {
    flushSync(() => setPrintScope(scope))
    window.print()
    // window.print() is synchronous; once it returns the dialog is done, so the screen can
    // drop back to showing every card instead of staying filtered to the last print set.
    setPrintScope('all')
  }, [])
  const [adminMedicines, setAdminMedicines] = useState([])
  const [medicineFilter, setMedicineFilter] = useState('')
  // Floor-management screen: the bulk chart-purge form. purgeTargets holds floor numbers
  // and/or special-ward names; purgeAll overrides it with "every ward".
  const [purgeFrom, setPurgeFrom] = useState('')
  const [purgeTo, setPurgeTo] = useState('')
  const [purgeAll, setPurgeAll] = useState(false)
  const [purgeTargets, setPurgeTargets] = useState(() => new Set())
  // The session cookie lasts 8 hours. When it lapses the server answers 401, and the save
  // loop below used to retry a rejected request every 4 seconds forever while the pharmacist
  // carried on typing into a grid that could no longer be saved. Raising this instead swaps
  // the screen for a sign-in card without unmounting App, so the typed chart stays in state
  // and is saved the moment they are back in — rather than lost.
  // Two tiers of administration. isManager covers what a supervisor shares with the manager;
  // isAdmin gates the three things kept back — join requests, deleting users, and changing
  // roles. Hiding a control is presentation only: every one of these is enforced server-side.
  const isAdmin = currentUser?.role === 'admin'
  const isManager = isAdmin || currentUser?.role === 'supervisor'
  const [sessionExpired, setSessionExpired] = useState(false)
  const isExpired = useCallback((response) => {
    if (response.status !== 401) return false
    setSessionExpired(true)
    return true
  }, [])
  const today = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('ar-IQ')
  // The weekday the chart is for. Noon-anchored like `today` so it cannot slip a day.
  const todayWeekday = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('ar-IQ', { weekday: 'long' })
  // The chart defaults to today; the date picker can move it. When it is not today, the
  // status bar says so — a past-dated chart looks identical to the live one otherwise.
  const dateIsToday = selectedDate === isoDate(new Date())
  // Built from two calls on purpose: Intl throws a TypeError if `weekday` is combined with
  // `dateStyle`, so the day name has to be formatted separately and prefixed.
  // Frozen per loaded pill form, not recomputed every render — «وقت التحرير» on the printed
  // sheet should read the moment the form was opened for this ward/day, not "now".
  const editedAt = useMemo(() => new Date(), [loadedPillsKey])
  const editTime = `${editedAt.toLocaleDateString('ar-IQ', { weekday: 'long' })} ${editedAt.toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' })}`
  const totals = useMemo(() => quantities[0].map((_, columnIndex) => quantities.reduce((sum, row) => sum + (Number(row[columnIndex]) || 0), 0)), [quantities])
  // Friday is the weekend, so a chart dated Thursday is ordered for two days. Anchored at noon
  // like `today` above, so the weekday cannot slip a day across the timezone offset. It reads
  // the chart's own date, not the calendar's — reviewing Thursday's chart on Saturday still
  // shows the doubled row.
  const isThursday = new Date(`${selectedDate}T12:00:00`).getDay() === 4
  // Which columns behave specially, derived from whatever the pharmacist typed in the header.
  const specialColumns = useMemo(() => {
    const unit = [], syringe = [], vialAmp = []
    columnMedicines.forEach((name, index) => {
      if (!name.trim()) return
      const key = medicineKey(name)
      if (isSyringe(name)) syringe.push(index)
      else if (UNIT_ONE.test(key)) unit.push(index)
      // A syringe column is never also a source column, so it can never feed its own total.
      // Flagyl / Paracetamol are hung ready-mixed, so they are left out even though they are vials.
      else if (VIAL_AMP.test(key) && !SYRINGE_EXCLUDE.test(key)) vialAmp.push(index)
    })
    return { unit, syringe, vialAmp }
  }, [columnMedicines])

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
      setJustLoggedIn(true)
      // Back on the same screen with the same unsaved chart; the autosave effect resumes.
      setSessionExpired(false)
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
  const changeUserRole = useCallback(async (id, role, name) => {
    if (!(await askConfirm(`تغيير دور "${name}" إلى "${roleLabels[role]}"؟ سيُطلب منه تسجيل الدخول من جديد.`))) return
    setRegistrationsError(''); setAdminSuccess(''); setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/users/${id}/role`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ role }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر تغيير الدور')
      setAllUsers((current) => current.map((user) => user.id === id ? { ...user, role } : user))
      setAdminSuccess(`أصبح "${name}" ${roleLabels[role]}`)
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') } finally { setBusy(false) }
  }, [askConfirm])
  const deleteUser = useCallback(async (id, name) => {
    if (!(await askConfirm(`حذف المستخدم "${name}" نهائيًا؟`, { danger: true }))) return
    setRegistrationsError(''); setAdminSuccess(''); setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/users/${id}`, { method: 'DELETE', credentials: 'include' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر حذف المستخدم')
      setAllUsers((current) => current.filter((user) => user.id !== id))
      setAdminSuccess(`تم حذف المستخدم "${name}"`)
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') } finally { setBusy(false) }
  }, [askConfirm])
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
    if (!(await askConfirm(`حذف الدواء "${name}" من القائمة؟`, { danger: true }))) return
    setRegistrationsError(''); setAdminSuccess(''); setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/medicines/${id}`, { method: 'DELETE', credentials: 'include' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر حذف الدواء')
      setAdminMedicines((current) => current.filter((item) => item.id !== id))
      setAdminSuccess(`تم حذف "${name}"`)
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') } finally { setBusy(false) }
  }, [askConfirm])
  const togglePurgeTarget = useCallback((key) => setPurgeTargets((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  }), [])
  const purgeCharts = useCallback(async () => {
    if (!purgeFrom || !purgeTo) { setRegistrationsError('اختر تاريخ البداية والنهاية'); return }
    const floorNumbers = [...purgeTargets].filter((key) => typeof key === 'number')
    const wardNames = [...purgeTargets].filter((key) => typeof key === 'string')
    if (!purgeAll && floorNumbers.length === 0 && wardNames.length === 0) { setRegistrationsError('اختر طابقًا واحدًا على الأقل أو فعّل "كل الطوابق والردهات"'); return }
    const scopeText = purgeAll ? 'كل الطوابق والردهات' : `${floorNumbers.length + wardNames.length} موقعًا مختارًا`
    if (!(await askConfirm(`مسح جميع الجارتات من ${purgeFrom} إلى ${purgeTo} — ${scopeText}؟ لا يمكن التراجع عن هذا نهائيًا.`, { danger: true }))) return
    setRegistrationsError(''); setAdminSuccess(''); setBusy(true)
    try {
      const body = purgeAll ? { from: purgeFrom, to: purgeTo, all: true } : { from: purgeFrom, to: purgeTo, floors: floorNumbers, wards: wardNames }
      const response = await fetch(`${apiUrl}/charts/purge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر مسح الجارتات')
      setAdminSuccess(`تم مسح ${result.deleted} جارت`)
      setPurgeTargets(new Set())
      setPurgeAll(false)
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') } finally { setBusy(false) }
  }, [askConfirm, purgeAll, purgeFrom, purgeTo, purgeTargets])
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
  // Rewrite one row's syringe cells to the vial/amp total that row now carries. Called only
  // when a vial/amp cell actually changes, which is what lets a hand-typed syringe count
  // stand: nothing recalculates it until the quantities it is drawn from move.
  const applySyringeTotal = useCallback((row) => {
    const { syringe, vialAmp } = specialColumns
    if (!syringe.length) return row
    const total = vialAmp.reduce((sum, columnIndex) => sum + (Number(row[columnIndex]) || 0), 0)
    const next = [...row]
    syringe.forEach((columnIndex) => { next[columnIndex] = total ? String(total) : '' })
    return next
  }, [specialColumns])
  // useCallback (not just a plain function) matters here beyond the usual reasons: every
  // ChartDoseRow below is memoized specifically so that typing in one row leaves the other
  // 40 untouched, and a new function identity on every keystroke would pass a "changed" prop
  // to all of them and defeat that. specialColumns is keyed only on columnMedicines, not
  // quantities, so this stays referentially stable while someone is just typing numbers.
  const updateQuantity = useCallback((rowIndex, columnIndex, value) => setQuantities((current) => current.map((row, currentRow) => {
    if (currentRow !== rowIndex) return row
    const edited = row.map((quantity, currentColumn) => currentColumn === columnIndex ? toEnglishDigits(value).replace(/\D/g, '') : quantity)
    return specialColumns.vialAmp.includes(columnIndex) ? applySyringeTotal(edited) : edited
  })), [applySyringeTotal, specialColumns])
  // Choosing a medicine for a column seeds that column: a giving set or cannula gets 1 for
  // every patient already on the ward, a syringe gets each patient's vial/amp total. Derived
  // from the new header list rather than from specialColumns, which still describes the
  // previous one — otherwise a column switching from vial to syringe would count itself.
  const setColumnMedicine = useCallback((columnIndex, value) => {
    const nextMedicines = columnMedicines.map((medicine, index) => index === columnIndex ? value : medicine)
    setColumnMedicines(nextMedicines)
    const becameSyringe = isSyringe(value)
    const becameUnit = !becameSyringe && UNIT_ONE.test(medicineKey(value))
    if (!becameSyringe && !becameUnit) return
    const vialAmp = []
    nextMedicines.forEach((medicine, index) => {
      const key = medicineKey(medicine)
      if (medicine.trim() && !isSyringe(medicine) && VIAL_AMP.test(key) && !SYRINGE_EXCLUDE.test(key)) vialAmp.push(index)
    })
    setQuantities((current) => current.map((row, rowIndex) => {
      if (!patientNames[rowIndex]?.trim()) return row
      const next = [...row]
      if (becameUnit) {
        if (row[columnIndex]) return row
        next[columnIndex] = '1'
      } else {
        const total = vialAmp.reduce((sum, index) => sum + (Number(row[index]) || 0), 0)
        next[columnIndex] = total ? String(total) : ''
      }
      return next
    }))
  }, [columnMedicines, patientNames])
  // Called when a column-header cell loses focus. A column may only hold a medicine that is
  // already in the shared catalogue: an exact (case/space-insensitive) match is snapped to the
  // catalogue spelling, an empty cell is fine, and anything else is refused — the cell reverts
  // to whatever it held when it was focused and a notice explains why.
  const commitColumnMedicine = useCallback((columnIndex, rawValue, previousValue = '') => {
    const trimmed = toEnglishDigits(String(rawValue ?? '')).replace(/\s+/g, ' ').trim()
    if (!trimmed) { setColumnMedicineNotice(null); setColumnMedicine(columnIndex, ''); return }
    const match = medicines.find((name) => medicineKey(name) === medicineKey(trimmed))
    if (match) { setColumnMedicineNotice(null); setColumnMedicine(columnIndex, match); return }
    setColumnMedicineNotice({
      column: columnIndex,
      text: `العمود ${columnIndex + 1}: «${trimmed}» غير موجود في قائمة الأدوية — عاد العمود إلى دوائه السابق.`,
      suggestion: nearestMedicine(trimmed, medicines),
    })
    setColumnMedicine(columnIndex, previousValue)
  }, [medicines, setColumnMedicine])
  const applyMedicineSuggestion = useCallback((columnIndex, name) => {
    setColumnMedicineNotice(null)
    setColumnMedicine(columnIndex, name)
  }, [setColumnMedicine])
  // Naming a patient seeds the per-patient supplies for that row. Only on the empty -> named
  // transition, so clearing a seeded cell by hand and then correcting the spelling of the
  // name does not silently put the 1 back.
  const setPatientName = useCallback((rowIndex, value) => {
    const wasEmpty = !patientNames[rowIndex]?.trim()
    setPatientNames((current) => current.map((patient, index) => index === rowIndex ? value : patient))
    if (!wasEmpty || !value.trim() || !specialColumns.unit.length) return
    setQuantities((current) => current.map((row, index) => {
      if (index !== rowIndex) return row
      const next = [...row]
      specialColumns.unit.forEach((columnIndex) => { if (!next[columnIndex]) next[columnIndex] = '1' })
      return next
    }))
  }, [patientNames, specialColumns])
  // Remove a patient row and pull every following row up one, keeping the grid at PATIENT_ROWS.
  // Triggered only by the explicit ✕ on the active row, and gated by a confirm: this deletes
  // the patient's whole dose line and renumbers every row below it, and there is no undo.
  const collapseRow = useCallback(async (rowIndex) => {
    const label = patientNames[rowIndex]?.trim() || `مريض ${rowIndex + 1}`
    if (!(await askConfirm(`حذف صف «${label}»؟ ستُحذف كل جرعاته وستنتقل الصفوف التالية صفًّا واحدًا للأعلى — بلا تراجع.`, { danger: true }))) return
    setPatientNames((current) => { const next = current.filter((_, index) => index !== rowIndex); next.push(''); return next })
    setQuantities((current) => { const next = current.filter((_, index) => index !== rowIndex); next.push(Array(CHART_COLUMNS).fill('')); return next })
    // The ✕ that was just clicked has unmounted; without this focus falls to <body> right
    // after a destructive confirm. Land on the name of whoever moved up into this row.
    requestAnimationFrame(() => chartGridRef.current?.querySelector(`.chart-names tr[data-row="${rowIndex}"] input`)?.focus())
    // The pill form's dose times and room numbers are keyed by row number and live only on
    // the server, so they have to be pulled up by one as well. Left behind, they reattach to
    // whoever moves into the row — the next patient inherits the deleted one's room number.
    if (!selected || selected.mode === 'pills') return
    fetch(`${apiUrl}/chart/collapse-row`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ floor: selected.floor, ward: selected.ward, date: selectedDate, slot: selected.slot || 'main', rowNumber: rowIndex + 1 }),
    }).catch(() => undefined)
  }, [askConfirm, patientNames, selected, selectedDate])
  const buildChartBody = useCallback((date) => ({
    floor: selected?.floor ?? null,
    ward: selected?.ward,
    slot: selected?.slot ?? 'main',
    date,
    patients: patientNames.map((name, index) => ({ rowNumber: index + 1, name })),
    columns: columnMedicines.map((medicineName, index) => ({ columnNumber: index + 1, medicineName })),
    quantities: quantities.flatMap((row, rowIndex) => row.map((quantity, columnIndex) => quantity ? ({ rowNumber: rowIndex + 1, columnNumber: columnIndex + 1, quantity: Number(quantity) }) : [])),
    expectedVersion: chartVersionRef.current,
  }), [columnMedicines, patientNames, quantities, selected])
  // Called on a 409 from PUT /api/chart. Re-fetches the chart and, field by field, keeps this
  // client's value where it differs from lastSyncedChartRef (an edit made here since the last
  // sync) and otherwise adopts the fresh server value (an edit made elsewhere) — see the
  // comment on chartVersionRef above for why a plain overwrite in either direction is wrong.
  const reconcileChartConflict = useCallback(async (date) => {
    if (!selected) return
    const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date })
    const response = await fetch(`${apiUrl}/chart?${params}`, { credentials: 'include' })
    if (!response.ok) return
    const result = await response.json()
    const fresh = parseChartRows(result.chart)
    const mine = { patientNames, columnMedicines, quantities }
    const merged = mergeChartSnapshots(lastSyncedChartRef.current, mine, fresh)
    // Every field where the merge took another device's value instead of this tab's. Each
    // entry carries its coordinate and both values so the banner can offer a per-field
    // "keep mine" — `mine` gets written back on resolve, `theirs` is the merged (adopted) value.
    // `what` is the label, `coord` the صف/عمود reference kept in its own field so the label
    // can ellipsise without eating the one thing that tells two same-named patients apart.
    const changes = []
    merged.patientNames.forEach((name, row) => {
      if (name !== (mine.patientNames[row] ?? '')) changes.push({ kind: 'name', row, what: 'اسم المريض', coord: `صف ${row + 1}`, mine: mine.patientNames[row] || '', theirs: name || '' })
    })
    merged.columnMedicines.forEach((name, col) => {
      if (name !== (mine.columnMedicines[col] ?? '')) changes.push({ kind: 'medicine', col, what: 'دواء العمود', coord: `عمود ${col + 1}`, mine: mine.columnMedicines[col] || '', theirs: name || '' })
    })
    merged.quantities.forEach((cells, row) => cells.forEach((value, col) => {
      if (value === (mine.quantities[row]?.[col] ?? '')) return
      // Named by patient + medicine — the pharmacist should not have to count past 51 vertical
      // headers to find out whose dose another device changed.
      const who = merged.patientNames[row]?.trim() || mine.patientNames[row]?.trim() || `صف ${row + 1}`
      const drug = merged.columnMedicines[col]?.trim() || mine.columnMedicines[col]?.trim() || `عمود ${col + 1}`
      changes.push({ kind: 'quantity', row, col, what: `${who} — ${drug}`, coord: `صف ${row + 1}/عمود ${col + 1}`, mine: mine.quantities[row]?.[col] || '', theirs: value || '' })
    }))
    setPatientNames(merged.patientNames)
    setColumnMedicines(merged.columnMedicines)
    setQuantities(merged.quantities)
    chartVersionRef.current = result.chart ? result.chart.version : 0
    // The server truth is `fresh`, not `merged` — `merged` still holds this tab's own edits
    // that haven't been PUT yet. Leaving lastSynced at `fresh` keeps the grid "dirty" so the
    // autosave effect re-sends those edits against the now-current version (and only marks
    // them synced once that PUT returns 200).
    lastSyncedChartRef.current = fresh
    if (changes.length) {
      conflictReturnFocusRef.current = document.activeElement
      setChartConflict({ changes })
    }
  }, [columnMedicines, patientNames, quantities, selected])
  // After the merge panel closes and the grid un-inerts, hand focus back to the cell the
  // pharmacist was in — focusing the element (not just the coordinates) re-runs the grid's
  // onFocusCapture and restores the active row/column highlight.
  useEffect(() => {
    if (chartConflict) return
    const target = conflictReturnFocusRef.current
    conflictReturnFocusRef.current = null
    if (!target) return
    requestAnimationFrame(() => {
      const el = document.body.contains(target) && target !== document.body
        ? target
        : chartGridRef.current?.querySelector('td[data-col] input')
      el?.focus?.()
    })
  }, [chartConflict])
  // "تطبيق": accept the merge as shown, except for the fields the pharmacist ticked "keep mine"
  // on — those are written back to this tab's pre-merge value, and the autosave effect then
  // re-PUTs the corrected grid at the now-current version. Ticking none is a plain "reviewed".
  const resolveChartConflict = useCallback((keepMine) => {
    keepMine.forEach((change) => {
      if (change.kind === 'name') setPatientNames((current) => current.map((value, index) => index === change.row ? change.mine : value))
      else if (change.kind === 'medicine') setColumnMedicines((current) => current.map((value, index) => index === change.col ? change.mine : value))
      else setQuantities((current) => current.map((row, rowIndex) => rowIndex === change.row ? row.map((value, colIndex) => colIndex === change.col ? change.mine : value) : row))
    })
    setChartConflict(null)
  }, [])
  // Fire an immediate save (survives navigation / tab close) — only once the grid is loaded,
  // so we never overwrite unknown server state with a blank grid.
  const flushChart = useCallback(() => {
    if (!selected || selected.mode === 'pills' || !isLoggedIn) return
    if (loadedChartKey !== `${selected.floor || 'special'}-${selected.ward}-${selectedDate}-${selected.slot || 'main'}`) return
    try { fetch(`${apiUrl}/chart`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', keepalive: true, body: JSON.stringify(buildChartBody(selectedDate)) }) } catch { /* the debounced autosave or next visit will retry */ }
  }, [buildChartBody, isLoggedIn, loadedChartKey, selected, selectedDate])
  const flushPills = useCallback(() => {
    if (!selected || selected.mode !== 'pills' || !isLoggedIn || !pillsData) return
    if (loadedPillsKey !== `${selected.floor || 'special'}-${selected.ward}-${selectedDate}-${selected.slot || 'main'}`) return
    const entries = pillEntryList(pillEntries)
    try { fetch(`${apiUrl}/pills`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', keepalive: true, body: JSON.stringify({ floor: selected.floor, ward: selected.ward, slot: selected.slot || 'main', date: selectedDate, entries, rooms: pillRooms }) }) } catch { /* retry on next visit */ }
  }, [isLoggedIn, loadedPillsKey, pillEntries, pillRooms, pillsData, selected, selectedDate])
  const goHome = useCallback(() => {
    if (selected?.mode === 'pills') flushPills(); else flushChart()
    setSelected(null)
    setFloor(null)
    setAdminView(null)
  }, [selected, flushChart, flushPills])
  // Ending the session is the likeliest accidental tap on a shared iPad, so it keeps the
  // session-expired screen's promise: flush any debounced edits first, and if something still
  // is not confirmed saved, say so before tearing down — the work stays mirrored on this
  // device and re-saves on the next sign-in either way. Also clears the auth-screen state so
  // nothing stale flashes on the login/register card that comes next.
  const logout = useCallback(async () => {
    if (selected?.mode === 'pills') flushPills(); else flushChart()
    const unsaved = Boolean(selected) && (selected.mode === 'pills' ? pillsSaveStatus : chartSaveStatus) !== 'saved'
    if (unsaved && !(await askConfirm('لا يزال هناك ما لم يُحفَظ على الخادم. إن سجّلت الخروج الآن يبقى على هذا الجهاز ويُعاد حفظه فور دخولك من جديد. متابعة تسجيل الخروج؟'))) return
    try { await fetch(`${apiUrl}/auth/logout`, { method: 'POST', credentials: 'include' }) } catch { /* ignore network errors on logout */ }
    setIsLoggedIn(false)
    setCurrentUser(null)
    setAdminView(null)
    setFloor(null)
    setSelected(null)
    setSessionExpired(false)
    setAuthView('login')
    setCredentials({ username: '', password: '' })
    setLoginError('')
    setRegisterError('')
    setRegisterSuccess('')
    setRegisterForm({ fullName: '', username: '', phone: '', email: '', fingerprintNumber: '', password: '' })
    setAdminSuccess('')
    setRegistrationsError('')
  }, [selected, flushChart, flushPills, chartSaveStatus, pillsSaveStatus, askConfirm])
  // There is no router, so the tab title is the only cue for which screen is open.
  useEffect(() => {
    const base = 'وحدة الصيدلة السريرية'
    const wardName = selected ? (selected.floor ? `الطابق ${selected.floor} - ${selected.ward}` : selected.ward) : ''
    const ward = selected?.slot === 'extra' ? `${wardName} — إضافي` : wardName
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
  // "Export PDF" is the same print path — the chart's @media print rules already lay it out to
  // one A4 landscape sheet. All this adds is a sensible default filename: browsers seed the
  // "Save as PDF" name from document.title, so set a clean one, print, and let the title
  // effect above put the real title back on the next render (afterprint also restores it in
  // case nothing else re-renders).
  const exportChartPdf = useCallback(() => {
    if (!selected) return
    const ward = selected.floor ? `الطابق ${selected.floor} - ${selected.ward}` : selected.ward
    const previousTitle = document.title
    const kind = selected.slot === 'extra' ? 'جارت إضافي' : 'جارت'
    document.title = `${kind} ${ward} ${selectedDate}`.replace(/[\\/:*?"<>|]/g, '-')
    const restore = () => { document.title = previousTitle; window.removeEventListener('afterprint', restore) }
    window.addEventListener('afterprint', restore)
    window.print()
  }, [selected, selectedDate])
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

  // iOS Safari — the iPad this is used on — routinely never fires `beforeunload`: switching
  // apps, locking the screen or closing the tab can put the page straight into the back/forward
  // cache. `pagehide` and a hidden `visibilitychange` do fire there, so the last edits made
  // before the pharmacist walks away reach the server instead of being dropped.
  useEffect(() => {
    const handler = () => { if (selected?.mode === 'pills') flushPills(); else flushChart() }
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') handler() }
    window.addEventListener('beforeunload', handler)
    window.addEventListener('pagehide', handler)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('beforeunload', handler)
      window.removeEventListener('pagehide', handler)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [selected, flushChart, flushPills])

  useEffect(() => { if (isLoggedIn) loadMedicines() }, [isLoggedIn, loadMedicines])
  useEffect(() => {
    if (!selected || selected.mode === 'pills') return undefined
    loadMedicines()
    const timer = setInterval(loadMedicines, 60000)
    return () => clearInterval(timer)
  }, [selected, loadMedicines])

  // The floor-picker dashboard only — loaded while it's the screen actually showing, not
  // carried along while a chart or admin screen is open.
  useEffect(() => {
    // Also re-runs when adminView clears, so returning from a screen that changed things
    // (a chart purge, an announcement) lands on fresh numbers rather than the stale set.
    if (!isLoggedIn || floor || selected || adminView) return undefined
    let cancelled = false
    const date = isoDate(new Date())
    const periodQuery = isManager ? `&period=${medicinesPeriod}` : ''
    fetch(`${apiUrl}/dashboard?date=${date}${periodQuery}`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : null })
      .then((result) => {
        if (cancelled) return
        if (result) { setDashboardData(result); setDashboardError(false) } else setDashboardError(true)
      })
      .catch(() => { if (!cancelled) setDashboardError(true) })
    fetch(`${apiUrl}/announcements`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : null })
      .then((result) => { if (!cancelled && result) setAnnouncements(result.announcements) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [isLoggedIn, floor, selected, adminView, isExpired, isManager, medicinesPeriod, dashboardReloadKey])

  const postAnnouncement = useCallback(async () => {
    const message = announcementDraft.trim()
    if (!message) return
    setAnnouncementError('')
    setAnnouncementBusy(true)
    try {
      const response = await fetch(`${apiUrl}/announcements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ message }) })
      if (isExpired(response)) return
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر نشر الإعلان')
      setAnnouncements((current) => [result.announcement, ...current].slice(0, 5))
      setAnnouncementDraft('')
    } catch (error) { setAnnouncementError(error.message || 'تعذر الاتصال بالخادم') } finally { setAnnouncementBusy(false) }
  }, [announcementDraft, isExpired])
  const editAnnouncement = useCallback(async (id, message) => {
    const text = message.trim()
    if (!text) return false
    try {
      const response = await fetch(`${apiUrl}/announcements/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ message: text }) })
      if (isExpired(response) || !response.ok) return false
      const result = await response.json()
      setAnnouncements((current) => current.map((item) => (item.id === id ? result.announcement : item)))
      return true
    } catch { return false }
  }, [isExpired])
  const deleteAnnouncement = useCallback(async (id) => {
    if (!(await askConfirm('حذف هذا الإعلان؟', { danger: true }))) return
    try {
      const response = await fetch(`${apiUrl}/announcements/${id}`, { method: 'DELETE', credentials: 'include' })
      if (isExpired(response) || !response.ok) return
      setAnnouncements((current) => current.filter((item) => item.id !== id))
    } catch { /* the next dashboard visit will show the current list */ }
  }, [askConfirm, isExpired])

  useEffect(() => {
    if (!selected || selected.mode === 'pills') return undefined
    const chartKey = `${selected.floor || 'special'}-${selected.ward}-${selectedDate}-${selected.slot || 'main'}`
    const draftKey = `cpa-chart-draft:${chartKey}`
    setChartLoading(true)
    setLoadedChartKey(null)
    setChartSaveStatus('saved')
    setLoadError(false)
    setCopyError(false)
    let cancelled = false
    let retryTimer
    const load = async () => {
      try {
        const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date: selectedDate })
        const response = await fetch(`${apiUrl}/chart?${params}`, { credentials: 'include' })
        // Raise the sign-in card, then keep retrying: a load overwrites nothing that was
        // typed (the grid is still empty when the very first load is the one that fails),
        // so once they are signed back in the next attempt simply succeeds.
        isExpired(response)
        if (!response.ok) throw new Error('load failed')
        const result = await response.json()
        if (cancelled) return
        const fresh = parseChartRows(result.chart)
        // A draft left by a killed tab (see the localStorage-mirror effect below) may hold
        // edits that never reached the server. Merge it in exactly like a save conflict —
        // draft.base is what that earlier tab last knew the server had, so the same
        // field-by-field diff tells its real edits apart from values it just hadn't caught
        // up on yet.
        let draft = null
        try {
          const raw = localStorage.getItem(draftKey)
          if (raw) draft = JSON.parse(raw)
        } catch { /* storage unavailable or the draft was corrupt — fall back to the server state */ }
        const next = draft ? mergeChartSnapshots(draft.base, draft.current, fresh) : fresh
        setPatientNames(next.patientNames); setQuantities(next.quantities); setColumnMedicines(next.columnMedicines)
        chartVersionRef.current = result.chart ? result.chart.version : 0
        // Always the server snapshot, not `next`: a recovered draft is still unsaved until the
        // next PUT actually succeeds, so it must still read as "pending" if that save 409s.
        lastSyncedChartRef.current = fresh
        if (draft) { try { localStorage.removeItem(draftKey) } catch { /* best effort */ } }
        setChartConflict(null)
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
  }, [selected, selectedDate, isExpired])
  // Mirrors the live grid to localStorage so a killed tab (not just a backgrounded one —
  // pagehide/visibilitychange below cover that) doesn't lose whatever hadn't reached the
  // server yet. `base` is the last state this tab knows was actually saved, so the load
  // effect's merge can tell a real edit apart from a stale copy of old server data.
  useEffect(() => {
    const chartKey = selected ? `${selected.floor || 'special'}-${selected.ward}-${selectedDate}-${selected.slot || 'main'}` : null
    if (!selected || selected.mode === 'pills' || loadedChartKey !== chartKey) return undefined
    try {
      localStorage.setItem(`cpa-chart-draft:${chartKey}`, JSON.stringify({ base: lastSyncedChartRef.current, current: { patientNames, columnMedicines, quantities } }))
    } catch { /* storage unavailable or full — the network autosave is still the source of truth */ }
    return undefined
  }, [columnMedicines, loadedChartKey, patientNames, quantities, selected, selectedDate])

  useEffect(() => {
    const chartKey = selected ? `${selected.floor || 'special'}-${selected.ward}-${selectedDate}-${selected.slot || 'main'}` : null
    // Holding off while the session is expired is what stops the 4-second retry loop. The
    // effect re-runs when it clears, which saves everything typed in the meantime.
    if (!selected || selected.mode === 'pills' || !isLoggedIn || sessionExpired || chartLoading || loadedChartKey !== chartKey) return undefined
    // Only claim "unsaved" when the grid actually differs from what the server last confirmed;
    // the effect also re-runs on navigation-shaped dep changes that carry no real edit.
    const synced = lastSyncedChartRef.current
    const dirty = JSON.stringify(patientNames) !== JSON.stringify(synced.patientNames)
      || JSON.stringify(columnMedicines) !== JSON.stringify(synced.columnMedicines)
      || JSON.stringify(quantities) !== JSON.stringify(synced.quantities)
    // Nothing changed since the last confirmed save (the effect also re-runs on navigation-
    // shaped dep changes): don't re-PUT identical data — it would only bump the row version
    // and make other open tabs 409 for no reason.
    if (!dirty) return undefined
    setChartSaveStatus('pending')
    let retryTimer
    const save = async () => {
      setChartSaveStatus('saving')
      try {
        const response = await fetch(`${apiUrl}/chart`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(buildChartBody(selectedDate)) })
        if (isExpired(response)) return
        // Someone else's save landed since this tab last synced. reconcileChartConflict
        // already merged the fresh server state with this tab's own pending edits and
        // updated chartVersionRef, so retrying almost immediately (not the 4s network-error
        // backoff below) resends exactly those edits against the now-current version.
        if (response.status === 409) {
          await reconcileChartConflict(selectedDate)
          retryTimer = setTimeout(save, 400)
          return
        }
        if (!response.ok) throw new Error('save failed')
        const result = await response.json()
        chartVersionRef.current = result.version
        lastSyncedChartRef.current = { patientNames, columnMedicines, quantities }
        // Everything the localStorage mirror was protecting has now actually reached the
        // server — an empty draft is indistinguishable from no draft, so just drop it.
        try { localStorage.removeItem(`cpa-chart-draft:${chartKey}`) } catch { /* best effort */ }
        setChartSaveStatus('saved')
      } catch {
        setChartSaveStatus('error')
        retryTimer = setTimeout(save, 4000)
      }
    }
    const timer = setTimeout(save, 1200)
    return () => { clearTimeout(timer); clearTimeout(retryTimer) }
  }, [buildChartBody, chartLoading, columnMedicines, isExpired, isLoggedIn, loadedChartKey, patientNames, quantities, reconcileChartConflict, selected, selectedDate, sessionExpired])

  useEffect(() => {
    if (!selected || selected.mode !== 'pills') return undefined
    const pillsKey = `${selected.floor || 'special'}-${selected.ward}-${selectedDate}-${selected.slot || 'main'}`
    setPillsLoading(true)
    setLoadedPillsKey(null)
    setPillsSaveStatus('saved')
    setPillsLoadError(false)
    // A different ward or day is a different set of patients — carrying ticks across would
    // silently print the wrong people.
    setPillSelection(new Set())
    setPrintScope('all')
    let cancelled = false
    let retryTimer
    const load = async () => {
      try {
        const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date: selectedDate })
        const response = await fetch(`${apiUrl}/pills?${params}`, { credentials: 'include' })
        isExpired(response)
        if (!response.ok) throw new Error('load failed')
        const result = await response.json()
        if (cancelled) return
        setPillsData(result.pills || null)
        const seed = {}
        ;(result.pills?.entries || []).forEach((entry) => { seed[`${entry.patientRowNumber}:${entry.medicineKey}`] = { doseTime: entry.doseTime || '', usageMethod: entry.usageMethod || '', note: entry.note || '', pillQty: entry.pillQty || '', pillName: entry.pillName || '' } })
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
  }, [selected, selectedDate, isExpired])

  useEffect(() => {
    if (!selected || selected.mode !== 'pills' || !isLoggedIn || sessionExpired || pillsLoading) return undefined
    const pillsKey = `${selected.floor || 'special'}-${selected.ward}-${selectedDate}-${selected.slot || 'main'}`
    if (loadedPillsKey !== pillsKey || !pillsData) return undefined
    let retryTimer
    const save = async () => {
      const entries = pillEntryList(pillEntries)
      try {
        setPillsSaveStatus('saving')
        const response = await fetch(`${apiUrl}/pills`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ floor: selected.floor, ward: selected.ward, slot: selected.slot || 'main', date: selectedDate, entries, rooms: pillRooms }) })
        if (isExpired(response)) return
        if (!response.ok) throw new Error('save failed')
        setPillsSaveStatus('saved')
      } catch {
        setPillsSaveStatus('error')
        retryTimer = setTimeout(save, 4000)
      }
    }
    setPillsSaveStatus('pending')
    const timer = setTimeout(save, 1200)
    return () => { clearTimeout(timer); clearTimeout(retryTimer) }
  }, [isExpired, isLoggedIn, loadedPillsKey, pillEntries, pillRooms, pillsData, pillsLoading, selected, selectedDate, sessionExpired])

  const changeDate = useCallback((nextDate) => {
    flushChart()
    setSelectedDate(nextDate)
  }, [flushChart])
  const copyToNextDay = useCallback(async () => {
    const nextDate = isoDate(new Date(`${selectedDate}T12:00:00`).getTime() + 86400000)
    if (!(await askConfirm(`نسخ جارت ${today} إلى اليوم التالي؟ سيُستبدل أي جارت محفوظ في ذلك اليوم.`))) return
    setCopyError(false)
    flushChart()
    try {
      if (!selected) throw new Error('copy failed')
      // This intentionally overwrites whatever is already on nextDate (the confirmation
      // above says so), so expectedVersion has to match THAT chart, not chartVersionRef —
      // which is still tracking the chart being copied FROM. Fetching it fresh keeps the
      // overwrite version-gated too: a genuine concurrent edit on nextDate in the moment
      // between this GET and the PUT below still 409s instead of silently being discarded.
      const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date: nextDate })
      const targetResponse = await fetch(`${apiUrl}/chart?${params}`, { credentials: 'include' })
      const targetResult = targetResponse.ok ? await targetResponse.json() : { chart: null }
      const body = { ...buildChartBody(nextDate), expectedVersion: targetResult.chart ? targetResult.chart.version : 0 }
      const response = await fetch(`${apiUrl}/chart`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
      if (!response.ok) throw new Error('copy failed')
      setSelectedDate(nextDate)
    } catch { setCopyError(true) }
  }, [askConfirm, buildChartBody, flushChart, selected, selectedDate, today])

  // Keep the latest handlers in refs. They are rebuilt on every patientNames change
  // (via buildChartBody -> flushChart), and depending on them directly made the effect
  // below tear down and re-create its DOM node on every single keystroke — a full
  // reflow of a 2756px table with 2000+ inputs, which is what smeared the sticky
  // patient column. The effect now only re-runs when the ward or date actually changes.
  // Keep the three strips on the same column. Whichever one the pharmacist drags leads and
  // the other two follow, so the header scrolls under a finger just like the quantities do.
  //
  // An echo is recognised by its value, not by a timer. Writing scrollLeft to a pane makes
  // it fire a scroll event of its own, and the browser delivers that asynchronously — a
  // frame or more later. A lock released on requestAnimationFrame is therefore already open
  // when the echo lands, so the header would become the leader and write back into the
  // doses pane in the middle of the user's momentum scroll, snatching it. Comparing against
  // the last value we published drops those echoes however late they arrive. The 0.5px
  // tolerance is because scrollLeft is fractional and a write can settle a hair away from
  // what we asked for, which would otherwise read as a fresh scroll and restart the fight.
  //
  // Also publish the width the vertical scrollbar steals from the body, so the strips
  // outside it reserve the same amount — otherwise every column sits off its own header on
  // platforms that give scrollbars width.
  useEffect(() => {
    const doses = chartDosesRef.current
    const grid = chartGridRef.current
    const frame = chartFrameRef.current
    if (!doses || !grid || !frame) return undefined
    const panes = [chartHeadRef.current, doses, chartFootRef.current].filter(Boolean)
    let lastLeft = null
    let pending = 0
    const propagate = (source) => {
      pending = 0
      const left = source.scrollLeft
      if (lastLeft !== null && Math.abs(left - lastLeft) < 0.5) return
      lastLeft = left
      panes.forEach((pane) => { if (pane !== source && Math.abs(pane.scrollLeft - left) >= 0.5) pane.scrollLeft = left })
    }
    // At most one write per frame; scroll events arrive faster than frames do.
    const follow = (source) => () => {
      if (pending) return
      pending = requestAnimationFrame(() => propagate(source))
    }
    const handlers = panes.map((pane) => [pane, follow(pane)])
    handlers.forEach(([pane, handler]) => pane.addEventListener('scroll', handler, { passive: true }))
    const measureGutter = () => frame.style.setProperty('--chart-gutter', `${grid.offsetWidth - grid.clientWidth}px`)
    window.addEventListener('resize', measureGutter)
    panes.forEach((pane) => { if (pane !== doses) pane.scrollLeft = doses.scrollLeft })
    lastLeft = doses.scrollLeft
    measureGutter()
    return () => {
      if (pending) cancelAnimationFrame(pending)
      handlers.forEach(([pane, handler]) => pane.removeEventListener('scroll', handler))
      window.removeEventListener('resize', measureGutter)
    }
    // sessionExpired: the sign-in card replaces the chart, so coming back builds new strip
    // elements. Without re-running, these listeners stay bound to the discarded ones and the
    // three strips no longer scroll together.
  }, [selected, sessionExpired])

  useEffect(() => {
    // The floor-number filter is the floor picker's job only. On the ward picker (a floor is
    // selected) the same `.location-card:not(.special)` selector matches ward cards whose
    // `.floor-number` is a glyph, not a number — so keep them all shown; the user already
    // cleared the floor gate to reach them.
    document.querySelectorAll('.location-card:not(.special)').forEach((card) => {
      if (floor) { card.hidden = false; return }
      const number = Number(card.querySelector('.floor-number')?.textContent)
      card.hidden = !isManager && number !== currentUser?.assignedFloor
    })
    document.querySelectorAll('.location-card.special').forEach((card) => {
      const wardName = card.querySelector('strong')?.textContent
      card.hidden = !isManager && !(currentUser?.assignedWards || []).includes(wardName)
    })
  }, [currentUser, isManager, floor, selected])
  useEffect(() => {
    if (!showMedicineForm) return undefined
    const opener = document.activeElement
    const onKey = (event) => { if (event.key === 'Escape') setShowMedicineForm(false) }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); opener?.focus?.() }
  }, [showMedicineForm])
  useEffect(() => {
    if (!justLoggedIn) return undefined
    // Matches .login-dissolve's animation: .7s duration + .15s delay.
    const timer = setTimeout(() => setJustLoggedIn(false), 850)
    return () => clearTimeout(timer)
  }, [justLoggedIn])

  // Rendered by every screen that can raise it, not just the chart. askConfirm() is also
  // called from the users and medicines screens, and a dialog whose JSX never renders leaves
  // its promise pending forever: the click silently does nothing, and the dialog then ambushes
  // whichever screen the pharmacist opens next — confirming there runs the delete they had
  // already given up on, in a completely unrelated context.
  const confirmModal = <ConfirmDialog dialog={confirmDialog} onResolve={resolveConfirm} />

  if (!isLoggedIn && authView === 'register') return <RegisterScreen registerForm={registerForm} setRegisterForm={setRegisterForm} registerError={registerError} registerSuccess={registerSuccess} busy={busy} onSubmit={submitRegister} onBackToLogin={() => { setAuthView('login'); setRegisterError(''); setRegisterSuccess('') }} confirmModal={confirmModal} />

  if (!isLoggedIn) return <LoginScreen credentials={credentials} setCredentials={setCredentials} loginError={loginError} busy={busy} onSubmit={submitLogin} onGoToRegister={() => { setAuthView('register'); setLoginError('') }} confirmModal={confirmModal} />

  if (sessionExpired) return <SessionExpiredScreen credentials={credentials} setCredentials={setCredentials} loginError={loginError} busy={busy} onSubmit={submitLogin} onLogout={logout} confirmModal={confirmModal} />

  const appHeader = <AppHeader theme={theme} onToggleTheme={toggleTheme} currentUser={currentUser} onLogout={logout} onHome={goHome} isAdmin={isAdmin} isManager={isManager} adminView={adminView} onNavigate={setAdminView} />

  if (adminView === 'requests' && isAdmin) return <AdminRequestsScreen adminHeader={appHeader} registrations={registrations} registrationsError={registrationsError} adminSuccess={adminSuccess} pendingFloor={pendingFloor} setPendingFloor={setPendingFloor} busy={busy} onReload={loadRegistrations} onApprove={approveRegistration} onReject={rejectRegistration} confirmModal={confirmModal} />

  if (adminView === 'users' && isManager) return <AdminUsersScreen adminHeader={appHeader} allUsers={allUsers} currentUser={currentUser} isAdmin={isAdmin} registrationsError={registrationsError} adminSuccess={adminSuccess} busy={busy} onReload={loadUsers} onChangeRole={changeUserRole} onAssignLocation={assignLocationToUser} onDeleteUser={deleteUser} confirmModal={confirmModal} />

  if (adminView === 'floors' && isManager) return <AdminFloorsScreen adminHeader={appHeader} purgeFrom={purgeFrom} setPurgeFrom={setPurgeFrom} purgeTo={purgeTo} setPurgeTo={setPurgeTo} purgeAll={purgeAll} setPurgeAll={setPurgeAll} purgeTargets={purgeTargets} onToggleTarget={togglePurgeTarget} busy={busy} registrationsError={registrationsError} adminSuccess={adminSuccess} onPurge={purgeCharts} confirmModal={confirmModal} />

  // adminMedicines holds the catalogue exactly as the server returned it, so its length is
  // the number of rows in the database; the filter only narrows what the table draws.
  const medicineSearch = medicineFilter.trim().toLowerCase()
  const visibleMedicines = adminMedicines.filter((item) => !medicineSearch || `${item.name} ${item.arabic_name || ''}`.toLowerCase().includes(medicineSearch))
  if (adminView === 'medicines' && isManager) return <AdminMedicinesScreen adminHeader={appHeader} adminMedicines={adminMedicines} visibleMedicines={visibleMedicines} medicineSearch={medicineSearch} medicineFilter={medicineFilter} setMedicineFilter={setMedicineFilter} newMedicine={newMedicine} setNewMedicine={setNewMedicine} registrationsError={registrationsError} adminSuccess={adminSuccess} busy={busy} onAddMedicine={addMedicine} onSaveMedicine={saveMedicine} onRemoveMedicine={removeMedicine} confirmModal={confirmModal} />

  const wardLabel = selected
    ? `${selected.floor ? `الطابق ${selected.floor} - ${selected.ward}` : selected.ward}${selected.slot === 'extra' ? ' — إضافي' : ''}`
    : ''
  // True once THIS ward+date's chart has finished loading. Until then the grid is covered and
  // made inert, so a slow or failed load cannot be typed into and then silently overwritten.
  const chartReadyKey = selected && selected.mode !== 'pills' ? `${selected.floor || 'special'}-${selected.ward}-${selectedDate}-${selected.slot || 'main'}` : null
  const chartReady = chartReadyKey !== null && loadedChartKey === chartReadyKey
  // The last form that actually prints must not force a page break after itself, or the job
  // ends on a blank sheet. Which form that is depends on the selection, so :last-child cannot
  // express it — a hidden last patient would leave the break on the one before it.
  const printingRows = (pillsData?.patients || []).filter((patient) => printScope === 'all' || pillSelection.has(patient.rowNumber)).map((patient) => patient.rowNumber)
  const lastPrintingRow = printingRows[printingRows.length - 1]
  if (selected && selected.mode === 'pills') return <PillsScreen header={appHeader} wardLabel={wardLabel} today={today} editTime={editTime} onBack={() => { flushPills(); setSelected(null) }} selectedDate={selectedDate} onChangeDate={setSelectedDate} pillsLoading={pillsLoading} pillsData={pillsData} pillsSaveStatus={pillsSaveStatus} pillsLoadError={pillsLoadError} pillEntries={pillEntries} setPillEntries={setPillEntries} pillRooms={pillRooms} setPillRooms={setPillRooms} pillSelection={pillSelection} onTogglePatient={togglePillPatient} printScope={printScope} lastPrintingRow={lastPrintingRow} onPrint={startPillsPrint} confirmModal={confirmModal} />

  return <main className="app-shell">{appHeader}{justLoggedIn && <div className="login-dissolve" aria-hidden="true"><img className="login-dissolve-logo" src={hospitalLogo} alt="" /><p className="login-dissolve-title">الصيدلة السريرية</p></div>}{!selected && !floor ? <FloorPickerScreen today={today} onPickFloor={setFloor} onOpen={setSelected} dashboard={dashboardData} dashboardLoading={dashboardData === null && !dashboardError} dashboardError={dashboardError} onRetryDashboard={retryDashboard} announcements={announcements} isManager={isManager} medicinesPeriod={medicinesPeriod} setMedicinesPeriod={setMedicinesPeriod} announcementDraft={announcementDraft} setAnnouncementDraft={setAnnouncementDraft} announcementError={announcementError} announcementBusy={announcementBusy} onPostAnnouncement={postAnnouncement} onEditAnnouncement={editAnnouncement} onDeleteAnnouncement={deleteAnnouncement} /> : !selected ? <WardPickerScreen floor={floor} today={today} dashboard={dashboardData} dashboardError={dashboardError} onBack={() => setFloor(null)} onOpen={setSelected} /> :<ChartScreen selected={selected} wardLabel={wardLabel} today={today} todayWeekday={todayWeekday} isManager={isManager} onBack={() => { flushChart(); setSelected(null) }} onGoToPills={() => { flushChart(); setSelected({ ...selected, mode: 'pills' }) }} onExportPdf={exportChartPdf} dateIsToday={dateIsToday} selectedDate={selectedDate} onChangeDate={changeDate} onCopyToNextDay={copyToNextDay} chartSaveStatus={chartSaveStatus} loadError={loadError} copyError={copyError} chartReady={chartReady} chartConflict={chartConflict} onResolveConflict={resolveChartConflict} medicines={medicines} patientNames={patientNames} columnMedicines={columnMedicines} quantities={quantities} totals={totals} isThursday={isThursday} activeRow={activeRow} activeColumn={activeColumn} labelBelow={labelBelow} setActiveRow={setActiveRow} setActiveColumn={setActiveColumn} setLabelBelow={setLabelBelow} onSetColumnMedicine={setColumnMedicine} onCommitColumnMedicine={commitColumnMedicine} columnMedicineNotice={columnMedicineNotice} onDismissNotice={() => setColumnMedicineNotice(null)} onApplySuggestion={applyMedicineSuggestion} onSetPatientName={setPatientName} onUpdateQuantity={updateQuantity} onCollapseRow={collapseRow} chartFrameRef={chartFrameRef} chartHeadRef={chartHeadRef} chartGridRef={chartGridRef} chartDosesRef={chartDosesRef} chartFootRef={chartFootRef} showMedicineForm={showMedicineForm} onOpenMedicineForm={() => { setRegistrationsError(''); setShowMedicineForm(true) }} onCloseMedicineForm={() => setShowMedicineForm(false)} onAddMedicine={addMedicine} newMedicine={newMedicine} setNewMedicine={setNewMedicine} registrationsError={registrationsError} />}{confirmModal}</main>
}

export default App
