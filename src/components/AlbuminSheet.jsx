import hospitalLogo from '../assets/hospital-logo.png'
import { DRUG_REQUESTS } from '../../shared/drug-requests.js'
import { Field, Rich, TickCell } from './RequestSheetParts.jsx'

// «استمارة الالبومين» as the hospital's paper form (استمارة صرف الالبومين): the patient box (Arabic
// fields on the right, the English ones on the left), then the protocol's numbered indications.
// On the form's screen every typed value is editable in place and the indications tick; with
// `paper` it is the plain page the PDF is drawn from. Indications 1–15 sit three to a row, left to
// right as on paper; 16 and 17 take the full width. «كتابة» is the count spelled out by the server.
const SPEC = DRUG_REQUESTS.albumin
const [INDICATION] = SPEC.groups
const byKey = Object.fromEntries(INDICATION.options.map((option) => [option.key, option]))
const fieldOf = Object.fromEntries(SPEC.fields.map((field) => [field.key, field]))
const GRID = [['i1', 'i2', 'i3'], ['i4', 'i5', 'i6'], ['i7', 'i8', 'i9'], ['i10', 'i11', 'i12'], ['i13', 'i14', 'i15'], ['i16'], ['i17']]
const ID_FIELD = { key: 'patientId', max: 20, digits: true }

export default function AlbuminSheet({ request, wardLabel, paper = false, onToggle, onField }) {
  const { fields } = request
  const value = (label, key, extra) => <Field label={label} value={fields[key]} field={fieldOf[key]} paper={paper} onSave={(next) => onField({ fields: { [key]: next } })} {...extra} />
  const indication = (key, colSpan) => {
    const option = byKey[key]
    return <TickCell key={key} paper={paper} colSpan={colSpan} className={`alb-${key}`} checked={request.ticks.includes(key)} onToggle={() => onToggle(key)}>
      <strong>{option.title}</strong>{option.inline && <Rich text={option.inline} />}
      {option.lines?.map((line) => <span key={line} className="alb-line"><Rich text={line} /></span>)}
    </TickCell>
  }

  return <div className="req-paper">
    <p className="alb-title">
      <img className="hospital-logo" width="30" height="30" src={hospitalLogo} alt="" />
      <strong>استمارة صرف الالبومين / مستشفى بغداد التعليمي</strong>
    </p>

    <table className="req-form alb-head">
      <tbody>
        <tr>
          <td><Field label="اسم المريض:" value={request.name} paper={paper} required onSave={(next) => onField({ name: next })} /></td>
          <td><Field label="رقم الطبلة:" value={request.patientId} field={ID_FIELD} paper={paper} onSave={(next) => onField({ patientId: next })} /></td>
          <td dir="ltr" lang="en">{value('Diagnosis:', 'diagnosis')}</td>
        </tr>
        <tr><td><Field paper label="الطابق والردهة:" value={wardLabel} /></td><td /><td dir="ltr" lang="en">{value('Serum albumin:', 'serumAlbumin', { unit: 'g/dl' })}</td></tr>
        <tr><td>{value('العدد المطلوب (رقما):', 'count')}</td><td /><td dir="ltr" lang="en">{value('Treatment day:', 'treatmentDay')}</td></tr>
        <tr><td><Field paper label="كتابة:" value={request.words} /></td><td /><td dir="ltr" lang="en">{value('Weight:', 'weight', { unit: 'kg' })}</td></tr>
        <tr><td /><td /><td dir="ltr" lang="en">{value('S.creatinine:', 'scr')}</td></tr>
      </tbody>
    </table>

    <table className="req-form alb-grid" lang="en" dir="ltr">
      <tbody>
        <tr><th colSpan={3} className="alb-protocol" lang="ar" dir="rtl">يصرف علاج الالبومين حسب البروتوكول العلاجي المقر من وزارة الصحة المرقم ٢٩٦٢ بتاريخ ١٧/٤/٢٠٢٣و للحالات التالية :</th></tr>
        {GRID.map((row) => <tr key={row[0]}>{row.map((key) => indication(key, row.length === 1 ? 3 : undefined))}</tr>)}
      </tbody>
    </table>

    <div className="req-signatures alb-signatures">
      <p><strong>الصيدلي السريري</strong></p>
      <p className="req-sign-doctor">{value('اسم الطبيب الاختصاص', 'doctor', { bare: true })}<strong>الطبيب الاختصاص</strong></p>
      <p><strong>مسؤول وحدة الصيدلة السريرية</strong></p>
      <p><strong>مسؤول القسم</strong></p>
      <p />
      <p><strong>مدير المستشفى او القسم الفني</strong></p>
    </div>
  </div>
}
