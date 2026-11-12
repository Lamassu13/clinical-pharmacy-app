import { EXTRA_PILL_FLOORS } from '../constants.js'

// What a ward offers: daily forms, then clinical follow-up. `open` is merged into { floor, ward } and
// handed to onOpen as is. Shown on the ward's own page (WardHubScreen); «الجارت» is not listed here
// because it is the page's one primary button.
const CHART_ITEMS = [
  { label: 'إدخال مريض (استمارة)', icon: 'user-plus', open: { mode: 'chart', slot: 'main', form: true } },
  { label: 'الجارت الإضافي', icon: 'sheet-stack', open: { mode: 'chart', slot: 'extra' } },
]
// `needsConnection`: PRODUCT.md lists these as the ones that cannot work offline; the ward page says so
// in words while the device is offline (everything else here is kept on the device or fails on its own).
// Order: the pill forms together, then the order and the request forms with the two Meropenem rows last.
// The follow-up group runs in the order of its steps (wardSteps.js), from «متابعة الاستلام»; the two
// lookup tools stay at the end.
// `count`: a drug-request kind whose forms are counted for the day and shown on the row (WardHubScreen).
const GROUPS = [
  { id: 'forms', label: 'الاستمارات اليومية', items: [
    { label: 'الحبوب', icon: 'pill', open: { mode: 'pills' } },
    { label: 'استمارة الحبوب الإضافي', icon: 'pill-sheet', open: { mode: 'extra-pills' }, show: (floor) => Boolean(floor && EXTRA_PILL_FLOORS.includes(floor)) },
    { label: 'الطلبية', icon: 'clipboard', open: { mode: 'order', slot: 'main' }, needsConnection: true },
    { label: 'استمارة الالبومين', icon: 'drop', open: { mode: 'albumin-forms' }, count: 'albumin' },
    { label: 'طلبية الميرونيم', icon: 'clipboard', open: { mode: 'meropenem-order', slot: 'main' } },
    { label: 'استمارة الميرونيم', icon: 'vial', open: { mode: 'meropenem-forms' }, count: 'meropenem' },
    { label: 'استمارة التايجيسايكلين', icon: 'vial', open: { mode: 'tigecycline-forms' }, count: 'tigecycline' },
    { label: 'استمارة الكوليستين', icon: 'vial', open: { mode: 'colistin-forms' }, count: 'colistin' },
    { label: 'استمارة IVIG', icon: 'vial', open: { mode: 'ivig-forms' }, count: 'ivig' },
  ] },
  { id: 'clinical', label: 'المتابعة السريرية', items: [
    { label: 'متابعة الاستلام', icon: 'receipt', open: { mode: 'receipts' }, needsConnection: true },
    { label: 'متابعة الميروبينيم', icon: 'trend', open: { mode: 'meropenem' }, needsConnection: true },
    { label: 'استمارة صرف المضادات', icon: 'clipboard', open: { mode: 'antibiotic-forms' } },
    { label: 'التداخلات الدوائية', icon: 'overlap', open: { mode: 'interactions' } },
    { label: 'تعديل الجرعة الكلوية', icon: 'kidney', open: { mode: 'renal' } },
  ] },
]

// One stroke family with the rest of the app: 24-grid, 1.75 stroke, round caps, a 0.14 tint fill.
const TINT = { fill: 'currentColor', fillOpacity: 0.14, stroke: 'none' }
const ICONS = {
  grid: <><rect x="4" y="4" width="16" height="16" rx="2" {...TINT} /><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16" /></>,
  'user-plus': <><circle cx="10" cy="8.5" r="3.5" {...TINT} /><circle cx="10" cy="8.5" r="3.5" /><path d="M3.5 19.5a6.5 6.5 0 0 1 13 0M18 8v6M15 11h6" /></>,
  'sheet-stack': <><rect x="8" y="3.5" width="12.5" height="14.5" rx="2" {...TINT} /><rect x="8" y="3.5" width="12.5" height="14.5" rx="2" /><path d="M4.5 7.5v11a2 2 0 0 0 2 2h9M11.5 8.5h6M11.5 12h6" /></>,
  drop: <><path d="M12 3.5s6 6.2 6 10.2a6 6 0 0 1-12 0c0-4 6-10.2 6-10.2z" {...TINT} /><path d="M12 3.5s6 6.2 6 10.2a6 6 0 0 1-12 0c0-4 6-10.2 6-10.2z" /><path d="M9.5 14.5a2.6 2.6 0 0 0 2.5 2.4" /></>,
  trend: <><path d="M3.5 17.5l5.5-6 4 3.5 7-8" /><path d="M15.5 7h5v5M3.5 20.5h17" /></>,
  pill: <><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)" {...TINT} /><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)" /><path d="M9.7 8.7l4.6 6.6" /></>,
  clipboard: <><rect x="5" y="4.5" width="14" height="16" rx="2" {...TINT} /><rect x="5" y="4.5" width="14" height="16" rx="2" /><path d="M9 4.5V3.5h6v1M8.5 10h7M8.5 13.5h7M8.5 17h4" /></>,
  receipt: <><rect x="5" y="4.5" width="14" height="16" rx="2" {...TINT} /><rect x="5" y="4.5" width="14" height="16" rx="2" /><path d="M9 4.5V3.5h6v1M8.5 13l2.5 2.5 4.5-5" /></>,
  'pill-sheet': <><rect x="4.5" y="3.5" width="15" height="17" rx="2" {...TINT} /><rect x="4.5" y="3.5" width="15" height="17" rx="2" /><rect x="8" y="10" width="8" height="4" rx="2" /><path d="M12 10v4M8 6.5h8M8 17h5" /></>,
  vial: <><path d="M9 3.5h6M10 3.5v3l-1.5 2.5v9.5a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V9L14 6.5v-3" /><path d="M8.5 12.5h7v6a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2z" {...TINT} /><path d="M8.5 12.5h7" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" {...TINT} /><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" /></>,
  overlap: <><circle cx="9" cy="12" r="5.5" {...TINT} /><circle cx="15" cy="12" r="5.5" {...TINT} /><circle cx="9" cy="12" r="5.5" /><circle cx="15" cy="12" r="5.5" /></>,
  kidney: <><path d="M15.5 3.5c-3.6 0-6 3-6 5.4 0 1.4 1.4 1.9 1.4 3.1s-1.4 1.7-1.4 3.1c0 2.4 2.4 5.4 6 5.4 3 0 5-3.6 5-8.5s-2-8.5-5-8.5z" {...TINT} /><path d="M15.5 3.5c-3.6 0-6 3-6 5.4 0 1.4 1.4 1.9 1.4 3.1s-1.4 1.7-1.4 3.1c0 2.4 2.4 5.4 6 5.4 3 0 5-3.6 5-8.5s-2-8.5-5-8.5z" /><path d="M10.9 12H6.5a3 3 0 0 0-3 3v1.5" /></>,
}
const Icon = ({ name }) => <svg className="ward-menu-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
export { CHART_ITEMS, GROUPS, Icon }
