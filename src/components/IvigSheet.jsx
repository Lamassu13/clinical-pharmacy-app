import { DRUG_REQUESTS } from '../../shared/drug-requests.js'
import { Field, TickCell } from './RequestSheetParts.jsx'

// «IVIG vial prescription / استمارة صرف»: the ministry's form as the Google Form asks it — the header, the patient's
// boxes, the vials, and the diagnoses by part (one is chosen; «Others» opens a box to specify, English only). Same
// layout classes as the other vial forms. Every value is editable in place and a diagnosis ticks. It is not printed: it goes to the
// ministry's Google Form only.
const SPEC = DRUG_REQUESTS.ivig
const [DIAGNOSIS] = SPEC.groups
const PARTS = [...new Set(DIAGNOSIS.options.map((option) => option.part))]
const fieldOf = Object.fromEntries(SPEC.fields.map((field) => [field.key, field]))
const ID_FIELD = { key: 'patientId', max: 20, digits: true }
const dayMonthYear = (iso) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`

export default function IvigSheet({ request, wardName, onToggle, onNote, onField }) {
  const { fields } = request
  const value = (label, key, extra) => <Field label={label} value={fields[key]} field={fieldOf[key]} onSave={(next) => onField({ fields: { [key]: next } })} {...extra} />
  const ticked = (key) => request.ticks.includes(key)
  const others = ticked('others') && <input className="req-note-input" lang="en" dir="ltr" defaultValue={request.note} key={request.note} maxLength={100} placeholder="specify (English letters only)" aria-label="Others (specify)"
    onBlur={(event) => { if (event.target.value.trim() !== request.note) onNote(event.target.value.trim()) }}
    onKeyDown={(event) => { if (event.key === 'Enter') event.target.blur() }} />

  return <div className="req-paper tige-paper">
    {/* The sex is a two-way choice (chips, no typing). */}
    <div className="req-extra-row">
      <span className="req-label">الجنس</span>
      <div className="req-chips" role="group" aria-label="الجنس">
        {fieldOf.sex.choices.map((choice) => <button key={choice} type="button" className="req-chip" aria-pressed={fields.sex === choice} onClick={() => onField({ fields: { sex: choice } })}>{choice}</button>)}
      </div>
    </div>

    <table className="req-form tige-head">
      <tbody><tr>
        <td className="tige-head-ministry"><strong>وزارة الصحة</strong><span className="tige-line">دائرة مدينة الطب</span></td>
        <td className="tige-head-ministry"><strong>مستشفى بغداد التعليمي</strong><span className="tige-line">وحدة الصيدلة السريرية</span></td>
        <td className="tige-head-title" lang="en" dir="ltr"><strong>IVIG vial prescription</strong><strong lang="ar" dir="rtl">استمارة صرف</strong></td>
      </tr></tbody>
    </table>

    <table className="req-form tige-patient">
      <tbody>
        <tr>
          <td><Field label="اسم المريض:" value={request.name} required onSave={(next) => onField({ name: next })} /></td>
          <td><Field paper label="الجنس:" value={fields.sex} /></td>
          <td>{value('العمر:', 'age', { unit: 'سنة' })}</td>
        </tr>
        <tr>
          <td><Field paper label="الردهة:" value={wardName} /></td>
          <td><Field label="رقم الطبلة:" value={request.patientId} field={ID_FIELD} onSave={(next) => onField({ patientId: next })} /></td>
          <td><Field paper label="تاريخ الصرف:" value={dayMonthYear(request.date)} /></td>
        </tr>
        <tr><td colSpan={3}>{value('عدد الفيالات المصروفة:', 'vials')}</td></tr>
        <tr><td colSpan={3}>{value('اسم الطبيب الاختصاص:', 'doctor')}</td></tr>
      </tbody>
    </table>

    <table className="req-form ivig-dx" lang="en" dir="ltr">
      <tbody>
        <tr><th scope="col" className="req-band">Diagnosis — select one suitable choice</th></tr>
        {PARTS.map((part) => [
          <tr key={part}><th scope="row" className="ivig-part">{part}</th></tr>,
          ...DIAGNOSIS.options.filter((option) => option.part === part).map((option) => <tr key={option.key}>
            <TickCell checked={ticked(option.key)} onToggle={() => onToggle(option.key)} after={option.key === 'others' ? others : null}>{option.text}</TickCell>
          </tr>),
        ])}
      </tbody>
    </table>
  </div>
}
