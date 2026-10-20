import test from 'node:test'
import assert from 'node:assert/strict'
import { memoizeAsync } from './cache.js'

const gate = () => { let open; const wait = new Promise((resolve) => { open = resolve }); return { wait, open } }

test('concurrent misses share one load', async () => {
  let calls = 0
  const { wait, open } = gate()
  const cache = memoizeAsync(async () => { calls += 1; await wait; return ['a'] }, { ttlMs: 1000 })
  const readers = Array.from({ length: 20 }, () => cache.get())
  open()
  const results = await Promise.all(readers)
  assert.equal(calls, 1)
  assert.ok(results.every((value) => value === results[0]))
  await cache.get()
  assert.equal(calls, 1, 'served from the cache while fresh')
})

test('invalidate() forces the next read to load again', async () => {
  let version = 0
  const cache = memoizeAsync(async () => { version += 1; return version }, { ttlMs: 60_000 })
  assert.equal(await cache.get(), 1)
  assert.equal(await cache.get(), 1)
  cache.invalidate()
  assert.equal(await cache.get(), 2)
})

test('a load that was running when invalidate() fired is not stored', async () => {
  let current = 'old'
  const { wait, open } = gate()
  let first = true
  const cache = memoizeAsync(async () => { const seen = current; if (first) { first = false; await wait } return seen }, { ttlMs: 60_000 })
  const slowReader = cache.get() // reads 'old', then stalls
  current = 'new' // the write
  cache.invalidate()
  open()
  assert.equal(await slowReader, 'old', 'the reader that started before the write may still see the old rows')
  assert.equal(await cache.get(), 'new', 'but they must not be put back in the cache')
})

test('the TTL expires an entry', async () => {
  let calls = 0
  const cache = memoizeAsync(async () => { calls += 1; return calls }, { ttlMs: 20 })
  assert.equal(await cache.get(), 1)
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(await cache.get(), 2)
})

test('a failed load is not cached and reaches every waiter; the next read retries', async () => {
  let calls = 0
  const { wait, open } = gate()
  const cache = memoizeAsync(async () => { calls += 1; if (calls === 1) { await wait; throw new Error('db down') } return 'ok' }, { ttlMs: 1000 })
  const readers = [cache.get(), cache.get(), cache.get()].map((promise) => promise.then(() => 'fulfilled', (error) => error.message))
  open()
  assert.deepEqual(await Promise.all(readers), ['db down', 'db down', 'db down'])
  assert.equal(calls, 1)
  assert.equal(await cache.get(), 'ok')
})
