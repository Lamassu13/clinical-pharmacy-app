import { GROUPS } from './components/wardOptions.jsx'

// A ward's daily work as steps: the chart, the order, the Meropenem order, the two request forms, then the
// pill forms. The labels, icons and `open` targets are the ward page's own (wardOptions.jsx), so a step
// opens exactly what its row does; only the order differs. «استمارة الحبوب الإضافي» is a step only where the
// ward page lists it (floors 3, 6, 8, 9).
const CHART_STEP = { label: 'الجارت', icon: 'grid', open: { mode: 'chart', slot: 'main' } }
// The pill forms come last: the order and the request forms are done first, then the pills.
const STEP_MODES = ['chart', 'order', 'meropenem-order', 'meropenem-forms', 'albumin-forms', 'pills', 'extra-pills']
export const stepsFor = (floor) => {
  const all = [CHART_STEP, ...GROUPS.flatMap((group) => group.items)]
  return STEP_MODES.map((mode) => all.find((item) => item.open.mode === mode))
    .filter((item) => item && (!item.show || item.show(floor)))
    .map((item) => ({ ...item, key: item.open.mode }))
}

// «اكتمل» on the chart step: only what this session has seen (the chart's own flag is read when the chart
// is opened), so a missing mark never means "not done".
const completedCharts = new Map()
export const rememberCompleted = (key, done) => { completedCharts.set(key, done) }
export const wasCompleted = (key) => completedCharts.get(key) === true
