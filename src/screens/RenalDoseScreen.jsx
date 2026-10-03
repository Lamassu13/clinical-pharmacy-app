import { useState } from 'react'
import { cockcroftGault, renalGuidance, SCR_UMOL_PER_MGDL } from '../helpers.js'

// «تعديل الجرعة الكلوية»: pick a patient from the day's chart, type their age, weight, sex and
// serum creatinine, and read each of their medicines' renal dose guidance (server/renal-doses.js)
// at the Cockcroft-Gault CrCl. Nothing typed here is sent or stored — it lives in this screen's
// state and is cleared on changing patient or leaving.
const BLANK = { age: '', weight: '', female: false, scr: '', umol: false, hd: false }
const number = (value) => Number(String(value).replace(',', '.'))

export default function RenalDoseScreen({ header, wardLabel, onBack, selectedDate, onChangeDate, loading, data, loadError }) {
  const [patientKey, setPatientKey] = useState('')
  const [labs, setLabs] = useState(BLANK)
  const patients = data?.patients || []
  const rules = data?.rules || {}
  const patient = patients.find((entry) => entry.key === patientKey)
  const set = (field) => (event) => setLabs((current) => ({ ...current, [field]: event.target.value }))
  const choose = (field, value) => setLabs((current) => ({ ...current, [field]: value }))

  const scrMgDl = labs.umol ? number(labs.scr) / SCR_UMOL_PER_MGDL : number(labs.scr)
  const crcl = cockcroftGault({ age: number(labs.age), weightKg: number(labs.weight), female: labs.female, scrMgDl })
  const ready = labs.hd || crcl !== null
  const ruled = patient ? patient.medicines.filter((name) => rules[name]) : []
  const unruled = patient ? patient.medicines.filter((name) => !rules[name]) : []

  return <main className="app-shell">
    {header}

    <section className="order-page renal-page">
      <div className="chart-toolbar order-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
        <h1>تعديل الجرعة الكلوية — <bdi>{wardLabel}</bdi></h1>
        <div className="toolbar-actions">
          <label className="pills-date">التاريخ <input type="date" value={selectedDate} onChange={(event) => { setPatientKey(''); setLabs(BLANK); onChangeDate(event.target.value) }} /></label>
        </div>
      </div>

      {loading ? <div className="empty-state"><span className="spinner" /><span>جارٍ تحميل الجارت…</span></div>
        : loadError ? <div className="empty-state"><strong>تعذّر تحميل الجارت</strong><span>حدّث الصفحة وحاول مجددًا.</span></div>
        : !patients.length ? <div className="empty-state"><strong>لا يوجد مرضى بأدوية في جارت هذا اليوم</strong><span>اختر تاريخًا آخر أو املأ الجارت أولًا.</span></div>
        : <>
          <form className="renal-form" onSubmit={(event) => event.preventDefault()}>
            <label className="renal-patient">المريض
              <select value={patientKey} onChange={(event) => { setPatientKey(event.target.value); setLabs(BLANK) }}>
                <option value="">اختر المريض…</option>
                {patients.map((entry) => <option key={entry.key} value={entry.key}>{entry.name || '—'}{entry.patientId ? ` · ${entry.patientId}` : ''}{entry.extra ? ' (إضافي)' : ''}</option>)}
              </select>
            </label>
            {patient && <>
              <label>العمر (سنة)<input inputMode="decimal" autoComplete="off" value={labs.age} onChange={set('age')} /></label>
              <label>الوزن الفعلي (كغم)<input inputMode="decimal" autoComplete="off" value={labs.weight} onChange={set('weight')} /></label>
              <fieldset className="renal-choice">
                <legend>الجنس</legend>
                <div className="filter-chips">
                  <button type="button" className="filter-chip" aria-pressed={!labs.female} onClick={() => choose('female', false)}>ذكر</button>
                  <button type="button" className="filter-chip" aria-pressed={labs.female} onClick={() => choose('female', true)}>أنثى</button>
                </div>
              </fieldset>
              <label>الكرياتينين<input inputMode="decimal" autoComplete="off" value={labs.scr} onChange={set('scr')} /></label>
              <fieldset className="renal-choice">
                <legend>الوحدة</legend>
                <div className="filter-chips" dir="ltr">
                  <button type="button" className="filter-chip" aria-pressed={!labs.umol} onClick={() => choose('umol', false)}>mg/dL</button>
                  <button type="button" className="filter-chip" aria-pressed={labs.umol} onClick={() => choose('umol', true)}>µmol/L</button>
                </div>
              </fieldset>
              <label className="renal-hd"><input type="checkbox" checked={labs.hd} onChange={(event) => choose('hd', event.target.checked)} /> على الغسيل الكلوي (HD)</label>
            </>}
          </form>

          {patient && <>
            <p className="renal-result" aria-live="polite">
              {labs.hd ? <><strong>غسيل كلوي</strong><span>تُعرض جرعات مرضى الغسيل الكلوي (HD).</span></>
                : crcl === null ? <><strong>CrCl —</strong><span>أدخل العمر والوزن والكرياتينين لحساب تصفية الكرياتينين.</span></>
                : <><strong dir="ltr">CrCl {Math.round(crcl)} mL/min</strong><span dir="ltr">Cockcroft-Gault: (140 − age) × weight ÷ (72 × SCr){labs.female ? ' × 0.85' : ''}</span></>}
            </p>

            {ruled.length ? <div className="order-table-scroll">
              <table className="renal-table">
                <thead><tr><th scope="col" dir="ltr">Medicine</th><th scope="col" dir="ltr">{labs.hd ? 'On haemodialysis' : ready ? `At CrCl ${Math.round(crcl)}` : 'Renal adjustment'}</th><th scope="col" dir="ltr">Usual dose</th></tr></thead>
                <tbody>{ruled.map((name) => {
                  const guidance = ready ? renalGuidance(rules[name], crcl, labs.hd) : ''
                  const unchanged = /^No change/.test(guidance)
                  return <tr key={name}>
                    <td lang="en" dir="ltr">{name}</td>
                    <td lang="en" dir="ltr" className={unchanged ? 'renal-guidance renal-guidance--same' : 'renal-guidance'}>{ready ? guidance : '—'}</td>
                    <td lang="en" dir="ltr" className="renal-usual">{rules[name].usual}</td>
                  </tr>
                })}</tbody>
              </table>
            </div> : <div className="empty-state"><strong>لا يحتاج أي من أدوية هذا المريض تعديلًا كلويًا في القائمة</strong></div>}
            {unruled.length > 0 && <p className="renal-note">بلا قاعدة كلوية في القائمة: <span lang="en" dir="ltr">{unruled.join(' · ')}</span></p>}
          </>}
          <p className="interactions-disclaimer">إرشاد للبالغين حسب تصفية الكرياتينين (Cockcroft-Gault، الوزن الفعلي) — لا يغني عن مراجعة الصيدلي للمرجع الدوائي ومستويات الدواء. لا تُحفظ أي قيمة مُدخلة.</p>
        </>}
    </section>
  </main>
}
