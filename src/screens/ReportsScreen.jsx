import { useRef, useState } from 'react'
import hospitalLogo from '../assets/hospital-logo.png'
import { Glyph } from '../components/ToolbarIcons.jsx'
import { apiUrl, floors, specialWards } from '../constants.js'
import { isoDate } from '../helpers.js'
import { exportReportPdf } from '../reportPdf.js'

// التقارير — per-floor figures over a chosen range, read on screen or printed. Loaded only when
// «عرض التقرير» is pressed: no auto-load, no polling (the Neon/Render free plans bill wake time).
const MAX_DAYS = 120
const DAY_MS = 86400000

const formatDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('ar-IQ')
const wardName = (row, scopedToFloor) => (row.floor === null ? row.ward : scopedToFloor ? row.ward : `الطابق ${row.floor} — ${row.ward}`)
const allKeys = [...floors.map((item) => String(item.number)), ...specialWards]
const keyLabel = (key) => (specialWards.includes(key) ? key : `الطابق ${key}`)
const scopeLabel = (scope) => (scope === 'all' ? 'كل الطوابق والردهات' : scope.split(',').map(keyLabel).join('، '))
const orDash = (value) => (value === null || value === undefined ? '—' : value)

// The report's parts, in the order they appear. Ticking only some hides the rest on screen and on
// the printout. It's display-only — the request is the same — so changing it after «عرض التقرير»
// takes effect at once, with no new request. Each part also prints on its own (its «طباعة»).
const SECTIONS = [
  { key: 'figures', label: 'الأرقام الرئيسية' },
  { key: 'longStays', label: 'الإقامة الطويلة' },
  { key: 'stays', label: 'مدة البقاء' },
  { key: 'readmissions', label: 'المرضى العائدون' },
  { key: 'sameIds', label: 'أرقام الطبلة المكررة' },
  { key: 'trend', label: 'اتجاه استهلاك دواء' },
  { key: 'consumption', label: 'استهلاك الأدوية' },
  { key: 'ddd', label: 'استهلاك المضادات (DDD)' },
  { key: 'longCourses', label: 'كورسات المضادات الطويلة' },
  { key: 'longRuns', label: 'مضاد بكتيري أكثر من 14 يومًا' },
  { key: 'multiple', label: 'أكثر من مضاد في اليوم' },
  { key: 'courses', label: 'مدة كورسات المضادات' },
  { key: 'restarts', label: 'إعادة المضاد نفسه' },
  { key: 'antibioticFloors', label: 'المضادات حسب الطابق' },
  { key: 'antibioticWards', label: 'المضادات حسب الردهة' },
  { key: 'reserve', label: 'مضادات Reserve' },
]
const allSections = SECTIONS.map((section) => section.key)
const toggleIn = (setList) => (key) => setList((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))

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

// One part of the report, with its own «طباعة»: a PDF of the letterhead and this part only.
function Section({ title, note, children, printKey, onPrint, printing, disabled }) {
  return (
    <section className="report-section" data-section={printKey}>
      <div className="report-section-head">
        <h2>{title}</h2>
        {onPrint && <button type="button" className="secondary-button compact report-print-one" disabled={disabled} onClick={() => onPrint(printKey)}><Glyph icon="print" />{printing === printKey ? 'جارٍ التحضير…' : 'طباعة'}</button>}
      </div>
      {note && <p className="report-note">{note}</p>}
      {children}
    </section>
  )
}

// AWaRe traffic light: Access green, Watch orange, Reserve red. Each segment carries its own
// percentage so the meaning never rests on colour alone (and survives a black-and-white print).
const AWARE_LIGHT = { Access: 'green', Watch: 'orange', Reserve: 'red' }
function AwareBar({ aware, compact }) {
  if (Object.values(aware).every((value) => value === null)) return null
  return (
    <div className={`aware-bar${compact ? ' compact' : ''}`} dir="ltr" role="img" aria-label={Object.keys(AWARE_LIGHT).map((group) => `${group} ${aware[group] ?? 0}%`).join(', ')}>
      <div className="aware-track">
        {Object.entries(AWARE_LIGHT).map(([group, light]) => aware[group] > 0 && <span key={group} className={`aware-seg ${light}`} style={{ flexGrow: aware[group] }}>{aware[group] >= 8 && !compact ? `${aware[group]}٪` : ''}</span>)}
      </div>
      <ul className="aware-key">
        {Object.entries(AWARE_LIGHT).map(([group, light]) => <li key={group}><i className={`aware-dot ${light}`} />{group} {orDash(aware[group])}٪</li>)}
      </ul>
    </div>
  )
}

