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
const starterMedicines = [
  'Acetylase 50mg/Vial', 'Actemra vial 200mg', 'Adenosine 6mg Amp', 'Adrenaline ampoule 1mg', 'Aldomet 250mg Tab', 'Allermine 10mg Amp', 'AmBisome 50mg', 'Amaryl 2mg Tab', 'Amikacin 500mg Vial', 'Aminophylline 250mg amp', 'Ambrisantan tablet 10mg', 'Amoxil 250mg/5ml Susp', 'Amoxil 500mg Cap', 'Angesid 0.5mg Tab', 'Angesid 10mg ampoule', 'Angesid 25mg ampoule', 'Anti D 1500 IU Inj', 'Apixaban 5mg tab', 'Apresoline 20mg Amp', 'Aransip 20mcg PFS', 'Aransip 40mcg PFS', 'Aspirin 100mg Tab', 'Atropine 1mg amp', 'Augmentin 312.5mg Susp', 'Augmentin 625mg tablet', 'Avas 20mg or 40mg Tab', 'Bosentan 125mg tab', 'Brilinta 90mg tab', 'Brufen 200mg Tab', 'Buscopan 10mg Tab', 'Caffeine amp', 'Calcium carbonate 500mg Tab', 'Capoten 25mg Tab', 'Carvedilol 6.25mg Tab', 'Ceftrixone 1g inj', 'Ciprodar 200mg vial', 'Ciprodar 500mg Tab', 'Cladribine 10mg tablet', 'Clexane prefilled syringe 4000 IU', 'Clexane prefilled syringe 6000 IU', 'Colistin 1000000 IU vial', 'Cyclocapron 500mg Amp', 'Daonil 5mg Tab', 'Decadrone 8mg Amp', 'Depomedrol 80mg Vial', 'Digoxin 250mcg Tab', 'Diltiazem 60mg tab', 'Dobutamine vial 250mg', 'Dopamine 200mg Amp', 'Dusptalin 135mg Tab', 'D.W', 'Ebixa 10mg Tab', 'Empadil 10mg tab', 'Enabrel 25mg PFs', 'Endoxan 500mg vial', 'Entresto 100mg tab', 'Entresto 50mg tab', 'Esmeron 50mg Amp', 'Ferrosam tablet 200mg', 'Ferrofolic cap', 'Flagyl 500mg tab', 'Flagyl 500mg Vial', 'Flamazine 1% Cream', 'Fluconazole 150mg cap', 'Forxiga 10mg tab', 'Forxiga 5mg tab', 'G/W 5% 500ml', 'Garamycin 80mg Amp', 'G/S 2.5%', 'G/S 5%', 'Glucophage 500mg Tab', 'Heparin', 'Histadin 4mg tablet', 'Human albumin 20% I.V.', 'Hyoscine 20mg Amp', 'Ibandronic acid 150mg', 'Inderal 40mg Tab', 'Insulin lente vial', 'Insulin mix vial', 'Insulin soluble vial', 'Isoptin 5mg Amp', 'KCl 15% amp', 'Keflex 500mg cap', 'Kemadrin 5mg Tab', 'Keppra 1000mg', 'Keppra 500mg', 'Keppra vial 100mg/ml', 'Ketamine 500mg Vial', 'Ketorolac 30mg amp', 'Lactulose Syp', 'Largactil 100mg Tab', 'Largactil 50mg Amp', 'Lasix 20mg Amp', 'Lasix 40mg Tab', 'Librium 5mg Tab', 'Lisinopril 10mg tab', 'Losartan 50mg Tab', 'Luminal 200mg Amp', 'Mannitol 20%', 'Mobic 7.5mg Tab', 'Meronem 1000gm Vial', 'Meronem 500gm Vial', 'Mesna 400mg Inj', 'Methoprim 480mg Tab', 'MgSO4 amp', 'MTX 50mg amp', 'Mycostatin Susp', 'Neostigmine 2.5mg Amp', 'NG Tube', 'Nimotop 30mg Tab', 'N/S 100ml', 'N/S 500ml', 'Nystacort Oint', 'Panadol 500mg Tab', 'Paracetamol 1g bottle', 'Pitocin 10units Amp', 'Plasil 10mg Amp', 'Plasil 10mg tab', 'Plavix 75mg tab', 'Prednisolone 5mg Tab', 'Propofol 1% amp', 'Protamine 10mg Amp', 'Qantavir 0.5mg tablet', 'Redepra 30mg Tab', 'Ringer Lactate', 'Ringer sol', 'Risek 20mg cap', 'Rivotrel 0.5mg Tab', 'Scolin 100mg Amp', 'Sevelamer 800mg Tab', 'Sinemet Tab', 'Sitagliptin 100mg tab', 'Singular 10mg Tab', 'Solumedrol 500mg inj', 'Solvodin 4mg/5ml Syp', 'Stugeron 25mg Tab', 'Survanta 25mg', 'Symbicort turbuhaler', 'Tegretol 200mg Tab', 'Tegretol tablet 200mg', 'Tigecycline vial 500mg', 'TPN I.V. infusion', 'Tracurium 50mg Amp', 'Tryptizole 25mg Tab', 'Tysabri 300mg vial', 'Valium 5mg Tab', 'Venofer 2% Amp', 'Ventolin inhalation', 'Vit. K1 (2 or 10)mg Amp', 'Voltarin 25mg Tab', 'Voltarin 75mg Amp', 'Voriconazole 200mg tab', 'Voriconazole vial 200mg', 'Xylocaine 2% Amp', 'Xylocaine 2% gel', 'Xylocaine 5% oint', 'Zofran ampoule 8mg', 'Zovirax vial 250mg',
].sort((firstMedicine, secondMedicine) => firstMedicine.localeCompare(secondMedicine))

