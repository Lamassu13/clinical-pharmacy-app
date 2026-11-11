import { useRef, useState } from 'react'
import hospitalLogo from '../assets/hospital-logo.png'
import { Glyph } from '../components/ToolbarIcons.jsx'
import { apiUrl, floors, specialWards } from '../constants.js'
import { isoDate, failureText } from '../helpers.js'
import { exportReportPdf } from '../reportPdf.js'

// التقارير — per-floor figures over a chosen range, read on screen or printed. Loaded only when
// «عرض التقرير» is pressed: no auto-load, no polling (the Neon/Render free plans bill wake time).
const MAX_DAYS = 120
const RANGE_PRESETS = [7, 30, 90]
const daysBefore = (iso, n) => isoDate(new Date(Date.parse(`${iso}T12:00:00`) - n * DAY_MS))
const DAY_MS = 86400000

const formatDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('ar-IQ')
const wardName = (row, scopedToFloor) => (row.floor === null ? row.ward : scopedToFloor ? row.ward : `الطابق ${row.floor} — ${row.ward}`)
const allKeys = [...floors.map((item) => String(item.number)), ...specialWards]
const keyLabel = (key) => (specialWards.includes(key) ? key : `الطابق ${key}`)
const scopeLabel = (scope) => (scope === 'all' ? 'كل الطوابق والردهات' : scope.split(',').map(keyLabel).join('، '))
const Tick = () => <svg className="rp-tick" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 7.5 2.5 2.5L11 4" /></svg>
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
  { key: 'dot', label: 'أيام العلاج بالمضادات (DOT)' },
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

// One part of the report: a row that opens on a tap (open = it is on screen and in the PDF), with
// what it says at a glance beside the title and its own «طباعة» once open. Closed, only the head is
// drawn; the PDF skips closed parts (.is-closed, src/reportPdf.js).
const Chevron = () => <svg className="rp-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
function Section({ title, note, summary, flat, open, onToggle, children, printKey, onPrint, printing, disabled }) {
  return (
    <section className={`report-section${open ? '' : ' is-closed'}${flat ? ' is-flat' : ''}`} data-section={printKey}>
      <div className="report-section-head">
        <h2><button type="button" className="rp-toggle" aria-expanded={open} onClick={() => onToggle(printKey)}><Chevron />{title}</button></h2>
        {summary && <span className={summary.attention ? 'rp-summary is-attention' : 'rp-summary'}>{summary.text}</span>}
        {open && onPrint && <button type="button" className="secondary-button compact report-print-one" disabled={disabled} onClick={() => onPrint(printKey)}><Glyph icon="print" />{printing === printKey ? 'جارٍ التحضير…' : 'طباعة'}</button>}
      </div>
      {open && note && <p className="report-note">{note}</p>}
      {open && children}
    </section>
  )
}

// DDD per 100 patient-days by floor as horizontal bars, each with its number in words (a list, so it reads without the bars).
function BarList({ rows, label, value }) {
  const max = Math.max(0, ...rows.map((row) => value(row) ?? 0))
  return (
    <ul className="rp-bars">
      {rows.filter((row) => value(row) !== null && value(row) !== undefined).map((row) => <li key={label(row)}>
        <span className="rp-bars-label">{label(row)}</span>
        <span className="rp-meter rp-meter--wide" aria-hidden="true"><i style={{ inlineSize: `${max > 0 ? Math.max(3, Math.round((value(row) / max) * 100)) : 0}%` }} /></span>
        <b className="num">{value(row)} <small>DDD/100</small></b>
      </li>)}
    </ul>
  )
}