function Empty({ children }) {
  return <p className="report-empty">{children}</p>
}

export default function ReportsScreen({ adminHeader, isExpired }) {
  const today = isoDate(new Date())
  const [selected, setSelected] = useState(allKeys)
  const scope = selected.length === allKeys.length ? 'all' : allKeys.filter((key) => selected.includes(key)).join(',')
  const toggle = toggleIn(setSelected)
  const [sections, setSections] = useState(allSections)
  const toggleSection = toggleIn(setSections)
  // «طباعة»: the report as an A4 PDF drawn to canvas (../reportPdf.js), every ticked part, or one
  // part (`key`) from that section's own button.
  const articleRef = useRef(null)
  const [pdfBusy, setPdfBusy] = useState(null) // the part being drawn ('all' for the whole report)
  const [pdfError, setPdfError] = useState('')
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
    if (rangeProblem || !selected.length || loading) return
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

  const print = async (key) => {
    if (!report || pdfBusy || !articleRef.current) return
    const part = key && SECTIONS.find((section) => section.key === key)
    const range = `${report.range.from} – ${report.range.to}`
    setPdfBusy(key || 'all'); setPdfError('')
    try {
      await exportReportPdf(articleRef.current, {
        only: key,
        title: `تقرير ${scopeLabel(report.scope)} · ${formatDate(report.range.from)} – ${formatDate(report.range.to)}`,
        name: `تقرير ${scopeLabel(report.scope)}${part ? ` — ${part.label}` : ''} ${range}`,
      })
    } catch {
      setPdfError('تعذّر إنشاء ملف PDF — حاول مرة أخرى.')
    } finally { setPdfBusy(null) }
  }

  return <main className="app-shell">{adminHeader}<section className="dashboard reports-page">
    <div className="section-heading"><div><h1>التقارير</h1></div></div>

    <form className="reports-controls" onSubmit={load}>
      <fieldset className="reports-scope">
        <legend>الطوابق والردهات</legend>
        <label><input type="checkbox" checked={selected.length === allKeys.length} onChange={() => setSelected(selected.length === allKeys.length ? [] : allKeys)} /> الكل</label>
        {allKeys.map((key) => <label key={key}><input type="checkbox" checked={selected.includes(key)} onChange={() => toggle(key)} /> {keyLabel(key)}</label>)}
      </fieldset>
      <fieldset className="reports-scope">
        <legend>أقسام التقرير</legend>
        <label><input type="checkbox" checked={sections.length === allSections.length} onChange={() => setSections(sections.length === allSections.length ? [] : allSections)} /> الكل</label>
        {SECTIONS.map(({ key, label }) => <label key={key}><input type="checkbox" checked={sections.includes(key)} onChange={() => toggleSection(key)} /> {label}</label>)}
      </fieldset>
      <label>من تاريخ<input type="date" value={from} max={to || today} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>إلى تاريخ<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} /></label>
      <div className="reports-controls-actions">
        <button type="submit" className="primary-button" disabled={Boolean(rangeProblem) || !selected.length || loading}>{loading ? 'جارٍ إنشاء التقرير…' : 'عرض التقرير'}</button>
        <button type="button" className="secondary-button" disabled={!report || loading || Boolean(pdfBusy) || !sections.length} onClick={() => print(null)}>{pdfBusy === 'all' ? 'جارٍ التحضير…' : 'طباعة / PDF'}</button>
      </div>
      {!selected.length && <p className="reports-controls-hint" role="status">اختر طابقًا أو ردهة واحدة على الأقل.</p>}
      {!sections.length && <p className="reports-controls-hint" role="status">اختر قسمًا واحدًا على الأقل من أقسام التقرير.</p>}
      {rangeProblem && <p className="reports-controls-hint" role="status">{rangeProblem}</p>}
    </form>

    {error && <p className="form-error" role="alert">{error}</p>}
    {pdfError && <p className="form-error" role="alert">{pdfError}</p>}

    {loading && !report ? (
      <div className="dashboard-skeleton report-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} className="skeleton-row" />)}</div>
    ) : !report ? (
      <div className="report-start">
        <strong>اختر الطابق والمدة ثم اضغط «عرض التقرير»</strong>
        <span>يشمل التقرير: عدد المرضى والدخول والخروج، مدة البقاء، استهلاك كل دواء مقارنةً بالمدة السابقة، ومتابعة المضادات الحيوية.</span>
      </div>
    ) : <ReportDocument ref={articleRef} report={report} stale={loading} sections={sections} printing={pdfBusy} onPrint={print} />}
  </section></main>
}

