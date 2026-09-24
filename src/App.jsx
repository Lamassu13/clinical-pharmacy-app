import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { roleLabels, PATIENT_ROWS, CHART_COLUMNS, MAX_CHART_COLUMNS, apiUrl, floors, specialWards } from './constants.js'
import { mergeChartSnapshots, diffMergeOutcome, mergeKeyedSnapshots, diffKeyedMergeOutcome, enqueueExtraPillsOp, applyExtraPillsQueue, blankExtraPillForm, parseChartRows, toEnglishDigits, medicineKey, patientNameKey, nearestMedicine, UNIT_ONE, isSyringe, VIAL_AMP, SYRINGE_EXCLUDE, isoDate, isDraftStale, locationBody, pillEntryList } from './helpers.js'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import CopyChartDialog from './components/CopyChartDialog.jsx'
import AppHeader from './components/AppHeader.jsx'
import LoginScreen from './screens/LoginScreen.jsx'
import RegisterScreen from './screens/RegisterScreen.jsx'
import SessionExpiredScreen from './screens/SessionExpiredScreen.jsx'
import AdminDashboardScreen from './screens/AdminDashboardScreen.jsx'
import AdminRequestsScreen from './screens/AdminRequestsScreen.jsx'
import AdminUsersScreen from './screens/AdminUsersScreen.jsx'
import AdminMedicinesScreen from './screens/AdminMedicinesScreen.jsx'
import AdminFloorsScreen from './screens/AdminFloorsScreen.jsx'
import TreatmentFormsScreen from './screens/TreatmentFormsScreen.jsx'
import ProfileScreen from './screens/ProfileScreen.jsx'
import ReportsScreen from './screens/ReportsScreen.jsx'
import PillsScreen from './screens/PillsScreen.jsx'
import OrderScreen from './screens/OrderScreen.jsx'
import ExtraPillsScreen from './screens/ExtraPillsScreen.jsx'
import FloorPickerScreen from './screens/FloorPickerScreen.jsx'
import WardPickerScreen from './screens/WardPickerScreen.jsx'
import ChartScreen from './screens/ChartScreen.jsx'
import ChartPrintTemplate from './components/ChartPrintTemplate.jsx'
import './App.css'

// True while this tab is in the foreground. The polling effects below gate on it so a
// backgrounded or screen-locked iPad stops hitting the server (and the Neon compute endpoint)
// every few seconds — it has nothing to show until it's looked at again.
function useDocumentVisible() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

// True while the browser reports connectivity. Drives the one top-level "غير متصل" banner and
// lets the extra-pills queue (which has no fixed retry timer of its own — see below) flush the
// instant the network returns instead of waiting for the next screen visit.
function useOnlineStatus() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])
  return online
}

