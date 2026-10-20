// Cache-aside for one hot, rarely-changing read, held in this process. Render runs a single
// instance, so a shared cache (Redis) would only add a service.
//
//  - Single-flight: concurrent misses share one in-flight load instead of each querying the
//    database (after a cold start every ward device asks at once).
//  - invalidate() when the data is written, plus a TTL as the safety net for changes that bypass
//    the app (a manual SQL edit, a restore).
//  - A load that was already running when invalidate() fired is not stored: otherwise a reader that
//    fetched the old rows just before a write could put them back after the invalidation.
//
// ponytail: no TTL jitter and no LRU — one key on one process has nothing to spread or evict. Add
// jitter and a max-size Map if this ever fronts many keys (e.g. per-date dashboards).
export const memoizeAsync = (load, { ttlMs }) => {
  let value
  let expires = 0
  let inflight = null
  let generation = 0

  const get = () => {
    if (Date.now() < expires) return Promise.resolve(value)
    if (inflight) return inflight
    const startedAt = generation
    const promise = load().then((result) => {
      if (generation === startedAt) { value = result; expires = Date.now() + ttlMs }
      return result
    }).finally(() => { if (inflight === promise) inflight = null })
    inflight = promise
    return promise
  }

  const invalidate = () => { generation += 1; expires = 0; inflight = null }

  return { get, invalidate }
}
