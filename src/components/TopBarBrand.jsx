import hospitalLogo from '../assets/hospital-logo.png'

// The logo-and-name button that returns to the floor picker. Identical on every screen that
// has a top bar, so it lives here rather than being re-typed in each of them.
export default function TopBarBrand({ onClick }) {
  return <button type="button" className="topbar-brand" onClick={onClick} aria-label="العودة إلى اختيار الطابق"><img className="hospital-logo header-logo" width="42" height="42" src={hospitalLogo} alt="" /><span><strong>الصيدلة السريرية</strong><small>مستشفى بغداد التعليمي</small></span></button>
}
