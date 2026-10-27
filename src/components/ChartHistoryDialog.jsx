import { useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'

// «سجل التعديلات» — read-only list of what each save changed on this chart: who, when, and the
// old → new value of every cell. Fetched when opened (no polling) and only shows saves made
// since the history feature shipped. Same modal chrome as TemplatesDialog.
const formatTime = (iso) => new Date(iso).toLocaleString('ar-IQ', { weekday: 'short', day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' })
const show = (value) => (value === '' || value === null || value === undefined ? '—' : value)

// One line per change, in the staff's own words for each kind of edit.
function describe(change) {
  const { kind, label, row, column, from, to } = change
  if (kind === 'created') return { what: 'أُنشئ الجارت', plain: to }
  if (kind === 'qty') return { what: `${label.patient || `صف ${row}`} — ${label.medicine || `عمود ${column}`}`, from, to }
  if (kind === 'patient') return { what: `اسم المريض (صف ${row})`, from, to }
  if (kind === 'patient_id') return { what: `رقم الطبلة — ${label.patient || `صف ${row}`}`, from, to }
  return { what: `دواء العمود ${column}`, from, to }
}

export default function ChartHistoryDialog({ open, selected, selectedDate, onClose }) {
  const [saves, setSaves] = useState(null)
  const [error, setError] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setSaves(null); setError(false)
    const params = new URLSearchParams({ floor: selected.floor || '', ward: selected.ward, slot: selected.slot || 'main', date: selectedDate })
    fetch(`${apiUrl}/chart/history?${params}`, { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('history failed'))))
      .then((result) => { if (!cancelled) setSaves(result.saves) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [open, selected, selectedDate, reload])
  if (!open) return null
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="medicine-modal templates-modal" role="dialog" aria-modal="true" aria-labelledby="history-title"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }}>
      <h2 id="history-title">سجل التعديلات</h2>
      <p className="templates-hint">كل حفظ على هذا الجارت: من حفظه ومتى وما الذي تغيّر (القيمة السابقة ← الجديدة). يظهر الأحدث أولًا.</p>
      {error ? <div className="templates-empty">
        <span>تعذّر تحميل السجل — تحقّق من الاتصال.</span>
        <button type="button" className="secondary-button compact" onClick={() => setReload((n) => n + 1)}>إعادة المحاولة</button>
      </div>
        : saves === null ? <p className="templates-empty" role="status">جارٍ تحميل السجل…</p>
        : saves.length === 0 ? <p className="templates-empty">لا توجد تعديلات مسجّلة لهذا الجارت بعد.</p>
        : <ol className="history-list">
          {saves.map((save) => <li key={save.version}>
            <p className="history-save"><strong>{save.userName}</strong> <span>{formatTime(save.at)}</span></p>
            <ul>{save.changes.map((change, index) => {
              const line = describe(change)
              return <li key={index}>{line.plain ? <>{line.what}: {line.plain}</> : <>{line.what}: <bdi className="history-old">{show(line.from)}</bdi> ← <bdi className="history-new">{show(line.to)}</bdi></>}</li>
            })}</ul>
            {save.more > 0 && <p className="history-more">و{save.more} تغييرًا آخر في هذا الحفظ</p>}
          </li>)}
        </ol>}
      <div className="modal-actions">
        <button type="button" className="secondary-button" autoFocus onClick={onClose}>إغلاق</button>
      </div>
    </div>
  </div>
}
