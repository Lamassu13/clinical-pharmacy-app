import hospitalLogo from '../assets/hospital-logo.png'
import { DRUG_REQUESTS } from '../../shared/drug-requests.js'
import { Field, Rich, TickCell } from './RequestSheetParts.jsx'

// «Tigecycline vial prescription / استمارة صرف» as the ministry's paper form: the header, the patient's
// boxes, the two permitted cases (one is chosen) beside the route and the dose, the administration notes,
// and the signatures. On the form's screen every typed value is editable in place and the case ticks; with
// `paper` it is the plain page the PDF is drawn from. The case/route/dose table reads left to right, as on paper.
const SPEC = DRUG_REQUESTS.tigecycline
const [INDICATION] = SPEC.groups
const fieldOf = Object.fromEntries(SPEC.fields.map((field) => [field.key, field]))
const ID_FIELD = { key: 'patientId', max: 20, digits: true }
const dayMonthYear = (iso) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`
const DOSE_LINES = [
  '- **Adult**: Initially 100 mg, followed by 50 mg every 12 hours for 5–14 days',
  '- **Child 8–11 years** (under expert supervision): 1.2 mg/kg every 12 hours (max. per dose 50 mg) for 5–14 days',
  '- **Child 12–17 years** (under expert supervision): 50 mg every 12 hours for 5–14 days',
]

export default function TigecyclineSheet({ request, wardName, paper = false, onToggle, onField }) {
  const { fields } = request
  const value = (label, key, extra) => <Field label={label} value={fields[key]} field={fieldOf[key]} paper={paper} onSave={(next) => onField({ fields: { [key]: next } })} {...extra} />
  const ticked = (key) => request.ticks.includes(key)
  const [skin, abdominal] = INDICATION.options
  const sexField = fieldOf.sex

  return <div className="req-paper tige-paper">
    {/* The sex is a two-way choice (chips, no typing); the paper form has its box, filled from the choice. */}
    {!paper && <>
      <div className="req-extra-row">
        <span className="req-label">الجنس</span>
        <div className="req-chips" role="group" aria-label="الجنس">
          {sexField.choices.map((choice) => <button key={choice} type="button" className="req-chip" aria-pressed={fields.sex === choice} onClick={() => onField({ fields: { sex: choice } })}>{choice}</button>)}
        </div>
      </div>
      <div className="req-extra-row">
        <span className="req-label">نتيجة الزرع البكتيري</span>
        <div className="req-chips" role="group" aria-label="نتيجة الزرع البكتيري">
          {fieldOf.culture.choices.map((choice) => <button key={choice} type="button" className="req-chip" aria-pressed={fields.culture === choice} onClick={() => onField({ fields: { culture: fields.culture === choice ? '' : choice } })}>{choice}</button>)}
        </div>
      </div>
      <div className="req-extra-row">{value('اسم عضو لجنة المضادات الحياتية', 'committee')}<small>(للإرسال إلى نموذج الوزارة — لا يُطبع)</small></div>
    </>}

    <table className="req-form tige-head">
      <tbody><tr>
        <td className="tige-head-ministry"><strong>وزارة الصحة</strong><span className="tige-line"><Field paper label="دائرة صحة:" value="مدينة الطب" /></span><span className="tige-line"><Field paper label="مستشفى:" value="مستشفى بغداد التعليمي" /></span></td>
        <td className="tige-head-logo"><img className="hospital-logo" width="46" height="46" src={hospitalLogo} alt="" /></td>
        <td className="tige-head-title" lang="en" dir="ltr"><strong>Tigecycline vial prescription</strong><strong lang="ar" dir="rtl">استمارة صرف</strong></td>
      </tr></tbody>
    </table>

    <table className="req-form tige-patient">
      <tbody>
        <tr>
          <td><Field label="اسم المريض:" value={request.name} paper={paper} required onSave={(next) => onField({ name: next })} /></td>
          <td><Field paper label="الجنس:" value={fields.sex} /></td>
          <td>{value('العمر:', 'age')}</td>
        </tr>
        <tr>
          <td><Field paper label="الردهة:" value={wardName} /></td>
          <td><Field label="رقم الطبلة:" value={request.patientId} field={ID_FIELD} paper={paper} onSave={(next) => onField({ patientId: next })} /></td>
          <td>{value('التشخيص:', 'diagnosis')}</td>
        </tr>
        <tr>
          <td><Field paper label="تاريخ بدء العلاج:" value={dayMonthYear(request.date)} /></td>
          <td>{value('الوزن:', 'weight', { unit: 'كغم' })}</td>
          <td />
        </tr>
        <tr><td colSpan={3}>{value('الجرعة المطلوبة يوميًا:', 'dose')}</td></tr>
        <tr>
          <td>{value('عدد الأيام المطلوب أخذ العلاج فيها:', 'duration')}</td>
          <td>{value('S.Cr.', 'scr', { ltr: true })}</td>
          <td><Field paper label="نتيجة الزرع البكتيري:" value={fields.culture} /></td>
        </tr>
      </tbody>
    </table>

    <table className="req-form tige-indication" lang="en" dir="ltr">
      <tbody>
        <tr>
          <th scope="col" className="tige-red">INDICATION</th>
          <th scope="col" className="tige-red">ROUTE</th>
          <th scope="col" className="tige-red">DOSE</th>
          <td rowSpan={3} className="tige-cases" lang="ar" dir="rtl"><strong>الحالات المصرح باستخدام المادة فيها</strong><strong className="tige-choose">(يتم اختيار إحدى الحالتين)</strong></td>
        </tr>
        <tr>
          <TickCell paper={paper} checked={ticked(skin.key)} onToggle={() => onToggle(skin.key)}><Rich text={`1. ${skin.text}`} /></TickCell>
          <td rowSpan={2} className="tige-route">IV</td>
          <td rowSpan={2} className="tige-dose">{DOSE_LINES.map((line) => <span key={line} className="tige-dose-line"><Rich text={line} /></span>)}</td>
        </tr>
        <tr>
          <TickCell paper={paper} checked={ticked(abdominal.key)} onToggle={() => onToggle(abdominal.key)}><Rich text={`2. ${abdominal.text}`} /></TickCell>
        </tr>
        <tr><td colSpan={4} className="tige-note"><Rich text="**Dose adjustment in severe hepatic impairment**: Reduction to 25 mg every 12 hours following the loading dose." /></td></tr>
        <tr><td colSpan={4} className="tige-note"><Rich text="**DIRECTIONS FOR ADMINISTRATION**: For IV infusion: give intermittently in Glucose 5% or Sodium Chloride 0.9%. Reconstitute each vial with 5.3 mL infusion fluid to produce a 10 mg/mL solution; dilute requisite dose in 100 mL infusion fluid; give over 30–60 minutes." /></td></tr>
      </tbody>
    </table>

    <p className="tige-warning"><strong>لا يصرف العلاج بدون ملئ الاستمارة كاملة من قبل الطبيب الاختصاصي المسؤول</strong></p>
    <p className="tige-committee">اعضاء اللجنة المشرفة على صرف المضادات الحياتية</p>
    <div className="req-signatures tige-signatures">
      <p><strong>الصيدلي</strong><strong>عضو لجنة المضادات الحياتية</strong></p>
      <p><strong>مسؤول الصيدلة السريرية</strong></p>
      <p className="req-sign-doctor">{value('اسم الطبيب الاختصاص', 'doctor', { bare: true, ...(paper && fields.hideDoctor ? { value: '' } : {}) })}{!paper && <label className="req-doctor-toggle"><input type="checkbox" checked={!fields.hideDoctor} onChange={(event) => onField({ fields: { hideDoctor: event.target.checked ? '' : '1' } })} /> طباعة اسم الطبيب</label>}<strong>الطبيب الاختصاصي</strong></p>
    </div>
  </div>
}
