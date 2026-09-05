import hospitalLogo from '../assets/hospital-logo.png'
import AppCredit from '../components/AppCredit.jsx'

// Swapping the screen rather than logging out: App stays mounted, so the chart the
// pharmacist was in the middle of typing is still in state and is saved on the way back in.
export default function SessionExpiredScreen({ credentials, setCredentials, loginError, busy, onSubmit, onLogout, confirmModal }) {
  return <main className="login-shell"><AppCredit /><section className="login-card"><img className="hospital-logo login-logo" width="116" height="116" src={hospitalLogo} alt="شعار مستشفى بغداد التعليمي" /><p className="eyebrow">انتهت الجلسة</p><h1>سجّل الدخول من جديد</h1><p className="login-intro">مضت مدة طويلة على تسجيل دخولك. ما كتبته محفوظ في الجهاز ولم يضع — سجّل الدخول وسيُحفظ فورًا وتعود إلى الشاشة نفسها.</p><form onSubmit={onSubmit} className="login-form"><label>اسم المستخدم<input value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} required /></label><label>كلمة المرور<input type="password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} required /></label>{loginError && <p className="form-error" role="alert">{loginError}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'جارٍ الدخول…' : <>متابعة العمل <span>←</span></>}</button></form><button type="button" className="text-button" onClick={onLogout}>تسجيل الخروج والبدء من جديد</button></section>{confirmModal}</main>
}
