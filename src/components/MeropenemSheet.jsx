import hospitalLogo from '../assets/hospital-logo.png'
import { DRUG_REQUESTS } from '../../shared/drug-requests.js'
import { Filled, TickCell } from './RequestSheetParts.jsx'

// «استمارة الميرونيم» as the ministry's paper form (الاستمارة اليومية للمضادات الحياتية): the typed
// fields filled in, the diagnosis and culture boxes tickable on screen and printed with their ✓.
// The diagnosis grid runs left to right, as on paper — the table's direction, not a row's, sets that.
const GRID = [
  ['mastoiditis', 'sinusitis', 'meningitis'],
  ['blast', 'gangrene', 'hap'],
  ['bronchiectasis', 'lung-abscess', 'nve'],
  ['neutropenic', 'empyema', 'pancreatitis'],
  ['liver-abscess', 'resection', 'cap'],
  ['diabetic-foot', 'peritonitis', 'sepsis'],
]
const [DIAGNOSIS, CULTURE] = DRUG_REQUESTS.meropenem.groups
const textOf = Object.fromEntries(DIAGNOSIS.options.map((option) => [option.key, option.text]))
const dayMonthYear = (iso) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`

export default function MeropenemSheet({ request, wardName, onToggle, onNote }) {
  const { fields } = request
  const ticked = (key) => request.ticks.includes(key)
  const cell = (key, colSpan, after) => <TickCell key={key} colSpan={colSpan} checked={ticked(key)} onToggle={() => onToggle(key)} after={after}>{textOf[key]}</TickCell>
  const others = ticked('others') && <>
    <input className="req-note-input" lang="en" dir="auto" defaultValue={request.note} key={request.note} maxLength={300} placeholder="specify" aria-label="Others (specify)"
      onBlur={(event) => { if (event.target.value.trim() !== request.note) onNote(event.target.value.trim()) }}
      onKeyDown={(event) => { if (event.key === 'Enter') event.target.blur() }} />
    {request.note && <span className="req-note-print">{request.note}</span>}
  </>

  return <div className="req-paper">
    <div className="req-paper-head">
      <img className="hospital-logo" width="34" height="34" src={hospitalLogo} alt="" />
      <span>مستشفى بغداد التعليمي — وحدة الصيدلة السريرية</span>
    </div>

    <table className="req-form">
      <tbody>
        <tr><th colSpan={3} className="req-band">الاستمارة اليومية للمضادات الحياتية</th></tr>
        <tr><td colSpan={3} className="mero-title">
          <strong lang="en" dir="ltr">Meropenem/ Imipenem requesting form</strong>
          <strong lang="en" dir="ltr">(Not first line therapy)</strong>
          <strong>(لايجوز تجهيز العلاج بدون ملء الاستمارة كاملة من قبل الطبيب الاختصاصي المسؤول حصراً)</strong>
        </td></tr>
        <tr><td><Filled label="دائرة صحة:" value="مدينة الطب" /></td><td><Filled label="مستشفى:" value="مستشفى بغداد التعليمي" /></td><td><Filled label="الردهة:" value={wardName} /></td></tr>
        <tr><td><Filled label="اسم المريض:" value={request.name} /></td><td><Filled label="العمر:" value={fields.age} /></td><td><Filled label="الوزن:" value={fields.weight} unit="كغم" /></td></tr>
        <tr><td><Filled label="التاريخ:" value={dayMonthYear(request.date)} /></td><td><Filled label="S.cr:" value={fields.scr} ltr /></td><td><Filled label="التحسس:" value={fields.allergy} /></td></tr>
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
        {CULTURE.options.map((option) => <TickCell key={option.key} checked={ticked(option.key)} onToggle={() => onToggle(option.key)}>{option.text}</TickCell>)}
      </tr></tbody>
    </table>

    <table className="req-form mero-dose">
      <tbody>
        <tr><th scope="row">الجرعة</th><td><bdi dir="auto">{fields.dose}</bdi></td></tr>
        <tr><th scope="row">تحديد مدة الصرف</th><td>{fields.duration}</td></tr>
      </tbody>
    </table>

    <div className="req-signatures">
      <p><strong>الصيدلي</strong><strong>عضو لجنة المضادات الحياتية</strong></p>
      <p><strong>مسؤول الصيدلة السريرية</strong><strong>(اذا لم يكن صيدلي اختصاص فيجب تخصيص صيدلي اختصاص/ صيدلة سريرية او فارماكوجي)</strong></p>
      <p><strong>الطبيب الاخصائي</strong></p>
    </div>
  </div>
}
