import { MANAGER_ROLES, todayInBaghdad } from './push.js'

// Only today is written to. A pharmacist's chart, its pill form, the request forms, the receipt
// marks, the ward note and course-day corrections all refuse any other date, past or future; a
// manager (مسؤول / مدير) is exempt, to correct an earlier day. "Today" is the hospital's (Baghdad),
// whatever a device's clock says. The app shows other days read-only (src/App.jsx dayLocked); this is
// the guard behind it, for a stale tab, a wrong device clock or a save queued offline across midnight.
export const DAY_LOCKED = { message: 'لا يُعدَّل إلا يوم اليوم — هذا اليوم للعرض فقط.', dayLocked: true }

// The test suite writes fixed past dates as pharmacists to test everything else: server/test-helpers.js
// turns the lock off for it, and server/day-lock.test.js turns it back on. Nothing else changes this.
export const dayLockSettings = { enabled: true }

export const isDayLocked = (user, date) => dayLockSettings.enabled && !MANAGER_ROLES.includes(user?.role) && date !== todayInBaghdad()

export const tomorrowInBaghdad = () => {
  const [year, month, day] = todayInBaghdad().split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}
