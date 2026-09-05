export default function ThemeToggle({ theme, onToggle }) {
  return <button type="button" className="theme-toggle" onClick={onToggle} aria-pressed={theme === 'dark'} aria-label={theme === 'dark' ? 'إيقاف الوضع الليلي' : 'تشغيل الوضع الليلي'}>{theme === 'dark' ? '☀' : '🌙'}</button>
}
