import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALLOWED_FLOORS, FLOOR_WARDS, SPECIAL_WARDS, isKnownWard, PILL_FORM,
  canAccessLocation, clampInt, isIsoDate, cleanText,
} from './validation.js'

const admin = { role: 'admin' }
const pharmacist = { role: 'pharmacist', assignedFloor: 5, assignedWards: ['ردهة الديلزة'] }

test('canAccessLocation: an admin reaches every floor and ward', () => {
  assert.equal(canAccessLocation(admin, 5, 'ردهة رجال'), true)
  assert.equal(canAccessLocation(admin, null, 'ردهة الخدج'), true)
  assert.equal(canAccessLocation(admin, 99, 'ردهة لا وجود لها'), true)
})

test('canAccessLocation: a pharmacist reaches only their own floor', () => {
  assert.equal(canAccessLocation(pharmacist, 5, 'ردهة رجال'), true)
  assert.equal(canAccessLocation(pharmacist, 6, 'ردهة الخاص'), false)
})

test('canAccessLocation: special wards go by the assigned list, not the floor', () => {
  assert.equal(canAccessLocation(pharmacist, null, 'ردهة الديلزة'), true)
  assert.equal(canAccessLocation(pharmacist, null, 'ردهة الخدج'), false)
})

test('canAccessLocation: a missing or malformed assignedWards denies access', () => {
  assert.equal(canAccessLocation({ role: 'pharmacist', assignedFloor: 5 }, null, 'ردهة الديلزة'), false)
  assert.equal(canAccessLocation({ role: 'pharmacist', assignedWards: 'ردهة الديلزة' }, null, 'ردهة الديلزة'), false)
})

test('canAccessLocation: an unassigned pharmacist reaches nothing', () => {
  const stranger = { role: 'pharmacist', assignedFloor: null, assignedWards: [] }
  ALLOWED_FLOORS.forEach((floor) => assert.equal(canAccessLocation(stranger, floor, FLOOR_WARDS[floor][0]), false))
  SPECIAL_WARDS.forEach((ward) => assert.equal(canAccessLocation(stranger, null, ward), false))
})

test('isKnownWard: a ward is only known on its own floor', () => {
  assert.equal(isKnownWard(3, 'ردهة CCU'), true)
  assert.equal(isKnownWard(4, 'ردهة CCU'), false)
  assert.equal(isKnownWard(7, 'ردهة الخاص'), false)
  assert.equal(isKnownWard(2, 'ردهة مخترعة'), false)
})

test('isKnownWard: a non-integer floor falls back to the special-ward list', () => {
  assert.equal(isKnownWard(null, 'ردهة الخدج'), true)
  assert.equal(isKnownWard(null, 'ردهة رجال'), false)
})

test('clampInt: accepts the bounds and rejects everything outside or unparseable', () => {
  assert.equal(clampInt(1, 1, 41), 1)
  assert.equal(clampInt(41, 1, 41), 41)
  assert.equal(clampInt('7', 1, 41), 7)
  assert.equal(clampInt(3.9, 1, 41), 3)
  assert.equal(clampInt(0, 1, 41), null)
  assert.equal(clampInt(42, 1, 41), null)
  assert.equal(clampInt('abc', 1, 41), null)
  assert.equal(clampInt('٥', 1, 41), null)
  assert.equal(clampInt(null, 1, 41), null)
  assert.equal(clampInt(undefined, 1, 41), null)
  assert.equal(clampInt(Infinity, 1, 41), null)
})

test('isIsoDate: only a zero-padded, real calendar date passes', () => {
  assert.equal(isIsoDate('2026-08-31'), true)
  assert.equal(isIsoDate('2026-8-31'), false)
  assert.equal(isIsoDate('2026-13-45'), false)
  assert.equal(isIsoDate('31-08-2026'), false)
  assert.equal(isIsoDate(''), false)
  assert.equal(isIsoDate(null), false)
  assert.equal(isIsoDate(20260831), false)
})

test('cleanText: truncates at the limit and never returns a non-string', () => {
  assert.equal(cleanText('abcdef', 3), 'abc')
  assert.equal(cleanText('abc', 10), 'abc')
  assert.equal(cleanText(null, 10), '')
  assert.equal(cleanText(undefined, 10), '')
  assert.equal(cleanText(42, 10), '42')
})

test('PILL_FORM: matches an oral solid but not a name that merely contains "cap"', () => {
  assert.equal(PILL_FORM.test('Amoxil 500mg Cap'), true)
  assert.equal(PILL_FORM.test('Aspirin 100mg Tablets'), true)
  assert.equal(PILL_FORM.test('Captopril 25mg'), false)
  assert.equal(PILL_FORM.test('Meronem 1g Vial'), false)
})
