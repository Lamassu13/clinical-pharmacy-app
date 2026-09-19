import { floors, specialWards, roleLabels } from '../constants.js'
import { TopMedicinesWidget, PatientsByFloorWidget, PatientsDailyTrendWidget } from '../components/DashboardWidgets.jsx'
import { ChevronStart } from '../components/WardGlyph.jsx'

// The manager's landing page inside «الإدارة» — an at-a-glance answer to "does anything need
// my attention right now", plus the fastest way into whichever section it points at. Every
// stat card below reuses .location-card verbatim (icon badge in .floor-number, value+label in
// .location-card-body, chevron in .arrow) rather than inventing a parallel "stat tile" —
// it's the exact same "a number that opens a screen" shape the floor/ward picker already is.
function RequestsIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5V15a2.5 2.5 0 0 1-2.5 2.5H9l-4.5 3.5V6.5Z" fill="currentColor" fillOpacity="0.14" stroke="none" />
    <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5V15a2.5 2.5 0 0 1-2.5 2.5H9l-4.5 3.5V6.5Z" />
    <path d="M9 9.5h6M9 12.5h3.5" />
  </svg>
}
function UsersIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="7" r="3" fill="currentColor" fillOpacity="0.14" stroke="none" /><circle cx="9" cy="7" r="3" />
    <path d="M3.5 19c0-3 2.4-5 5.5-5s5.5 2 5.5 5" />
    <path d="M16.5 5.5a2.5 2.5 0 1 1 0 5" /><path d="M15.5 14.2c2.7.2 4.5 2.3 4.5 4.8" />
  </svg>
}
function MedicineIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)" fill="currentColor" fillOpacity="0.14" stroke="none" />
    <rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)" />
    <line x1="12" y1="8.5" x2="12" y2="15.5" transform="rotate(-45 12 12)" />
  </svg>
}
function FormsIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z" fill="currentColor" fillOpacity="0.14" stroke="none" />
    <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z" />
    <path d="M14 3.5V7.5h4" /><path d="M9 12h6M9 15.5h6" />
  </svg>
}
function WardsIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 13h18v4" fill="currentColor" fillOpacity="0.14" stroke="none" /><path d="M3 13h18v4" />
    <path d="M3 8v9" /><path d="M21 17v-4H3" />
    <path d="M6 13v-1.5A1.5 1.5 0 0 1 7.5 10h3A1.5 1.5 0 0 1 12 11.5V13" />
  </svg>
}

function StatCard({ icon, value, label, onClick }) {
  return <button type="button" className="location-card location-card--link" onClick={onClick}>
    <span className="floor-number">{icon}</span>
    <span className="location-card-body"><strong>{value}</strong><small>{label}</small></span>
    <span className="arrow" aria-hidden="true"><ChevronStart /></span>
  </button>
}

export default function AdminDashboardScreen({
  adminHeader, isAdmin, onNavigate,
  registrations, allUsers, adminMedicines, treatmentForms,
  dashboard, dashboardLoading, dashboardError, onRetryDashboard,
  medicinesPeriod, setMedicinesPeriod, patientsPeriod, setPatientsPeriod,
  pendingFloor, setPendingFloor, busy, onApprove, onReject,
  registrationsError, adminSuccess, confirmModal,
}) {
  // Ward granularity, same rule as the floor/ward picker's own count (WardStatusBand):
  // one key per started ward, a floor's total is the sum of its sub-wards.
  const startedKeys = new Set((dashboard?.startedWards ?? []).map((item) => `${item.floor ?? 'x'}|${item.ward}`))
  const totalWards = floors.reduce((sum, floor) => sum + floor.wards.length, 0) + specialWards.length
  const startedWards = floors.reduce((sum, floor) => sum + floor.wards.filter((ward) => startedKeys.has(`${floor.number}|${ward}`)).length, 0)
    + specialWards.filter((ward) => startedKeys.has(`x|${ward}`)).length

  const roleCounts = allUsers.reduce((counts, user) => ({ ...counts, [user.role]: (counts[user.role] || 0) + 1 }), {})
  const roleBreakdown = ['admin', 'supervisor', 'user'].map((role) => `${roleCounts[role] || 0} ${roleLabels[role]}`).join(' · ')

  const RECENT_REQUESTS = 5
  const recentRequests = registrations.slice(0, RECENT_REQUESTS)

  return <main className="app-shell">{adminHeader}<section className="dashboard admin-dashboard-page">
    <div className="section-heading"><div><h1>لوحة التحكم</h1></div></div>
    {registrationsError && <p className="form-error" role="alert">{registrationsError}</p>}
    {adminSuccess && <p className="form-success" role="status">{adminSuccess}</p>}

    <div className="location-grid">
      {isAdmin && (
        <StatCard icon={<RequestsIcon />} value={registrations.length} label="طلبات بانتظار الموافقة" onClick={() => onNavigate('requests')} />
      )}
      <StatCard icon={<UsersIcon />} value={allUsers.length} label={`المستخدمون — ${roleBreakdown}`} onClick={() => onNavigate('users')} />
      <StatCard icon={<MedicineIcon />} value={adminMedicines.length} label="الأدوية في القائمة" onClick={() => onNavigate('medicines')} />
      <StatCard icon={<FormsIcon />} value={treatmentForms.length} label="استمارات العلاج" onClick={() => onNavigate('forms')} />
      <StatCard icon={<WardsIcon />} value={`${startedWards} / ${totalWards}`} label="الردهات التي بدأت جارتها اليوم" onClick={() => onNavigate('floors')} />
    </div>

    {isAdmin && recentRequests.length > 0 && (
      <>
        <h2 className="admin-subheading">أحدث طلبات الانضمام</h2>
        <div className="table-frame"><table className="requests-table">
          <thead><tr><th>الاسم الكامل</th><th>الهاتف</th><th>الطابق / الردهة</th><th>إجراء</th></tr></thead>
          <tbody>{recentRequests.map((item) => <tr key={item.id}>
            <td>{item.full_name}</td>
            <td>{item.phone}</td>
            <td><select value={pendingFloor[item.id] || ''} onChange={(event) => setPendingFloor((current) => ({ ...current, [item.id]: event.target.value }))}>
              <option value="">اختر</option>
              <optgroup label="الطوابق">{floors.map((floorOption) => <option key={floorOption.number} value={floorOption.number}>الطابق {floorOption.number}</option>)}</optgroup>
              <optgroup label="ردهات خاصة">{specialWards.map((ward) => <option key={ward} value={ward}>{ward}</option>)}</optgroup>
            </select></td>
            <td className="requests-actions">
              <button className="primary-button compact" disabled={busy} onClick={() => onApprove(item.id)}>قبول</button>
              <button className="danger-button compact" disabled={busy} onClick={() => onReject(item.id)}>رفض</button>
            </td>
          </tr>)}</tbody>
        </table></div>
        {registrations.length > RECENT_REQUESTS && (
          <button type="button" className="text-button" onClick={() => onNavigate('requests')}>عرض كل الطلبات ({registrations.length})</button>
        )}
      </>
    )}

    <h2 className="admin-subheading">التحليلات</h2>
    <div className="dashboard-widgets">
      <TopMedicinesWidget
        topMedicines={dashboard?.topMedicines ?? []}
        period={medicinesPeriod} setPeriod={setMedicinesPeriod} isManager open
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
  </section>{confirmModal}</main>
}
