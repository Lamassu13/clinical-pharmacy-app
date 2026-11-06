import hospitalLogo from '../assets/hospital-logo.png'
import { DRUG_REQUESTS } from '../../shared/drug-requests.js'
import { Field, TickCell } from './RequestSheetParts.jsx'

// «استمارة الميرونيم» as the ministry's paper form (الاستمارة اليومية للمضادات الحياتية). On the
// form's screen every typed value is editable in place and the diagnosis / culture boxes tick; with
// `paper` it is the plain page the PDF is drawn from. The diagnosis grid runs left to right, as on
// paper — the table's direction, not a row's, sets that.
const GRID = [
  ['mastoiditis', 'sinusitis', 'meningitis'],
  ['blast', 'gangrene', 'hap'],
  ['bronchiectasis', 'lung-abscess', 'nve'],
  ['neutropenic', 'empyema', 'pancreatitis'],
  ['liver-abscess', 'resection', 'cap'],
  ['diabetic-foot', 'peritonitis', 'sepsis'],
]
const SPEC = DRUG_REQUESTS.meropenem
const [DIAGNOSIS, CULTURE] = SPEC.groups
const textOf = Object.fromEntries(DIAGNOSIS.options.map((option) => [option.key, option.text]))
const fieldOf = Object.fromEntries(SPEC.fields.map((field) => [field.key, field]))
const dayMonthYear = (iso) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`

export default function MeropenemSheet({ request, wardName, paper = false, onToggle, onNote, onField }) {
  const { fields } = request
  const ticked = (key) => request.ticks.includes(key)
  const cell = (key, colSpan, after) => <TickCell key={key} paper={paper} colSpan={colSpan} checked={ticked(key)} onToggle={() => onToggle(key)} after={after}>{textOf[key]}</TickCell>
  const value = (label, key, extra) => <Field label={label} value={fields[key]} field={fieldOf[key]} paper={paper} onSave={(next) => onField({ fields: { [key]: next } })} {...extra} />
  const others = ticked('others') && (paper
    ? request.note && <span className="req-note-print">{request.note}</span>
    : <input className="req-note-input" lang="en" dir="auto" defaultValue={request.note} key={request.note} maxLength={300} placeholder="specify" aria-label="Others (specify)"
      onBlur={(event) => { if (event.target.value.trim() !== request.note) onNote(event.target.value.trim()) }}
      onKeyDown={(event) => { if (event.key === 'Enter') event.target.blur() }} />)

  const sexField = fieldOf.sex
  return <div className="req-paper">
    <div className="req-paper-head">
      <img className="hospital-logo" width="34" height="34" src={hospitalLogo} alt="" />
      <span>مستشفى بغداد التعليمي — وحدة الصيدلة السريرية</span>
    </div>

    {/* On screen only: the paper form has no box for the sex, but «مواقف القسم» reports it, so a
        form saved before it was asked can be completed here. Never drawn for the PDF (`paper`). */}
    {!paper && <div className="req-extra-row">
      <span className="req-label">الجنس <small>(للتقرير — لا يُطبع)</small></span>
      <div className="req-chips" role="group" aria-label="الجنس">
        {sexField.choices.map((choice) => <button key={choice} type="button" className="req-chip" aria-pressed={fields.sex === choice} onClick={() => onField({ fields: { sex: choice } })}>{choice}</button>)}
      </div>
    </div>}

    <table className="req-form">
      <tbody>
        <tr><th colSpan={3} className="req-band">الاستمارة اليومية للمضادات الحياتية</th></tr>
        <tr><td colSpan={3} className="mero-title">
          <strong lang="en" dir="ltr">Meropenem/ Imipenem requesting form</strong>
          <strong lang="en" dir="ltr">(Not first line therapy)</strong>
          <strong>(لايجوز تجهيز العلاج بدون ملء الاستمارة كاملة من قبل الطبيب الاختصاصي المسؤول حصراً)</strong>
        </td></tr>
        <tr>
          <td><Field paper label="دائرة صحة:" value="مدينة الطب" /></td>
          <td><Field paper label="مستشفى:" value="مستشفى بغداد التعليمي" /></td>
          <td><Field paper label="الردهة:" value={wardName} /></td>
        </tr>
        <tr>
          <td><Field label="اسم المريض:" value={request.name} paper={paper} required onSave={(next) => onField({ name: next })} /></td>
          <td>{value('العمر:', 'age')}</td>
          <td>{value('الوزن:', 'weight', { unit: 'كغم' })}</td>
        </tr>
        <tr>
          <td><Field paper label="التاريخ:" value={dayMonthYear(request.date)} /></td>
          <td>{value('S.cr:', 'scr', { ltr: true })}</td>
          <td>{value('التحسس:', 'allergy')}</td>
        </tr>
      </tbody>
    </table>

    <table className="req-form mero-diagnosis" lang="en" dir="ltr">
      <tbody>
        <tr><th colSpan={3} className="req-band" lang="ar" dir="rtl">يستخدم في الحالات المحددة من وزارة الصحة/ دائرة الامور الفنية / قسم الصيدلة/ شعبة الصيدلة السريرية</th></tr>
        <tr><td colSpan={3}>Diagnosis -state the life threatening Infection from below:</td></tr>
        {GRID.map((row) => <tr key={row[0]}>{row.map((key) => cell(key))}</tr>)}
        <tr>{cell('ssi')}{cell('others', 2, others)}</tr>
      </tbody>
    </table>

    <table className="req-form mero-culture" lang="en" dir="ltr">
      <tbody><tr>
        <td>Culture &amp; sensitivity</td>
        {CULTURE.options.map((option) => <TickCell key={option.key} paper={paper} checked={ticked(option.key)} onToggle={() => onToggle(option.key)}>{option.text}</TickCell>)}
      </tr></tbody>
    </table>

    <table className="req-form mero-dose">
      <tbody>
        <tr><th scope="row">الجرعة</th><td>{value('الجرعة', 'dose', { bare: true })}</td></tr>
        <tr><th scope="row">تحديد مدة الصرف</th><td>{value('تحديد مدة الصرف', 'duration', { bare: true })}</td></tr>
      </tbody>
    </table>

    <div className="req-signatures">
      <p><strong>الصيدلي</strong><strong>عضو لجنة المضادات الحياتية</strong></p>
      <p><strong>مسؤول الصيدلة السريرية</strong><strong>(اذا لم يكن صيدلي اختصاص فيجب تخصيص صيدلي اختصاص/ صيدلة سريرية او فارماكوجي)</strong></p>
      <p className="req-sign-doctor">{value('اسم الطبيب الاختصاص', 'doctor', { bare: true })}<strong>الطبيب الاخصائي</strong></p>
    </div>
  </div>
}
