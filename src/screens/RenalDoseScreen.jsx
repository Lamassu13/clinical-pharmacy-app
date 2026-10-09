import { useState } from 'react'
import { RENAL_EQUATIONS, SCR_UMOL_PER_MGDL } from '../helpers.js'

// «تعديل الجرعة الكلوية»: type the patient's values once and read the result of every kidney-function
// equation side by side. Nothing typed here is sent or stored — it lives in this screen's state.
const BLANK = { age: '', weight: '', height: '', female: false, black: false, scr: '', scr2: '', hours: '', umol: false }
const number = (value) => Number(String(value).replace(',', '.'))
const INPUTS = [['age', 'العمر (سنة)'], ['weight', 'الوزن الفعلي (كغم)'], ['height', 'الطول (سم)'], ['scr', 'الكرياتينين'], ['scr2', 'الكرياتينين الأحدث (للمتغيّر)'], ['hours', 'الفاصل بين القياسين (ساعة)']]
const FIELD_NAMES = { age: 'Age', weight: 'Weight', height: 'Height', scr: 'Creatinine', scr2: 'Recent creatinine', hours: 'Hours between' }

export default function RenalDoseScreen({ header, wardLabel, onBack }) {
  const [labs, setLabs] = useState(BLANK)
  const set = (field) => (event) => setLabs((current) => ({ ...current, [field]: event.target.value }))
  const choose = (field, value) => setLabs((current) => ({ ...current, [field]: value }))
  const mgDl = (value) => (labs.umol ? number(value) / SCR_UMOL_PER_MGDL : number(value))
  const values = { age: number(labs.age), weightKg: number(labs.weight), heightCm: number(labs.height), female: labs.female, black: labs.black, scr: mgDl(labs.scr), scr2: mgDl(labs.scr2), hours: number(labs.hours) }
  const filled = { age: values.age > 0, weight: values.weightKg > 0, height: values.heightCm > 0, scr: values.scr > 0, scr2: values.scr2 > 0, hours: values.hours > 0 }

  return <main className="app-shell">
    {header}

    <section className="order-page renal-page">
      <div className="chart-toolbar order-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
        <h1>تعديل الجرعة الكلوية — <bdi>{wardLabel}</bdi></h1>
      </div>

      <form className="renal-form" onSubmit={(event) => event.preventDefault()}>
        {INPUTS.slice(0, 3).map(([field, label]) => <label key={field}>{label}<input inputMode="decimal" autoComplete="off" value={labs[field]} onChange={set(field)} /></label>)}
        <fieldset className="renal-choice">
          <legend>الجنس</legend>
          <div className="filter-chips">
            <button type="button" className="filter-chip" aria-pressed={!labs.female} onClick={() => choose('female', false)}>ذكر</button>
            <button type="button" className="filter-chip" aria-pressed={labs.female} onClick={() => choose('female', true)}>أنثى</button>
          </div>
        </fieldset>
        {INPUTS.slice(3, 4).map(([field, label]) => <label key={field}>{label}<input inputMode="decimal" autoComplete="off" value={labs[field]} onChange={set(field)} /></label>)}
        <fieldset className="renal-choice">
          <legend>الوحدة</legend>
          <div className="filter-chips" dir="ltr">
            <button type="button" className="filter-chip" aria-pressed={!labs.umol} onClick={() => choose('umol', false)}>mg/dL</button>
            <button type="button" className="filter-chip" aria-pressed={labs.umol} onClick={() => choose('umol', true)}>µmol/L</button>
          </div>
        </fieldset>
        <label className="renal-hd"><input type="checkbox" checked={labs.black} onChange={(event) => choose('black', event.target.checked)} /> Black (CKD-EPI 2009 / MDRD)</label>
        {INPUTS.slice(4).map(([field, label]) => <label key={field}>{label}<input inputMode="decimal" autoComplete="off" value={labs[field]} onChange={set(field)} /></label>)}
      </form>

      <div className="order-table-scroll">
        <table className="renal-table">
          <thead><tr><th scope="col" dir="ltr">Equation</th><th scope="col" dir="ltr">Result</th></tr></thead>
          <tbody>{Object.entries(RENAL_EQUATIONS).map(([id, { label, fields, calc }]) => {
            const result = calc(values)
            const missing = fields.filter((field) => !field.endsWith('?') && filled[field] === false).map((field) => FIELD_NAMES[field])
            return <tr key={id}>
              <td lang="en" dir="ltr">{label}</td>
              <td lang="en" dir="ltr" className="renal-guidance">{result === null ? <span className="renal-usual">Needs {missing.join(', ') || 'valid values'}</span> : `${Math.round(result)} mL/min`}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
      <p className="interactions-disclaimer">تقدير للبالغين — لا يغني عن مراجعة الصيدلي للمرجع الدوائي. معادلات CKD-EPI وMDRD وJelliffe 1973 تُحوَّل إلى mL/min عند إدخال الطول والوزن، وإلا تُعرض كما هي (mL/min/1.73 m²). لا تُحفظ أي قيمة مُدخلة.</p>
    </section>
  </main>
}
