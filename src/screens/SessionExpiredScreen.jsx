import hospitalLogo from '../assets/hospital-logo.png'
import AppCredit from '../components/AppCredit.jsx'

// Swapping the screen rather than logging out: App stays mounted, so the chart the
// pharmacist was in the middle of typing is still in state — and mirrored to localStorage
// on every keystroke — so it is saved on the way back in. The one job of this screen is to
// make that fact louder than the interruption: the reassurance leads, the sign-in is the
// mechanism under it, and "log out and start over" is a de-emphasised last resort.
export default function SessionExpiredScreen({ credentials, setCredentials, loginError, busy, onSubmit, onLogout, confirmModal }) {
  return <main className="login-shell session-expired"><AppCredit /><section className="login-card">
    <img className="hospital-logo login-logo" width="116" height="116" src={hospitalLogo} alt="شعار مستشفى بغداد التعليمي" />
    <h1>انتهت الجلسة</h1>
    <p className="session-reassure" role="status">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity="0.14" stroke="none" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></svg>
      <span>ما كتبته محفوظ على هذا الجهاز — لم يضِع شيء.</span>
    </p>
    <p className="login-intro">سجّل الدخول من جديد وسيُعاد حفظه فورًا، وتعود إلى الشاشة نفسها.</p>
    <form onSubmit={onSubmit} className="login-form">
      <label>اسم المستخدم<input autoFocus autoComplete="username" value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} required /></label>
      <label>كلمة المرور<input type="password" autoComplete="current-password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} required /></label>
      {loginError && <p className="form-error" role="alert">{loginError}</p>}
      {loginError && <p className="login-hint">تأكد من مفتاح Caps Lock ولغة لوحة المفاتيح.</p>}
      <button className="primary-button" type="submit" disabled={busy}>{busy ? 'جارٍ الدخول…' : 'متابعة العمل'}</button>
    </form>
    <button type="button" className="text-button session-logout" onClick={onLogout}>تسجيل الخروج والبدء من جديد</button>
  </section>{confirmModal}</main>
}