// استمارة الحبوب الإضافي has no chart-style version/lock machinery on the server (every PUT
// just overwrites), so unlike chart/pills there's nothing to merge — only one offline write
// per form is ever queued at a time (see enqueueExtraPillsOp), stored here keyed by ward so a
// reload before reconnecting doesn't lose it.
const extraPillsQueueKey = (floorValue, ward) => `cpa-extra-pills-queue:${floorValue || 'special'}-${ward}`
const readExtraPillsQueue = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] } }
const writeExtraPillsQueue = (key, queue) => {
  try { if (queue.length) localStorage.setItem(key, JSON.stringify(queue)); else localStorage.removeItem(key) } catch { /* best effort */ }
}
// Identifies one ward/day/slot — the loaded-chart/pills guards and localStorage draft keys.
const wardKey = (selected, date) => `${selected.floor || 'special'}-${selected.ward}-${date}-${selected.slot || 'main'}`
function App() {
  const documentVisible = useDocumentVisible()
  const isOnline = useOnlineStatus()
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [authView, setAuthView] = useState('login')
  const [credentials, setCredentials] = useState({ username: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [registerForm, setRegisterForm] = useState({ fullName: '', username: '', phone: '', email: '', fingerprintNumber: '', password: '' })
  const [registerError, setRegisterError] = useState('')
  const [registerSuccess, setRegisterSuccess] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [profileForm, setProfileForm] = useState({ fullName: '', email: '', phone: '' })
  const [profileError, setProfileError] = useState('')
  const [profileSuccess, setProfileSuccess] = useState('')
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
  // The manager-chosen from/to range for the patients-by-floor×date table on لوحة التحكم.
  // No default (like purgeFrom/purgeTo below) — the table shows a prompt until both are set.
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
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
  // "نسخ إلى اليوم التالي" needs a real three-way choice (cancel / copy everything / copy only
  // the medicine list), not askConfirm's yes/no — resolves to 'all' | 'medicines' | null.
  const [copyChoiceDialog, setCopyChoiceDialog] = useState(null)
  const askCopyChoice = useCallback((message, { danger = false } = {}) => new Promise((resolve) => setCopyChoiceDialog({ message, danger, opener: document.activeElement, resolve })), [])
  const resolveCopyChoice = useCallback((value) => { setCopyChoiceDialog((current) => { current?.resolve(value); current?.opener?.focus?.(); return null }) }, [])
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
  // The off-screen export render (ChartPrintTemplate) — always mounted alongside the live
  // chart so exportChartPdf can rasterize it immediately with no separate mount/wait step.
  // Cheap to keep around: plain text cells, not 2000+ live inputs like the editable grid.
  const printTemplateRef = useRef(null)
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
  // Wall-clock time of the last PUT this tab got a 200 for — shown as "آخر حفظ HH:MM" so a
  // pharmacist handing over the shared iPad can tell whether their edits synced. null until
  // this tab has actually confirmed a save (a fresh load does not set it).
  const [lastChartSaveAt, setLastChartSaveAt] = useState(null)
  // The pharmacist's own "اكتملت الجارت" mark — server-authoritative (GET /chart is the source
  // of truth), cleared automatically the moment a real edit follows (see noteChartEdit).
  const [chartCompleted, setChartCompleted] = useState(false)
  const [completedByName, setCompletedByName] = useState(null)
  // Bumped by the "إعادة المحاولة الآن" buttons on the load-error cover and the save-error
  // chip: re-runs the matching effect immediately instead of waiting out its 4s backoff.
  const [chartLoadNonce, setChartLoadNonce] = useState(0)
  const [chartSaveNonce, setChartSaveNonce] = useState(0)
  // Set when a merge was closed with clashes left unpicked: those cells kept this tab's value
  // and the other device's was dropped. A persistent line says so — the round shouldn't be
  // able to end looking clean over a silently-reverted dose. Cleared on dismiss or chart switch.
  const [chartClashNote, setChartClashNote] = useState(null)
  // Optimistic-concurrency bookkeeping for PUT /api/chart (see server/schema.sql's
  // daily_charts.version comment): the version last confirmed by the server, and the exact
  // snapshot that version corresponds to. On a 409, diffing the current grid against this
  // snapshot tells "edits made here since the last sync" apart from "edits made elsewhere
  // that haven't reached this tab yet" — the first kind survives a merge, the second adopts
  // the fresher server value, instead of one whole-chart snapshot silently winning over
  // the other on a shared iPad.
  const chartVersionRef = useRef(0)
  const lastSyncedChartRef = useRef({ patientNames: [], columnMedicines: [], quantities: [] })
  // Per-session edit lock (chart_locks server-side). One holder at a time:
  //   'idle'      — free chart, this tab hasn't claimed it; grid editable, no banner (the normal solo open)
  //   'editing'   — this tab holds the lock; heartbeating; grid editable
  //   'stale'     — this tab held it but a heartbeat failed; grid stays editable, a soft warning shows
  //   'readonly'  — another device holds it; grid inert + scrimmed, its edits polled in live
  //   'available' — was 'readonly', the lock just freed; grid editable again, first edit re-claims
  const [lockState, setLockState] = useState('idle')
  const [lockHolder, setLockHolder] = useState(null) // { name, since } while 'readonly'
  const claimingLockRef = useRef(false)
  const [pillsData, setPillsData] = useState(null)
  const [pillEntries, setPillEntries] = useState({})
  const [pillRooms, setPillRooms] = useState({})
  const [pillsLoading, setPillsLoading] = useState(false)
  const [loadedPillsKey, setLoadedPillsKey] = useState(null)
  // saved | pending (edited, debounce running) | saving (PUT in flight) | error — mirrors
  // chartSaveStatus so the pills toolbar chip can tell "saved" from "not saved yet".
  const [pillsSaveStatus, setPillsSaveStatus] = useState('saved')
  const [pillsLoadError, setPillsLoadError] = useState(false)
  // What this tab last knew the server to have — the merge base for a localStorage draft left
  // by a killed/offline tab (cpa-pills-draft:<key>), same role as lastSyncedChartRef for chart.
  const lastSyncedPillsRef = useRef({ entries: {}, rooms: {} })
  const [pillsClashNote, setPillsClashNote] = useState(null)
  // The requisition view (mode 'order') — read-only, derived from the main chart.
  const [orderData, setOrderData] = useState(null)
  const [orderLoading, setOrderLoading] = useState(false)
  const [orderError, setOrderError] = useState(false)
  // استمارة الحبوب الإضافي (mode 'extra-pills') — a standalone, per-ward list of manually
  // created pill forms with no chart behind them at all.
  const [extraPillsForms, setExtraPillsForms] = useState([])
  const [extraPillsLoading, setExtraPillsLoading] = useState(false)
  const [extraPillsError, setExtraPillsError] = useState(false)
  const [extraPillsBusy, setExtraPillsBusy] = useState(false)
  const [extraPillsActionError, setExtraPillsActionError] = useState('')
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
    // Not "call print() then reset the scope on the next line": window.print() blocks until
    // the dialog closes on desktop, but on iOS/iPadOS Safari it hands off to the system print
    // sheet and returns immediately — the very quirk ChartPrintTemplate's comment describes
    // fighting over several rounds elsewhere in this app. Resetting synchronously after the
    // call reverted the scope to "all" before the iPad's sheet ever captured the page, so every
    // form printed regardless of selection. afterprint fires when the sheet actually closes on
    // every browser (including where print() already blocks, where it's effectively instant).
    const resetScope = () => { setPrintScope('all'); window.removeEventListener('afterprint', resetScope) }
    window.addEventListener('afterprint', resetScope)
    window.print()
  }, [])
  const [adminMedicines, setAdminMedicines] = useState([])
  const [medicineFilter, setMedicineFilter] = useState('')
  // استمارات العلاج — every member reads this list; only a manager gets the write handlers below.
  const [treatmentForms, setTreatmentForms] = useState([])
  const [treatmentFormsLoading, setTreatmentFormsLoading] = useState(false)
  const [treatmentFormsError, setTreatmentFormsError] = useState(false)
  const [treatmentFormFilter, setTreatmentFormFilter] = useState('')
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
    // A real 401, not a network failure — the offline auth-bootstrap fallback (App boot effect)
    // must not resurrect this identity on the next cold, offline reopen.
    try { localStorage.removeItem('cpa-session-cache') } catch { /* best effort */ }
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
  // sheet should read the moment the form was opened for this ward/day, not "now". Stamped by
  // both the pills and extra-pills loaders.
  const [editedAt, setEditedAt] = useState(() => new Date())
  const editTime = `${editedAt.toLocaleDateString('ar-IQ', { weekday: 'long' })} ${editedAt.toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' })}`
  const totals = useMemo(() => quantities[0].map((_, columnIndex) => quantities.reduce((sum, row) => sum + (Number(row[columnIndex]) || 0), 0)), [quantities])
  // Thursday's «المجموع المضاعف» row, shared by the grid and the PDF export: two days' supply,
  // except a medicine ticked «لا يُضاعف يوم الخميس» in إدارة الأدوية repeats its normal total.
  const doubledTotals = useMemo(() => {
    const noDouble = new Set(adminMedicines.filter((item) => item.no_thursday_double).map((item) => medicineKey(item.name)))
    return totals.map((total, columnIndex) => (noDouble.has(medicineKey(columnMedicines[columnIndex])) ? total : total * 2))
  }, [adminMedicines, columnMedicines, totals])
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

  // A 10-second window to reverse the last destructive chart edit (row delete, copy-forward).
  // { message, undoFn } — undoFn puts the grid back; the autosave effect then re-PUTs it.
  const [undo, setUndo] = useState(null)
  const undoTimerRef = useRef(null)
  const offerUndo = useCallback((message, undoFn) => {
    clearTimeout(undoTimerRef.current)
    setUndo({ message, undoFn })
    undoTimerRef.current = setTimeout(() => setUndo(null), 10000)
  }, [])
  const takeUndo = useCallback(() => {
    clearTimeout(undoTimerRef.current)
    setUndo((current) => { current?.undoFn(); return null })
  }, [])

  // After a stale-lock merge, the cells where this tab's value won and the other device's was
  // dropped: { "row:col": theirValue }. Shown on the grid as a "كان: X" tag until the
  // pharmacist edits the cell or dismisses the clash note — so a silently-reverted dose is visible.
  const [droppedCells, setDroppedCells] = useState({})

  // The picker shows a plain user only their assigned floor/ward; a manager sees the unit. This
  // replaces a post-paint effect that hid cards by reading their DOM text.
  const visibleFloors = useMemo(
    () => (isManager ? floors : floors.filter((item) => item.number === currentUser?.assignedFloor)),
    [isManager, currentUser],
  )
  const visibleSpecialWards = useMemo(
    () => (isManager ? specialWards : specialWards.filter((ward) => (currentUser?.assignedWards || []).includes(ward))),
    [isManager, currentUser],
  )
  const assignedFloorObj = useMemo(
    () => floors.find((item) => item.number === currentUser?.assignedFloor) || null,
    [currentUser],
  )
  const didAutoLandRef = useRef(false)
  // Guards the nav-persist effect below from wiping cpa-nav before this effect has even had a
  // chance to read it: both run on mount, but this one only *schedules* an async read (fetch),
  // while the persist effect's body is synchronous — so without this guard it always ran first
  // and saw selected/floor still at their initial null, deleting cpa-nav on every single mount
  // regardless of connectivity. That silently broke "resume after a refresh" entirely; the
  // resume-draft card (a real localStorage draft, unrelated to this session-only nav pointer)
  // was the only reason it still looked like it worked.
  const navRestoreAttemptedRef = useRef(false)

  useEffect(() => {
    const landFromNav = () => {
      try {
        const nav = JSON.parse(sessionStorage.getItem('cpa-nav') || 'null')
        if (nav?.selectedDate) setSelectedDate(nav.selectedDate)
        if (nav?.floor) setFloor(nav.floor)
        if (nav?.selected) { didAutoLandRef.current = true; setSelected(nav.selected) }
      } catch { /* storage unavailable or corrupt — start on the picker */ }
    }
    fetch(`${apiUrl}/auth/me`, { credentials: 'include' })
      .then((response) => response.json())
      .then((result) => {
        if (!result.user) return
        setCurrentUser(result.user)
        setIsLoggedIn(true)
        try { localStorage.setItem('cpa-session-cache', JSON.stringify(result.user)) } catch { /* best effort */ }
        // Restore the ward/date open before a refresh or iOS tab-kill (only once we know the
        // session is still good — otherwise a 401 chart-load would flash the expiry screen).
        landFromNav()
      })
      .catch(() => {
        // A network error (offline cold start), not a 401 — the session cookie may well still
        // be good. Fall back to the last identity we actually confirmed, so the app renders the
        // shell and cached ward data instead of forcing a login screen the pharmacist can't get
        // past without a connection. A real 401 (session actually gone) still logs out — that
        // response reaches the .then() branch above, not here.
        try {
          const cached = JSON.parse(localStorage.getItem('cpa-session-cache') || 'null')
          if (!cached) return
          setCurrentUser(cached)
          setIsLoggedIn(true)
          landFromNav()
        } catch { /* storage unavailable or corrupt — start on the picker */ }
      })
      .finally(() => { navRestoreAttemptedRef.current = true })
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
      // A manual login doesn't go through the /auth/me effect above, so if that background
      // check is still in flight (or never settles), its ref would otherwise keep gating the
      // nav-persist effect forever, silently breaking "resume after a refresh" for this whole
      // session even though the user is now genuinely logged in.
      navRestoreAttemptedRef.current = true
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
  const openProfile = useCallback(() => {
    setProfileForm({ fullName: currentUser?.fullName || '', email: currentUser?.email || '', phone: currentUser?.phone || '' })
    setProfileError('')
    setProfileSuccess('')
    setAdminView('profile')
  }, [currentUser])
  const submitProfile = async (event) => {
    event.preventDefault()
    if (busy) return
    setProfileError(''); setProfileSuccess(''); setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/auth/me`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(profileForm) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر حفظ التغييرات')
      setCurrentUser(result.user)
      try { localStorage.setItem('cpa-session-cache', JSON.stringify(result.user)) } catch { /* best effort */ }
      setProfileSuccess('تم حفظ التغييرات')
    } catch (error) { setProfileError(error.message || 'تعذر الاتصال بالخادم') } finally { setBusy(false) }
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
      setAdminMedicines(result.medicines)
    } catch { /* keep the current list on network error */ }
  }, [])
  const saveMedicine = useCallback(async (id, name, arabicName, isSupply, noThursdayDouble) => {
    setRegistrationsError(''); setAdminSuccess(''); setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/medicines/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name, arabicName, isSupply, noThursdayDouble }) })
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
  const loadTreatmentForms = useCallback(async () => {
    setTreatmentFormsLoading(true); setTreatmentFormsError(false)
    try {
      const response = await fetch(`${apiUrl}/treatment-forms`, { credentials: 'include' })
      const result = await response.json()
      if (!response.ok || !Array.isArray(result.forms)) throw new Error()
      setTreatmentForms(result.forms)
    } catch { setTreatmentFormsError(true) } finally { setTreatmentFormsLoading(false) }
  }, [])
  const uploadTreatmentForm = useCallback(async (title, file) => {
    setRegistrationsError(''); setAdminSuccess(''); setBusy(true)
    try {
      const body = new FormData()
      body.append('title', title)
      body.append('file', file)
      const response = await fetch(`${apiUrl}/treatment-forms`, { method: 'POST', credentials: 'include', body })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر رفع الاستمارة')
      setTreatmentForms((current) => [...current, result.form].sort((a, b) => a.title.localeCompare(b.title, 'ar')))
      setAdminSuccess(`تم رفع "${result.form.title}"`)
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') } finally { setBusy(false) }
  }, [])
  const saveTreatmentForm = useCallback(async (id, title, file) => {
    setRegistrationsError(''); setAdminSuccess(''); setBusy(true)
    try {
      const body = new FormData()
      body.append('title', title)
      if (file) body.append('file', file)
      const response = await fetch(`${apiUrl}/treatment-forms/${id}`, { method: 'PUT', credentials: 'include', body })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر حفظ الاستمارة')
      setTreatmentForms((current) => current.map((item) => (item.id === id ? result.form : item)).sort((a, b) => a.title.localeCompare(b.title, 'ar')))
      setAdminSuccess(`تم حفظ "${result.form.title}"`)
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') } finally { setBusy(false) }
  }, [])
  const deleteTreatmentForm = useCallback(async (id, title) => {
    if (!(await askConfirm(`حذف الاستمارة "${title}"؟`, { danger: true }))) return
    setRegistrationsError(''); setAdminSuccess(''); setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/treatment-forms/${id}`, { method: 'DELETE', credentials: 'include' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر حذف الاستمارة')
      setTreatmentForms((current) => current.filter((item) => item.id !== id))
      setAdminSuccess(`تم حذف "${title}"`)
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
    if (adminView === 'medicines') loadMedicines()
    if (adminView === 'forms') loadTreatmentForms()
    // لوحة التحكم needs a count from each of the sections it links to — a supervisor just
    // skips the admin-only requests count, same gate AdminRequestsScreen itself uses.
    if (adminView === 'dashboard') {
      if (isAdmin) loadRegistrations()
      loadUsers(); loadMedicines(); loadTreatmentForms()
    }
  }, [adminView, isAdmin, loadRegistrations, loadUsers, loadMedicines, loadTreatmentForms])
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
      if (adminView === 'medicines') loadMedicines()
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
  // The first edit to a chart this tab hasn't claimed acquires the edit lock. Refused means
  // another device holds it: revert this tab's edits and drop to read-only. A lock-service
  // hiccup is treated as "claimed locally" — a save would 409 into mergeAfterConflict if wrong.
  const noteChartEdit = useCallback(() => {
    if (!selected || selected.mode !== 'chart') return
    // A real edit retracts "اكتملت الجارت" — checked before the lock-claim early-returns below,
    // since those only run their body on the *first* edit of a session; a chart marked complete
    // mid-session (lock already 'editing') must still clear on the very next edit after that.
    if (chartCompleted) {
      setChartCompleted(false); setCompletedByName(null)
      fetch(`${apiUrl}/chart/complete`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date: selectedDate, completed: false }) })
        .catch(() => undefined)
    }
    if (claimingLockRef.current) return
    if (lockState !== 'idle' && lockState !== 'available') return
    claimingLockRef.current = true
    const body = { floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date: selectedDate }
    fetch(`${apiUrl}/chart/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
      .then((response) => { isExpired(response); return response.ok ? response.json() : { ok: true } })
      .then((result) => {
        if (result.ok) setLockState('editing')
        else {
          setLockState('readonly')
          setLockHolder(result.holder || null)
          const synced = lastSyncedChartRef.current
          setPatientNames(synced.patientNames); setColumnMedicines(synced.columnMedicines); setQuantities(synced.quantities)
        }
      })
      .catch(() => setLockState('editing'))
      .finally(() => { claimingLockRef.current = false })
  }, [chartCompleted, lockState, selected, selectedDate, isExpired])
  const updateQuantity = useCallback((rowIndex, columnIndex, value) => { noteChartEdit()
    // Editing a cell that still carries a post-merge "كان: X" tag resolves it — the pharmacist
    // has now made a deliberate call on that dose.
    setDroppedCells((current) => {
      const cellKey = `${rowIndex}:${columnIndex}`
      if (!(cellKey in current)) return current
      const next = { ...current }; delete next[cellKey]; return next
    })
    setQuantities((current) => current.map((row, currentRow) => {
    if (currentRow !== rowIndex) return row
    // Digits only, capped at 4: a dose count never needs 5 digits, and an Excel paste that
    // concatenates a whole selection into one cell would otherwise save a nonsense number
    // that prints at 5px on the sheet the ward dispenses from. Truncate at the first
    // separator so a pasted "12.5" reads as "12", not "125".
    const edited = row.map((quantity, currentColumn) => currentColumn === columnIndex ? toEnglishDigits(value).split(/[.,]/)[0].replace(/\D/g, '').slice(0, 4) : quantity)
    return specialColumns.vialAmp.includes(columnIndex) ? applySyringeTotal(edited) : edited
  })) }, [applySyringeTotal, noteChartEdit, specialColumns])
  // Choosing a medicine for a column seeds that column: a giving set or cannula gets 1 for
  // every patient already on the ward, a syringe gets each patient's vial/amp total. Derived
  // from the new header list rather than from specialColumns, which still describes the
  // previous one — otherwise a column switching from vial to syringe would count itself.
  const setColumnMedicine = useCallback((columnIndex, value) => {
    if (columnMedicines[columnIndex] !== value) noteChartEdit()
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
  }, [columnMedicines, noteChartEdit, patientNames])
  // Called when a column-header cell loses focus. A column may only hold a medicine that is
  // already in the shared catalogue: an exact (case/space-insensitive) match is snapped to the
  // catalogue spelling, an empty cell is fine, and anything else is refused — the cell reverts
  // to whatever it held when it was focused and a notice explains why.
  const commitColumnMedicine = useCallback((columnIndex, rawValue, previousValue = '') => {
    const trimmed = toEnglishDigits(String(rawValue ?? '')).replace(/\s+/g, ' ').trim()
    if (!trimmed) {
      setColumnMedicineNotice(null)
      setColumnMedicine(columnIndex, '')
      // The medicine that gave these numbers meaning is gone — leaving them behind shows
      // orphaned quantities under a blank header, on screen and in print.
      setQuantities((current) => current.map((row) => row.map((qty, index) => (index === columnIndex ? '' : qty))))
      return
    }
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
    if (patientNames[rowIndex] !== value) noteChartEdit()
    const wasEmpty = !patientNames[rowIndex]?.trim()
    setPatientNames((current) => current.map((patient, index) => index === rowIndex ? value : patient))
    if (!wasEmpty || !value.trim() || !specialColumns.unit.length) return
    setQuantities((current) => current.map((row, index) => {
      if (index !== rowIndex) return row
      const next = [...row]
      specialColumns.unit.forEach((columnIndex) => { if (!next[columnIndex]) next[columnIndex] = '1' })
      return next
    }))
  }, [noteChartEdit, patientNames, specialColumns])
  // Carries a previous day's (medicine, quantity) pairs into this row: an existing column with
  // that medicine just gets the quantity, a new one is appended with it. Built as one coherent
  // snapshot (same style as setColumnMedicine's own nextMedicines above) rather than functional
  // updaters — the two arrays have to be computed together (a newly-appended column's index
  // must match between them), so mixing a fresh functional `current` for one with a decision
  // already made against the other would risk the two disagreeing.
  const applyPreviousDayDoses = useCallback((rowIndex, prevDoses) => {
    noteChartEdit()
    const nextColumns = [...columnMedicines]
    const plan = []
    prevDoses.forEach(({ med, qty }) => {
      const canonical = medicines.find((name) => medicineKey(name) === medicineKey(med))
      if (!canonical) return // no longer in the catalogue — dropped, same as the server's own backstop would do
      let columnIndex = nextColumns.findIndex((name) => medicineKey(name) === medicineKey(canonical))
      if (columnIndex === -1) {
        // No column already carries this medicine — reuse the first blank column (the chart
        // starts 51 wide with plenty of those) before growing the grid at all.
        columnIndex = nextColumns.findIndex((name) => !name.trim())
        if (columnIndex === -1) {
          if (nextColumns.length >= MAX_CHART_COLUMNS) return // at the column ceiling — dropped
          columnIndex = nextColumns.length
          nextColumns.push(canonical)
        } else {
          nextColumns[columnIndex] = canonical
        }
      }
      plan.push({ columnIndex, qty })
    })
    const columnCount = nextColumns.length
    const nextQuantities = quantities.map((row, index) => {
      const widened = row.length < columnCount ? [...row, ...Array(columnCount - row.length).fill('')] : [...row]
      if (index !== rowIndex) return widened
      plan.forEach(({ columnIndex, qty }) => { widened[columnIndex] = String(qty) })
      return widened
    })
    setColumnMedicines(nextColumns)
    setQuantities(nextQuantities)
  }, [columnMedicines, quantities, medicines, noteChartEdit])
  // Fires on a patient-name field's empty -> named transition, on blur (wired from
  // ChartScreen). If the same name already appears in this ward's chart from the previous
  // calendar day, offers to carry that patient's medicines and quantities forward. Purely a
  // convenience: any failure (no chart yesterday, no match, network error) just means no
  // popup — never surfaces an error, since nothing the pharmacist did actually failed.
  const checkPreviousDayPatient = useCallback(async (rowIndex, rawValue) => {
    if (!selected || selected.mode !== 'chart' || lockState === 'readonly') return
    const trimmed = rawValue.trim()
    if (!trimmed) return
    const prevDate = isoDate(new Date(`${selectedDate}T12:00:00`).getTime() - 86400000)
    let prevChart
    try {
      const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date: prevDate })
      const response = await fetch(`${apiUrl}/chart?${params}`, { credentials: 'include' })
      prevChart = response.ok ? (await response.json()).chart : null
    } catch { return }
    if (!prevChart) return
    const prevRows = parseChartRows(prevChart)
    const matchRow = prevRows.patientNames.findIndex((name) => patientNameKey(name) === patientNameKey(trimmed))
    if (matchRow === -1) return
    const prevDoses = prevRows.columnMedicines
      .map((med, columnIndex) => ({ med: med.trim(), qty: prevRows.quantities[matchRow][columnIndex] }))
      .filter((entry) => entry.med && Number(entry.qty) > 0)
    if (!prevDoses.length) return
    // The row may have changed while the fetch was in flight (renamed, cleared) — re-check
    // before opening the dialog, and again after it resolves since a background conflict merge
    // isn't blocked by the (foreground-blocking) confirm modal.
    if (patientNameKey(patientNames[rowIndex] || '') !== trimmed) return
    if (!(await askConfirm(`«${trimmed}» موجود في جارت الأمس — هل تريد نسخ أدويته وكمياته؟`))) return
    if (patientNameKey(patientNames[rowIndex] || '') !== trimmed) return
    applyPreviousDayDoses(rowIndex, prevDoses)
  }, [selected, selectedDate, lockState, patientNames, askConfirm, applyPreviousDayDoses])
  // Remove a patient row and pull every following row up one, keeping the grid at PATIENT_ROWS.
  // Triggered only by the explicit ✕ on the active row, gated by a confirm, and reversible for
  // 10s via the undo toast (grid only — see the ponytail note on the server call below).
  const collapseRow = useCallback(async (rowIndex) => {
    const label = patientNames[rowIndex]?.trim() || `مريض ${rowIndex + 1}`
    if (!(await askConfirm(`حذف صف «${label}»؟ ستُحذف كل جرعاته وستنتقل الصفوف التالية صفًّا واحدًا للأعلى.`, { danger: true }))) return
    noteChartEdit()
    const prevNames = patientNames
    const prevQuantities = quantities
    setPatientNames((current) => { const next = current.filter((_, index) => index !== rowIndex); next.push(''); return next })
    setQuantities((current) => { const next = current.filter((_, index) => index !== rowIndex); next.push(Array(current[0]?.length ?? CHART_COLUMNS).fill('')); return next })
    offerUndo(`حُذف صف «${label}»`, () => { noteChartEdit(); setPatientNames(prevNames); setQuantities(prevQuantities) })
    // The ✕ that was just clicked has unmounted; without this focus falls to <body> right
    // after a destructive confirm. Land on the name of whoever moved up into this row.
    requestAnimationFrame(() => chartGridRef.current?.querySelector(`.chart-names tr[data-row="${rowIndex}"] input`)?.focus())
    // The pill form's dose times and room numbers are keyed by row number and live only on
    // the server, so they have to be pulled up by one as well. Left behind, they reattach to
    // whoever moves into the row — the next patient inherits the deleted one's room number.
    // ponytail: fired immediately, so an undo restores the chart grid but not this server-side
    // renumber. Pill rooms only matter on the pills form (a separate mode); the room can be
    // re-typed there if it moved. Deferring this call to the undo window would avoid that, at
    // the cost of a navigation-vs-timer race on a shared iPad.
    if (!selected || selected.mode !== 'chart') return
    fetch(`${apiUrl}/chart/collapse-row`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ floor: selected.floor, ward: selected.ward, date: selectedDate, slot: selected.slot || 'main', rowNumber: rowIndex + 1 }),
    }).catch(() => undefined)
  }, [askConfirm, patientNames, quantities, selected, selectedDate, offerUndo, noteChartEdit])
  // "+ عمود": grows the grid by one blank column, on demand — no schema/print change needed,
  // ChartPrintTemplate already sizes itself from columnMedicines' actual length. Capped well
  // under MAX_CHART_COLUMNS so the button disables itself instead of silently doing nothing
  // once a save would start dropping columns past the server's own ceiling.
  const canAddColumn = columnMedicines.length < MAX_CHART_COLUMNS
  const addColumn = useCallback(() => {
    if (columnMedicines.length >= MAX_CHART_COLUMNS) return
    noteChartEdit()
    setColumnMedicines((current) => [...current, ''])
    setQuantities((current) => current.map((row) => [...row, '']))
  }, [columnMedicines.length, noteChartEdit])
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
  // Called on a 409 from PUT /api/chart. With per-session locking this is rare — it only
  // happens when this tab's lock went stale (missed heartbeats) and another device took over
  // while this tab still had unsaved edits. Re-fetch, merge field-by-field (mine wins where I
  // changed it since the last sync, theirs where they did), and if any field was taken from
  // the other device, leave one persistent line naming them. No modal, no inert grid.
  const mergeAfterConflict = useCallback(async (date) => {
    if (!selected) return
    const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date })
    const response = await fetch(`${apiUrl}/chart?${params}`, { credentials: 'include' })
    if (!response.ok) return
    const result = await response.json()
    const fresh = parseChartRows(result.chart)
    const mine = { patientNames, columnMedicines, quantities }
    const merged = mergeChartSnapshots(lastSyncedChartRef.current, mine, fresh)
    const { adopted, dropped, droppedOther } = diffMergeOutcome(merged, mine, fresh)
    setPatientNames(merged.patientNames)
    setColumnMedicines(merged.columnMedicines)
    setQuantities(merged.quantities)
    setDroppedCells(dropped)
    chartVersionRef.current = result.chart ? result.chart.version : 0
    lastSyncedChartRef.current = fresh
    // A conflict re-fetch may reveal another device marked (or un-marked) completion meanwhile.
    setChartCompleted(!!result.chart?.completedAt)
    setCompletedByName(result.chart?.completedByName ?? null)
    if (adopted.length || Object.keys(dropped).length || droppedOther) {
      const parts = []
      if (adopted.length) parts.push(`${adopted.length} حقلًا دُمج من جهاز آخر`)
      if (Object.keys(dropped).length) parts.push(`${Object.keys(dropped).length} خلية اختلفت فيها قيمتك — تُعرض قيمة الجهاز الآخر بجانبها («كان: …»)`)
      if (droppedOther) parts.push(`${droppedOther} من أسماء المرضى/الأدوية اختلفت أيضًا وأُبقيت قيمتك — راجعها يدويًا`)
      setChartClashNote(`${parts.join(' · ')}. راجِعها${adopted.length ? `: ${adopted.slice(0, 4).join('، ')}${adopted.length > 4 ? '…' : ''}` : ''}.`)
    }
  }, [columnMedicines, patientNames, quantities, selected])
  // Fire an immediate save (survives navigation / tab close) — only once the grid is loaded,
  // so we never overwrite unknown server state with a blank grid.
  const flushChart = useCallback(() => {
    if (!selected || selected.mode !== 'chart' || !isLoggedIn) return
    if (lockState === 'readonly' || lockState === 'available') return // only viewing — nothing of ours to flush
    const chartKey = wardKey(selected, selectedDate)
    if (loadedChartKey !== chartKey) return
    fetch(`${apiUrl}/chart`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', keepalive: true, body: JSON.stringify(buildChartBody(selectedDate)) })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (!result?.ok) return
        // This only runs if the tab is still alive when the response lands — true on a
        // background/resume (the common case this fires for on the ward iPad), moot on a real
        // kill (nothing left to correct). Without it, chartVersionRef/lastSyncedChartRef stay
        // stale after a save that actually succeeded, so the very next autosave 409s against
        // this tab's own already-saved edits and re-litigates them through mergeAfterConflict
        // for no reason — and the leftover draft below would otherwise survive to clobber a
        // genuinely newer save from elsewhere the next time this exact chart is opened.
        chartVersionRef.current = result.version
        lastSyncedChartRef.current = { patientNames, columnMedicines, quantities }
        try { localStorage.removeItem(`cpa-chart-draft:${chartKey}`) } catch { /* best effort */ }
      })
      .catch(() => { /* the debounced autosave or next visit will retry */ })
  }, [buildChartBody, columnMedicines, isLoggedIn, loadedChartKey, lockState, patientNames, quantities, selected, selectedDate])
  // The pharmacist's own toggle — server-authoritative, so another open tab/device picks up
  // the change on its next GET /chart. Deliberately not gated on readOnly here; ChartScreen
  // only renders the button when !readOnly, same as its other write actions.
  const toggleChartComplete = useCallback(async () => {
    if (!selected || selected.mode !== 'chart') return
    const next = !chartCompleted
    try {
      const response = await fetch(`${apiUrl}/chart/complete`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date: selectedDate, completed: next }) })
      if (isExpired(response) || !response.ok) return
      const result = await response.json()
      setChartCompleted(!!result.completedAt)
      setCompletedByName(result.completedByName ?? null)
    } catch { /* the button stays clickable to retry */ }
  }, [chartCompleted, selected, selectedDate, isExpired])
  const flushPills = useCallback(() => {
    if (!selected || selected.mode !== 'pills' || !isLoggedIn || !pillsData) return
    const pillsKey = wardKey(selected, selectedDate)
    if (loadedPillsKey !== pillsKey) return
    const entries = pillEntryList(pillEntries)
    // fetch() rejects asynchronously — a synchronous try/catch around the call never sees that
    // rejection, so (unlike the mirror comment once claimed) a real failure surfaced as an
    // unhandled promise rejection instead of being swallowed. .catch() actually does that.
    fetch(`${apiUrl}/pills`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', keepalive: true, body: JSON.stringify({ floor: selected.floor, ward: selected.ward, slot: selected.slot || 'main', date: selectedDate, entries, rooms: pillRooms }) })
      .then((response) => {
        if (!response.ok) return
        // Same bookkeeping flushChart does on its own success path — without it a tab that
        // resumes after this flush lands treats its own already-saved edits as still dirty.
        lastSyncedPillsRef.current = { entries: pillEntries, rooms: pillRooms }
        try { localStorage.removeItem(`cpa-pills-draft:${pillsKey}`) } catch { /* best effort */ }
      })
      .catch(() => { /* the debounced autosave or next visit will retry */ })
  }, [isLoggedIn, loadedPillsKey, pillEntries, pillRooms, pillsData, selected, selectedDate])
  const goHome = useCallback(async () => {
    // The brand logo is "home"; mid-edit with a save still in flight, a stray tap on a shared
    // iPad shouldn't drop the round without a word. Only asks while something is actually
    // unsaved — chart or pills alike (logout already treats both the same way, below).
    const unsaved = Boolean(selected) && (selected.mode === 'pills' ? pillsSaveStatus : chartSaveStatus) !== 'saved'
    if (unsaved && !(await askConfirm('العودة إلى قائمة الطوابق؟ سيُحفَظ ما كتبته.'))) return
    if (selected?.mode === 'pills') flushPills(); else flushChart()
    setSelected(null)
    setFloor(null)
    setAdminView(null)
  }, [selected, flushChart, flushPills, chartSaveStatus, pillsSaveStatus, askConfirm])
  // Jump straight to the assigned floor's ward list — a persistent shortcut for the
  // one-pharmacist-one-floor case, and the target of the auto-land on login.
  const goToMyWard = useCallback(() => {
    if (!assignedFloorObj) return
    if (selected?.mode === 'pills') flushPills(); else flushChart()
    setSelected(null)
    setAdminView(null)
    setFloor(assignedFloorObj)
  }, [assignedFloorObj, selected, flushChart, flushPills])
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
    didAutoLandRef.current = false
    try { sessionStorage.removeItem('cpa-nav'); localStorage.removeItem('cpa-session-cache') } catch { /* storage unavailable */ }
    // Ward iPads are shared between pharmacists — the next person to sign in on this device
    // shouldn't be able to see this session's cached chart/pills/extra-pills responses if they
    // go offline before their own first successful load. Name must match sw.js's API_CACHE.
    try { await caches.delete('cpa-api-v1') } catch { /* Cache API unavailable — nothing cached to worry about either */ }
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
    else if (adminView === 'dashboard') screen = 'لوحة التحكم'
    else if (adminView === 'requests') screen = 'طلبات الانضمام'
    else if (adminView === 'users') screen = 'جميع المستخدمين'
    else if (adminView === 'medicines') screen = 'إدارة الأدوية'
    else if (adminView === 'reports') screen = 'التقارير'
    else if (selected?.mode === 'pills') screen = `الحبوب — ${ward}`
    else if (selected?.mode === 'order') screen = `الطلبية — ${ward}`
    else if (selected?.mode === 'extra-pills') screen = `استمارة الحبوب الإضافي — ${wardName}`
    else if (selected) screen = `الجارت — ${ward}`
    else if (floor) screen = `الطابق ${floor.number} — اختر الردهة`
    document.title = `${screen} · ${base}`
  }, [isLoggedIn, authView, adminView, selected, floor])
  // Rasterizes the dedicated off-screen ChartPrintTemplate (plain text, no inputs, fixed at
  // exactly the A4 landscape ratio) with html2canvas, then drops that image into a jsPDF page
  // at 297x210mm with no margin — the printer's own hardware floor decides the rest at the
  // physical print step, same as before, but the FILE itself is now byte-identical regardless
  // of which device/browser generated it. Replaces window.print(), which handed the live DOM
  // to whichever print engine the device had (see the plan this superseded for why that was
  // the actual source of the iPad-specific quirks fought over several rounds this session).
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfExportError, setPdfExportError] = useState('')
  const exportChartPdf = useCallback(async () => {
    if (!selected || pdfBusy) return
    const node = printTemplateRef.current
    if (!node) return
    setPdfBusy(true)
    setPdfExportError('')
    try {
      await document.fonts.ready
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
      // html2canvas clones the document into an offscreen iframe to measure it; the clone
      // carries over index.html's tiny inline dark-mode-flash script, which the iframe then
      // tries to re-run and the app's CSP (correctly) blocks — harmless, since it's unrelated
      // to the chart content, but strip it so the console stays clean.
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', onclone: (clonedDoc) => clonedDoc.querySelectorAll('script').forEach((s) => s.remove()) })
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210)
      const ward = selected.floor ? `الطابق ${selected.floor} - ${selected.ward}` : selected.ward
      const kind = selected.slot === 'extra' ? 'جارت إضافي' : 'جارت'
      const fileName = `${kind} ${ward} ${selectedDate}`.replace(/[\\/:*?"<>|]/g, '-')
      const blobUrl = pdf.output('bloburl', { filename: `${fileName}.pdf` })
      // Not window.open(): iOS/iPadOS Safari silently blocks it once it fires outside the
      // synchronous click gesture (which the awaits above always push it past), and blocks it
      // outright regardless of timing when the user's Block Pop-ups setting is on — the iOS
      // default, unlikely to ever be touched on a hospital-issued shared iPad. Navigating the
      // current tab is never subject to either restriction, on any platform. Safari opens a
      // navigated-to PDF in its own inline viewer with the OS print/share icon right there.
      // The chart autosaves continuously, so there's nothing to lose by leaving the page.
      window.location.href = blobUrl
    } catch {
      setPdfExportError('تعذّر إنشاء ملف PDF — حاول مرة أخرى.')
    } finally {
      setPdfBusy(false)
    }
  }, [selected, selectedDate, pdfBusy])
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
    if (!selected || selected.mode !== 'chart' || !documentVisible) return undefined
    loadMedicines()
    const timer = setInterval(loadMedicines, 60000)
    return () => clearInterval(timer)
  }, [selected, loadMedicines, documentVisible])

  // The dashboard aggregates — loaded for the floor-picker landing page and for لوحة التحكم
  // (which hosts the medicines + per-floor patients + daily-trend widgets), not carried along
  // while a chart or another admin screen is open.
  useEffect(() => {
    // Also re-runs when adminView clears, so returning from a screen that changed things
    // (a chart purge, an announcement) lands on fresh numbers rather than the stale set.
    if (!isLoggedIn || floor || selected || (adminView && adminView !== 'dashboard')) return undefined
    let cancelled = false
    const date = isoDate(new Date())
    const rangeQuery = isManager && rangeFrom && rangeTo ? `&rangeFrom=${rangeFrom}&rangeTo=${rangeTo}` : ''
    fetch(`${apiUrl}/dashboard?date=${date}${rangeQuery}`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : null })
      .then((result) => {
        if (cancelled) return
        if (result) { setDashboardData(result); setDashboardError(false) } else setDashboardError(true)
      })
      .catch(() => { if (!cancelled) setDashboardError(true) })
    if (!adminView) {
      fetch(`${apiUrl}/announcements`, { credentials: 'include' })
        .then((response) => { isExpired(response); return response.ok ? response.json() : null })
        .then((result) => { if (!cancelled && result) setAnnouncements(result.announcements) })
        .catch(() => undefined)
    }
    return () => { cancelled = true }
  }, [isLoggedIn, floor, selected, adminView, isExpired, isManager, rangeFrom, rangeTo, dashboardReloadKey])

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
    if (!selected || selected.mode !== 'chart') return undefined
    const chartKey = wardKey(selected, selectedDate)
    const draftKey = `cpa-chart-draft:${chartKey}`
    setChartLoading(true)
    setLoadedChartKey(null)
    setChartSaveStatus('saved')
    setLoadError(false)
    setCopyError(false)
    setLastChartSaveAt(null)
    setChartClashNote(null)
    setDroppedCells({})
    setLockState('idle')
    setLockHolder(null)
    setChartCompleted(false)
    setCompletedByName(null)
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
        setChartCompleted(!!result.chart?.completedAt)
        setCompletedByName(result.chart?.completedByName ?? null)
        // Always the server snapshot, not `next`: a recovered draft is still unsaved until the
        // next PUT actually succeeds, so it must still read as "pending" if that save 409s.
        lastSyncedChartRef.current = fresh
        if (draft) {
          try { localStorage.removeItem(draftKey) } catch { /* best effort */ }
          // Same reporting as a live save conflict (mergeAfterConflict) — a recovered draft is
          // exactly that, just discovered on load instead of on a 409, and was previously
          // applied in total silence: any field this tab's own draft happened to also touch
          // could clobber a real, newer server value with zero indication.
          const { adopted, dropped, droppedOther } = diffMergeOutcome(next, draft.current, fresh)
          setDroppedCells(dropped)
          if (adopted.length || Object.keys(dropped).length || droppedOther) {
            const parts = []
            if (adopted.length) parts.push(`${adopted.length} حقلًا حُدّث من آخر حفظ على الخادم`)
            if (Object.keys(dropped).length) parts.push(`${Object.keys(dropped).length} خلية من مسودة غير محفوظة اختلفت — تُعرض القيمة الحالية بجانبها («كان: …»)`)
            if (droppedOther) parts.push(`${droppedOther} من أسماء المرضى/الأدوية اختلفت أيضًا — راجعها يدويًا`)
            setChartClashNote(`استُعيدت مسودة غير محفوظة من جلسة سابقة. ${parts.join(' · ')}.`)
          }
        }
        // Someone else is in this chart -> open read-only. If it's already ours (a re-open),
        // resume editing. Otherwise stay 'idle': the first edit will claim the lock.
        const lock = result.lock || {}
        if (lock.held && lock.mine) setLockState('editing')
        else if (lock.held) { setLockState('readonly'); setLockHolder(lock.holder || null) }
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
  }, [selected, selectedDate, isExpired, chartLoadNonce])
  // Mirrors the live grid to localStorage so a killed tab (not just a backgrounded one —
  // pagehide/visibilitychange below cover that) doesn't lose whatever hadn't reached the
  // server yet. `base` is the last state this tab knows was actually saved, so the load
  // effect's merge can tell a real edit apart from a stale copy of old server data.
  useEffect(() => {
    const chartKey = selected ? wardKey(selected, selectedDate) : null
    if (!selected || selected.mode !== 'chart' || loadedChartKey !== chartKey) return undefined
    try {
      // `meta` lets the picker's resume card name the ward/date without parsing the key
      // (which contains dashes from the ISO date). The load effect ignores it.
      const meta = { floor: selected.floor ?? null, ward: selected.ward, date: selectedDate, slot: selected.slot || 'main' }
      localStorage.setItem(`cpa-chart-draft:${chartKey}`, JSON.stringify({ meta, base: lastSyncedChartRef.current, current: { patientNames, columnMedicines, quantities } }))
    } catch { /* storage unavailable or full — the network autosave is still the source of truth */ }
    return undefined
  }, [columnMedicines, loadedChartKey, patientNames, quantities, selected, selectedDate])

  // An unsynced chart draft left by a killed tab, surfaced on the picker as a one-tap "resume".
  // Recomputed when navigation lands back on the picker; a draft is cleared by the load effect
  // once its edits reach the server, so a lingering one really is unfinished work.
  const resumeDraft = useMemo(() => {
    if (!isLoggedIn || floor || selected || adminView) return null
    try {
      const keys = []
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i)
        if (key && key.startsWith('cpa-chart-draft:')) keys.push(key)
      }
      const todayIso = isoDate(new Date())
      let found = null
      for (const key of keys) {
        const meta = JSON.parse(localStorage.getItem(key) || 'null')?.meta
        if (!meta?.ward) continue
        // A draft from a past date never got a successful flush to clear it (tab killed, app
        // force-quit) — it would otherwise resurface every login forever. Garbage-collect it
        // here instead of just skipping past it.
        if (isDraftStale(meta, todayIso)) { try { localStorage.removeItem(key) } catch { /* best effort */ } continue }
        if (found) continue
        // Shared iPads carry drafts across logins: a different ward's account may have left an
        // unsynced chart in this same browser's storage. Only offer to resume what the current
        // user can actually open — otherwise a floor-5 pharmacist gets a "resume" button into
        // floor 3's chart.
        const inScope = isManager || (meta.floor ? meta.floor === currentUser?.assignedFloor : (currentUser?.assignedWards || []).includes(meta.ward))
        if (inScope) found = meta
      }
      return found
    } catch { /* storage unavailable */ }
    return null
  }, [isLoggedIn, floor, selected, adminView, isManager, currentUser])
  const resumeFromDraft = useCallback(() => {
    if (!resumeDraft) return
    if (resumeDraft.date) setSelectedDate(resumeDraft.date)
    setSelected({ floor: resumeDraft.floor, ward: resumeDraft.ward, mode: 'chart', slot: resumeDraft.slot || 'main' })
  }, [resumeDraft])

  useEffect(() => {
    const chartKey = selected ? wardKey(selected, selectedDate) : null
    // Holding off while the session is expired is what stops the 4-second retry loop. The
    // effect re-runs when it clears, which saves everything typed in the meantime.
    if (!selected || selected.mode !== 'chart' || !isLoggedIn || sessionExpired || chartLoading || loadedChartKey !== chartKey) return undefined
    // Read-only (another device holds the lock) or not-yet-claimed: nothing of ours to save.
    if (lockState === 'readonly' || lockState === 'available') return undefined
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
        // Rare with locking (only after a stale-lock takeover). mergeAfterConflict merges the
        // fresh server state with this tab's pending edits, updates chartVersionRef, and drops
        // one review line if any field came from the other device; retrying at 400ms resends
        // the merged grid against the now-current version.
        if (response.status === 409) {
          await mergeAfterConflict(selectedDate)
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
        setLastChartSaveAt(Date.now())
      } catch {
        setChartSaveStatus('error')
        retryTimer = setTimeout(save, 4000)
      }
    }
    // "إعادة المحاولة الآن" bumps chartSaveNonce, which re-runs this effect: it clears the
    // 4s error backoff still pending and reschedules the save on the normal debounce.
    const timer = setTimeout(save, 1200)
    return () => { clearTimeout(timer); clearTimeout(retryTimer) }
  }, [buildChartBody, chartLoading, chartSaveNonce, columnMedicines, isExpired, isLoggedIn, loadedChartKey, lockState, mergeAfterConflict, patientNames, quantities, selected, selectedDate, sessionExpired])

  // Heartbeat while this tab holds the edit lock (or held it and is trying to keep it). A
  // failed PATCH means it was taken after going stale — keep editing, show the soft 'stale'
  // warning; a later PATCH re-claims the lock as soon as no other device holds it fresh.
  useEffect(() => {
    if (!selected || selected.mode !== 'chart' || (lockState !== 'editing' && lockState !== 'stale') || !documentVisible) return undefined
    const body = { floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date: selectedDate }
    const beat = () => fetch(`${apiUrl}/chart/lock`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
      .then((response) => { isExpired(response); return response.ok ? response.json() : { ok: true } })
      .then((result) => setLockState((current) => (current === 'readonly' || current === 'available' ? current : result.ok ? 'editing' : 'stale')))
      .catch(() => { /* offline — keep editing; the save path handles a real conflict */ })
    beat() // re-affirm the lock immediately on (re)focus, don't wait a full interval
    const timer = setInterval(beat, 30000)
    return () => clearInterval(timer)
  }, [selected, selectedDate, lockState, isExpired, documentVisible])

  // Read-only: another device holds the lock. Poll the full chart so its edits show live, and
  // flip to 'available' the instant the lock frees.
  useEffect(() => {
    if (!selected || selected.mode !== 'chart' || lockState !== 'readonly' || !documentVisible) return undefined
    const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date: selectedDate })
    let cancelled = false
    const poll = () => fetch(`${apiUrl}/chart?${params}`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : null })
      .then((result) => {
        if (cancelled || !result) return
        const fresh = parseChartRows(result.chart)
        setPatientNames(fresh.patientNames); setColumnMedicines(fresh.columnMedicines); setQuantities(fresh.quantities)
        lastSyncedChartRef.current = fresh
        chartVersionRef.current = result.chart ? result.chart.version : 0
        setChartCompleted(!!result.chart?.completedAt)
        setCompletedByName(result.chart?.completedByName ?? null)
        const lock = result.lock || {}
        if (!lock.held) setLockState('available')
        else if (lock.mine) setLockState('editing')
        else setLockHolder(lock.holder || null)
      })
      .catch(() => { /* transient — next poll retries */ })
    poll() // catch up immediately on (re)focus rather than waiting a full interval
    const timer = setInterval(poll, 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [selected, selectedDate, lockState, isExpired, documentVisible])

  // Release the lock on back-out / date change / tab-close. keepalive survives the unload;
  // the server DELETE is a no-op when this tab didn't hold it.
  useEffect(() => {
    if (!selected || selected.mode !== 'chart') return undefined
    const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date: selectedDate })
    const release = () => { try { fetch(`${apiUrl}/chart/lock?${params}`, { method: 'DELETE', credentials: 'include', keepalive: true }) } catch { /* best effort */ } }
    window.addEventListener('pagehide', release)
    return () => { window.removeEventListener('pagehide', release); release() }
  }, [selected, selectedDate])

  useEffect(() => {
    if (!selected || selected.mode !== 'pills') return undefined
    const pillsKey = wardKey(selected, selectedDate)
    const draftKey = `cpa-pills-draft:${pillsKey}`
    setPillsLoading(true)
    setLoadedPillsKey(null)
    setPillsSaveStatus('saved')
    setPillsLoadError(false)
    setPillsClashNote(null)
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
        const freshRooms = result.pills?.rooms || {}
        // A draft left by a killed/offline tab (see the localStorage-mirror effect below) may
        // hold edits that never reached the server — merged in exactly like chart's own
        // recovered-draft path: draft.base is what that earlier tab last knew the server had.
        let draft = null
        try {
          const raw = localStorage.getItem(draftKey)
          if (raw) draft = JSON.parse(raw)
        } catch { /* storage unavailable or the draft was corrupt — fall back to the server state */ }
        const nextEntries = draft ? mergeKeyedSnapshots(draft.base.entries, draft.current.entries, seed) : seed
        const nextRooms = draft ? mergeKeyedSnapshots(draft.base.rooms, draft.current.rooms, freshRooms) : freshRooms
        setPillEntries(nextEntries)
        setPillRooms(nextRooms)
        // Always the server snapshot, not the merged result: a recovered draft is still unsaved
        // until the next PUT actually succeeds.
        lastSyncedPillsRef.current = { entries: seed, rooms: freshRooms }
        if (draft) {
          try { localStorage.removeItem(draftKey) } catch { /* best effort */ }
          const { adopted, dropped } = diffKeyedMergeOutcome(nextEntries, draft.current.entries, seed)
          if (adopted || dropped) {
            const parts = []
            if (adopted) parts.push(`${adopted} حقلًا حُدّث من آخر حفظ على الخادم`)
            if (dropped) parts.push(`${dropped} حقلًا من مسودة غير محفوظة اختلف عن الخادم وأُبقيت قيمتك — راجعها يدويًا`)
            setPillsClashNote(`استُعيدت مسودة غير محفوظة من جلسة سابقة. ${parts.join(' · ')}.`)
          }
        }
        setPillsLoadError(false)
        setEditedAt(new Date())
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
  // Mirrors the live pills form to localStorage so a killed/offline tab doesn't lose whatever
  // hadn't reached the server yet — same role as chart's cpa-chart-draft mirror below.
  useEffect(() => {
    const pillsKey = selected ? wardKey(selected, selectedDate) : null
    if (!selected || selected.mode !== 'pills' || loadedPillsKey !== pillsKey) return undefined
    try {
      localStorage.setItem(`cpa-pills-draft:${pillsKey}`, JSON.stringify({ base: lastSyncedPillsRef.current, current: { entries: pillEntries, rooms: pillRooms } }))
    } catch { /* storage unavailable or full — the network autosave is still the source of truth */ }
  }, [loadedPillsKey, pillEntries, pillRooms, selected, selectedDate])

  useEffect(() => {
    if (!selected || selected.mode !== 'pills' || !isLoggedIn || sessionExpired || pillsLoading) return undefined
    const pillsKey = wardKey(selected, selectedDate)
    if (loadedPillsKey !== pillsKey || !pillsData) return undefined
    // Same guard chart's autosave uses: this effect also re-runs on navigation-shaped dep
    // changes (a load completing, a ward/date switch) that carry no real edit — without it,
    // every one of those re-PUT identical data a moment later for no reason.
    const synced = lastSyncedPillsRef.current
    const dirty = JSON.stringify(pillEntries) !== JSON.stringify(synced.entries) || JSON.stringify(pillRooms) !== JSON.stringify(synced.rooms)
    if (!dirty) return undefined
    let retryTimer
    const save = async () => {
      const entries = pillEntryList(pillEntries)
      try {
        setPillsSaveStatus('saving')
        const response = await fetch(`${apiUrl}/pills`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ floor: selected.floor, ward: selected.ward, slot: selected.slot || 'main', date: selectedDate, entries, rooms: pillRooms }) })
        if (isExpired(response)) return
        if (!response.ok) throw new Error('save failed')
        lastSyncedPillsRef.current = { entries: pillEntries, rooms: pillRooms }
        try { localStorage.removeItem(`cpa-pills-draft:${pillsKey}`) } catch { /* best effort */ }
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

  // The requisition — a plain read-only fetch on ward/date change. No autosave, no lock.
  useEffect(() => {
    if (!selected || selected.mode !== 'order') return undefined
    let cancelled = false
    setOrderLoading(true)
    setOrderError(false)
    const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date: selectedDate })
    fetch(`${apiUrl}/order?${params}`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : null })
      .then((result) => {
        if (cancelled) return
        if (result) { setOrderData(result.order || { items: [] }); setOrderError(false) }
        else { setOrderData(null); setOrderError(true) }
        setOrderLoading(false)
      })
      .catch(() => { if (!cancelled) { setOrderError(true); setOrderLoading(false) } })
    return () => { cancelled = true }
  }, [selected, selectedDate, isExpired])

  // استمارة الحبوب الإضافي: one standing list per ward — no date scoping, since these aren't a
  // daily/reset artifact like the chart or the real pills form. `applyExtraPillsQueue` layers
  // in whatever create/edit/delete didn't reach the server yet (see the callbacks below), so a
  // pending offline change still shows right after this GET — including one served from the
  // service worker's cache while genuinely offline.
  useEffect(() => {
    if (!selected || selected.mode !== 'extra-pills') return undefined
    let cancelled = false
    setExtraPillsLoading(true)
    setExtraPillsError(false)
    const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward })
    const queueKey = extraPillsQueueKey(selected.floor, selected.ward)
    fetch(`${apiUrl}/extra-pills?${params}`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : null })
      .then((result) => {
        if (cancelled) return
        if (result) { setExtraPillsForms(applyExtraPillsQueue(result.forms, readExtraPillsQueue(queueKey))); setExtraPillsError(false); setEditedAt(new Date()) }
        else { setExtraPillsForms([]); setExtraPillsError(true) }
        setExtraPillsLoading(false)
      })
      .catch(() => { if (!cancelled) { setExtraPillsError(true); setExtraPillsLoading(false) } })
    return () => { cancelled = true }
  }, [selected, isExpired])

  const createExtraPillForm = useCallback(async () => {
    if (!selected || selected.mode !== 'extra-pills') return
    setExtraPillsBusy(true)
    setExtraPillsActionError('')
    try {
      const response = await fetch(`${apiUrl}/extra-pills`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ floor: selected.floor, ward: selected.ward }) })
      isExpired(response)
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      setExtraPillsForms((current) => [...current, result.form])
    } catch (error) {
      if (error instanceof TypeError) {
        // Offline: show a blank editable card immediately and queue its creation for reconnect
        // — there's no real id yet, so edits to it (below) fold into this same queued op.
        const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        setExtraPillsForms((current) => [...current, { id: tempId, ...blankExtraPillForm(selected.floor, selected.ward) }])
        const queueKey = extraPillsQueueKey(selected.floor, selected.ward)
        writeExtraPillsQueue(queueKey, enqueueExtraPillsOp(readExtraPillsQueue(queueKey), { key: tempId, op: 'create', floor: selected.floor, ward: selected.ward, patch: null }))
      } else {
        setExtraPillsActionError('تعذّر إنشاء الاستمارة — حاول مرة أخرى')
      }
    } finally { setExtraPillsBusy(false) }
  }, [selected, isExpired])

  const saveExtraPillForm = useCallback(async (id, patch) => {
    const isTemp = typeof id === 'string' && id.startsWith('temp-')
    const form = extraPillsForms.find((item) => item.id === id)
    if (isTemp) {
      // Still waiting on its own creation to reach the server — fold the edit into the queued
      // create instead of PUTting to an id the server has never seen.
      setExtraPillsForms((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
      if (form) {
        const queueKey = extraPillsQueueKey(form.floor, form.ward)
        writeExtraPillsQueue(queueKey, enqueueExtraPillsOp(readExtraPillsQueue(queueKey), { key: id, op: 'create', floor: form.floor, ward: form.ward, patch }))
      }
      return
    }
    setExtraPillsBusy(true)
    setExtraPillsActionError('')
    try {
      const response = await fetch(`${apiUrl}/extra-pills/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(patch) })
      isExpired(response)
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      setExtraPillsForms((current) => current.map((item) => (item.id === id ? result.form : item)))
    } catch (error) {
      if (error instanceof TypeError) {
        setExtraPillsForms((current) => current.map((item) => (item.id === id ? { ...item, ...patch, pending: true } : item)))
        if (form) {
          const queueKey = extraPillsQueueKey(form.floor, form.ward)
          writeExtraPillsQueue(queueKey, enqueueExtraPillsOp(readExtraPillsQueue(queueKey), { key: String(id), op: 'update', id, patch }))
        }
      } else {
        setExtraPillsActionError('تعذّر حفظ الاستمارة — حاول مرة أخرى')
      }
    } finally { setExtraPillsBusy(false) }
  }, [isExpired, extraPillsForms])

  const deleteExtraPillForm = useCallback(async (id) => {
    if (!(await askConfirm('حذف هذه الاستمارة؟', { danger: true }))) return
    const isTemp = typeof id === 'string' && id.startsWith('temp-')
    const form = extraPillsForms.find((item) => item.id === id)
    if (isTemp) {
      // Never reached the server — drop the local card and cancel its queued creation outright.
      setExtraPillsForms((current) => current.filter((item) => item.id !== id))
      if (form) {
        const queueKey = extraPillsQueueKey(form.floor, form.ward)
        writeExtraPillsQueue(queueKey, enqueueExtraPillsOp(readExtraPillsQueue(queueKey), { key: id, op: 'delete', id: null }))
      }
      return
    }
    setExtraPillsBusy(true)
    setExtraPillsActionError('')
    try {
      const response = await fetch(`${apiUrl}/extra-pills/${id}`, { method: 'DELETE', credentials: 'include' })
      isExpired(response)
      if (!response.ok && response.status !== 404) throw new Error()
      setExtraPillsForms((current) => current.filter((item) => item.id !== id))
    } catch (error) {
      if (error instanceof TypeError) {
        setExtraPillsForms((current) => current.filter((item) => item.id !== id))
        if (form) {
          const queueKey = extraPillsQueueKey(form.floor, form.ward)
          writeExtraPillsQueue(queueKey, enqueueExtraPillsOp(readExtraPillsQueue(queueKey), { key: String(id), op: 'delete', id }))
        }
      } else {
        setExtraPillsActionError('تعذّر حذف الاستمارة — حاول مرة أخرى')
      }
    } finally { setExtraPillsBusy(false) }
  }, [askConfirm, isExpired, extraPillsForms])

  // Replays queued extra-pills writes in order once the network is back — there's no fixed
  // retry timer for this screen (see the constant above), so reconnecting is the trigger.
  const flushExtraPillsQueue = useCallback(async (floorValue, ward) => {
    const queueKey = extraPillsQueueKey(floorValue, ward)
    let queue = readExtraPillsQueue(queueKey)
    for (const entry of queue) {
      try {
        if (entry.op === 'create') {
          const response = await fetch(`${apiUrl}/extra-pills`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ floor: floorValue, ward }) })
          if (isExpired(response)) return
          if (!response.ok) throw new Error()
          let { form } = await response.json()
          if (entry.patch) {
            const putResponse = await fetch(`${apiUrl}/extra-pills/${form.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(entry.patch) })
            if (putResponse.ok) form = (await putResponse.json()).form
          }
          setExtraPillsForms((current) => current.map((item) => (item.id === entry.key ? form : item)))
        } else if (entry.op === 'update') {
          const response = await fetch(`${apiUrl}/extra-pills/${entry.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(entry.patch) })
          if (isExpired(response)) return
          if (!response.ok) throw new Error()
          const { form } = await response.json()
          setExtraPillsForms((current) => current.map((item) => (item.id === entry.id ? form : item)))
        } else if (entry.op === 'delete' && entry.id) {
          const response = await fetch(`${apiUrl}/extra-pills/${entry.id}`, { method: 'DELETE', credentials: 'include' })
          if (isExpired(response)) return
          if (!response.ok && response.status !== 404) throw new Error()
        }
        queue = queue.filter((item) => item.key !== entry.key)
        writeExtraPillsQueue(queueKey, queue)
      } catch {
        return // still offline / still failing — leave the rest queued for next time
      }
    }
  }, [isExpired])

  useEffect(() => {
    if (!selected || selected.mode !== 'extra-pills' || !isOnline) return undefined
    flushExtraPillsQueue(selected.floor, selected.ward)
  }, [selected, isOnline, flushExtraPillsQueue])

  const changeDate = useCallback((nextDate) => {
    flushChart()
    setSelectedDate(nextDate)
  }, [flushChart])
  const copyToNextDay = useCallback(async () => {
    if (!selected) { setCopyError(true); return }
    const nextDate = isoDate(new Date(`${selectedDate}T12:00:00`).getTime() + 86400000)
    setCopyError(false)
    flushChart()
    // Fetch the target day first so the confirm can say whether it is about to overwrite real
    // work. expectedVersion also has to match THAT chart, not chartVersionRef (which tracks the
    // chart being copied FROM); fetching fresh keeps the overwrite version-gated — a genuine
    // concurrent edit on nextDate still 409s instead of being silently discarded.
    let targetResult
    try {
      const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date: nextDate })
      const targetResponse = await fetch(`${apiUrl}/chart?${params}`, { credentials: 'include' })
      targetResult = targetResponse.ok ? await targetResponse.json() : { chart: null }
    } catch { setCopyError(true); return }
    const targetCount = (targetResult.chart?.patients || []).filter((patient) => patient.patient_name?.trim()).length
    const warn = targetCount > 0 ? `اليوم التالي يحتوي جارت بـ ${targetCount} مريض — سيُستبدل بالكامل.` : 'اليوم التالي فارغ.'
    const choice = await askCopyChoice(`نسخ جارت ${today} إلى اليوم التالي؟ ${warn}`, { danger: targetCount > 0 })
    if (!choice) return
    try {
      // "أسماء الأدوية فقط": keep the medicine columns, drop every patient name and quantity —
      // a fresh day's own dosing starts blank instead of inheriting yesterday's patients/doses.
      const base = buildChartBody(nextDate)
      const body = {
        ...base,
        patients: choice === 'medicines' ? base.patients.map((patient) => ({ ...patient, name: '' })) : base.patients,
        quantities: choice === 'medicines' ? [] : base.quantities,
        expectedVersion: targetResult.chart ? targetResult.chart.version : 0,
      }
      const response = await fetch(`${apiUrl}/chart`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
      if (!response.ok) throw new Error('copy failed')
      const sourceDate = selectedDate
      setSelectedDate(nextDate)
      // ponytail: undo returns you to the source day (untouched there). It does not restore what
      // the next day held before the copy — the informed choice above is the guard for that.
      offerUndo(choice === 'medicines' ? 'نُسخت أسماء الأدوية إلى اليوم التالي' : 'نُسخ الجارت إلى اليوم التالي', () => setSelectedDate(sourceDate))
    } catch { setCopyError(true) }
  }, [askCopyChoice, buildChartBody, flushChart, selected, selectedDate, today, offerUndo])

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

  // A one-floor pharmacist's whole daily job is one ward's chart — land them on that floor's
  // ward list instead of a picker with a single card. Once per login, and never over an
  // admin screen or a chart they navigated to directly (e.g. via the resume card).
  useEffect(() => {
    if (didAutoLandRef.current) return
    if (isLoggedIn && !isManager && assignedFloorObj && !floor && !selected && !adminView) {
      didAutoLandRef.current = true
      setFloor(assignedFloorObj)
    }
  }, [isLoggedIn, isManager, assignedFloorObj, floor, selected, adminView])

  // Persist the open ward/date so a refresh or an iOS tab-kill+restore comes back here instead
  // of the floor picker (the restore itself runs in the /auth/me effect above, once the
  // session is confirmed). sessionStorage, so it clears when the tab really closes.
  useEffect(() => {
    // Both this effect and the /auth/me one above run on mount; this one is synchronous and
    // would otherwise always win the race, wiping cpa-nav (selected/floor start null) before
    // the other ever gets to read it. Holding off until that attempt has actually finished is
    // what lets a restored selection get persisted at all, instead of being deleted on arrival.
    if (!navRestoreAttemptedRef.current) return undefined
    try {
      if (selected || floor) sessionStorage.setItem('cpa-nav', JSON.stringify({ selected, floor, selectedDate }))
      else sessionStorage.removeItem('cpa-nav')
    } catch { /* storage unavailable */ }
    return undefined
  }, [selected, floor, selectedDate])

  useEffect(() => {
    if (!showMedicineForm) return undefined
    const opener = document.activeElement
    const onKey = (event) => { if (event.key === 'Escape') setShowMedicineForm(false) }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); opener?.focus?.() }
  }, [showMedicineForm])
  // Rendered by every screen that can raise it, not just the chart. askConfirm() is also
  // called from the users and medicines screens, and a dialog whose JSX never renders leaves
  // its promise pending forever: the click silently does nothing, and the dialog then ambushes
  // whichever screen the pharmacist opens next — confirming there runs the delete they had
  // already given up on, in a completely unrelated context.
  const confirmModal = <ConfirmDialog dialog={confirmDialog} onResolve={resolveConfirm} />
  const copyChoiceModal = <CopyChartDialog dialog={copyChoiceDialog} onResolve={resolveCopyChoice} />

  if (!isLoggedIn && authView === 'register') return <RegisterScreen registerForm={registerForm} setRegisterForm={setRegisterForm} registerError={registerError} registerSuccess={registerSuccess} busy={busy} onSubmit={submitRegister} onBackToLogin={() => { setAuthView('login'); setRegisterError(''); setRegisterSuccess('') }} confirmModal={confirmModal} />

  if (!isLoggedIn) return <LoginScreen credentials={credentials} setCredentials={setCredentials} loginError={loginError} busy={busy} onSubmit={submitLogin} onGoToRegister={() => { setAuthView('register'); setLoginError('') }} confirmModal={confirmModal} />

  if (sessionExpired) return <SessionExpiredScreen credentials={credentials} setCredentials={setCredentials} loginError={loginError} busy={busy} onSubmit={submitLogin} onLogout={logout} confirmModal={confirmModal} />

  const appHeader = <AppHeader theme={theme} onToggleTheme={toggleTheme} currentUser={currentUser} onLogout={logout} onHome={goHome} onMyWard={!isManager && assignedFloorObj ? goToMyWard : undefined} onOpenProfile={openProfile} isAdmin={isAdmin} isManager={isManager} adminView={adminView} onNavigate={setAdminView} isOnline={isOnline} />

  if (adminView === 'profile') return <ProfileScreen adminHeader={appHeader} profileForm={profileForm} setProfileForm={setProfileForm} profileError={profileError} profileSuccess={profileSuccess} busy={busy} onSubmit={submitProfile} />

  if (adminView === 'dashboard' && isManager) return <AdminDashboardScreen adminHeader={appHeader} isAdmin={isAdmin} onNavigate={setAdminView} onOpenWard={(target) => { setAdminView(null); setSelected(target) }} registrations={registrations} allUsers={allUsers} adminMedicines={adminMedicines} treatmentForms={treatmentForms} dashboard={dashboardData} dashboardLoading={dashboardData === null && !dashboardError} dashboardError={dashboardError} onRetryDashboard={retryDashboard} rangeFrom={rangeFrom} setRangeFrom={setRangeFrom} rangeTo={rangeTo} setRangeTo={setRangeTo} pendingFloor={pendingFloor} setPendingFloor={setPendingFloor} busy={busy} onApprove={approveRegistration} onReject={rejectRegistration} registrationsError={registrationsError} adminSuccess={adminSuccess} confirmModal={confirmModal} />

  if (adminView === 'requests' && isAdmin) return <AdminRequestsScreen adminHeader={appHeader} registrations={registrations} registrationsError={registrationsError} adminSuccess={adminSuccess} pendingFloor={pendingFloor} setPendingFloor={setPendingFloor} busy={busy} onReload={loadRegistrations} onApprove={approveRegistration} onReject={rejectRegistration} confirmModal={confirmModal} />

  if (adminView === 'users' && isManager) return <AdminUsersScreen adminHeader={appHeader} allUsers={allUsers} currentUser={currentUser} isAdmin={isAdmin} registrationsError={registrationsError} adminSuccess={adminSuccess} busy={busy} onReload={loadUsers} onChangeRole={changeUserRole} onAssignLocation={assignLocationToUser} onDeleteUser={deleteUser} confirmModal={confirmModal} />

  if (adminView === 'reports' && isManager) return <ReportsScreen adminHeader={appHeader} isExpired={isExpired} />

  if (adminView === 'floors' && isManager) return <AdminFloorsScreen adminHeader={appHeader} purgeFrom={purgeFrom} setPurgeFrom={setPurgeFrom} purgeTo={purgeTo} setPurgeTo={setPurgeTo} purgeAll={purgeAll} setPurgeAll={setPurgeAll} purgeTargets={purgeTargets} onToggleTarget={togglePurgeTarget} busy={busy} registrationsError={registrationsError} adminSuccess={adminSuccess} onPurge={purgeCharts} confirmModal={confirmModal} />

  // adminMedicines holds the catalogue exactly as the server returned it, so its length is
  // the number of rows in the database; the filter only narrows what the table draws.
  const medicineSearch = medicineFilter.trim().toLowerCase()
  const visibleMedicines = adminMedicines.filter((item) => !medicineSearch || `${item.name} ${item.arabic_name || ''}`.toLowerCase().includes(medicineSearch))
  if (adminView === 'medicines' && isManager) return <AdminMedicinesScreen adminHeader={appHeader} adminMedicines={adminMedicines} visibleMedicines={visibleMedicines} medicineSearch={medicineSearch} medicineFilter={medicineFilter} setMedicineFilter={setMedicineFilter} newMedicine={newMedicine} setNewMedicine={setNewMedicine} registrationsError={registrationsError} adminSuccess={adminSuccess} busy={busy} onAddMedicine={addMedicine} onSaveMedicine={saveMedicine} onRemoveMedicine={removeMedicine} confirmModal={confirmModal} />
  const formSearch = treatmentFormFilter.trim().toLowerCase()
  const visibleTreatmentForms = treatmentForms.filter((item) => !formSearch || item.title.toLowerCase().includes(formSearch))
  // No isManager guard here, unlike the other admin screens — every member reads this list;
  // the upload/rename/replace/delete controls inside are what's gated on isManager.
  if (adminView === 'forms') return <TreatmentFormsScreen adminHeader={appHeader} isManager={isManager} forms={visibleTreatmentForms} formCount={treatmentForms.length} formFilter={treatmentFormFilter} setFormFilter={setTreatmentFormFilter} loading={treatmentFormsLoading} loadError={treatmentFormsError} onRetry={loadTreatmentForms} registrationsError={registrationsError} adminSuccess={adminSuccess} busy={busy} onUpload={uploadTreatmentForm} onSave={saveTreatmentForm} onRemove={deleteTreatmentForm} confirmModal={confirmModal} />

  const wardLabel = selected
    ? `${selected.floor ? `الطابق ${selected.floor} - ${selected.ward}` : selected.ward}${selected.slot === 'extra' ? ' — إضافي' : ''}`
    : ''
  // True once THIS ward+date's chart has finished loading. Until then the grid is covered and
  // made inert, so a slow or failed load cannot be typed into and then silently overwritten.
  const chartReadyKey = selected && selected.mode !== 'pills' ? wardKey(selected, selectedDate) : null
  const chartReady = chartReadyKey !== null && loadedChartKey === chartReadyKey
  // The last form that actually prints must not force a page break after itself, or the job
  // ends on a blank sheet. Which form that is depends on the selection, so :last-child cannot
  // express it — a hidden last patient would leave the break on the one before it.
  const printingRows = (pillsData?.patients || []).filter((patient) => printScope === 'all' || pillSelection.has(patient.rowNumber)).map((patient) => patient.rowNumber)
  const lastPrintingRow = printingRows[printingRows.length - 1]
  if (selected && selected.mode === 'order') return <OrderScreen header={appHeader} wardLabel={wardLabel} today={today} onBack={() => setSelected(null)} selectedDate={selectedDate} onChangeDate={setSelectedDate} loading={orderLoading} data={orderData} loadError={orderError} onPrint={() => window.print()} />
  if (selected && selected.mode === 'extra-pills') return <ExtraPillsScreen header={appHeader} floorLabel={wardLabel} today={today} editTime={editTime} onBack={() => setSelected(null)} loading={extraPillsLoading} loadError={extraPillsError} forms={extraPillsForms} busy={extraPillsBusy} actionError={extraPillsActionError} onCreate={createExtraPillForm} onSave={saveExtraPillForm} onRemove={deleteExtraPillForm} confirmModal={confirmModal} />
  if (selected && selected.mode === 'pills') return <PillsScreen header={appHeader} wardLabel={wardLabel} roomLabel={/\bccu\b/i.test(selected.ward || '') ? 'رقم السرير' : 'رقم الغرفة'} today={today} editTime={editTime} onBack={() => { flushPills(); setSelected(null) }} selectedDate={selectedDate} onChangeDate={(nextDate) => { flushPills(); setSelectedDate(nextDate) }} pillsLoading={pillsLoading} pillsData={pillsData} pillsSaveStatus={pillsSaveStatus} pillsLoadError={pillsLoadError} pillEntries={pillEntries} setPillEntries={setPillEntries} pillRooms={pillRooms} setPillRooms={setPillRooms} pillSelection={pillSelection} onTogglePatient={togglePillPatient} printScope={printScope} lastPrintingRow={lastPrintingRow} onPrint={startPillsPrint} confirmModal={confirmModal} pillsClashNote={pillsClashNote} onDismissPillsClashNote={() => setPillsClashNote(null)} />

  return <main className="app-shell">{appHeader}{!selected && !floor ? <FloorPickerScreen today={today} floors={visibleFloors} specialWards={visibleSpecialWards} resumeDraft={resumeDraft} onResume={resumeFromDraft} onPickFloor={setFloor} onOpen={setSelected} dashboard={dashboardData} dashboardLoading={dashboardData === null && !dashboardError} dashboardError={dashboardError} onRetryDashboard={retryDashboard} announcements={announcements} isManager={isManager} announcementDraft={announcementDraft} setAnnouncementDraft={setAnnouncementDraft} announcementError={announcementError} announcementBusy={announcementBusy} onPostAnnouncement={postAnnouncement} onEditAnnouncement={editAnnouncement} onDeleteAnnouncement={deleteAnnouncement} /> : !selected ? <WardPickerScreen floor={floor} today={today} dashboard={dashboardData} dashboardError={dashboardError} onBack={() => setFloor(null)} onOpen={setSelected} /> :<ChartScreen selected={selected} wardLabel={wardLabel} today={today} todayWeekday={todayWeekday} isManager={isManager} onBack={() => { flushChart(); setSelected(null) }} onGoToPills={() => { flushChart(); setSelected({ ...selected, mode: 'pills' }) }} onGoToOrder={() => { flushChart(); setSelected({ ...selected, mode: 'order' }) }} onExportPdf={exportChartPdf} pdfBusy={pdfBusy} pdfExportError={pdfExportError} dateIsToday={dateIsToday} selectedDate={selectedDate} onChangeDate={changeDate} onCopyToNextDay={copyToNextDay} chartSaveStatus={chartSaveStatus} loadError={loadError} copyError={copyError} chartReady={chartReady} lastChartSaveAt={lastChartSaveAt} chartCompleted={chartCompleted} completedByName={completedByName} onToggleComplete={toggleChartComplete} onRetryLoad={() => setChartLoadNonce((n) => n + 1)} onRetrySave={() => setChartSaveNonce((n) => n + 1)} lockState={lockState} lockHolder={lockHolder} chartClashNote={chartClashNote} onDismissClashNote={() => { setChartClashNote(null); setDroppedCells({}) }} droppedCells={droppedCells} undo={undo} onUndo={takeUndo} medicines={medicines} patientNames={patientNames} columnMedicines={columnMedicines} quantities={quantities} totals={totals} doubledTotals={doubledTotals} isThursday={isThursday} activeRow={activeRow} activeColumn={activeColumn} labelBelow={labelBelow} setActiveRow={setActiveRow} setActiveColumn={setActiveColumn} setLabelBelow={setLabelBelow} onSetColumnMedicine={setColumnMedicine} onCommitColumnMedicine={commitColumnMedicine} columnMedicineNotice={columnMedicineNotice} onDismissNotice={() => setColumnMedicineNotice(null)} onApplySuggestion={applyMedicineSuggestion} onSetPatientName={setPatientName} onCheckPreviousDay={checkPreviousDayPatient} onUpdateQuantity={updateQuantity} onCollapseRow={collapseRow} onAddColumn={addColumn} canAddColumn={canAddColumn} chartFrameRef={chartFrameRef} chartHeadRef={chartHeadRef} chartGridRef={chartGridRef} chartDosesRef={chartDosesRef} chartFootRef={chartFootRef} showMedicineForm={showMedicineForm} onOpenMedicineForm={() => { setRegistrationsError(''); setShowMedicineForm(true) }} onCloseMedicineForm={() => setShowMedicineForm(false)} onAddMedicine={addMedicine} newMedicine={newMedicine} setNewMedicine={setNewMedicine} registrationsError={registrationsError} />}{selected?.mode === 'chart' && chartReady && <ChartPrintTemplate ref={printTemplateRef} selected={selected} today={today} todayWeekday={todayWeekday} isThursday={isThursday} patientNames={patientNames} columnMedicines={columnMedicines} quantities={quantities} totals={totals} doubledTotals={doubledTotals} />}{confirmModal}{copyChoiceModal}</main>
}

export default App
