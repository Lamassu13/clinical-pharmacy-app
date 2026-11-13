import { formsBadge } from '../helpers.js'

// «مواقف القسم»: a floor's six forms in one place. Each tab is the form's own screen (its mode), so editing, sending
// and printing work exactly as on the ward page; the rows only switch the ward (`wards`, the floor's) and the form.
// `counts` is useRequestCounts' for the ward shown.
export const FORM_TABS = [
  { kind: 'albumin', mode: 'albumin-forms', label: 'الالبومين' },
  { kind: 'meropenem', mode: 'meropenem-forms', label: 'الميرونيم' },
  { kind: 'colistin', mode: 'colistin-forms', label: 'الكوليستين' },
  { kind: 'tigecycline', mode: 'tigecycline-forms', label: 'التايجيسايكلين' },
  { kind: 'ivig', mode: 'ivig-forms', label: 'IVIG' },
  { kind: null, mode: 'antibiotic-forms', label: 'صرف المضادات' },
]

export default function WardFormsTabs({ mode, counts, onPick, wards, ward, onPickWard }) {
  return <>
    {wards?.length > 1 && <div className="filter-chips ward-forms-tabs" role="group" aria-label="الردهة">
      {wards.map((name) => <button key={name} type="button" className="filter-chip" aria-pressed={ward === name} onClick={() => { if (ward !== name) onPickWard(name) }}>{name}</button>)}
    </div>}
    <div className="filter-chips ward-forms-tabs" role="group" aria-label="استمارات الردهة">
      {FORM_TABS.map((tab) => {
        const badge = tab.kind && formsBadge(counts, tab.kind)
        const total = tab.kind ? counts?.[tab.kind] || 0 : 0
        return <button key={tab.mode} type="button" className="filter-chip" aria-pressed={mode === tab.mode} title={badge?.text} onClick={() => { if (mode !== tab.mode) onPick(tab.mode) }}>
          {tab.label}{total > 0 && <> <span className="filter-chip-count">{total}</span></>}{badge?.tone === 'pending' && <span className="ward-forms-dot" aria-label={badge.text} />}
        </button>
      })}
    </div>
  </>
}