const toEnglishDigits = (value) => value.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
const isoDate = (date) => new Date(date).toISOString().slice(0, 10)
const apiUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api')

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
  const today = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('ar-IQ')
  const totals = useMemo(() => quantities[0].map((_, columnIndex) => quantities.reduce((sum, row) => sum + (Number(row[columnIndex]) || 0), 0)), [quantities])

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
  const loadRegistrations = useCallback(async () => {
    setRegistrationsError('')
    try {
      const response = await fetch(`${apiUrl}/registrations`, { credentials: 'include' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر جلب الطلبات')
      setRegistrations(result.registrations)
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') }
  }, [])
  const decideRegistration = useCallback(async (id, status) => {
    try {
      const response = await fetch(`${apiUrl}/registrations/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'تعذر تحديث الطلب')
      setRegistrations((current) => current.filter((item) => item.id !== id))
    } catch (error) { setRegistrationsError(error.message || 'تعذر الاتصال بالخادم') }
  }, [])
  useEffect(() => { if (adminView) loadRegistrations() }, [adminView, loadRegistrations])
  const assignFloorFromPrompt = useCallback(() => {
    const username = window.prompt('اسم المستخدم')?.trim()
    const selectedFloor = Number(window.prompt('رقم الطابق المسموح: 2، 3، 4، 5، 6، 8، 9 أو 10'))
    if (username && floors.some((item) => item.number === selectedFloor)) fetch(`${apiUrl}/access/by-username`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ username, floor: selectedFloor }) })
  }, [])
  const addMedicine = (event) => { event.preventDefault(); const medicine = newMedicine.trim(); if (!medicine) return; setMedicines((current) => [...new Set([...current, medicine])].sort((a, b) => a.localeCompare(b))); setNewMedicine(''); setShowMedicineForm(false) }
  const updateQuantity = (rowIndex, columnIndex, value) => setQuantities((current) => current.map((row, currentRow) => currentRow === rowIndex ? row.map((quantity, currentColumn) => currentColumn === columnIndex ? toEnglishDigits(value).replace(/\D/g, '') : quantity) : row))

  useEffect(() => {
    if (!selected) return undefined
    setChartLoading(true)
    setLoadedChartKey(null)
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
      requestAnimationFrame(() => document.querySelectorAll('.chart-table thead select').forEach((select, index) => { select.value = nextColumns[index] || '' }))
    }).catch(() => undefined).finally(() => setChartLoading(false))
    return undefined
  }, [selected, selectedDate])

  useEffect(() => {
    const chartKey = selected ? `${selected.floor || 'special'}-${selected.ward}-${selectedDate}` : null
    if (!selected || !isLoggedIn || chartLoading || loadedChartKey !== chartKey) return undefined
    const timer = setTimeout(() => {
      const patients = patientNames.map((name, index) => ({ rowNumber: index + 1, name }))
      const columns = columnMedicines.map((medicineName, index) => ({ columnNumber: index + 1, medicineName }))
      const savedQuantities = quantities.flatMap((row, rowIndex) => row.map((quantity, columnIndex) => quantity ? ({ rowNumber: rowIndex + 1, columnNumber: columnIndex + 1, quantity: Number(quantity) }) : []))
      fetch(`${apiUrl}/chart`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ floor: selected.floor, ward: selected.ward, date: selectedDate, patients, columns, quantities: savedQuantities }) }).catch(() => undefined)
    }, 500)
    return () => clearTimeout(timer)
  }, [chartLoading, columnMedicines, isLoggedIn, loadedChartKey, patientNames, quantities, selected, selectedDate])

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
    if (!meta || !selected) return undefined
    const controls = document.createElement('span')
    controls.className = 'date-controls'
    controls.innerHTML = '<label>التاريخ <input type="date" aria-label="تاريخ الجارت"></label><button type="button">نسخ إلى اليوم التالي</button>'
    const dateInput = controls.querySelector('input')
    const copyButton = controls.querySelector('button')
    dateInput.value = selectedDate
    dateInput.addEventListener('change', (event) => changeDate(event.target.value))
    copyButton.addEventListener('click', copyToNextDay)
    meta.append(controls)
    const medicineSelects = document.querySelectorAll('.chart-table thead select')
    const syncColumnMedicines = () => setColumnMedicines(Array.from(medicineSelects, (select) => select.value))
    medicineSelects.forEach((select) => select.addEventListener('change', syncColumnMedicines))
    medicineSelects.forEach((select, index) => select.addEventListener('change', () => {
      setColumnMedicines((current) => current.map((medicine, medicineIndex) => medicineIndex === index ? select.value : medicine))
    }))
    return () => { controls.remove(); medicineSelects.forEach((select) => select.removeEventListener('change', syncColumnMedicines)) }
  }, [selected, selectedDate, patientNames, quantities, dailyRecords, changeDate, copyToNextDay])
  useEffect(() => {
    const userMenu = document.querySelector('.user-menu')
    if (!userMenu || currentUser?.role !== 'admin') return undefined
    const accessButton = document.createElement('button')
    accessButton.className = 'text-button'
    accessButton.textContent = 'تعيين الطابق'
    accessButton.addEventListener('click', assignFloorFromPrompt)
    const requestsButton = document.createElement('button')
    requestsButton.className = 'text-button'
    requestsButton.textContent = 'طلبات الانضمام'
    requestsButton.addEventListener('click', () => setAdminView(true))
    userMenu.prepend(accessButton)
    userMenu.prepend(requestsButton)
    return () => { accessButton.remove(); requestsButton.remove() }
  }, [currentUser, assignFloorFromPrompt])
  useEffect(() => {
    const cards = document.querySelectorAll('.location-card:not(.special)')
    cards.forEach((card) => {
      const number = Number(card.querySelector('.floor-number')?.textContent)
      card.hidden = currentUser?.role !== 'admin' && number !== currentUser?.assignedFloor
    })
    document.querySelectorAll('.location-card.special').forEach((card) => { card.hidden = currentUser?.role !== 'admin' })
  }, [currentUser, floor, selected])

  if (!isLoggedIn && authView === 'register') return <main className="login-shell"><section className="login-card"><img className="hospital-logo login-logo" src={hospitalLogo} alt="شعار مستشفى بغداد التعليمي" /><p className="eyebrow">مستشفى بغداد التعليمي</p><h1>إنشاء حساب جديد</h1><p className="login-intro">أدخل بياناتك، وسيتم تفعيل الحساب بعد موافقة المدير</p><form onSubmit={submitRegister} className="login-form"><label>الاسم الكامل<input value={registerForm.fullName} onChange={(event) => setRegisterForm({ ...registerForm, fullName: event.target.value })} required /></label><label>اسم المستخدم<input value={registerForm.username} onChange={(event) => setRegisterForm({ ...registerForm, username: event.target.value })} required /></label><label>رقم الهاتف<input type="tel" value={registerForm.phone} onChange={(event) => setRegisterForm({ ...registerForm, phone: event.target.value })} required /></label><label>البريد الإلكتروني<input type="email" value={registerForm.email} onChange={(event) => setRegisterForm({ ...registerForm, email: event.target.value })} required /></label><label>رقم البصمة<input value={registerForm.fingerprintNumber} onChange={(event) => setRegisterForm({ ...registerForm, fingerprintNumber: event.target.value })} required /></label><label>كلمة المرور<input type="password" minLength={6} value={registerForm.password} onChange={(event) => setRegisterForm({ ...registerForm, password: event.target.value })} required /></label>{registerError && <p className="form-error">{registerError}</p>}{registerSuccess && <p className="form-success">{registerSuccess}</p>}<button className="primary-button" type="submit">إنشاء الحساب <span>←</span></button></form><button type="button" className="text-button" onClick={() => { setAuthView('login'); setRegisterError(''); setRegisterSuccess('') }}>لديك حساب؟ تسجيل الدخول</button></section></main>

  if (!isLoggedIn) return <main className="login-shell"><section className="login-card"><img className="hospital-logo login-logo" src={hospitalLogo} alt="شعار مستشفى بغداد التعليمي" /><p className="eyebrow">مستشفى بغداد التعليمي</p><h1>وحدة الصيدلة السريرية</h1><p className="login-intro">سجل الدخول للوصول إلى جداول الجارت اليومية</p><form onSubmit={submitLogin} className="login-form"><label>اسم المستخدم<input value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} required /></label><label>كلمة المرور<input type="password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} required /></label>{loginError && <p className="form-error">{loginError}</p>}<button className="primary-button" type="submit">تسجيل الدخول <span>←</span></button></form><button type="button" className="secondary-button" onClick={() => { setAuthView('register'); setLoginError('') }}>إنشاء حساب</button><p className="security-note">الحسابات الجديدة بانتظار موافقة المدير</p></section></main>

  if (adminView) return <main className="app-shell"><header className="topbar"><div className="topbar-brand"><img className="hospital-logo header-logo" src={hospitalLogo} alt="شعار مستشفى بغداد التعليمي" /><div><strong>الصيدلة السريرية</strong><small>مستشفى بغداد التعليمي</small></div></div><div className="user-menu"><button onClick={() => setAdminView(false)} className="text-button">→ عودة</button></div></header><section className="dashboard"><div className="section-heading"><div><p className="eyebrow">إدارة الحسابات</p><h1>طلبات الانضمام</h1><p>راجع الحسابات الجديدة ثم وافق عليها أو ارفضها.</p></div><button className="secondary-button" onClick={loadRegistrations}>تحديث</button></div>{registrationsError && <p className="form-error">{registrationsError}</p>}{registrations.length === 0 ? <p className="login-intro">لا توجد طلبات قيد الانتظار.</p> : <div className="table-frame"><table className="requests-table"><thead><tr><th>الاسم الكامل</th><th>اسم المستخدم</th><th>الهاتف</th><th>البريد الإلكتروني</th><th>رقم البصمة</th><th>إجراء</th></tr></thead><tbody>{registrations.map((item) => <tr key={item.id}><td>{item.full_name}</td><td>{item.username}</td><td>{item.phone}</td><td>{item.email}</td><td>{item.fingerprint_number}</td><td className="requests-actions"><button className="primary-button compact" onClick={() => decideRegistration(item.id, 'active')}>قبول</button><button className="secondary-button compact" onClick={() => decideRegistration(item.id, 'rejected')}>رفض</button></td></tr>)}</tbody></table></div>}</section></main>

  return <main className="app-shell"><header className="topbar"><div className="topbar-brand"><img className="hospital-logo header-logo" src={hospitalLogo} alt="شعار مستشفى بغداد التعليمي" /><div><strong>الصيدلة السريرية</strong><small>مستشفى بغداد التعليمي</small></div></div><div className="user-menu"><span>الحسين عبدالله جاسم</span><button onClick={() => setIsLoggedIn(false)} className="text-button">تسجيل الخروج</button></div></header>{!selected && !floor ? <section className="dashboard"><div className="section-heading"><div><p className="eyebrow">مساحة العمل اليومية</p><h1>اختر الطابق أو الردهة</h1><p>ابدأ باختيار موقع الجارت الذي تريد تسجيله أو مراجعته.</p></div><div className="date-chip"><span>اليوم</span><strong>{today}</strong></div></div><div className="location-grid">{floors.map((item) => <button className="location-card" key={item.number} onClick={() => setFloor(item)}><span className="floor-number">{item.number}</span><span><strong>الطابق {item.number}</strong><small>{item.wards.length} أروقة فرعية</small></span><span className="arrow">←</span></button>)}{specialWards.map((ward) => <button className="location-card special" key={ward} onClick={() => setSelected({ floor: null, ward })}><span className="floor-number">✚</span><span><strong>{ward}</strong></span></button>)}</div></section> : !selected ? <section className="dashboard"><button className="back-button" onClick={() => setFloor(null)}>→ العودة للطوابق</button><div className="section-heading"><div><p className="eyebrow">الطابق {floor.number}</p><h1>اختر الردهة</h1><p>اختر الردهة لفتح جارتها اليومية.</p></div></div><div className="location-grid">{floor.wards.map((ward) => <button className="location-card" key={ward} onClick={() => setSelected({ floor: floor.number, ward })}><span className="floor-number">{floor.number}</span><span><strong>{ward}</strong><small>فتح جارت الردهة</small></span><span className="arrow">←</span></button>)}</div></section> : <section className="chart-page"><div className="chart-toolbar"><button className="back-button" onClick={() => { setSelected(null); setFloor(null) }}>→ العودة للطوابق</button><div><p className="eyebrow">الجارت اليومي</p><h1>{selected.ward}</h1></div><div className="toolbar-actions"><button className="secondary-button" onClick={() => setShowMedicineForm(true)}>+ علاج جديد</button><button className="primary-button compact" onClick={() => window.print()}>طباعة A4</button></div></div><div className="chart-meta">{selected.floor && <span>الطابق: <b>{selected.floor}</b></span>}<span>الفرع: <b>{selected.ward}</b></span><span>التاريخ: <b>{today}</b></span><span className="save-state">● محفوظ تلقائيًا</span></div><div className="table-frame"><table className="chart-table"><thead><tr><th className="patient-header"><img className="header-watermark" src={hospitalLogo} alt="" /><span>مستشفى بغداد التعليمي</span><span>وحدة الصيدلة السريرية</span>{selected.floor && <span>الطابق {selected.floor}</span>}<span>{selected.ward}</span><span>{today}</span></th>{Array.from({ length: 51 }, (_, index) => <th key={index}><select defaultValue=""><option value=""></option>{medicines.map((medicine) => <option key={medicine}>{medicine}</option>)}</select></th>)}</tr></thead><tbody>{patientNames.map((name, rowIndex) => <tr key={rowIndex}><th className="patient-cell"><input value={name} onChange={(event) => setPatientNames((current) => current.map((patient, index) => index === rowIndex ? event.target.value : patient))} placeholder={`مريض ${rowIndex + 1}`} /></th>{Array.from({ length: 51 }, (_, columnIndex) => <td key={columnIndex}><input inputMode="numeric" pattern="[0-9]*" value={quantities[rowIndex][columnIndex]} onChange={(event) => updateQuantity(rowIndex, columnIndex, event.target.value)} /></td>)}</tr>)}</tbody><tfoot><tr><th className="patient-header">المجموع</th>{totals.map((total, index) => <td key={index}>{total || ''}</td>)}</tr></tfoot></table></div>{showMedicineForm && <div className="modal-backdrop" onClick={() => setShowMedicineForm(false)}><form className="medicine-modal" onSubmit={addMedicine} onClick={(event) => event.stopPropagation()}><button type="button" className="close-button" onClick={() => setShowMedicineForm(false)}>×</button><p className="eyebrow">قائمة الأدوية العامة</p><h2>إضافة علاج جديد</h2><label>اسم العلاج<input autoFocus value={newMedicine} onChange={(event) => setNewMedicine(event.target.value)} required /></label><button className="primary-button" type="submit">إضافة إلى القائمة</button></form></div>}</section>}</main>
}

export default App
