import { Glyph } from './ToolbarIcons.jsx'
import { formsWord } from '../helpers.js'

// The alert for a floor user: today's request forms still to follow up (not sent to the ministry's Google Form, or lacking what they
// need), per ward they can open — a tap opens that ward's page, where the forms are. It reads what the dashboard answer already carries
// (`formsPending`, server/routes/drug-request-followup.js), so it costs no request. `floor`: show only that floor's wards (the ward list of
// a floor); without it, every ward (the floor/ward grid, where the app lands). Nothing is shown when nothing is pending.
export default function FormsPendingNote({ pending, floor, onOpenWard }) {
  const wards = (pending?.wards ?? []).filter((item) => floor === undefined || item.floor === floor)
  if (!wards.length) return null
  const total = wards.reduce((sum, item) => sum + item.n, 0)
  return <section className="forms-pending" role="status" aria-label="استمارات تحتاج متابعة">
    <p className="forms-pending-head"><Glyph icon="warn" /><strong>{formsWord(total)} تحتاج متابعة اليوم</strong><small>لم تُرسل إلى نموذج الوزارة أو ينقصها شيء</small></p>
    <div className="forms-pending-wards">
      {wards.map((item) => <button key={`${item.floor ?? ''}|${item.ward}`} type="button" className="forms-pending-ward" onClick={() => onOpenWard({ floor: item.floor, ward: item.ward })}>
        <span>{item.floor ? `الطابق ${item.floor} — ${item.ward}` : item.ward}</span><b>{item.n}</b>
      </button>)}
    </div>
  </section>
}
