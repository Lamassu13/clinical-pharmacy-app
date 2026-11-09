import { GROUPS } from './components/wardOptions.jsx'

// A ward's work as steps, in two flows. The daily work: the chart, the order, the Meropenem order, Meropenem and
// albumin forms, the pill forms, then the newer request forms. The clinical follow-up: dose receipt, the Meropenem follow-up, the
// interactions, the renal dose. Each has its own bar and «الخطوة التالية». The labels, icons and `open` targets are the ward page's own (wardOptions.jsx), so a step
// opens exactly what its row does; only the order differs. «استمارة الحبوب الإضافي» is a step only where the
// ward page lists it (floors 3, 6, 8, 9).
const CHART_STEP = { label: 'الجارت', icon: 'grid', open: { mode: 'chart', slot: 'main' } }
// The order, Meropenem and albumin come first, then the pill forms, then the newer request forms
// (Tigecycline, Colistin, IVIG) after «استمارة الحبوب الإضافي».
const DAILY_MODES = ['chart', 'order', 'meropenem-order', 'meropenem-forms', 'albumin-forms', 'pills', 'extra-pills', 'tigecycline-forms', 'colistin-forms', 'ivig-forms']
// The follow-up starts where the doses were handed over: «متابعة الاستلام».
const CLINICAL_MODES = ['receipts', 'meropenem', 'interactions', 'renal']
// The steps of the flow that `mode` belongs to (the daily flow for any other mode, e.g. none open yet).
export const stepsFor = (floor, mode = 'chart') => {
  const all = [CHART_STEP, ...GROUPS.flatMap((group) => group.items)]
  return (CLINICAL_MODES.includes(mode) ? CLINICAL_MODES : DAILY_MODES).map((step) => all.find((item) => item.open.mode === step))
    .filter((item) => item && (!item.show || item.show(floor)))
    .map((item) => ({ ...item, key: item.open.mode }))
}

// «اكتمل» on the chart step: only what this session has seen (the chart's own flag is read when the chart
// is opened), so a missing mark never means "not done".
const completedCharts = new Map()
export const rememberCompleted = (key, done) => { completedCharts.set(key, done) }
export const wasCompleted = (key) => completedCharts.get(key) === true
