import { formsWord } from '../helpers.js'

// «مواقف القسم»: a floor's six forms in one place, to correct and send them. Each tile is the form's own screen (its mode), so
// editing and sending work exactly as on the ward page — no new form and no print here (both stay on the ward page); albumin
// «Not indicated» forms are left out. The controls only switch the ward (`wards`, the floor's) and the form.
// The ward is a segmented track (one choice of a few, always one row); the forms are tiles with their day's state in
// words under the name. `counts` is useRequestCounts' for the ward shown ({ kind: n, attention: { kind: n } }).
export const FORM_TABS = [
  { kind: 'albumin', mode: 'albumin-forms', label: 'الالبومين' },
  { kind: 'meropenem', mode: 'meropenem-forms', label: 'الميرونيم' },
  { kind: 'colistin', mode: 'colistin-forms', label: 'الكوليستين' },
  { kind: 'tigecycline', mode: 'tigecycline-forms', label: 'التايجيسايكلين' },
  { kind: 'ivig', mode: 'ivig-forms', label: 'IVIG' },
  { kind: null, mode: 'antibiotic-forms', label: 'صرف المضادات' },
]

// The tile's second line: what still needs following up, else how many there are, else none. Nothing while the count
// is unknown (offline, still loading), and nothing for the dispensing form, which is per patient, not per day.
const stateOf = (counts, kind) => {
  if (!kind || !counts) return null
  const attention = counts.attention?.[kind] || 0
  if (attention > 0) return { text: `${attention} تحتاج متابعة`, attention: true }
  const total = counts[kind] || 0
  return { text: total > 0 ? formsWord(total) : 'لا توجد' }
}

export default function WardFormsTabs({ mode, counts, onPick, wards, ward, onPickWard }) {
  return <div className="forms-hub">
    {wards?.length > 1 && <div className="forms-hub-wards" role="group" aria-label="الردهة">
      {wards.map((name) => <button key={name} type="button" aria-pressed={ward === name} onClick={() => { if (ward !== name) onPickWard(name) }}>{name}</button>)}
    </div>}
    <div className="forms-hub-tabs" role="group" aria-label="الاستمارة">
      {FORM_TABS.map((tab) => {
        const state = stateOf(counts, tab.kind)
        return <button key={tab.mode} type="button" className="forms-hub-tab" aria-pressed={mode === tab.mode} onClick={() => { if (mode !== tab.mode) onPick(tab.mode) }}>
          <span lang={tab.kind === 'ivig' ? 'en' : undefined}>{tab.label}</span>
          {state && <small className={state.attention ? 'is-attention' : undefined}>{state.text}</small>}
        </button>
      })}
    </div>
  </div>
}
