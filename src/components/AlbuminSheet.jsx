import hospitalLogo from '../assets/hospital-logo.png'
import { DRUG_REQUESTS } from '../../shared/drug-requests.js'
import { Filled, Rich, TickCell } from './RequestSheetParts.jsx'

// «استمارة الالبومين» as the hospital's paper form (استمارة صرف الالبومين): the patient box filled in
// (Arabic fields on the right, the English ones on the left), then the protocol's numbered indications,
// tickable on screen and printed with their ✓. Indications 1–15 sit three to a row, left to right as
// on paper; 16 and 17 take the full width.
const [INDICATION] = DRUG_REQUESTS.albumin.groups
const byKey = Object.fromEntries(INDICATION.options.map((option) => [option.key, option]))
const GRID = [['i1', 'i2', 'i3'], ['i4', 'i5', 'i6'], ['i7', 'i8', 'i9'], ['i10', 'i11', 'i12'], ['i13', 'i14', 'i15'], ['i16'], ['i17']]

export default function AlbuminSheet({ request, wardLabel, onToggle }) {
  const { fields } = request
  const indication = (key, colSpan) => {
    const option = byKey[key]
    return <TickCell key={key} colSpan={colSpan} className={`alb-${key}`} checked={request.ticks.includes(key)} onToggle={() => onToggle(key)}>
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
        <tr><td><Filled label="اسم المريض:" value={request.name} /></td><td><Filled label="رقم الطبلة:" value={request.patientId} /></td><td dir="ltr" lang="en"><Filled label="Diagnosis:" value={fields.diagnosis} /></td></tr>
        <tr><td><Filled label="الطابق والردهة:" value={wardLabel} /></td><td /><td dir="ltr" lang="en"><Filled label="Serum albumin:" value={fields.serumAlbumin} unit="g/dl" /></td></tr>
        <tr><td><Filled label="العدد المطلوب (رقما):" value={fields.count} /></td><td /><td dir="ltr" lang="en"><Filled label="Treatment day:" value={fields.treatmentDay} /></td></tr>
        <tr><td><Filled label="كتابة:" value={request.words} /></td><td /><td dir="ltr" lang="en"><Filled label="Weight:" value={fields.weight} unit="kg" /></td></tr>
        <tr><td /><td /><td dir="ltr" lang="en"><Filled label="S.creatinine:" value={fields.scr} /></td></tr>
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
      <p><strong>الطبيب الاختصاص</strong></p>
      <p><strong>مسؤول وحدة الصيدلة السريرية</strong></p>
      <p><strong>مسؤول القسم</strong></p>
      <p />
      <p><strong>مدير المستشفى او القسم الفني</strong></p>
    </div>
  </div>
}
