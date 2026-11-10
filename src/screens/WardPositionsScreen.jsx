import { useRef, useState } from 'react'
import hospitalLogo from '../assets/hospital-logo.png'
import { Glyph } from '../components/ToolbarIcons.jsx'
import { apiUrl } from '../constants.js'
import { isoDate, failureText } from '../helpers.js'
import { exportReportPdf } from '../reportPdf.js'
import { buildXlsx, downloadXlsx } from '../xlsx.js'

// مواقف القسم — one row per Meropenem course that began in the chosen dates, hospital-wide: who, where,
// sex / age / diagnosis from «استمارة الميرونيم», the dose and times a day read from the chart, and how
// long the patient had been on the charts. Read on screen, printed (A4 PDF) or saved as an Excel file.
// Loaded only on «عرض»: no auto-load, no polling.
const MAX_DAYS = 62
const DAY_MS = 86400000

const formatDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('ar-IQ')
const wardLabel = (row) => (row.floor ? `الطابق ${row.floor} — ${row.ward}` : row.ward)
const doseLabel = (mg) => (mg === null || mg === undefined ? '' : mg >= 1000 ? `${mg / 1000} g` : `${mg} mg`)
// A stay that reaches the start of what was read is «at least»: 45+.
const stayText = (row) => (row.stayDays === null || row.stayDays === undefined ? '' : row.stayCapped ? `${row.stayDays}+` : row.stayDays)
const dash = (value) => (value === '' || value === null || value === undefined ? '—' : value)

// The Excel sheet: the table's columns, numbers kept numeric so Excel can sort / filter / count them.
const EXCEL_COLUMNS = [
  { key: 'n', header: '#', width: 6 },
  { key: 'name', header: 'اسم المريض', width: 26 },
  { key: 'patientId', header: 'رقم الطبلة', width: 12 },
  { key: 'ward', header: 'الردهة', width: 26 },
  { key: 'startDate', header: 'تاريخ البدء', width: 13 },
  { key: 'sex', header: 'الجنس', width: 9 },
  { key: 'age', header: 'العمر', width: 9 },
  { key: 'diagnosis', header: 'التشخيص', width: 46 },
  { key: 'dose', header: 'الجرعة', width: 10 },
  { key: 'perDay', header: 'التكرار', width: 9 },
  { key: 'stayDays', header: 'فترة الرقود (يوم)', width: 16 },
  { key: 'noForm', header: 'بلا استمارة', width: 12 },
]
const excelRows = (patients) => patients.map((row, index) => ({
  n: index + 1, name: row.name, patientId: row.patientId, ward: wardLabel(row), startDate: row.startDate, sex: row.sex,
  age: /^\d+$/.test(row.age) ? Number(row.age) : row.age, diagnosis: row.diagnoses.join('\n'), dose: doseLabel(row.doseMg),
  perDay: row.perDay, stayDays: stayText(row), noForm: row.hasForm ? '' : 'نعم',
}))