// A value's share of the largest one, drawn as a bar beside its number (the number stays; the bar is for scanning).
const Meter = ({ value, max }) => <span className="rp-meter" aria-hidden="true"><i style={{ inlineSize: `${max > 0 && value > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0}%` }} /></span>

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
  const [sections, setSections] = useState(['figures']) // the parts open on screen and in the PDF; the rest are closed rows
  const toggleSection = toggleIn(setSections)
  // «طباعة»: the report as an A4 PDF drawn to canvas (../reportPdf.js), every ticked part, or one
  // part (`key`) from that section's own button.
  const articleRef = useRef(null)
  const [pdfBusy, setPdfBusy] = useState(null) // the part being drawn ('all' for the whole report)
  const [pdfError, setPdfError] = useState('')
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 29 * DAY_MS)))
  const [to, setTo] = useState(today)
  const [report, setReport] = useState(null)
  const [editing, setEditing] = useState(false) // the filters are folded to one line once a report is on screen
  const folded = Boolean(report) && !editing
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
      setReport({ ...result, scope }); setEditing(false)
    } catch (caught) {
      setError(failureText(caught, 'تعذّر إنشاء التقرير — تحقّق من الاتصال وحاول مرة أخرى.'))
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

  return <main className="app-shell reports-shell">{adminHeader}<section className="dashboard reports-page">
    <div className="section-heading"><div><h1>التقارير</h1></div></div>

    <form className="rp-bar" onSubmit={load}>
      {folded ? (
        <div className="rp-folded">
          <p>{scopeLabel(report.scope)} · {formatDate(report.range.from)} – {formatDate(report.range.to)}</p>
          <button type="button" className="text-button" onClick={() => setEditing(true)}>تعديل</button>
          <div className="rp-actions">
            <button type="submit" className="primary-button" disabled={loading}>{loading ? 'جارٍ إنشاء التقرير…' : 'تحديث'}</button>
            <button type="button" className="secondary-button" disabled={loading || Boolean(pdfBusy) || !sections.length} onClick={() => print(null)}>{pdfBusy === 'all' ? 'جارٍ التحضير…' : 'طباعة / PDF'}</button>
          </div>
        </div>
      ) : <>
      <div className="rp-scope" role="group" aria-label="الطوابق والردهات">
        <button type="button" className="rp-chip" aria-pressed={selected.length === allKeys.length} onClick={() => setSelected(selected.length === allKeys.length ? [] : allKeys)}><Tick />الكل</button>
        {allKeys.map((key) => <button key={key} type="button" className="rp-chip" aria-pressed={selected.includes(key)} onClick={() => toggle(key)}><Tick />{keyLabel(key)}</button>)}
      </div>
      <div className="rp-when">
        <div className="rp-scope" role="group" aria-label="المدة">
          {RANGE_PRESETS.map((length) => <button key={length} type="button" className="rp-chip" aria-pressed={from === daysBefore(today, length - 1) && to === today} onClick={() => { setFrom(daysBefore(today, length - 1)); setTo(today) }}><Tick />آخر {length} يومًا</button>)}
        </div>
        <label>من تاريخ<input type="date" value={from} max={to || today} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>إلى تاريخ<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} /></label>
        <div className="rp-actions">
          <button type="submit" className="primary-button" disabled={Boolean(rangeProblem) || !selected.length || loading}>{loading ? 'جارٍ إنشاء التقرير…' : 'عرض التقرير'}</button>
          <button type="button" className="secondary-button" disabled={!report || loading || Boolean(pdfBusy) || !sections.length} onClick={() => print(null)}>{pdfBusy === 'all' ? 'جارٍ التحضير…' : 'طباعة / PDF'}</button>
        </div>
      </div>
      </>}
      {!selected.length && <p className="reports-controls-hint" role="status">اختر طابقًا أو ردهة واحدة على الأقل.</p>}
      {report && !sections.length && <p className="reports-controls-hint" role="status">افتح قسمًا واحدًا على الأقل لطباعته.</p>}
      {rangeProblem && <p className="reports-controls-hint" role="status">{rangeProblem}</p>}
    </form>

    {error && <p className="form-error" role="alert">{error}</p>}
    {pdfError && <p className="form-error" role="alert">{pdfError}</p>}

    {loading && !report ? (
      <div className="dashboard-skeleton report-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} className="skeleton-row" />)}</div>
    ) : !report ? (
      <div className="report-start">
        <strong>اختر الطابق والمدة ثم اضغط «عرض التقرير»</strong>
        <span>تظهر الأرقام الرئيسية أولًا، وبقية الأقسام مغلقة — افتح ما تحتاجه واطبع المفتوح. يشمل التقرير: عدد المرضى والدخول والخروج، مدة البقاء، استهلاك كل دواء مقارنةً بالمدة السابقة، ومتابعة المضادات الحيوية.</span>
      </div>
    ) : <ReportDocument ref={articleRef} report={report} stale={loading} sections={sections} onToggleSection={toggleSection} onSetSections={setSections} printing={pdfBusy} onPrint={print} />}
  </section></main>
}

