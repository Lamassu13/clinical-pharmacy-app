import { floors, specialWards, roleLabels } from '../constants.js'
import { PatientsDailyTrendWidget, PatientsRangeTableWidget, WardStatusBand } from '../components/DashboardWidgets.jsx'
import { ChevronStart } from '../components/WardGlyph.jsx'
import { wardAttention } from '../helpers.js'

// The manager's landing page inside «الإدارة» — an at-a-glance answer to "does anything need
// my attention right now", plus the fastest way into whichever section it points at. The
// highest-stakes answer (which wards haven't charted yet) gets the WardStatusBand itself, same
// as the floor/ward hub — not a stat card, so it never has to compete with "medicines in the
// registry" for weight or route through an admin screen to be useful. Every stat card below it
// reuses .location-card verbatim (icon badge in .floor-number, value+label in
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
function StatCard({ icon, value, label, detail, onClick }) {
  return <button type="button" className="location-card location-card--link stat-card" onClick={onClick}>
    <span className="floor-number">{icon}</span>
    <span className="location-card-body">
      <strong className="stat-card-value">{value}</strong>
      <small className="stat-card-label">{label}</small>
      {detail && <small className="stat-card-detail">{detail}</small>}
    </span>
    <span className="arrow" aria-hidden="true"><ChevronStart /></span>
  </button>
}

export default function AdminDashboardScreen({
  adminHeader, isAdmin, onNavigate, onOpenWard,
  registrations, allUsers, adminMedicines, treatmentForms,
  dashboard, dashboardLoading, dashboardError, onRetryDashboard,
  rangeFrom, setRangeFrom, rangeTo, setRangeTo,
  pendingFloor, setPendingFloor, busy, onApprove, onReject,
  registrationsError, adminSuccess, confirmModal,
}) {
  // The morning round's own answer (WardStatusBand), same as the floor/ward hub — the
  // reason this screen exists gets the hub's full treatment, not a bare fraction.
  const { startedCount, totalCount, attention } = wardAttention(floors, specialWards, dashboard)

  const roleCounts = allUsers.reduce((counts, user) => ({ ...counts, [user.role]: (counts[user.role] || 0) + 1 }), {})
  const roleBreakdown = ['admin', 'supervisor', 'user'].map((role) => `${roleCounts[role] || 0} ${roleLabels[role]}`).join(' · ')

  const RECENT_REQUESTS = 5
  const recentRequests = registrations.slice(0, RECENT_REQUESTS)

  return <main className="app-shell">{adminHeader}<section className="dashboard admin-dashboard-page">
    <div className="section-heading"><div><h1>لوحة التحكم</h1></div></div>
    {registrationsError && <p className="form-error" role="alert">{registrationsError}</p>}
    {adminSuccess && <p className="form-success" role="status">{adminSuccess}</p>}

    <WardStatusBand
      startedCount={startedCount} totalCount={totalCount} attention={attention}
      onOpen={onOpenWard}
      loading={dashboardLoading} error={dashboardError} onRetry={onRetryDashboard}
    />

    <div className="location-grid">
      {isAdmin && (
        <StatCard icon={<RequestsIcon />} value={registrations.length} label="طلبات بانتظار الموافقة" onClick={() => onNavigate('requests')} />
      )}
      <StatCard icon={<UsersIcon />} value={allUsers.length} label="المستخدمون" detail={roleBreakdown} onClick={() => onNavigate('users')} />
      <StatCard icon={<MedicineIcon />} value={adminMedicines.length} label="الأدوية في القائمة" onClick={() => onNavigate('medicines')} />
      <StatCard icon={<FormsIcon />} value={treatmentForms.length} label="استمارات العلاج" onClick={() => onNavigate('forms')} />
    </div>

    {isAdmin && recentRequests.length > 0 && (
      <>
        <h2 className="admin-subheading">أحدث طلبات الانضمام</h2>
        <div className="table-frame"><table className="requests-table requests-table--stack">
          <thead><tr><th>الاسم الكامل</th><th>الهاتف</th><th>الطابق / الردهة</th><th>إجراء</th></tr></thead>
          <tbody>{recentRequests.map((item) => <tr key={item.id}>
            <td className="requests-name">{item.full_name}</td>
            <td data-label="الهاتف">{item.phone}</td>
            <td data-label="الطابق / الردهة"><select value={pendingFloor[item.id] || ''} onChange={(event) => setPendingFloor((current) => ({ ...current, [item.id]: event.target.value }))}>
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
    {/* Trend and range widgets are closed by default — reference content, not the reason this screen exists, so neither adds scroll cost
        for a manager who only opened it to check ward status or approve a request. */}
    <PatientsDailyTrendWidget
      dailyPatientsByFloor={dashboard?.dailyPatientsByFloor ?? []}
      loading={dashboardLoading} error={dashboardError} onRetry={onRetryDashboard}
    />
    <PatientsRangeTableWidget
      patientsByFloorRange={dashboard?.patientsByFloorRange ?? []}
      rangeFrom={rangeFrom} setRangeFrom={setRangeFrom} rangeTo={rangeTo} setRangeTo={setRangeTo}
      loading={dashboardLoading} error={dashboardError} onRetry={onRetryDashboard}
    />
  </section>{confirmModal}</main>
}
