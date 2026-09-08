import { floors, specialWards } from '../constants.js'

// Floor management. For now it holds one tool: bulk-deleting charts for a date range across
// every ward, or a chosen set of floors and special wards. Manager-gated; the actual delete
// is confirmed through the shared dialog in App.
export default function AdminFloorsScreen({
  adminHeader, purgeFrom, setPurgeFrom, purgeTo, setPurgeTo, purgeAll, setPurgeAll,
  purgeTargets, onToggleTarget, busy, registrationsError, adminSuccess, onPurge, confirmModal,
}) {
  return <main className="app-shell">{adminHeader}<section className="dashboard">
    <div className="section-heading"><div>
      <h1>مسح الجارتات</h1>
    </div></div>
    {registrationsError && <p className="form-error" role="alert">{registrationsError}</p>}
    {adminSuccess && <p className="form-success" role="status">{adminSuccess}</p>}

    <form className="purge-form" onSubmit={(event) => { event.preventDefault(); onPurge() }}>
      <div className="purge-dates">
        <label>من تاريخ<input type="date" value={purgeFrom} onChange={(event) => setPurgeFrom(event.target.value)} required /></label>
        <label>إلى تاريخ<input type="date" value={purgeTo} onChange={(event) => setPurgeTo(event.target.value)} required /></label>
      </div>

      <label className="purge-all-toggle">
        <input type="checkbox" checked={purgeAll} onChange={(event) => setPurgeAll(event.target.checked)} />
        <span>كل الطوابق والردهات الخاصة</span>
      </label>

      <fieldset className="purge-targets" disabled={purgeAll}>
        <legend>أو اختر مواقع محدّدة</legend>
        <div className="purge-targets-grid">
          {floors.map((item) => (
            <label key={item.number}>
              <input type="checkbox" checked={purgeTargets.has(item.number)} onChange={() => onToggleTarget(item.number)} />
              <span>الطابق {item.number}</span>
            </label>
          ))}
          {specialWards.map((ward) => (
            <label key={ward}>
              <input type="checkbox" checked={purgeTargets.has(ward)} onChange={() => onToggleTarget(ward)} />
              <span>{ward}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <button
        className="danger-button"
        type="submit"
        disabled={busy || !purgeFrom || !purgeTo || (!purgeAll && purgeTargets.size === 0)}
      >{busy ? 'جارٍ المسح…' : 'مسح الجارتات'}</button>
    </form>
  </section>{confirmModal}</main>
}
