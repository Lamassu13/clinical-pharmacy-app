import { useState } from 'react'
import hospitalLogo from '../assets/hospital-logo.png'
import { apiUrl, floors, specialWards } from '../constants.js'
import { isoDate } from '../helpers.js'

// التقارير — per-floor figures over a chosen range, read on screen or printed. Loaded only when
// «عرض التقرير» is pressed: no auto-load, no polling (the Neon/Render free plans bill wake time).
const MAX_DAYS = 120
const DAY_MS = 86400000

const formatDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('ar-IQ')
const weekday = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('ar-IQ', { weekday: 'long' })
const wardName = (row, scopedToFloor) => (row.floor === null ? row.ward : scopedToFloor ? row.ward : `الطابق ${row.floor} — ${row.ward}`)
const scopeLabel = (scope) => (scope === 'all' ? 'كل الطوابق والردهات' : specialWards.includes(scope) ? scope : `الطابق ${scope}`)
const orDash = (value) => (value === null || value === undefined ? '—' : value)

// Change against the previous period of the same length, as words and a drawn arrow — never
// colour alone, and never red: a rise in patients is not an error.
function Delta({ now, before }) {
  if (!before) return <span className="report-delta">لا مقارنة</span>
  const percent = Math.round(((now - before) / before) * 100)
  if (percent === 0) return <span className="report-delta">دون تغيير</span>
  const up = percent > 0
  return (
    <span className="report-delta">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {up ? <path d="M6 10V2M2.5 5.5 6 2l3.5 3.5" /> : <path d="M6 2v8M2.5 6.5 6 10l3.5-3.5" />}
      </svg>
      {up ? 'زيادة' : 'انخفاض'} {Math.abs(percent)}٪
    </span>
  )
}

function Section({ title, note, children }) {
  return (
    <section className="report-section">
      <h2>{title}</h2>
      {note && <p className="report-note">{note}</p>}
      {children}
    </section>
  )
}

function Empty({ children }) {
  return <p className="report-empty">{children}</p>
}

export default function ReportsScreen({ adminHeader, isExpired }) {
  const today = isoDate(new Date())
  const [scope, setScope] = useState('all')
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 29 * DAY_MS)))
  const [to, setTo] = useState(today)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const days = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1 : 0
  const rangeProblem = !from || !to ? 'اختر تاريخ البداية والنهاية.'
    : days < 1 ? 'تاريخ البداية بعد تاريخ النهاية.'
    : days > MAX_DAYS ? `المدة القصوى ${MAX_DAYS} يومًا — المدة المختارة ${days} يومًا.`
    : ''

  const load = async (event) => {
    event.preventDefault()
    if (rangeProblem || loading) return
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ scope, from, to })
      const response = await fetch(`${apiUrl}/reports?${params}`, { credentials: 'include' })
      if (isExpired(response)) return
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      setReport({ ...result, scope })
    } catch (caught) {
      setError(caught.message || 'تعذّر إنشاء التقرير — تحقّق من الاتصال وحاول مرة أخرى.')
    } finally { setLoading(false) }
  }

  return <main className="app-shell">{adminHeader}<section className="dashboard reports-page">
    <div className="section-heading"><div><h1>التقارير</h1></div></div>

    <form className="reports-controls" onSubmit={load}>
      <label>الطابق أو الردهة
        <select value={scope} onChange={(event) => setScope(event.target.value)}>
          <option value="all">كل الطوابق والردهات</option>
          <optgroup label="الطوابق">{floors.map((item) => <option key={item.number} value={item.number}>الطابق {item.number}</option>)}</optgroup>
          <optgroup label="ردهات مستقلة">{specialWards.map((ward) => <option key={ward} value={ward}>{ward}</option>)}</optgroup>
        </select>
      </label>
      <label>من تاريخ<input type="date" value={from} max={to || today} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>إلى تاريخ<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} /></label>
      <div className="reports-controls-actions">
        <button type="submit" className="primary-button" disabled={Boolean(rangeProblem) || loading}>{loading ? 'جارٍ إنشاء التقرير…' : 'عرض التقرير'}</button>
        <button type="button" className="secondary-button" disabled={!report || loading} onClick={() => window.print()}>طباعة / PDF</button>
      </div>
      {rangeProblem && <p className="reports-controls-hint" role="status">{rangeProblem}</p>}
    </form>

    {error && <p className="form-error" role="alert">{error}</p>}

    {loading && !report ? (
      <div className="dashboard-skeleton report-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} className="skeleton-row" />)}</div>
    ) : !report ? (
      <div className="report-start">
        <strong>اختر الطابق والمدة ثم اضغط «عرض التقرير»</strong>
        <span>يشمل التقرير: عدد المرضى والدخول والخروج، مدة البقاء، استهلاك كل دواء مقارنةً بالمدة السابقة، ومتابعة المضادات الحيوية، ونشاط الصيادلة.</span>
      </div>
    ) : <ReportDocument report={report} stale={loading} />}
  </section></main>
}

