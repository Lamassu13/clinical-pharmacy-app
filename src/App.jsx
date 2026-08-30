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
// Fixed pill-form option lists. Keep in sync with server/index.js.
const doseTimes = ['٨ صباحًا', '٩ صباحًا', '١٠ صباحًا', '١١ صباحًا', '١٢ ظهرًا', '٢ ظهرًا', '٣ ظهرًا', '٤ عصرًا', '٥ عصرًا', '٦ مساءً', '٨ ليلًا', '٩ ليلًا', '١٠ ليلًا', '١٠ صباحًا - ١٠ مساءً', '١٢ ظهرًا - ١٢ ليلًا', '١٢ ظهرًا - ٨ ليلًا', '٨ صباحًا - ٤ عصرًا - ١٢ ليلًا', '٦ صباحًا - ١٢ ظهرًا - ٦ مساءً - ١٢ ليلًا']
const usageMethods = ['حبة بعد الطعام مباشرة', 'حبة قبل الطعام بساعة أو بعده بساعتين', '٢ حبة بعد الطعام مباشرة']
const starterMedicines = [
  'Acetylase 50mg/Vial', 'Actemra vial 200mg', 'Adenosine 6mg Amp', 'Adrenaline ampoule 1mg', 'Aldomet 250mg Tab', 'Allermine 10mg Amp', 'AmBisome 50mg', 'Amaryl 2mg Tab', 'Amikacin 500mg Vial', 'Aminophylline 250mg amp', 'Ambrisantan tablet 10mg', 'Amoxil 250mg/5ml Susp', 'Amoxil 500mg Cap', 'Angesid 0.5mg Tab', 'Angesid 10mg ampoule', 'Angesid 25mg ampoule', 'Anti D 1500 IU Inj', 'Apixaban 5mg tab', 'Apresoline 20mg Amp', 'Aransip 20mcg PFS', 'Aransip 40mcg PFS', 'Aspirin 100mg Tab', 'Atropine 1mg amp', 'Augmentin 312.5mg Susp', 'Augmentin 625mg tablet', 'Avas 20mg or 40mg Tab', 'Bosentan 125mg tab', 'Brilinta 90mg tab', 'Brufen 200mg Tab', 'Buscopan 10mg Tab', 'Caffeine amp', 'Calcium carbonate 500mg Tab', 'Capoten 25mg Tab', 'Carvedilol 6.25mg Tab', 'Ceftrixone 1g inj', 'Ciprodar 200mg vial', 'Ciprodar 500mg Tab', 'Cladribine 10mg tablet', 'Clexane prefilled syringe 4000 IU', 'Clexane prefilled syringe 6000 IU', 'Colistin 1000000 IU vial', 'Cyclocapron 500mg Amp', 'Daonil 5mg Tab', 'Decadrone 8mg Amp', 'Depomedrol 80mg Vial', 'Digoxin 250mcg Tab', 'Diltiazem 60mg tab', 'Dobutamine vial 250mg', 'Dopamine 200mg Amp', 'Dusptalin 135mg Tab', 'D.W', 'Ebixa 10mg Tab', 'Empadil 10mg tab', 'Enabrel 25mg PFs', 'Endoxan 500mg vial', 'Entresto 100mg tab', 'Entresto 50mg tab', 'Esmeron 50mg Amp', 'Ferrosam tablet 200mg', 'Ferrofolic cap', 'Flagyl 500mg tab', 'Flagyl 500mg Vial', 'Flamazine 1% Cream', 'Fluconazole 150mg cap', 'Forxiga 10mg tab', 'Forxiga 5mg tab', 'G/W 5% 500ml', 'Garamycin 80mg Amp', 'G/S 2.5%', 'G/S 5%', 'Glucophage 500mg Tab', 'Heparin', 'Histadin 4mg tablet', 'Human albumin 20% I.V.', 'Hyoscine 20mg Amp', 'Ibandronic acid 150mg', 'Inderal 40mg Tab', 'Insulin lente vial', 'Insulin mix vial', 'Insulin soluble vial', 'Isoptin 5mg Amp', 'KCl 15% amp', 'Keflex 500mg cap', 'Kemadrin 5mg Tab', 'Keppra 1000mg', 'Keppra 500mg', 'Keppra vial 100mg/ml', 'Ketamine 500mg Vial', 'Ketorolac 30mg amp', 'Lactulose Syp', 'Largactil 100mg Tab', 'Largactil 50mg Amp', 'Lasix 20mg Amp', 'Lasix 40mg Tab', 'Librium 5mg Tab', 'Lisinopril 10mg tab', 'Losartan 50mg Tab', 'Luminal 200mg Amp', 'Mannitol 20%', 'Mobic 7.5mg Tab', 'Meronem 1000gm Vial', 'Meronem 500gm Vial', 'Mesna 400mg Inj', 'Methoprim 480mg Tab', 'MgSO4 amp', 'MTX 50mg amp', 'Mycostatin Susp', 'Neostigmine 2.5mg Amp', 'NG Tube', 'Nimotop 30mg Tab', 'N/S 100ml', 'N/S 500ml', 'Nystacort Oint', 'Panadol 500mg Tab', 'Paracetamol 1g bottle', 'Pitocin 10units Amp', 'Plasil 10mg Amp', 'Plasil 10mg tab', 'Plavix 75mg tab', 'Prednisolone 5mg Tab', 'Propofol 1% amp', 'Protamine 10mg Amp', 'Qantavir 0.5mg tablet', 'Redepra 30mg Tab', 'Ringer Lactate', 'Ringer sol', 'Risek 20mg cap', 'Rivotrel 0.5mg Tab', 'Scolin 100mg Amp', 'Sevelamer 800mg Tab', 'Sinemet Tab', 'Sitagliptin 100mg tab', 'Singular 10mg Tab', 'Solumedrol 500mg inj', 'Solvodin 4mg/5ml Syp', 'Stugeron 25mg Tab', 'Survanta 25mg', 'Symbicort turbuhaler', 'Tegretol 200mg Tab', 'Tegretol tablet 200mg', 'Tigecycline vial 500mg', 'TPN I.V. infusion', 'Tracurium 50mg Amp', 'Tryptizole 25mg Tab', 'Tysabri 300mg vial', 'Valium 5mg Tab', 'Venofer 2% Amp', 'Ventolin inhalation', 'Vit. K1 (2 or 10)mg Amp', 'Voltarin 25mg Tab', 'Voltarin 75mg Amp', 'Voriconazole 200mg tab', 'Voriconazole vial 200mg', 'Xylocaine 2% Amp', 'Xylocaine 2% gel', 'Xylocaine 5% oint', 'Zofran ampoule 8mg', 'Zovirax vial 250mg',
].sort((firstMedicine, secondMedicine) => firstMedicine.localeCompare(secondMedicine))

