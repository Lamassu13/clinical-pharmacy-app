import { floors, specialWards } from '../constants.js'
import { TopMedicinesWidget, PatientsByFloorWidget, PatientsDailyTrendWidget } from '../components/DashboardWidgets.jsx'

// Floor management. Two parts: the manager's analytics (most-dispensed medicines + patients
// per floor, each with its own day/week/month window) and the chart-purge tool below.
// Manager-gated; the actual delete is confirmed through the shared dialog in App.
export default function AdminFloorsScreen({
  adminHeader, purgeFrom, setPurgeFrom, purgeTo, setPurgeTo, purgeAll, setPurgeAll,
  purgeTargets, onToggleTarget, busy, registrationsError, adminSuccess, onPurge, confirmModal,
  dashboard, dashboardLoading, dashboardError, onRetryDashboard,
  medicinesPeriod, setMedicinesPeriod, patientsPeriod, setPatientsPeriod, isManager,
}) {
  return <main className="app-shell">{adminHeader}<section className="dashboard">
    <div className="section-heading"><div>
      <h1>إدارة الطوابق</h1>
    </div></div>
    {registrationsError && <p className="form-error" role="alert">{registrationsError}</p>}
    {adminSuccess && <p className="form-success" role="status">{adminSuccess}</p>}

    <div className="dashboard-widgets">
      <TopMedicinesWidget
        topMedicines={dashboard?.topMedicines ?? []}
        period={medicinesPeriod} setPeriod={setMedicinesPeriod} isManager={isManager} open
        loading={dashboardLoading} error={dashboardError} onRetry={onRetryDashboard}
      />
      <PatientsByFloorWidget
        patientsByFloor={dashboard?.patientsByFloor ?? []}
        period={patientsPeriod} setPeriod={setPatientsPeriod}
        loading={dashboardLoading} error={dashboardError} onRetry={onRetryDashboard}
      />
    </div>

    <PatientsDailyTrendWidget
      dailyPatientsByFloor={dashboard?.dailyPatientsByFloor ?? []}
      loading={dashboardLoading} error={dashboardError} onRetry={onRetryDashboard}
    />

    <h2 className="admin-subheading">مسح الجارتات</h2>
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
