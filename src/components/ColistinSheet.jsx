import { DRUG_REQUESTS } from '../../shared/drug-requests.js'
import { Field, TickCell } from './RequestSheetParts.jsx'

// «Colistin vial prescription / استمارة صرف» as the ministry's paper form: the header, the patient's boxes,
// the dose with the unit conversions, the days, the culture and S.Cr, the two permitted cases (one is chosen),
// and the signatures. On the form's screen every typed value is editable in place and the case ticks; with
// `paper` it is the plain page the PDF is drawn from. Styled with TigecyclineSheet's classes (same ministry layout).
const SPEC = DRUG_REQUESTS.colistin
const [INDICATION] = SPEC.groups
const fieldOf = Object.fromEntries(SPEC.fields.map((field) => [field.key, field]))
const ID_FIELD = { key: 'patientId', max: 20, digits: true }
const dayMonthYear = (iso) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`
const CONVERSIONS = ['12500 IU = 1 mg of colistimethate', '2.67 mg colistimethate = 1 mg colistin base', 'Thus 1 million IU = 80 mg colistimethate = 30 mg colistin base']

export default function ColistinSheet({ request, wardName, paper = false, onToggle, onField }) {
  const { fields } = request
  const value = (label, key, extra) => <Field label={label} value={fields[key]} field={fieldOf[key]} paper={paper} onSave={(next) => onField({ fields: { [key]: next } })} {...extra} />
  const ticked = (key) => request.ticks.includes(key)
  const [serious, cf] = INDICATION.options

  return <div className="req-paper tige-paper">
    {/* The sex is a two-way choice (chips, no typing); the paper form has its box, filled from the choice. */}
    {!paper && <div className="req-extra-row">
      <span className="req-label">الجنس</span>
      <div className="req-chips" role="group" aria-label="الجنس">
        {fieldOf.sex.choices.map((choice) => <button key={choice} type="button" className="req-chip" aria-pressed={fields.sex === choice} onClick={() => onField({ fields: { sex: choice } })}>{choice}</button>)}
      </div>
    </div>}

    <table className="req-form tige-head">
      <tbody><tr>
        <td className="tige-head-ministry"><strong>وزارة الصحة</strong><span className="tige-line">دائرة مدينة الطب</span></td>
        <td className="tige-head-ministry"><strong>مستشفى بغداد التعليمي</strong><span className="tige-line">وحدة الصيدلة السريرية</span></td>
        <td className="tige-head-title" lang="en" dir="ltr"><strong>Colistin vial prescription</strong><strong lang="ar" dir="rtl">استمارة صرف</strong></td>
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
          <td colSpan={2}><Field paper label="تاريخ بدء العلاج:" value={dayMonthYear(request.date)} /></td>
          <td>{value('الوزن:', 'weight', { unit: 'كغم' })}</td>
        </tr>
        <tr>
          <td>{value('الجرعة المطلوبة يوميًا:', 'dose')}</td>
          <td colSpan={2} className="coli-equations" lang="en" dir="ltr"><span>Dose calculated according to the following equations:</span>{CONVERSIONS.map((line) => <span key={line}>{line}</span>)}</td>
        </tr>
        <tr>
          <td>{value('عدد الأيام المطلوب أخذ العلاج فيها:', 'duration')}</td>
          <td>{value('نتيجة الزرع البكتيري:', 'culture')}</td>
          <td>{value('S.Cr.', 'scr', { ltr: true })}</td>
        </tr>
        <tr>
          <td rowSpan={2} className="tige-cases"><strong>الحالات المصرح باستخدام المادة فيها</strong><strong className="tige-choose">(يتم اختيار إحدى الحالتين)</strong></td>
          <TickCell paper={paper} colSpan={2} checked={ticked(serious.key)} onToggle={() => onToggle(serious.key)}><span lang="en" dir="ltr">{serious.text}</span></TickCell>
        </tr>
        <tr>
          <TickCell paper={paper} colSpan={2} checked={ticked(cf.key)} onToggle={() => onToggle(cf.key)}><span lang="en" dir="ltr">{cf.text}</span></TickCell>
        </tr>
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
