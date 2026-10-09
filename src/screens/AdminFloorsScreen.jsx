import { floors, specialWards } from '../constants.js'

// Floor management: the chart-purge tool. The analytics that used to open this screen (most-
// dispensed medicines, patients per floor, the daily trend) now live on لوحة التحكم — the
// manager's landing page inside «الإدارة» — so this one stays focused on its own destructive
// action. Manager-gated; the actual delete is confirmed through the shared dialog in App.
export default function AdminFloorsScreen({
  adminHeader, purgeFrom, setPurgeFrom, purgeTo, setPurgeTo, purgeAll, setPurgeAll, purgeKinds, setPurgeKinds,
  purgeTargets, onToggleTarget, busy, registrationsError, adminSuccess, onPurge, confirmModal,
}) {
  return <main className="app-shell">{adminHeader}<section className="dashboard floor-admin-page">
    <div className="section-heading"><div>
      <h1>إدارة الطوابق</h1>
    </div></div>
    {registrationsError && <p className="form-error" role="alert">{registrationsError}</p>}
    {adminSuccess && <p className="form-success" role="status">{adminSuccess}</p>}

    <p className="report-note">استمارات الحبوب الإضافية تُحدَّد بتاريخ إنشائها وتخص الطوابق 3 و6 و8 و9 فقط؛ مسح استمارات الحبوب لا يمسح الجارت ولا أرقام الغرف.</p>

    {/* No subheading here on purpose: the purge tool is this page's only section now that the
        analytics moved to لوحة التحكم, so a second "مسح الجارتات" label right under the h1
        would just repeat it — the page title and the form's own legend/button already say
        what this does. */}
    <form className="purge-form" onSubmit={(event) => { event.preventDefault(); onPurge() }}>
      <fieldset className="purge-targets">
        <legend>ما الذي يُمسح</legend>
        <div className="purge-targets-grid">
          {[['charts', 'الجارتات (تشمل استمارات الحبوب)'], ['pills', 'استمارات الحبوب فقط'], ['extra', 'استمارات الحبوب الإضافية']].map(([key, label]) => (
            <label key={key}>
              <input type="checkbox" checked={purgeKinds[key]} disabled={key === 'pills' && purgeKinds.charts} onChange={() => setPurgeKinds((current) => ({ ...current, [key]: !current[key] }))} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

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
        disabled={busy || !purgeFrom || !purgeTo || (!purgeAll && purgeTargets.size === 0) || !(purgeKinds.charts || purgeKinds.pills || purgeKinds.extra)}
      >{busy ? <><span className="spinner spinner--inline" aria-hidden="true" />جارٍ المسح…</> : 'مسح'}</button>
    </form>
  </section>{confirmModal}</main>
}