function ReportDocument({ report, stale }) {
  const { summary, range, thresholds } = report
  const scopedToFloor = report.scope !== 'all'
  const generatedAt = new Date().toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <article className={stale ? 'report-doc is-stale' : 'report-doc'} aria-busy={stale || undefined}>
      <header className="report-doc-head">
        <img className="hospital-logo" width="52" height="52" src={hospitalLogo} alt="" />
        <div>
          <p className="report-doc-org">مستشفى بغداد التعليمي — وحدة الصيدلة السريرية</p>
          <h2 className="report-doc-title">تقرير {scopeLabel(report.scope)}</h2>
          <p className="report-doc-range">
            من {formatDate(range.from)} إلى {formatDate(range.to)} ({range.days} يومًا)
            <span className="report-doc-sep">·</span>
            المقارنة مع {formatDate(range.previousFrom)} – {formatDate(range.previousTo)}
          </p>
        </div>
        <p className="report-doc-stamp">أُنشئ {generatedAt}</p>
      </header>

      <dl className="report-figures">
        <div><dt>أيام المرضى</dt><dd>{summary.patientDays}</dd><Delta now={summary.patientDays} before={summary.previousPatientDays} /></div>
        <div><dt>مرضى فعليون (غير مكرر)</dt><dd>{summary.distinctPatients}</dd><Delta now={summary.distinctPatients} before={summary.previousDistinctPatients} /></div>
        <div><dt>أنواع الأدوية (مع المستلزمات)</dt><dd>{summary.medicineTypes}</dd><Delta now={summary.medicineTypes} before={summary.previousMedicineTypes} /></div>
        <div><dt>دخول / خروج</dt><dd>{summary.admissions} / {summary.discharges}</dd></div>
        <div><dt>متوسط مدة البقاء</dt><dd>{orDash(summary.averageStay)} <small>يوم</small></dd></div>
        <div><dt>متوسط الأدوية لكل مريض</dt><dd>{orDash(summary.averageMedicines)}</dd></div>
      </dl>

      {!scopedToFloor && (
        <Section title="مقارنة الطوابق" note="الجرعات لا تشمل المستلزمات (IV set، كانيولا، سرنجات، سوائل وريدية).">
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>الطابق / الردهة</th><th>أيام المرضى</th><th>الجرعات</th><th>جرعات لكل مريض يوميًا</th></tr></thead>
            <tbody>{report.floors.map((row) => <tr key={row.floor ?? row.ward}>
              <td>{row.floor === null ? row.ward : `الطابق ${row.floor}`}</td>
              <td className="num">{row.patientDays}</td>
              <td className="num">{row.doses}</td>
              <td className="num">{orDash(row.dosesPerPatient)}</td>
            </tr>)}</tbody>
          </table></div>
        </Section>
      )}

      <Section title="المرضى حسب الردهة" note="الدخول: اسم ظهر اليوم ولم يكن أمس. الخروج: اسم كان أمس ولم يظهر اليوم. يُحتسبان فقط بين يومين فيهما جارت، حتى لا يُقرأ يوم بلا جارت خروجًا لكل المرضى.">
        <div className="table-frame"><table className="requests-table report-table">
          <thead><tr><th>الردهة</th><th>أيام المرضى</th><th>المدة السابقة</th><th>مرضى فعليون</th><th>دخول</th><th>خروج</th><th>متوسط البقاء (يوم)</th></tr></thead>
          <tbody>{report.wards.map((row) => <tr key={`${row.floor}|${row.ward}`}>
            <td>{wardName(row, scopedToFloor)}</td>
            <td className="num">{row.patientDays}</td>
            <td className="num">{row.previousPatientDays}</td>
            <td className="num">{row.distinctPatients}</td>
            <td className="num">{row.admissions}</td>
            <td className="num">{row.discharges}</td>
            <td className="num">{orDash(row.averageStay)}</td>
          </tr>)}</tbody>
        </table></div>
      </Section>

      <Section title="الحركة اليومية">
        <div className="table-frame"><table className="requests-table report-table">
          <thead><tr><th>التاريخ</th><th>المرضى</th><th>دخول</th><th>خروج</th></tr></thead>
          <tbody>{report.daily.map((row) => <tr key={row.date}>
            <td>{formatDate(row.date)} <small className="report-weekday">{weekday(row.date)}</small></td>
            <td className="num">{row.patients}</td>
            <td className="num">{row.admissions}</td>
            <td className="num">{row.discharges}</td>
          </tr>)}</tbody>
        </table></div>
      </Section>

      <Section title={`الإقامة الطويلة (${thresholds.longStay} أيام فأكثر)`} note="مرضى ما زالوا في الردهة في آخر يوم من المدة. النقل إلى ردهة أخرى يبدأ إقامة جديدة.">
        {report.longStays.length === 0 ? <Empty>لا يوجد مريض بقي {thresholds.longStay} أيام متتالية حتى آخر يوم من المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>الأيام</th><th>منذ</th></tr></thead>
            <tbody>{report.longStays.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.patient}`}>
              <td>{row.patient}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td className="num">{row.days}</td><td>{formatDate(row.since)}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>

      <Section title="استهلاك الأدوية" note="مجموع الكميات في الجارت (الرئيسي والإضافي) لكل دواء، مقارنةً بالمدة السابقة بنفس الطول.">
        {report.consumption.length === 0 ? <Empty>لا توجد كميات مسجّلة في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>الدواء</th><th>الكمية</th><th>المدة السابقة</th><th>التغيّر</th></tr></thead>
            <tbody>{report.consumption.map((line) => <tr key={line.name}>
              <td><span lang="en" dir="ltr">{line.name}</span>{line.isSupply && <span className="card-status card-status--muted report-supply">مستلزم</span>}</td>
              <td className="num">{line.quantity}</td>
              <td className="num">{line.previous}</td>
              <td><Delta now={line.quantity} before={line.previous} /></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>

      {report.antibiotics && <Section title="استهلاك المضادات الحيوية — DDD لكل 100 يوم مريض" note="الجرعة اليومية المحددة (DDD) حسب منظمة الصحة العالمية، وتصنيف AWaRe (Access / Watch / Reserve) لعام 2023. مضادات الفطريات غير مصنّفة في AWaRe.">
        {!report.antibiotics.lines.length && !report.antibiotics.notCounted.length ? <Empty>لا توجد مضادات حيوية مسجّلة في هذه المدة.</Empty> : <>
          <dl className="report-figures">
            <div><dt>DDD لكل 100 يوم مريض</dt><dd>{orDash(report.antibiotics.dddPer100)}</dd><span className="report-delta" dir="ltr">{report.antibiotics.totalDdds} DDD</span></div>
            {['Access', 'Watch', 'Reserve'].map((group) => <div key={group}><dt lang="en" dir="ltr">{group}</dt><dd>{orDash(report.antibiotics.aware[group])}٪</dd></div>)}
          </dl>
          {report.antibiotics.lines.length > 0 && <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>الدواء</th><th>ATC</th><th>AWaRe</th><th>الكمية</th><th>المجموع</th><th>DDD</th><th>DDD/100</th></tr></thead>
            <tbody>{report.antibiotics.lines.map((line) => <tr key={line.name}>
              <td><span lang="en" dir="ltr">{line.name}</span></td>
              <td lang="en" dir="ltr">{line.atc}</td>
              <td lang="en" dir="ltr">{line.aware || '—'}</td>
              <td className="num">{line.quantity}</td>
              <td className="num" dir="ltr">{line.amount} {line.unit}</td>
              <td className="num">{line.ddds}</td>
              <td className="num">{orDash(line.dddPer100)}</td>
            </tr>)}</tbody>
          </table></div>}
          {report.antibiotics.notCounted.length > 0 && <p className="report-note">غير محسوب: {report.antibiotics.notCounted.map((line) => <span key={line.name}><span lang="en" dir="ltr">{line.name}</span> ({line.reason})</span>).reduce((list, item) => [...list, list.length ? '، ' : '', item], [])}</p>}
        </>}
      </Section>}

      <Section title={`مضادات حيوية لأكثر من ${report.antibiotics.longCourseDays} يومًا`} note="مرضى ما زالوا على المضاد في آخر يوم من المدة؛ رقم اليوم محسوب بنفس قواعد «متابعة المضادات الحيوية».">
        {report.antibiotics.longCourses.length === 0 ? <Empty>لا توجد كورسات أطول من {report.antibiotics.longCourseDays} يومًا.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>المضاد</th><th>اليوم</th></tr></thead>
            <tbody>{report.antibiotics.longCourses.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.name}|${row.drugKey}`}>
              <td>{row.name}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td lang="en" dir="ltr">{row.drug}</td><td className="num">D{row.day}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>

      <Section title="أكثر من مضاد حيوي في اليوم نفسه" note="مرضى أُعطوا مضادين مختلفين أو أكثر في يوم واحد. المضاد المركّب (مثل Tazocin) يُحتسب دواءً مستقلًا عن مكوّنه.">
        {report.antibiotics.multiple.length === 0 ? <Empty>لا يوجد مريض أخذ أكثر من مضاد حيوي في يوم واحد.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>أعلى عدد في يوم</th><th>أيام</th><th>المضادات</th></tr></thead>
            <tbody>{report.antibiotics.multiple.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.patient}`}>
              <td>{row.patient}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td className="num">{row.maxConcurrent}</td><td className="num">{row.days}</td><td lang="en" dir="ltr">{row.drugs.join(', ')}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>

      <Section title="مضادات الاحتياط (Reserve)" note="مرضى أُعطوا دواءً من فئة Reserve حسب تصنيف AWaRe لمنظمة الصحة العالمية.">
        {report.antibiotics.reserve.length === 0 ? <Empty>لم يُعطَ أي مريض مضادًا من فئة Reserve في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>الدواء</th><th>الأيام</th></tr></thead>
            <tbody>{report.antibiotics.reserve.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.patient}|${row.drug}`}>
              <td>{row.patient}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td lang="en" dir="ltr">{row.drug}</td><td className="num">{row.days}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>
      <Section title="نشاط الصيادلة" note="للجارتات المؤرّخة في هذه المدة (الرئيسي والإضافي). لا يوجد سجل لكل تعديل، فالجارت يعرف فقط من أنشأه ومن أكمله ومن حفظه آخر مرة.">
        {report.staff.length === 0 ? <Empty>لا يوجد نشاط مسجّل في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>الصيدلي</th><th>جارتات أنشأها</th><th>جارتات أكملها</th><th>آخر من حفظ</th><th>استمارات حبوب إضافية</th></tr></thead>
            <tbody>{report.staff.map((row) => <tr key={row.userId}>
              <td>{row.name}</td>
              <td className="num">{row.started}</td>
              <td className="num">{row.completed}</td>
              <td className="num">{row.lastEdited}</td>
              <td className="num">{row.extraForms}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>
    </article>
  )
}