const toEnglishDigits = (value) => value.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
const isoDate = (date) => new Date(date).toISOString().slice(0, 10)
const locationBody = (value) => {
  const asFloor = Number(value)
  if (floors.some((item) => item.number === asFloor)) return { floor: asFloor }
  if (specialWards.includes(value)) return { ward: value }
  return null
}
const apiUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api')

function MedicineRow({ item, onSave, onRemove }) {
  const [name, setName] = useState(item.name)
  const [arabicName, setArabicName] = useState(item.arabic_name || '')
  const dirty = name.trim() !== item.name || arabicName.trim() !== (item.arabic_name || '')
  return <tr>
    <td><input value={name} onChange={(event) => setName(event.target.value)} /></td>
    <td><input value={arabicName} onChange={(event) => setArabicName(event.target.value)} placeholder="—" /></td>
    <td className="requests-actions"><button className="primary-button compact" disabled={!dirty} onClick={() => onSave(item.id, name.trim(), arabicName.trim())}>حفظ</button><button className="secondary-button compact" onClick={() => onRemove(item.id, item.name)}>حذف</button></td>
  </tr>
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
  const [adminView, setAdminView] = useState(false)
  const [registrations, setRegistrations] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [pendingFloor, setPendingFloor] = useState({})
  const [registrationsError, setRegistrationsError] = useState('')
  const [floor, setFloor] = useState(null)
  const [selected, setSelected] = useState(null)
  const [medicines, setMedicines] = useState(starterMedicines)
  const [columnMedicines, setColumnMedicines] = useState(() => Array(51).fill(''))
  const [showMedicineForm, setShowMedicineForm] = useState(false)
  const [newMedicine, setNewMedicine] = useState('')
  const [patientNames, setPatientNames] = useState(() => Array.from({ length: 36 }, () => ''))
  const [quantities, setQuantities] = useState(() => Array.from({ length: 36 }, () => Array(51).fill('')))
  const previousPatientNames = useRef(patientNames)
  const [selectedDate, setSelectedDate] = useState(() => isoDate(new Date()))
  const [dailyRecords, setDailyRecords] = useState({})
  const [chartLoading, setChartLoading] = useState(false)
  const [loadedChartKey, setLoadedChartKey] = useState(null)
  const [saveError, setSaveError] = useState(false)
  const [pillsData, setPillsData] = useState(null)
  const [pillEntries, setPillEntries] = useState({})
  const [pillsLoading, setPillsLoading] = useState(false)
  const [loadedPillsKey, setLoadedPillsKey] = useState(null)
  const [pillsSaveError, setPillsSaveError] = useState(false)
  const [adminMedicines, setAdminMedicines] = useState([])
  const [medicineFilter, setMedicineFilter] = useState('')
  const today = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('ar-IQ')
  const totals = useMemo(() => quantities[0].map((_, columnIndex) => quantities.reduce((sum, row) => sum + (Number(row[columnIndex]) || 0), 0)), [quantities])

  useEffect(() => {
    fetch(`${apiUrl}/auth/me`, { credentials: 'include' })
      .then((response) => response.json())
      .then((result) => { if (result.user) { setCurrentUser(result.user); setIsLoggedIn(true) } })
      .catch(() => undefined)
  }, [])

  const submitLogin = async (event) => {
    event.preventDefault()
    setLoginError('')
    try {
      const response = await fetch(`${apiUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(credentials) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر تسجيل الدخول')
      setCurrentUser(result.user)
      setIsLoggedIn(true)
    } catch (error) { setLoginError(error.message || 'تعذر الاتصال بالخادم') }
  }
  const submitRegister = async (event) => {
    event.preventDefault()
    setRegisterError('')
    setRegisterSuccess('')
    try {
      const response = await fetch(`${apiUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(registerForm) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر إنشاء الحساب')
      setRegisterSuccess(result.message || 'تم إنشاء الحساب، بانتظار موافقة المدير')
      setRegisterForm({ fullName: '', username: '', phone: '', email: '', fingerprintNumber: '', password: '' })
    } catch (error) { setRegisterError(error.message || 'تعذر الاتصال بالخادم') }
  }
  const logout = useCallback(async () => {
    try { await fetch(`${apiUrl}/auth/logout`, { method: 'POST', credentials: 'include' }) } catch { /* ignore network errors on logout */ }
    setIsLoggedIn(false)
    setCurrentUser(null)
    setAdminView(false)
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
    if (!location) { setRegistrationsError('اختر الطابق أو الردهة قبل قبول الطلب'); return }
    setRegistrationsError('')
    try {
      const response = await fetch(`${apiUrl}/registrations/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status: 'active', ...location }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر قبول الطلب')
      setRegistrations((current) => current.filter((item) => item.id !== id))
      loadUsers()
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') }
  }, [pendingFloor, loadUsers])
  const rejectRegistration = useCallback(async (id) => {
    setRegistrationsError('')
    try {
      const response = await fetch(`${apiUrl}/registrations/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status: 'rejected' }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر رفض الطلب')
      setRegistrations((current) => current.filter((item) => item.id !== id))
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') }
  }, [])
  const assignLocationToUser = useCallback(async (id, value) => {
    const location = locationBody(value)
    if (!location) return
    setRegistrationsError('')
    try {
      const response = await fetch(`${apiUrl}/access/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(location) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر تعيين الموقع')
      setAllUsers((current) => current.map((user) => user.id === id ? { ...user, floors: location.floor ? [location.floor] : [], wards: location.ward ? [location.ward] : [] } : user))
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') }
  }, [])
  const deleteUser = useCallback(async (id, name) => {
    if (!window.confirm(`حذف المستخدم "${name}" نهائيًا؟`)) return
    setRegistrationsError('')
    try {
      const response = await fetch(`${apiUrl}/users/${id}`, { method: 'DELETE', credentials: 'include' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر حذف المستخدم')
      setAllUsers((current) => current.filter((user) => user.id !== id))
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') }
  }, [])
  const assignFloorFromPrompt = useCallback(async () => {
    const username = window.prompt('اسم المستخدم')?.trim()
    if (!username) return
    const selectedFloor = Number(toEnglishDigits(window.prompt('رقم الطابق المسموح: 2، 3، 4، 5، 6، 8، 9 أو 10') || ''))
    if (!floors.some((item) => item.number === selectedFloor)) { window.alert('رقم الطابق غير مسموح'); return }
    try {
      const response = await fetch(`${apiUrl}/access/by-username`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ username, floor: selectedFloor }) })
      const result = await response.json()
      window.alert(response.ok ? `تم تعيين الطابق ${selectedFloor} للمستخدم ${username}` : (result.message || 'تعذر تعيين الطابق'))
    } catch { window.alert('تعذر الاتصال بالخادم') }
  }, [])
  const loadMedicines = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/medicines`, { credentials: 'include' })
      const result = await response.json()
      if (!response.ok || !Array.isArray(result.medicines)) return
      setMedicines((current) => [...new Set([...starterMedicines, ...current, ...result.medicines.map((item) => item.name)])].sort((a, b) => a.localeCompare(b)))
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
    setRegistrationsError('')
    try {
      const response = await fetch(`${apiUrl}/medicines/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name, arabicName }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر تحديث الدواء')
      setAdminMedicines((current) => current.map((item) => item.id === id ? result.medicine : item))
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') }
  }, [])
  const removeMedicine = useCallback(async (id, name) => {
    if (!window.confirm(`حذف الدواء "${name}" من القائمة؟`)) return
    setRegistrationsError('')
    try {
      const response = await fetch(`${apiUrl}/medicines/${id}`, { method: 'DELETE', credentials: 'include' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر حذف الدواء')
      setAdminMedicines((current) => current.filter((item) => item.id !== id))
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') }
  }, [])
  useEffect(() => { if (adminView) { loadRegistrations(); loadUsers(); loadMedicinesAdmin() } }, [adminView, loadRegistrations, loadUsers, loadMedicinesAdmin])
  const addMedicine = async (event) => {
    event.preventDefault()
    const medicine = newMedicine.trim()
    if (!medicine) return
    setMedicines((current) => [...new Set([...current, medicine])].sort((a, b) => a.localeCompare(b)))
    setNewMedicine('')
    setShowMedicineForm(false)
    try {
      await fetch(`${apiUrl}/medicines`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name: medicine }) })
      if (adminView) loadMedicinesAdmin()
    } catch { /* it will also persist on the next chart autosave */ }
  }
  const updateQuantity = (rowIndex, columnIndex, value) => setQuantities((current) => current.map((row, currentRow) => currentRow === rowIndex ? row.map((quantity, currentColumn) => currentColumn === columnIndex ? toEnglishDigits(value).replace(/\D/g, '') : quantity) : row))

  useEffect(() => { if (isLoggedIn) loadMedicines() }, [isLoggedIn, loadMedicines])
  useEffect(() => {
    if (!selected || selected.mode === 'pills') return undefined
    loadMedicines()
    const timer = setInterval(loadMedicines, 60000)
    return () => clearInterval(timer)
  }, [selected, loadMedicines])

  useEffect(() => {
    if (!selected || selected.mode === 'pills') return undefined
    setChartLoading(true)
    setLoadedChartKey(null)
    setSaveError(false)
    const chartKey = `${selected.floor || 'special'}-${selected.ward}-${selectedDate}`
    const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, date: selectedDate })
    fetch(`${apiUrl}/chart?${params}`, { credentials: 'include' }).then((response) => response.json()).then((result) => {
      if (!result.chart) {
        setPatientNames(Array.from({ length: 36 }, () => ''))
        setQuantities(Array.from({ length: 36 }, () => Array(51).fill('')))
        setColumnMedicines(Array(51).fill(''))
        setLoadedChartKey(chartKey)
        return
      }
      const nextPatients = Array(36).fill('')
      result.chart.patients.forEach((patient) => { nextPatients[patient.row_number - 1] = patient.patient_name })
      const nextQuantities = Array.from({ length: 36 }, () => Array(51).fill(''))
      result.chart.quantities.forEach((quantity) => { nextQuantities[quantity.row_number - 1][quantity.column_number - 1] = String(quantity.quantity) })
      const nextColumns = Array(51).fill('')
      result.chart.columns.forEach((column) => { nextColumns[column.column_number - 1] = column.medicine_name || '' })
      setPatientNames(nextPatients); setQuantities(nextQuantities); setColumnMedicines(nextColumns)
      setLoadedChartKey(chartKey)
      requestAnimationFrame(() => document.querySelectorAll('.chart-table thead input.medicine-select').forEach((select, index) => { select.value = nextColumns[index] || '' }))
    }).catch(() => undefined).finally(() => setChartLoading(false))
    return undefined
  }, [selected, selectedDate])

  useEffect(() => {
    const chartKey = selected ? `${selected.floor || 'special'}-${selected.ward}-${selectedDate}` : null
    if (!selected || selected.mode === 'pills' || !isLoggedIn || chartLoading || loadedChartKey !== chartKey) return undefined
    let retryTimer
    const save = async () => {
      const patients = patientNames.map((name, index) => ({ rowNumber: index + 1, name }))
      const columns = columnMedicines.map((medicineName, index) => ({ columnNumber: index + 1, medicineName }))
      const savedQuantities = quantities.flatMap((row, rowIndex) => row.map((quantity, columnIndex) => quantity ? ({ rowNumber: rowIndex + 1, columnNumber: columnIndex + 1, quantity: Number(quantity) }) : []))
      try {
        const response = await fetch(`${apiUrl}/chart`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ floor: selected.floor, ward: selected.ward, date: selectedDate, patients, columns, quantities: savedQuantities }) })
        if (!response.ok) throw new Error('save failed')
        setSaveError(false)
      } catch {
        setSaveError(true)
        retryTimer = setTimeout(save, 4000)
      }
    }
    const timer = setTimeout(save, 2500)
    return () => { clearTimeout(timer); clearTimeout(retryTimer) }
  }, [chartLoading, columnMedicines, isLoggedIn, loadedChartKey, patientNames, quantities, selected, selectedDate])

  useEffect(() => {
    if (!selected || selected.mode !== 'pills') return undefined
    const pillsKey = `${selected.floor || 'special'}-${selected.ward}-${selectedDate}`
    setPillsLoading(true)
    setLoadedPillsKey(null)
    setPillsSaveError(false)
    const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, date: selectedDate })
    fetch(`${apiUrl}/pills?${params}`, { credentials: 'include' }).then((response) => response.json()).then((result) => {
      setPillsData(result.pills || null)
      const seed = {}
      ;(result.pills?.entries || []).forEach((entry) => { seed[`${entry.patientRowNumber}:${entry.medicineId}`] = { doseTime: entry.doseTime || '', usageMethod: entry.usageMethod || '' } })
      setPillEntries(seed)
      setLoadedPillsKey(pillsKey)
    }).catch(() => setPillsData(null)).finally(() => setPillsLoading(false))
    return undefined
  }, [selected, selectedDate])

  useEffect(() => {
    if (!selected || selected.mode !== 'pills' || !isLoggedIn || pillsLoading) return undefined
    const pillsKey = `${selected.floor || 'special'}-${selected.ward}-${selectedDate}`
    if (loadedPillsKey !== pillsKey || !pillsData) return undefined
    let retryTimer
    const save = async () => {
      const entries = Object.entries(pillEntries).map(([key, value]) => {
        const [patientRowNumber, medicineId] = key.split(':').map(Number)
        return { patientRowNumber, medicineId, doseTime: value.doseTime || '', usageMethod: value.usageMethod || '' }
      })
      try {
        const response = await fetch(`${apiUrl}/pills`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ floor: selected.floor, ward: selected.ward, date: selectedDate, entries }) })
        if (!response.ok) throw new Error('save failed')
        setPillsSaveError(false)
      } catch {
        setPillsSaveError(true)
        retryTimer = setTimeout(save, 4000)
      }
    }
    const timer = setTimeout(save, 2500)
    return () => { clearTimeout(timer); clearTimeout(retryTimer) }
  }, [isLoggedIn, loadedPillsKey, pillEntries, pillsData, pillsLoading, selected, selectedDate])

  useEffect(() => {
    const clearedRows = patientNames.reduce((rows, name, rowIndex) => {
      if (previousPatientNames.current[rowIndex].trim() && !name.trim()) rows.push(rowIndex)
      return rows
    }, [])
    if (clearedRows.length) setQuantities((current) => current.map((row, rowIndex) => clearedRows.includes(rowIndex) ? Array(51).fill('') : row))
    previousPatientNames.current = patientNames
  }, [patientNames])
  const changeDate = useCallback((nextDate) => {
    const recordKey = `${selected?.floor || floor?.number || 'main'}-${selected?.ward || 'main'}-${selectedDate}`
    const nextKey = `${selected?.floor || floor?.number || 'main'}-${selected?.ward || 'main'}-${nextDate}`
    setDailyRecords((current) => ({ ...current, [recordKey]: { patientNames, quantities } }))
    const nextRecord = dailyRecords[nextKey]
    setPatientNames(nextRecord?.patientNames || Array.from({ length: 36 }, () => ''))
    setQuantities(nextRecord?.quantities || Array.from({ length: 36 }, () => Array(51).fill('')))
    setSelectedDate(nextDate)
  }, [dailyRecords, floor, patientNames, quantities, selected, selectedDate])
  const copyToNextDay = useCallback(() => {
    const nextDate = isoDate(new Date(`${selectedDate}T12:00:00`).getTime() + 86400000)
    const recordKey = `${selected?.floor || 'main'}-${selected?.ward || 'main'}-${nextDate}`
    setDailyRecords((current) => ({ ...current, [recordKey]: { patientNames: [...patientNames], quantities: quantities.map((row) => [...row]) } }))
    setPatientNames([...patientNames])
    setQuantities(quantities.map((row) => [...row]))
    setSelectedDate(nextDate)
  }, [patientNames, quantities, selected, selectedDate])

  useEffect(() => {
    const meta = document.querySelector('.chart-meta')
    if (!meta || !selected || selected.mode === 'pills') return undefined
    const controls = document.createElement('span')
    controls.className = 'date-controls'
    controls.innerHTML = '<label>التاريخ <input type="date" aria-label="تاريخ الجارت"></label><button type="button">نسخ إلى اليوم التالي</button>'
    const dateInput = controls.querySelector('input')
    const copyButton = controls.querySelector('button')
    dateInput.value = selectedDate
    dateInput.addEventListener('change', (event) => changeDate(event.target.value))
    copyButton.addEventListener('click', copyToNextDay)
    meta.append(controls)
    const medicineSelects = document.querySelectorAll('.chart-table thead input.medicine-select')
    const syncColumnMedicines = () => setColumnMedicines(Array.from(medicineSelects, (select) => select.value))
    medicineSelects.forEach((select) => select.addEventListener('change', syncColumnMedicines))
    medicineSelects.forEach((select, index) => select.addEventListener('change', () => {
      setColumnMedicines((current) => current.map((medicine, medicineIndex) => medicineIndex === index ? select.value : medicine))
    }))
    return () => { controls.remove(); medicineSelects.forEach((select) => select.removeEventListener('change', syncColumnMedicines)) }
  }, [selected, selectedDate, patientNames, quantities, dailyRecords, changeDate, copyToNextDay])
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

  if (!isLoggedIn && authView === 'register') return <main className="login-shell"><section className="login-card"><img className="hospital-logo login-logo" src={hospitalLogo} alt="شعار مستشفى بغداد التعليمي" /><p className="eyebrow">مستشفى بغداد التعليمي</p><h1>إنشاء حساب جديد</h1><p className="login-intro">أدخل بياناتك، وسيتم تفعيل الحساب بعد موافقة المدير</p><form onSubmit={submitRegister} className="login-form"><label>الاسم الكامل<input value={registerForm.fullName} onChange={(event) => setRegisterForm({ ...registerForm, fullName: event.target.value })} required /></label><label>اسم المستخدم<input value={registerForm.username} onChange={(event) => setRegisterForm({ ...registerForm, username: event.target.value })} required /></label><label>رقم الهاتف<input type="tel" value={registerForm.phone} onChange={(event) => setRegisterForm({ ...registerForm, phone: event.target.value })} required /></label><label>البريد الإلكتروني<input type="email" value={registerForm.email} onChange={(event) => setRegisterForm({ ...registerForm, email: event.target.value })} required /></label><label>رقم البصمة<input value={registerForm.fingerprintNumber} onChange={(event) => setRegisterForm({ ...registerForm, fingerprintNumber: event.target.value })} required /></label><label>كلمة المرور<input type="password" minLength={6} value={registerForm.password} onChange={(event) => setRegisterForm({ ...registerForm, password: event.target.value })} required /></label>{registerError && <p className="form-error">{registerError}</p>}{registerSuccess && <p className="form-success">{registerSuccess}</p>}<button className="primary-button" type="submit">إنشاء الحساب <span>←</span></button></form><button type="button" className="text-button" onClick={() => { setAuthView('login'); setRegisterError(''); setRegisterSuccess('') }}>لديك حساب؟ تسجيل الدخول</button></section></main>

  if (!isLoggedIn) return <main className="login-shell"><section className="login-card"><img className="hospital-logo login-logo" src={hospitalLogo} alt="شعار مستشفى بغداد التعليمي" /><p className="eyebrow">مستشفى بغداد التعليمي</p><h1>وحدة الصيدلة السريرية</h1><p className="login-intro">سجل الدخول للوصول إلى جداول الجارت اليومية</p><form onSubmit={submitLogin} className="login-form"><label>اسم المستخدم<input value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} required /></label><label>كلمة المرور<input type="password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} required /></label>{loginError && <p className="form-error">{loginError}</p>}<button className="primary-button" type="submit">تسجيل الدخول <span>←</span></button></form><button type="button" className="secondary-button" onClick={() => { setAuthView('register'); setLoginError('') }}>إنشاء حساب</button><p className="security-note">الحسابات الجديدة بانتظار موافقة المدير</p></section></main>

  if (adminView && currentUser?.role === 'admin') return <main className="app-shell"><header className="topbar"><div className="topbar-brand"><img className="hospital-logo header-logo" src={hospitalLogo} alt="شعار مستشفى بغداد التعليمي" /><div><strong>الصيدلة السريرية</strong><small>مستشفى بغداد التعليمي</small></div></div><div className="user-menu"><button onClick={() => setAdminView(false)} className="text-button">→ عودة</button></div></header><section className="dashboard"><div className="section-heading"><div><p className="eyebrow">إدارة الحسابات</p><h1>طلبات الانضمام</h1><p>عند القبول اختر الطابق أو الردهة المسموح بها للمستخدم.</p></div><button className="secondary-button" onClick={() => { loadRegistrations(); loadUsers() }}>تحديث</button></div>{registrationsError && <p className="form-error">{registrationsError}</p>}{registrations.length === 0 ? <p className="login-intro">لا توجد طلبات قيد الانتظار.</p> : <div className="table-frame"><table className="requests-table"><thead><tr><th>الاسم الكامل</th><th>اسم المستخدم</th><th>الهاتف</th><th>البريد الإلكتروني</th><th>رقم البصمة</th><th>الطابق / الردهة</th><th>إجراء</th></tr></thead><tbody>{registrations.map((item) => <tr key={item.id}><td>{item.full_name}</td><td>{item.username}</td><td>{item.phone}</td><td>{item.email}</td><td>{item.fingerprint_number}</td><td><select value={pendingFloor[item.id] || ''} onChange={(event) => setPendingFloor((current) => ({ ...current, [item.id]: event.target.value }))}><option value="">اختر</option><optgroup label="الطوابق">{floors.map((floorOption) => <option key={floorOption.number} value={floorOption.number}>الطابق {floorOption.number}</option>)}</optgroup><optgroup label="ردهات خاصة">{specialWards.map((ward) => <option key={ward} value={ward}>{ward}</option>)}</optgroup></select></td><td className="requests-actions"><button className="primary-button compact" onClick={() => approveRegistration(item.id)}>قبول</button><button className="secondary-button compact" onClick={() => rejectRegistration(item.id)}>رفض</button></td></tr>)}</tbody></table></div>}<div className="section-heading admin-users-heading"><div><p className="eyebrow">المستخدمون</p><h1>جميع المستخدمين</h1><p>الحسابات المسجلة في النظام.</p></div></div>{allUsers.length === 0 ? <p className="login-intro">لا يوجد مستخدمون.</p> : <div className="table-frame"><table className="requests-table"><thead><tr><th>الاسم الكامل</th><th>اسم المستخدم</th><th>البريد الإلكتروني</th><th>الهاتف</th><th>الدور</th><th>الحالة</th><th>الطابق / الردهة</th><th>إجراء</th></tr></thead><tbody>{allUsers.map((user) => <tr key={user.id}><td>{user.full_name}</td><td>{user.username}</td><td>{user.email}</td><td>{user.phone}</td><td>{user.role === 'admin' ? 'مدير' : 'مستخدم'}</td><td>{({ pending: 'قيد الانتظار', active: 'مفعل', rejected: 'مرفوض', suspended: 'موقوف' })[user.account_status] || user.account_status}</td><td><select value={(user.floors || [])[0] || (user.wards || [])[0] || ''} onChange={(event) => assignLocationToUser(user.id, event.target.value)}><option value="">بدون</option><optgroup label="الطوابق">{floors.map((floorOption) => <option key={floorOption.number} value={floorOption.number}>الطابق {floorOption.number}</option>)}</optgroup><optgroup label="ردهات خاصة">{specialWards.map((ward) => <option key={ward} value={ward}>{ward}</option>)}</optgroup></select></td><td className="requests-actions">{user.id !== currentUser.id && <button className="secondary-button compact" onClick={() => deleteUser(user.id, user.full_name)}>حذف</button>}</td></tr>)}</tbody></table></div>}<div className="section-heading admin-users-heading"><div><p className="eyebrow">الأدوية</p><h1>إدارة الأدوية</h1><p>أضف دواءً، عدّل الاسم الإنجليزي أو العربي، أو احذفه. الاسم العربي يظهر في استمارة الحبوب.</p></div></div><form className="medicine-add-row" onSubmit={addMedicine}><input placeholder="اسم دواء جديد (إنجليزي)" value={newMedicine} onChange={(event) => setNewMedicine(event.target.value)} /><button className="primary-button compact" type="submit">إضافة</button></form><input className="medicine-filter" placeholder="بحث في الأدوية…" value={medicineFilter} onChange={(event) => setMedicineFilter(event.target.value)} /><div className="table-frame"><table className="requests-table"><thead><tr><th>الاسم (إنجليزي)</th><th>الاسم بالعربية</th><th>إجراء</th></tr></thead><tbody>{adminMedicines.filter((item) => !medicineFilter.trim() || `${item.name} ${item.arabic_name || ''}`.toLowerCase().includes(medicineFilter.trim().toLowerCase())).map((item) => <MedicineRow key={item.id} item={item} onSave={saveMedicine} onRemove={removeMedicine} />)}</tbody></table></div></section></main>

  if (selected && selected.mode === 'pills') return <main className="app-shell"><header className="topbar"><div className="topbar-brand"><img className="hospital-logo header-logo" src={hospitalLogo} alt="شعار مستشفى بغداد التعليمي" /><div><strong>الصيدلة السريرية</strong><small>مستشفى بغداد التعليمي</small></div></div><div className="user-menu"><span>{currentUser?.fullName || 'مستخدم'}</span><button onClick={logout} className="text-button">تسجيل الخروج</button></div></header><section className="pills-page"><div className="chart-toolbar pills-toolbar"><button className="back-button" onClick={() => setSelected(null)}>→ العودة للردهات</button><div><p className="eyebrow">استمارة إعطاء الحبوب</p><h1>{selected.ward}</h1></div><div className="toolbar-actions"><label className="pills-date">التاريخ <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label><span className={pillsSaveError ? 'save-state save-state-error' : 'save-state'}>{pillsSaveError ? '⚠ لم يُحفظ — تُعاد المحاولة…' : '● محفوظ تلقائيًا'}</span><button className="primary-button compact" onClick={() => window.print()}>طباعة</button></div></div>{pillsLoading ? <p className="login-intro">جارٍ التحميل…</p> : !pillsData ? <p className="login-intro">لا يوجد جارت محفوظ لهذا اليوم — سجّل الجارت أولًا.</p> : pillsData.patients.length === 0 ? <p className="login-intro">لا يوجد مرضى لديهم حبوب (Tab / Cap) في جارت هذا اليوم.</p> : pillsData.patients.map((patient) => <article className="pill-form" key={patient.rowNumber}><div className="pill-form-head"><img className="hospital-logo header-logo" src={hospitalLogo} alt="" /><div className="pill-form-title"><strong>مستشفى بغداد التعليمي</strong><span>وحدة الصيدلة السريرية — {selected.ward}</span></div><div className="pill-form-patient"><strong>{patient.name}</strong><span>{today}</span></div></div><table className="pill-table"><thead><tr><th>العلاج</th><th>وقت الجرعة</th><th>طريقة الاستخدام</th></tr></thead><tbody>{pillsData.medicines.filter((med) => (pillsData.matrix[patient.rowNumber] || []).includes(med.id)).map((med) => { const key = `${patient.rowNumber}:${med.id}`; const entry = pillEntries[key] || { doseTime: '', usageMethod: '' }; return <tr key={med.id}><td>{med.arabicName || med.name}</td><td><select value={entry.doseTime} onChange={(event) => setPillEntries((current) => ({ ...current, [key]: { ...entry, doseTime: event.target.value } }))}><option value="">—</option>{doseTimes.map((option) => <option key={option} value={option}>{option}</option>)}</select></td><td><select value={entry.usageMethod} onChange={(event) => setPillEntries((current) => ({ ...current, [key]: { ...entry, usageMethod: event.target.value } }))}><option value="">—</option>{usageMethods.map((option) => <option key={option} value={option}>{option}</option>)}</select></td></tr> })}</tbody></table></article>)}</section></main>

  return <main className="app-shell"><header className="topbar"><div className="topbar-brand"><img className="hospital-logo header-logo" src={hospitalLogo} alt="شعار مستشفى بغداد التعليمي" /><div><strong>الصيدلة السريرية</strong><small>مستشفى بغداد التعليمي</small></div></div><div className="user-menu">{currentUser?.role === 'admin' && <button className="secondary-button compact" onClick={() => setAdminView(true)}>طلبات الانضمام</button>}{currentUser?.role === 'admin' && <button className="text-button" onClick={assignFloorFromPrompt}>تعيين الطابق</button>}<span>{currentUser?.fullName || 'مستخدم'}</span><button onClick={logout} className="text-button">تسجيل الخروج</button></div></header>{!selected && !floor ? <section className="dashboard"><div className="section-heading"><div><p className="eyebrow">مساحة العمل اليومية</p><h1>اختر الطابق أو الردهة</h1><p>ابدأ باختيار موقع الجارت الذي تريد تسجيله أو مراجعته.</p></div><div className="date-chip"><span>اليوم</span><strong>{today}</strong></div></div><div className="location-grid">{floors.map((item) => <button className="location-card" key={item.number} onClick={() => setFloor(item)}><span className="floor-number">{item.number}</span><span><strong>الطابق {item.number}</strong><small>{item.wards.length} أروقة فرعية</small></span><span className="arrow">←</span></button>)}{specialWards.map((ward) => <div className="location-card special" key={ward}><span className="floor-number">✚</span><span><strong>{ward}</strong></span><span className="ward-card-actions"><button className="secondary-button compact" onClick={() => setSelected({ floor: null, ward, mode: 'chart' })}>الجارت</button><button className="primary-button compact" onClick={() => setSelected({ floor: null, ward, mode: 'pills' })}>الحبوب</button></span></div>)}</div></section> : !selected ? <section className="dashboard"><button className="back-button" onClick={() => setFloor(null)}>→ العودة للطوابق</button><div className="section-heading"><div><p className="eyebrow">الطابق {floor.number}</p><h1>اختر الردهة</h1><p>اختر «الجارت» لتسجيل الجرعات، أو «الحبوب» لاستمارة إعطاء الحبوب.</p></div></div><div className="location-grid">{floor.wards.map((ward) => <div className="location-card" key={ward}><span className="floor-number">{floor.number}</span><span><strong>{ward}</strong></span><span className="ward-card-actions"><button className="secondary-button compact" onClick={() => setSelected({ floor: floor.number, ward, mode: 'chart' })}>الجارت</button><button className="primary-button compact" onClick={() => setSelected({ floor: floor.number, ward, mode: 'pills' })}>الحبوب</button></span></div>)}</div></section> : <section className="chart-page"><div className="chart-toolbar"><button className="back-button" onClick={() => { setSelected(null); setFloor(null) }}>→ العودة للطوابق</button><div><p className="eyebrow">الجارت اليومي</p><h1>{selected.ward}</h1></div><div className="toolbar-actions"><button className="secondary-button" onClick={() => setShowMedicineForm(true)}>+ علاج جديد</button><button className="primary-button compact" onClick={() => window.print()}>طباعة A4</button></div></div><div className="chart-meta">{selected.floor && <span>الطابق: <b>{selected.floor}</b></span>}<span>الفرع: <b>{selected.ward}</b></span><span>التاريخ: <b>{today}</b></span><span className={saveError ? 'save-state save-state-error' : 'save-state'}>{saveError ? '⚠ لم يُحفظ — تُعاد المحاولة…' : '● محفوظ تلقائيًا'}</span></div><datalist id="medicine-options">{medicines.map((medicine) => <option key={medicine} value={medicine} />)}</datalist><div className="table-frame"><table className="chart-table"><thead><tr><th className="patient-header"><img className="header-watermark" src={hospitalLogo} alt="" /><span>مستشفى بغداد التعليمي</span><span>وحدة الصيدلة السريرية</span>{selected.floor && <span>الطابق {selected.floor}</span>}<span>{selected.ward}</span><span>{today}</span></th>{Array.from({ length: 51 }, (_, index) => <th key={index}><input className="medicine-select" list="medicine-options" defaultValue="" placeholder="دواء" title="اكتب أول حروف الدواء" /></th>)}</tr></thead><tbody>{patientNames.map((name, rowIndex) => <tr key={rowIndex}><th className="patient-cell"><input value={name} onChange={(event) => setPatientNames((current) => current.map((patient, index) => index === rowIndex ? event.target.value : patient))} placeholder={`مريض ${rowIndex + 1}`} /></th>{Array.from({ length: 51 }, (_, columnIndex) => <td key={columnIndex}><input inputMode="numeric" pattern="[0-9]*" value={quantities[rowIndex][columnIndex]} onChange={(event) => updateQuantity(rowIndex, columnIndex, event.target.value)} /></td>)}</tr>)}</tbody><tfoot><tr><th className="patient-header">المجموع</th>{totals.map((total, index) => <td key={index}>{total || ''}</td>)}</tr></tfoot></table></div>{showMedicineForm && <div className="modal-backdrop" onClick={() => setShowMedicineForm(false)}><form className="medicine-modal" onSubmit={addMedicine} onClick={(event) => event.stopPropagation()}><button type="button" className="close-button" onClick={() => setShowMedicineForm(false)}>×</button><p className="eyebrow">قائمة الأدوية العامة</p><h2>إضافة علاج جديد</h2><label>اسم العلاج<input autoFocus value={newMedicine} onChange={(event) => setNewMedicine(event.target.value)} required /></label><button className="primary-button" type="submit">إضافة إلى القائمة</button></form></div>}</section>}</main>
}

export default App