function ReportDocument({ ref, report, stale, sections, onToggleSection, onSetSections, printing, onPrint }) {
  const antibiotics = report.antibiotics
  // What each part says before it is opened: a count (amber when something needs a look) or a headline figure.
  const count = (n, unit) => ({ text: n ? `${n} ${unit}` : 'لا يوجد', attention: n > 0 })
  const total = (rows, field) => rows.reduce((sum, row) => sum + row[field], 0)
  const summaries = {
    longStays: count(report.longStays.length, 'مريض'),
    stays: { text: `${total(report.stayRows, 'stays')} إقامة` },
    readmissions: count(report.readmissions.length, 'مريض'),
    sameIds: count(report.sameIds.length, 'رقم'),
    consumption: { text: `${report.consumption.length} دواء` },
    ddd: { text: `${orDash(antibiotics?.dddPer100)} DDD/100` },
    dot: { text: `${orDash(antibiotics?.dot?.per1000)} DOT/1000` },
    longCourses: count(antibiotics?.longCourses.length, 'مريض'),
    longRuns: count(antibiotics?.longRuns.length, 'كورس'),
    multiple: count(antibiotics?.multiple.length, 'مريض'),
    courses: { text: `${antibiotics ? total(antibiotics.courseStats, 'courses') : 0} كورس` },
    restarts: count(antibiotics?.restarts.length, 'حالة'),
    antibioticFloors: { text: `${antibiotics?.byFloor.length ?? 0} طابق` },
    antibioticWards: { text: `${antibiotics?.byWard.length ?? 0} ردهة` },
    reserve: count(antibiotics?.reserve.length, 'مريض'),
  }
  const part = (key) => ({ printKey: key, onPrint, printing, disabled: stale || Boolean(printing), open: sections.includes(key), onToggle: onToggleSection, summary: summaries[key] })
  // The widest bar in each table that draws one.
  const maxOf = (rows, pick) => Math.max(0, ...rows.map((row) => pick(row) ?? 0))
  const wardMax = antibiotics ? maxOf(antibiotics.byWard, (row) => row.dddPer100) : 0
  const consumptionMax = maxOf(report.consumption, (row) => row.quantity)
  const dotMax = antibiotics?.dot ? maxOf(antibiotics.dot.byDrug, (row) => row.days) : 0
  const [trendDrug, setTrendDrug] = useState('')
  // «أرقام الطبلة المكررة»: the rows (ID + name + ward) left unticked, which the PDF skips (everything is ticked at first).
  const [skipped, setSkipped] = useState(() => new Set())
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

      <div className="rp-toolbar">
        <span role="status">{sections.length ? `${sections.length} من ${allSections.length} أقسام مفتوحة` : 'كل الأقسام مغلقة'}</span>
        <button type="button" className="text-button" onClick={() => onSetSections(allSections)} disabled={sections.length === allSections.length}>فتح الكل</button>
        <button type="button" className="text-button" onClick={() => onSetSections([])} disabled={!sections.length}>إغلاق الكل</button>
      </div>
      <p className="rp-group">السكان والإقامة</p>
      <Section {...part('figures')} flat title="الأرقام الرئيسية"><dl className="report-figures">
        <div><dt>أيام المرضى</dt><dd>{summary.patientDays}</dd><Delta now={summary.patientDays} before={summary.previousPatientDays} /></div>
        <div><dt>مرضى فعليون (غير مكرر)</dt><dd>{summary.distinctPatients}</dd><Delta now={summary.distinctPatients} before={summary.previousDistinctPatients} /></div>
        <div><dt>أنواع الأدوية (مع المستلزمات)</dt><dd>{summary.medicineTypes}</dd><Delta now={summary.medicineTypes} before={summary.previousMedicineTypes} /></div>
        <div><dt>دخول / خروج</dt><dd>{summary.admissions} / {summary.discharges}</dd></div>
        <div><dt>متوسط مدة البقاء</dt><dd>{orDash(summary.averageStay)} <small>يوم</small></dd></div>
        <div><dt>متوسط الأدوية لكل مريض</dt><dd>{orDash(summary.averageMedicines)}</dd></div>
        {antibiotics && <div><dt>DDD لكل 100 يوم مريض</dt><dd>{orDash(antibiotics.dddPer100)}</dd></div>}
        {antibiotics?.dot && <div><dt>DOT لكل 1000 يوم مريض</dt><dd>{orDash(antibiotics.dot.per1000)}</dd><Delta now={antibiotics.dot.per1000} before={antibiotics.dot.previousPer1000} /></div>}
      </dl></Section>

      <Section {...part('longStays')} title={`الإقامة الطويلة (${thresholds.longStay} أيام فأكثر)`} note="مرضى ما زالوا في الردهة في آخر يوم من المدة. النقل إلى ردهة أخرى يبدأ إقامة جديدة.">
        {report.longStays.length === 0 ? <Empty>لا يوجد مريض بقي {thresholds.longStay} أيام متتالية حتى آخر يوم من المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>الأيام</th><th>منذ</th></tr></thead>
            <tbody>{report.longStays.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.patient}`}>
              <td>{row.patient}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td className="num">{row.days}</td><td>{formatDate(row.since)}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>

      <Section {...part('stays')} title="مدة بقاء المرضى حسب الردهة" note="عدد الإقامات حسب طولها بالأيام (إقامة = أيام متتالية بالاسم نفسه في الردهة). الإقامات الجارية عند طرفي المدة تُحتسب بما ظهر منها فقط.">
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
      </Section>

      <Section {...part('readmissions')} title="المرضى العائدون إلى الردهة" note={`مريض غادر الردهة ثم عاد إليها خلال ${thresholds.readmit} يومًا أو أقل. تُحتسب العودة فقط إذا كان للردهة جارت في كل يوم غيابه.`}>
        {report.readmissions.length === 0 ? <Empty>لا يوجد مريض عاد إلى الردهة في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>مرات العودة</th><th>تاريخ العودة (بعد كم يومًا)</th></tr></thead>
            <tbody>{report.readmissions.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.patient}`}>
              <td>{row.patient}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td className="num">{row.count}</td><td>{row.returns.map((item) => `${formatDate(item.date)} (${item.gap})`).join('، ')}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>

      <Section {...part('sameIds')} title="أرقام الطبلة المكررة" note="رقم طبلة كُتب لمريضين باسمين مختلفين في طابقين مختلفين خلال هذه المدة — خطأ في الرقم أو مريضان بالرقم نفسه. الاسم نفسه في ردهتين (نقل) أو الاسمان في الطابق نفسه لا يظهران هنا. علّم الأرقام أو الأسماء التي تريد طباعتها.">
        {report.sameIds.length === 0 ? <Empty>لا يوجد رقم طبلة مكرر لمرضى مختلفين في هذه المدة.</Empty> : (() => {
          const keyOf = (group, entry) => `${group.patientId}|${entry.patient}|${entry.floor}|${entry.ward}`
          const allKeys = report.sameIds.flatMap((group) => group.entries.map((entry) => keyOf(group, entry)))
          const flip = (keys, on) => setSkipped((current) => { const next = new Set(current); keys.forEach((key) => (on ? next.delete(key) : next.add(key))); return next })
          return <div className="table-frame"><table className="requests-table report-table">
            <thead><tr>
              <th className="report-print-skip"><input type="checkbox" aria-label="تحديد كل الأرقام للطباعة" checked={skipped.size === 0} onChange={(event) => flip(allKeys, event.target.checked)} /></th>
              <th>رقم الطبلة</th><th className="report-print-skip" /><th>المريض</th><th>الطابق</th><th>الردهة</th><th>من — إلى</th><th>الأيام</th>
            </tr></thead>
            <tbody>{report.sameIds.flatMap((group) => {
              const keys = group.entries.map((entry) => keyOf(group, entry))
              const ticked = keys.filter((key) => !skipped.has(key)).length
              // The ID is written on every row (not spanned) so a row left out of the PDF never takes it with it.
              return group.entries.map((entry, index) => <tr key={keys[index]} data-print-skip={skipped.has(keys[index]) || undefined}>
                {index === 0 ? <td rowSpan={keys.length} className="report-print-skip"><input type="checkbox" aria-label={`طباعة كل أسماء رقم الطبلة ${group.patientId}`} checked={ticked === keys.length} ref={(box) => { if (box) box.indeterminate = ticked > 0 && ticked < keys.length }} onChange={(event) => flip(keys, event.target.checked)} /></td> : null}
                <td className="num">{group.patientId}</td>
                <td className="report-print-skip"><input type="checkbox" aria-label={`طباعة ${entry.patient}`} checked={!skipped.has(keys[index])} onChange={(event) => flip([keys[index]], event.target.checked)} /></td>
                <td>{entry.patient}</td><td>{entry.floor ?? '—'}</td><td>{entry.ward}</td>
                <td>{entry.from === entry.to ? formatDate(entry.from) : `${formatDate(entry.from)} — ${formatDate(entry.to)}`}</td><td className="num">{entry.days}</td>
              </tr>)
            })}</tbody>
          </table></div>
        })()}
      </Section>

      <p className="rp-group">الاستهلاك</p>
      <Section {...part('trend')} title="اتجاه استهلاك دواء" note="الكمية الأسبوعية في الجارت للدواء المختار، تبدأ الأسابيع من أول يوم في المدة.">
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
      </Section>

      <Section {...part('consumption')} title="استهلاك الأدوية" note="مجموع الكميات في الجارت (الرئيسي والإضافي) لكل دواء، مقارنةً بالمدة السابقة بنفس الطول.">
        {report.consumption.length === 0 ? <Empty>لا توجد كميات مسجّلة في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>الدواء</th><th>الكمية</th><th className="rp-hide-narrow">المدة السابقة</th><th>التغيّر</th></tr></thead>
            <tbody>{report.consumption.map((line) => <tr key={line.name}>
              <td><span lang="en" dir="ltr">{line.name}</span>{line.isSupply && <span className="card-status card-status--muted report-supply">مستلزم</span>}</td>
              <td className="num">{line.quantity}<Meter value={line.quantity} max={consumptionMax} /></td>
              <td className="num rp-hide-narrow">{line.previous}</td>
              <td><Delta now={line.quantity} before={line.previous} /></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>

      <p className="rp-group">المضادات الحيوية</p>
      {report.antibiotics && <Section {...part('ddd')} title="استهلاك المضادات الحيوية — DDD لكل 100 يوم مريض" note="الجرعة اليومية المحددة (DDD) حسب منظمة الصحة العالمية، وتصنيف AWaRe (Access / Watch / Reserve) لعام 2023. مضادات الفطريات غير مصنّفة في AWaRe. الكمية هنا هي المصروف فعلاً: جارت الخميس يُحسب مرتين لأن الجمعة بلا جارت (إلا الأدوية «لا تُضاعف يوم الخميس»).">
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

      {report.antibiotics && <Section {...part('dot')} title="أيام العلاج بالمضادات الحيوية — DOT لكل 1000 يوم مريض" note="كل يوم يأخذ فيه المريض مضادًا حيويًا يُحسب يوم علاج واحد، مهما كان عدد الحبوب أو الفيالات؛ ومن أخذ مضادين في اليوم يُحسب يومين. الجمعة داخل الكورس تُحسب. مضادات الفطريات محسوبة كما في DDD.">
        {!report.antibiotics.dot.days ? <Empty>لا توجد أيام علاج بالمضادات الحيوية في هذه المدة.</Empty> : <>
          <dl className="report-figures">
            <div><dt>أيام العلاج</dt><dd>{report.antibiotics.dot.days}</dd></div>
          </dl>
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المضاد</th><th>أيام العلاج</th><th>DOT/1000</th></tr></thead>
            <tbody>{report.antibiotics.dot.byDrug.map((row) => <tr key={row.drug}>
              <td lang="en" dir="ltr">{row.drug}</td><td className="num">{row.days}<Meter value={row.days} max={dotMax} /></td><td className="num">{orDash(row.per1000)}</td>
            </tr>)}</tbody>
          </table></div>
        </>}
      </Section>}

      <Section {...part('longCourses')} title={`مضادات حيوية لأكثر من ${report.antibiotics.longCourseDays} يومًا`} note="مرضى ما زالوا على المضاد في آخر يوم من المدة؛ رقم اليوم محسوب بنفس قواعد «متابعة المضادات الحيوية».">
        {report.antibiotics.longCourses.length === 0 ? <Empty>لا توجد كورسات أطول من {report.antibiotics.longCourseDays} يومًا.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>المضاد</th><th>اليوم</th></tr></thead>
            <tbody>{report.antibiotics.longCourses.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.name}|${row.drugKey}`}>
              <td>{row.name}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td lang="en" dir="ltr">{row.drug}</td><td className="num">D{row.day}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>

      <Section {...part('longRuns')} title={`مضاد بكتيري لأكثر من ${report.antibiotics.longCourseDays} يومًا خلال المدة`} note={`كل مريض بقي على مضاد بكتيري واحد أكثر من ${report.antibiotics.longCourseDays} يومًا متتالية في أي وقت خلال المدة — انتهى الكورس أو ما زال مستمرًا. الكورس الذي بدأ قبل المدة يُحتسب بطوله كاملًا، ومضادات الفطريات غير محسوبة.`}>
        {report.antibiotics.longRuns.length === 0 ? <Empty>لم يبقَ أي مريض على مضاد بكتيري أكثر من {report.antibiotics.longCourseDays} يومًا في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>المضاد</th><th>من</th><th>إلى</th><th>الأيام</th><th>الحالة</th></tr></thead>
            <tbody>{report.antibiotics.longRuns.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.patient}|${row.drug}|${row.from}`}>
              <td>{row.patient}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td lang="en" dir="ltr">{row.drug}</td><td>{formatDate(row.from)}</td><td>{formatDate(row.to)}</td><td className="num">{row.days}</td><td>{row.ongoing ? 'مستمر' : 'انتهى'}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>

      <Section {...part('multiple')} title="أكثر من مضاد حيوي في اليوم نفسه" note="مرضى أُعطوا ثلاثة مضادات مختلفة أو أكثر في يوم واحد. المضاد المركّب (مثل Tazocin) يُحتسب دواءً مستقلًا عن مكوّنه.">
        {report.antibiotics.multiple.length === 0 ? <Empty>لا يوجد مريض أخذ ثلاثة مضادات حيوية أو أكثر في يوم واحد.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>أعلى عدد في يوم</th><th>أيام</th><th>المضادات</th></tr></thead>
            <tbody>{report.antibiotics.multiple.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.patient}`}>
              <td>{row.patient}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td className="num">{row.maxConcurrent}</td><td className="num">{row.days}</td><td lang="en" dir="ltr">{row.drugs.join(', ')}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>

      <Section {...part('courses')} title="مدة كورسات المضادات الحيوية" note="الكورس = أيام متتالية لمضاد واحد عند المريض نفسه. الكورس الذي بدأ قبل المدة يُحتسب بطوله كاملًا.">
        {report.antibiotics.courseStats.length === 0 ? <Empty>لا توجد كورسات في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المضاد</th><th>الكورسات</th><th>المتوسط (يوم)</th><th>الوسيط</th><th>الأطول</th><th>أكثر من {report.antibiotics.longCourseDays} يومًا</th></tr></thead>
            <tbody>{report.antibiotics.courseStats.map((row) => <tr key={row.drug}>
              <td lang="en" dir="ltr">{row.drug}</td><td className="num">{row.courses}</td><td className="num">{row.average}</td><td className="num">{row.median}</td><td className="num">{row.max}</td><td className="num">{row.long}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>

      <Section {...part('restarts')} title="إعادة المضاد نفسه" note={`مريض أُوقف عنه مضاد ثم أُعطي المضاد نفسه خلال ${report.antibiotics.restartDays} أيام أو أقل.`}>
        {report.antibiotics.restarts.length === 0 ? <Empty>لا توجد إعادة لمضاد في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>المضاد</th><th>توقف في</th><th>أُعيد في</th><th>أيام التوقف</th></tr></thead>
            <tbody>{report.antibiotics.restarts.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.patient}|${row.drug}|${row.restartedOn}`}>
              <td>{row.patient}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td lang="en" dir="ltr">{row.drug}</td><td>{formatDate(row.stoppedOn)}</td><td>{formatDate(row.restartedOn)}</td><td className="num">{row.gap}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>

      <Section {...part('antibioticFloors')} title="استهلاك المضادات الحيوية حسب الطابق" note="DDD لكل 100 يوم مريض في كل طابق (ردهاته مجتمعة)، ونسبة كل فئة AWaRe من DDD الطابق. الردهة التي لا تتبع طابقًا تظهر وحدها.">
        {report.antibiotics.byFloor.length === 0 ? <Empty>لا توجد مضادات حيوية محسوبة في هذه المدة.</Empty> : <>
          <BarList rows={report.antibiotics.byFloor} label={(row) => (row.floor === null ? row.ward : `الطابق ${row.floor}`)} value={(row) => row.dddPer100} />
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>الطابق</th><th>أيام المرضى</th><th>DDD</th><th>DDD/100</th><th>DOT/1000</th><th lang="en" dir="ltr">AWaRe</th></tr></thead>
            <tbody>{report.antibiotics.byFloor.map((row) => <tr key={`${row.floor}|${row.ward}`}>
              <td>{row.floor === null ? row.ward : `الطابق ${row.floor}`}</td><td className="num">{row.patientDays}</td><td className="num">{row.ddds}</td><td className="num">{orDash(row.dddPer100)}</td><td className="num">{orDash(row.dotPer1000)}</td>
              <td className="report-aware-cell"><AwareBar aware={row.aware} compact /></td>
            </tr>)}</tbody>
          </table></div>
        </>}
      </Section>

      <Section {...part('antibioticWards')} title="استهلاك المضادات الحيوية حسب الردهة" note="DDD لكل 100 يوم مريض في كل ردهة، ونسبة كل فئة AWaRe من DDD الردهة.">
        {report.antibiotics.byWard.length === 0 ? <Empty>لا توجد مضادات حيوية محسوبة في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>الردهة</th><th>أيام المرضى</th><th>DDD</th><th>DDD/100</th><th>DOT/1000</th><th lang="en" dir="ltr">AWaRe</th></tr></thead>
            <tbody>{report.antibiotics.byWard.map((row) => <tr key={`${row.floor}|${row.ward}`}>
              <td>{wardName(row, scopedToFloor)}</td><td className="num">{row.patientDays}</td><td className="num">{row.ddds}</td><td className="num">{orDash(row.dddPer100)}<Meter value={row.dddPer100} max={wardMax} /></td><td className="num">{orDash(row.dotPer1000)}</td>
              <td className="report-aware-cell"><AwareBar aware={row.aware} compact /></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>

      <Section {...part('reserve')} title="مضادات الاحتياط (Reserve)" note="مرضى أُعطوا دواءً من فئة Reserve حسب تصنيف AWaRe لمنظمة الصحة العالمية.">
        {report.antibiotics.reserve.length === 0 ? <Empty>لم يُعطَ أي مريض مضادًا من فئة Reserve في هذه المدة.</Empty> : (
          <div className="table-frame"><table className="requests-table report-table">
            <thead><tr><th>المريض</th><th>الردهة</th><th>الدواء</th><th>الأيام</th></tr></thead>
            <tbody>{report.antibiotics.reserve.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.patient}|${row.drug}`}>
              <td>{row.patient}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}</td><td>{wardName(row, scopedToFloor)}</td><td lang="en" dir="ltr">{row.drug}</td><td className="num">{row.days}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Section>
    </article>
  )
}