function ReportDocument({ ref, report, stale, sections, printing, onPrint }) {
  const shows = (key) => sections.includes(key)
  const part = (key) => ({ printKey: key, onPrint, printing, disabled: stale || Boolean(printing) })
  const [trendDrug, setTrendDrug] = useState('')
  const { summary, range, thresholds, trend } = report
  const trendLine = trend.medicines.find((line) => line.name === trendDrug)
  const trendMax = trendLine ? Math.max(...trendLine.weeks, 1) : 1
  const scopedToFloor = report.scope !== 'all' && !report.scope.includes(',')
  const generatedAt = new Date().toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <article ref={ref} className={stale ? 'report-doc is-stale' : 'report-doc'} aria-busy={stale || undefined}>
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

      {shows('figures') && <Section {...part('figures')} title="الأرقام الرئيسية"><dl className="report-figures">
        <div><dt>أيام المرضى</dt><dd>{summary.patientDays}</dd><Delta now={summary.patientDays} before={summary.previousPatientDays} /></div>
        <div><dt>مرضى فعليون (غير مكرر)</dt><dd>{summary.distinctPatients}</dd><Delta now={summary.distinctPatients} before={summary.previousDistinctPatients} /></div>
        <div><dt>أنواع الأدوية (مع المستلزمات)</dt><dd>{summary.medicineTypes}</dd><Delta now={summary.medicineTypes} before={summary.previousMedicineTypes} /></div>
        <div><dt>دخول / خروج</dt><dd>{summary.admissions} / {summary.discharges}</dd></div>
        <div><dt>متوسط مدة البقاء</dt><dd>{orDash(summary.averageStay)} <small>يوم</small></dd></div>
        <div><dt>متوسط الأدوية لكل مريض</dt><dd>{orDash(summary.averageMedicines)}</dd></div>
      </dl></Section>}

      {shows('longStays') && <Section {...part('longStays')} title={`الإقامة الطويلة (${thresholds.longStay} أيام فأكثر)`} note="مرضى ما زالوا في الردهة في آخر يوم من المدة. النقل إلى ردهة أخرى يبدأ إقامة جديدة.">
        {report.longStays.length === 0 ? <Empty>لا يوجد مريض بقي {thresholds.longStay} أيام متتالية حتى آخر يوم من المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>الأيام</th><th>منذ</th></tr></thead>
            <tbody>{report.longStays.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.patient}`}>
              <td>{row.patient}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td className="num">{row.days}</td><td>{formatDate(row.since)}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>}

      {shows('stays') && <Section {...part('stays')} title="مدة بقاء المرضى حسب الردهة" note="عدد الإقامات حسب طولها بالأيام (إقامة = أيام متتالية بالاسم نفسه في الردهة). الإقامات الجارية عند طرفي المدة تُحتسب بما ظهر منها فقط.">
        {report.stayRows.length === 0 ? <Empty>لا توجد إقامات في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>الردهة</th><th>الإقامات</th>{report.stayBuckets.map((label) => <th key={label}>{label} يوم</th>)}<th>الوسيط</th><th>الأقصى</th></tr></thead>
            <tbody>{report.stayRows.map((row) => <tr key={`${row.floor}|${row.ward}`}>
              <td>{wardName(row, scopedToFloor)}</td><td className="num">{row.stays}</td>
              {row.buckets.map((count, i) => <td key={i} className="num">{count}</td>)}
              <td className="num">{row.median}</td><td className="num">{row.max}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>}

      {shows('readmissions') && <Section {...part('readmissions')} title="المرضى العائدون إلى الردهة" note={`مريض غادر الردهة ثم عاد إليها خلال ${thresholds.readmit} يومًا أو أقل. تُحتسب العودة فقط إذا كان للردهة جارت في كل يوم غيابه.`}>
        {report.readmissions.length === 0 ? <Empty>لا يوجد مريض عاد إلى الردهة في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>مرات العودة</th><th>تاريخ العودة (بعد كم يومًا)</th></tr></thead>
            <tbody>{report.readmissions.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.patient}`}>
              <td>{row.patient}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td className="num">{row.count}</td><td>{row.returns.map((item) => `${formatDate(item.date)} (${item.gap})`).join('، ')}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>}

      {shows('sameIds') && <Section {...part('sameIds')} title="أرقام الطبلة المكررة" note="رقم طبلة كُتب لأكثر من اسم مريض في هذه المدة — خطأ في الرقم أو مريضان بالرقم نفسه. الاسم نفسه في ردهتين (نقل) لا يظهر هنا.">
        {report.sameIds.length === 0 ? <Empty>لا يوجد رقم طبلة مكرر لمرضى مختلفين في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>رقم الطبلة</th><th>المريض</th><th>الطابق</th><th>الردهة</th><th>من — إلى</th><th>الأيام</th></tr></thead>
            <tbody>{report.sameIds.flatMap((group) => group.entries.map((entry, index) => <tr key={`${group.patientId}|${entry.patient}|${entry.floor}|${entry.ward}`}>
              {index === 0 && <td rowSpan={group.entries.length} className="num">{group.patientId}</td>}
              <td>{entry.patient}</td><td>{entry.floor ?? '—'}</td><td>{entry.ward}</td>
              <td>{entry.from === entry.to ? formatDate(entry.from) : `${formatDate(entry.from)} — ${formatDate(entry.to)}`}</td><td className="num">{entry.days}</td>
            </tr>))}</tbody>
          </table></div>
        )}
      </Section>}

      {shows('trend') && <Section {...part('trend')} title="اتجاه استهلاك دواء" note="الكمية الأسبوعية في الجارت للدواء المختار، تبدأ الأسابيع من أول يوم في المدة.">
        <label className="report-trend-pick">الدواء
          <select value={trendDrug} onChange={(event) => setTrendDrug(event.target.value)}>
            <option value="">اختر دواءً…</option>
            {trend.medicines.map((line) => <option key={line.name} value={line.name}>{line.name}</option>)}
          </select>
        </label>
        {trendLine && (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>الأسبوع</th><th>الكمية</th><th aria-hidden="true" /></tr></thead>
            <tbody>{trend.weeks.map((week, i) => <tr key={week.from}>
              <td>{formatDate(week.from)} – {formatDate(week.to)}</td>
              <td className="num">{trendLine.weeks[i]}</td>
              <td className="report-bar-cell" aria-hidden="true"><span className="report-bar" style={{ width: `${(trendLine.weeks[i] / trendMax) * 100}%` }} /></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>}

      {shows('consumption') && <Section {...part('consumption')} title="استهلاك الأدوية" note="مجموع الكميات في الجارت (الرئيسي والإضافي) لكل دواء، مقارنةً بالمدة السابقة بنفس الطول.">
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
      </Section>}

      {shows('ddd') && report.antibiotics && <Section {...part('ddd')} title="استهلاك المضادات الحيوية — DDD لكل 100 يوم مريض" note="الجرعة اليومية المحددة (DDD) حسب منظمة الصحة العالمية، وتصنيف AWaRe (Access / Watch / Reserve) لعام 2023. مضادات الفطريات غير مصنّفة في AWaRe.">
        {!report.antibiotics.lines.length && !report.antibiotics.notCounted.length ? <Empty>لا توجد مضادات حيوية مسجّلة في هذه المدة.</Empty> : <>
          <dl className="report-figures">
            <div><dt>DDD لكل 100 يوم مريض</dt><dd>{orDash(report.antibiotics.dddPer100)}</dd><span className="report-delta" dir="ltr">{report.antibiotics.totalDdds} DDD</span></div>
            {['Access', 'Watch', 'Reserve'].map((group) => <div key={group}><dt lang="en" dir="ltr">{group}</dt><dd>{orDash(report.antibiotics.aware[group])}٪</dd></div>)}
          </dl>
          <AwareBar aware={report.antibiotics.aware} />
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

      {shows('longCourses') && <Section {...part('longCourses')} title={`مضادات حيوية لأكثر من ${report.antibiotics.longCourseDays} يومًا`} note="مرضى ما زالوا على المضاد في آخر يوم من المدة؛ رقم اليوم محسوب بنفس قواعد «متابعة المضادات الحيوية».">
        {report.antibiotics.longCourses.length === 0 ? <Empty>لا توجد كورسات أطول من {report.antibiotics.longCourseDays} يومًا.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>المضاد</th><th>اليوم</th></tr></thead>
            <tbody>{report.antibiotics.longCourses.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.name}|${row.drugKey}`}>
              <td>{row.name}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td lang="en" dir="ltr">{row.drug}</td><td className="num">D{row.day}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>}

      {shows('longRuns') && <Section {...part('longRuns')} title={`مضاد بكتيري لأكثر من ${report.antibiotics.longCourseDays} يومًا خلال المدة`} note={`كل مريض بقي على مضاد بكتيري واحد أكثر من ${report.antibiotics.longCourseDays} يومًا متتالية في أي وقت خلال المدة — انتهى الكورس أو ما زال مستمرًا. الكورس الذي بدأ قبل المدة يُحتسب بطوله كاملًا، ومضادات الفطريات غير محسوبة.`}>
        {report.antibiotics.longRuns.length === 0 ? <Empty>لم يبقَ أي مريض على مضاد بكتيري أكثر من {report.antibiotics.longCourseDays} يومًا في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>المضاد</th><th>من</th><th>إلى</th><th>الأيام</th><th>الحالة</th></tr></thead>
            <tbody>{report.antibiotics.longRuns.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.patient}|${row.drug}|${row.from}`}>
              <td>{row.patient}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td lang="en" dir="ltr">{row.drug}</td><td>{formatDate(row.from)}</td><td>{formatDate(row.to)}</td><td className="num">{row.days}</td><td>{row.ongoing ? 'مستمر' : 'انتهى'}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>}

      {shows('multiple') && <Section {...part('multiple')} title="أكثر من مضاد حيوي في اليوم نفسه" note="مرضى أُعطوا ثلاثة مضادات مختلفة أو أكثر في يوم واحد. المضاد المركّب (مثل Tazocin) يُحتسب دواءً مستقلًا عن مكوّنه.">
        {report.antibiotics.multiple.length === 0 ? <Empty>لا يوجد مريض أخذ ثلاثة مضادات حيوية أو أكثر في يوم واحد.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>أعلى عدد في يوم</th><th>أيام</th><th>المضادات</th></tr></thead>
            <tbody>{report.antibiotics.multiple.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.patient}`}>
              <td>{row.patient}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td className="num">{row.maxConcurrent}</td><td className="num">{row.days}</td><td lang="en" dir="ltr">{row.drugs.join(', ')}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>}

      {shows('courses') && <Section {...part('courses')} title="مدة كورسات المضادات الحيوية" note="الكورس = أيام متتالية لمضاد واحد عند المريض نفسه. الكورس الذي بدأ قبل المدة يُحتسب بطوله كاملًا.">
        {report.antibiotics.courseStats.length === 0 ? <Empty>لا توجد كورسات في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المضاد</th><th>الكورسات</th><th>المتوسط (يوم)</th><th>الوسيط</th><th>الأطول</th><th>أكثر من {report.antibiotics.longCourseDays} يومًا</th></tr></thead>
            <tbody>{report.antibiotics.courseStats.map((row) => <tr key={row.drug}>
              <td lang="en" dir="ltr">{row.drug}</td><td className="num">{row.courses}</td><td className="num">{row.average}</td><td className="num">{row.median}</td><td className="num">{row.max}</td><td className="num">{row.long}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>}

      {shows('restarts') && <Section {...part('restarts')} title="إعادة المضاد نفسه" note={`مريض أُوقف عنه مضاد ثم أُعطي المضاد نفسه خلال ${report.antibiotics.restartDays} أيام أو أقل.`}>
        {report.antibiotics.restarts.length === 0 ? <Empty>لا توجد إعادة لمضاد في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>المضاد</th><th>توقف في</th><th>أُعيد في</th><th>أيام التوقف</th></tr></thead>
            <tbody>{report.antibiotics.restarts.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.patient}|${row.drug}|${row.restartedOn}`}>
              <td>{row.patient}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td lang="en" dir="ltr">{row.drug}</td><td>{formatDate(row.stoppedOn)}</td><td>{formatDate(row.restartedOn)}</td><td className="num">{row.gap}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>}

      {shows('antibioticFloors') && <Section {...part('antibioticFloors')} title="استهلاك المضادات الحيوية حسب الطابق" note="DDD لكل 100 يوم مريض في كل طابق (ردهاته مجتمعة)، ونسبة كل فئة AWaRe من DDD الطابق. الردهة التي لا تتبع طابقًا تظهر وحدها.">
        {report.antibiotics.byFloor.length === 0 ? <Empty>لا توجد مضادات حيوية محسوبة في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>الطابق</th><th>أيام المرضى</th><th>DDD</th><th>DDD/100</th><th lang="en" dir="ltr">AWaRe</th></tr></thead>
            <tbody>{report.antibiotics.byFloor.map((row) => <tr key={`${row.floor}|${row.ward}`}>
              <td>{row.floor === null ? row.ward : `الطابق ${row.floor}`}</td><td className="num">{row.patientDays}</td><td className="num">{row.ddds}</td><td className="num">{orDash(row.dddPer100)}</td>
              <td className="report-aware-cell"><AwareBar aware={row.aware} compact /></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>}

      {shows('antibioticWards') && <Section {...part('antibioticWards')} title="استهلاك المضادات الحيوية حسب الردهة" note="DDD لكل 100 يوم مريض في كل ردهة، ونسبة كل فئة AWaRe من DDD الردهة.">
        {report.antibiotics.byWard.length === 0 ? <Empty>لا توجد مضادات حيوية محسوبة في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>الردهة</th><th>أيام المرضى</th><th>DDD</th><th>DDD/100</th><th lang="en" dir="ltr">AWaRe</th></tr></thead>
            <tbody>{report.antibiotics.byWard.map((row) => <tr key={`${row.floor}|${row.ward}`}>
              <td>{wardName(row, scopedToFloor)}</td><td className="num">{row.patientDays}</td><td className="num">{row.ddds}</td><td className="num">{orDash(row.dddPer100)}</td>
              <td className="report-aware-cell"><AwareBar aware={row.aware} compact /></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>}

      {shows('reserve') && <Section {...part('reserve')} title="مضادات الاحتياط (Reserve)" note="مرضى أُعطوا دواءً من فئة Reserve حسب تصنيف AWaRe لمنظمة الصحة العالمية.">
        {report.antibiotics.reserve.length === 0 ? <Empty>لم يُعطَ أي مريض مضادًا من فئة Reserve في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>الدواء</th><th>الأيام</th></tr></thead>
            <tbody>{report.antibiotics.reserve.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.patient}|${row.drug}`}>
              <td>{row.patient}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td lang="en" dir="ltr">{row.drug}</td><td className="num">{row.days}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>}
    </article>
  )
}
