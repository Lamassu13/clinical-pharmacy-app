import { Glyph } from './ToolbarIcons.jsx'
import { formsWord } from '../helpers.js'

// The alert on the floor pages (a floor user's own wards; for a manager, the floor that is open): today's request forms still to follow up (not sent to the ministry's Google Form, or lacking what they
// need), per ward they can open — a tap opens that ward's page, where the forms are. It reads what the dashboard answer already carries
// (`formsPending`, server/routes/drug-request-followup.js), so it costs no request. `floor`: show only that floor's wards (the ward list of
// a floor); without it, every ward (the floor/ward grid, where the app lands). Nothing is shown when nothing is pending.
// Its own line below: the dispensing form's patients (`abx`, same shape) — a tap opens «مواقف القسم» on that ward, at the form
// (`onOpenAbx`), since the ward page does not have it.
const patientsWord = (n) => (n === 1 ? 'مريض واحد' : n === 2 ? 'مريضان' : `${n} ${n <= 10 ? 'مرضى' : 'مريضًا'}`)
const label = (item) => (item.floor ? `الطابق ${item.floor} — ${item.ward}` : item.ward)
export default function FormsPendingNote({ pending, floor, onOpenWard, onOpenAbx }) {
  const inFloor = (item) => floor === undefined || item.floor === floor
  const wards = (pending?.wards ?? []).filter(inFloor)
  const abx = (pending?.abx ?? []).filter(inFloor)
  if (!wards.length && !abx.length) return null
  const total = wards.reduce((sum, item) => sum + item.n, 0)
  const abxTotal = abx.reduce((sum, item) => sum + item.n, 0)
  return <section className="forms-pending" role="status" aria-label="استمارات تحتاج متابعة">
    {wards.length > 0 && <>
      <p className="forms-pending-head"><Glyph icon="warn" /><strong>{formsWord(total)} تحتاج متابعة اليوم</strong><small>لم تُرسل إلى نموذج الوزارة أو ينقصها شيء</small></p>
      <div className="forms-pending-wards">
        {wards.map((item) => <button key={`${item.floor ?? ''}|${item.ward}`} type="button" className="forms-pending-ward" onClick={() => onOpenWard({ floor: item.floor, ward: item.ward })}>
          <span>{label(item)}</span><b>{item.n}</b>
        </button>)}
      </div>
    </>}
    {abx.length > 0 && <>
      <p className={`forms-pending-head${wards.length ? ' forms-pending-head--next' : ''}`}>{!wards.length && <Glyph icon="warn" />}<strong>استمارة صرف المضادات</strong><small>{patientsWord(abxTotal)} بلا استمارة أو باستمارة ناقصة</small></p>
      <div className="forms-pending-wards">
        {abx.map((item) => <button key={`${item.floor ?? ''}|${item.ward}`} type="button" className="forms-pending-ward" onClick={() => onOpenAbx({ floor: item.floor, ward: item.ward })}>
          <span>{label(item)}</span><b>{item.n}</b>
        </button>)}
      </div>
    </>}
  </section>
}