export default function WardPositionsScreen({ adminHeader, isExpired }) {
  const today = isoDate(new Date())
  const articleRef = useRef(null)
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 29 * DAY_MS)))
  const [to, setTo] = useState(today)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)

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
      const response = await fetch(`${apiUrl}/ward-positions?${new URLSearchParams({ from, to })}`, { credentials: 'include' })
      if (isExpired(response)) return
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      setReport(result)
    } catch (caught) {
      setError(failureText(caught, 'تعذّر إنشاء التقرير — تحقّق من الاتصال وحاول مرة أخرى.'))
    } finally { setLoading(false) }
  }

  const rangeText = report && `${report.range.from} – ${report.range.to}`
  const print = async () => {
    if (!report || pdfBusy || !articleRef.current) return
    setPdfBusy(true); setError('')
    try {
      await exportReportPdf(articleRef.current, { title: `مواقف القسم · ${formatDate(report.range.from)} – ${formatDate(report.range.to)}`, name: `مواقف القسم ${rangeText}` })
    } catch { setError('تعذّر إنشاء ملف PDF — حاول مرة أخرى.') } finally { setPdfBusy(false) }
  }
  const exportExcel = () => {
    if (!report) return
    try {
      downloadXlsx(buildXlsx({ sheetName: 'مواقف القسم', columns: EXCEL_COLUMNS, rows: excelRows(report.patients) }), `مواقف القسم ${rangeText}.xlsx`)
    } catch { setError('تعذّر إنشاء ملف Excel — حاول مرة أخرى.') }
  }

  const withoutForm = report ? report.patients.filter((row) => !row.hasForm).length : 0
  const generatedAt = new Date().toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' })

  return <main className="app-shell">{adminHeader}<section className="dashboard reports-page">
    <div className="section-heading"><div><h1>مواقف القسم</h1></div></div>

    <form className="reports-controls reports-controls--range" onSubmit={load}>
      <label>من تاريخ<input type="date" value={from} max={to || today} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>إلى تاريخ<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} /></label>
      <div className="reports-controls-actions">
        <button type="submit" className="primary-button" disabled={Boolean(rangeProblem) || loading}>{loading ? 'جارٍ إنشاء التقرير…' : 'عرض التقرير'}</button>
        <button type="button" className="secondary-button" disabled={!report || loading || pdfBusy} onClick={print}><Glyph icon="print" />{pdfBusy ? 'جارٍ التحضير…' : 'طباعة / PDF'}</button>
        <button type="button" className="secondary-button" disabled={!report || loading} onClick={exportExcel}>تصدير Excel</button>
      </div>
      {rangeProblem && <p className="reports-controls-hint" role="status">{rangeProblem}</p>}
    </form>

    {error && <p className="form-error" role="alert">{error}</p>}

    {loading && !report ? (
      <div className="dashboard-skeleton report-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} className="skeleton-row" />)}</div>
    ) : !report ? (
      <div className="report-start">
        <strong>اختر المدة ثم اضغط «عرض التقرير»</strong>
        <span>كل دورة ميروبينيم بدأت في هذه المدة في كل الردهات: المريض، الجنس والعمر والتشخيص من الاستمارة، الجرعة والتكرار من الجارت، وفترة الرقود.</span>
      </div>
    ) : (
      <article ref={articleRef} className={loading ? 'report-doc is-stale' : 'report-doc'} aria-busy={loading || undefined}>
        <header className="report-doc-head">
          <img className="hospital-logo" width="52" height="52" src={hospitalLogo} alt="" />
          <div>
            <p className="report-doc-org">مستشفى بغداد التعليمي — وحدة الصيدلة السريرية</p>
            <h2 className="report-doc-title">مواقف القسم — دورات الميروبينيم</h2>
            <p className="report-doc-range">من {formatDate(report.range.from)} إلى {formatDate(report.range.to)}</p>
          </div>
          <p className="report-doc-stamp">أُنشئ {generatedAt}</p>
        </header>
        <section className="report-section" data-section="positions">
          <div className="report-section-head"><h2>الدورات التي بدأت في المدة</h2></div>
          <p className="report-note">{report.patients.length} دورة{withoutForm > 0 && ` — ${withoutForm} منها بلا استمارة، فالجنس والعمر والتشخيص فيها فارغة`}. الجرعة والتكرار مستنتجان من كميات الجارت في اليوم الثاني للدورة (وإلا الأول): 3 مرات ثم مرتين ثم مرة، بجرعة 1 g أو 500 mg متى أمكن، وليسا مسجَّلين. فترة الرقود: أيام ظهور المريض المتصلة في الجارتات حتى يوم البدء (يُغفَل يوم واحد ناقص)، وقد تكون أقل من الحقيقة لمن دخل قبل استعمال البرنامج، وتُكتب مثل 60+ حين تبلغ حدّ ما قُرئ. تُعدّ كل دورة من أول يوم جرعة فيها، أيًّا كان رقم اليوم المكتوب في المتابعة.</p>
          {report.patients.length === 0 ? <p className="report-empty">لم تبدأ أي دورة ميروبينيم في هذه المدة.</p> : (
            <div className="table-frame"><table className="requests-table report-table">
              <thead><tr><th>اسم المريض</th><th>الردهة</th><th>البدء</th><th>الجنس</th><th>العمر</th><th>التشخيص</th><th>الجرعة</th><th>التكرار</th><th>الرقود (يوم)</th></tr></thead>
              <tbody>{report.patients.map((row) => <tr key={`${row.floor}|${row.ward}|${row.patientId}|${row.name}|${row.startDate}`}>
                <td>{row.name}{row.patientId && <span className="report-patient-id"> · {row.patientId}</span>}{!row.hasForm && <small className="report-no-form"> · بلا استمارة</small>}</td>
                <td>{wardLabel(row)}</td>
                <td>{formatDate(row.startDate)}</td>
                <td>{dash(row.sex)}</td>
                <td className="num">{dash(row.age)}</td>
                <td className="report-dx" dir="ltr" lang="en">{row.diagnoses.length ? row.diagnoses.join('; ') : '—'}</td>
                <td dir="ltr">{dash(doseLabel(row.doseMg))}</td>
                <td className="num">{dash(row.perDay)}</td>
                <td className="num"><bdi dir="ltr">{dash(stayText(row))}</bdi></td>
              </tr>)}</tbody>
            </table></div>
          )}
        </section>
      </article>
    )}
  </section></main>
}
