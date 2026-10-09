import { useState } from 'react'
import { RENAL_EQUATIONS, renalGuidance, SCR_UMOL_PER_MGDL } from '../helpers.js'

// «تعديل الجرعة الكلوية»: pick a kidney-function equation, type the values it asks for, and read
// every listed medicine's renal dose guidance (server/renal-doses.js) at the resulting CrCl.
// Nothing typed here is sent or stored — it lives in this screen's state and is cleared on leaving.
const BLANK = { age: '', weight: '', height: '', female: false, black: false, scr: '', scr2: '', hours: '', umol: false, hd: false }
const number = (value) => Number(String(value).replace(',', '.'))
const FIELD_LABELS = { age: 'العمر (سنة)', weight: 'الوزن الفعلي (كغم)', height: 'الطول (سم)', scr: 'الكرياتينين', scr2: 'الكرياتينين الأحدث', hours: 'الفاصل بين القياسين (ساعة)' }

export default function RenalDoseScreen({ header, wardLabel, onBack, loading, data, loadError }) {
  const [equationId, setEquationId] = useState('cg')
  const [labs, setLabs] = useState(BLANK)
  const rules = Object.entries(data?.rules || {})
  const equation = RENAL_EQUATIONS[equationId]
  const unstable = equation.fields.includes('scr2')
  const set = (field) => (event) => setLabs((current) => ({ ...current, [field]: event.target.value }))
  const choose = (field, value) => setLabs((current) => ({ ...current, [field]: value }))
  const mgDl = (value) => (labs.umol ? number(value) / SCR_UMOL_PER_MGDL : number(value))

  const crcl = equation.calc({
    age: number(labs.age), weightKg: number(labs.weight), heightCm: number(labs.height), female: labs.female, black: labs.black,
    scr: mgDl(labs.scr), scr2: mgDl(labs.scr2), hours: number(labs.hours),
  })
  const ready = labs.hd || crcl !== null
  const input = (field) => {
    const optional = equation.fields.includes(`${field}?`)
    return <label key={field}>{FIELD_LABELS[field]}{optional && ' (اختياري)'}<input inputMode="decimal" autoComplete="off" value={labs[field]} onChange={set(field)} /></label>
  }
  const shown = equation.fields.map((field) => field.replace('?', ''))

  return <main className="app-shell">
    {header}

    <section className="order-page renal-page">
      <div className="chart-toolbar order-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
        <h1>تعديل الجرعة الكلوية — <bdi>{wardLabel}</bdi></h1>
      </div>

      {loading ? <div className="empty-state"><span className="spinner" /><span>جارٍ التحميل…</span></div>
        : loadError ? <div className="empty-state"><strong>تعذّر تحميل قائمة الجرعات</strong><span>حدّث الصفحة وحاول مجددًا.</span></div>
        : <>
          <form className="renal-form" onSubmit={(event) => event.preventDefault()}>
            <label className="renal-patient">المعادلة
              <select value={equationId} onChange={(event) => setEquationId(event.target.value)} dir="ltr">
                {Object.entries(RENAL_EQUATIONS).map(([id, { label }]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            {shown.map((field) => {
              if (field === 'sex') return <fieldset key={field} className="renal-choice">
                <legend>الجنس</legend>
                <div className="filter-chips">
                  <button type="button" className="filter-chip" aria-pressed={!labs.female} onClick={() => choose('female', false)}>ذكر</button>
                  <button type="button" className="filter-chip" aria-pressed={labs.female} onClick={() => choose('female', true)}>أنثى</button>
                </div>
              </fieldset>
              if (field === 'black') return <label key={field} className="renal-hd"><input type="checkbox" checked={labs.black} onChange={(event) => choose('black', event.target.checked)} /> Black</label>
              if (field === 'scr') return [input('scr'), <fieldset key="unit" className="renal-choice">
                <legend>الوحدة</legend>
                <div className="filter-chips" dir="ltr">
                  <button type="button" className="filter-chip" aria-pressed={!labs.umol} onClick={() => choose('umol', false)}>mg/dL</button>
                  <button type="button" className="filter-chip" aria-pressed={labs.umol} onClick={() => choose('umol', true)}>µmol/L</button>
                </div>
              </fieldset>]
              return input(field)
            })}
            <label className="renal-hd"><input type="checkbox" checked={labs.hd} onChange={(event) => choose('hd', event.target.checked)} /> على الغسيل الكلوي (HD)</label>
          </form>

          <p className="renal-result" aria-live="polite">
            {labs.hd ? <><strong>غسيل كلوي</strong><span>تُعرض جرعات مرضى الغسيل الكلوي (HD).</span></>
              : crcl === null ? <><strong>CrCl —</strong><span>أدخل القيم المطلوبة للمعادلة.</span></>
              : <><strong dir="ltr">CrCl {Math.round(crcl)} mL/min</strong><span dir="ltr">{equation.label}</span></>}
          </p>
          {unstable && <p className="renal-note">الكرياتينين: الأقدم في الحقل الأول والأحدث في الثاني. المعادلة غير مثبتة على نطاق واسع للكرياتينين المتغيّر.</p>}

          <div className="order-table-scroll">
            <table className="renal-table">
              <thead><tr><th scope="col" dir="ltr">Medicine</th><th scope="col" dir="ltr">{labs.hd ? 'On haemodialysis' : ready ? `At CrCl ${Math.round(crcl)}` : 'Renal adjustment'}</th><th scope="col" dir="ltr">Usual dose</th></tr></thead>
              <tbody>{rules.map(([name, rule]) => {
                const guidance = ready ? renalGuidance(rule, crcl, labs.hd) : ''
                const unchanged = /^No change/.test(guidance)
                return <tr key={name}>
                  <td lang="en" dir="ltr" className="renal-drug">{name}</td>
                  <td lang="en" dir="ltr" className={unchanged ? 'renal-guidance renal-guidance--same' : 'renal-guidance'}>{ready ? guidance : '—'}</td>
                  <td lang="en" dir="ltr" className="renal-usual">{rule.usual}</td>
                </tr>
              })}</tbody>
            </table>
          </div>
          <p className="interactions-disclaimer">إرشاد للبالغين، وخطوات الجرعة محددة بتصفية الكرياتينين (Cockcroft-Gault) — المعادلات الأخرى للمقارنة والتقدير. لا يغني عن مراجعة الصيدلي للمرجع الدوائي ومستويات الدواء. لا تُحفظ أي قيمة مُدخلة.</p>
        </>}
    </section>
  </main>
}
