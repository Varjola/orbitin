import { expect, it } from 'vitest'
import { acquireLease, cleanupOldSnapshots, publishSnapshot } from './publish.ts'
import { buildCatalogueSnapshot } from './ingest.ts'
import { CATALOGUE_SELECTION_IDS } from './catalogues.ts'
import { FixtureProvider } from './provider/fixture.ts'
import { sha256Hex } from '../../src/data/catalogueSchema.ts'
import type { R2BucketLike, R2ObjectLike } from './types.ts'

interface Stored { readonly bytes: Uint8Array; readonly etag: string }
interface PutCall { readonly key: string; readonly options: { onlyIf?: Record<string, string>; sha256?: unknown } }

/** Minimal R2 stand-in that enforces the conditional semantics the publisher
 *  depends on. `etagDoesNotMatch: '*'` succeeds only when the key is absent and
 *  `etagMatches` only when it is present and current, which is exactly the
 *  distinction a create-only write relies on. */
function fakeBucket() {
  const objects = new Map<string, Stored>()
  const puts: PutCall[] = []
  let nextEtag = 0
  const describe = (stored: Stored): R2ObjectLike => ({
    size: stored.bytes.byteLength,
    etag: stored.etag,
    httpEtag: stored.etag,
    body: new Response(new Uint8Array(stored.bytes).buffer).body!,
  })
  const bucket: R2BucketLike = {
    async get(key) {
      const stored = objects.get(key)
      return stored ? describe(stored) : null
    },
    async head(key) {
      const stored = objects.get(key)
      if (!stored) return null
      return { size: stored.bytes.byteLength, etag: stored.etag, httpEtag: stored.etag, checksums: { sha256: await sha256Hex(stored.bytes) } }
    },
    async put(key, value, options) {
      const typed = (options ?? {}) as PutCall['options']
      puts.push({ key, options: typed })
      const existing = objects.get(key)
      const condition = typed.onlyIf ?? {}
      if (condition.etagDoesNotMatch === '*' && existing) return null
      if (condition.etagMatches !== undefined && condition.etagMatches !== existing?.etag) return null
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value)
      const stored = { bytes, etag: `etag-${nextEtag++}` }
      objects.set(key, stored)
      return { size: bytes.byteLength, etag: stored.etag, httpEtag: stored.etag, checksums: { sha256: await sha256Hex(bytes) } }
    },
    async delete(key) { objects.delete(key) },
    async list() { return { objects: [...objects.keys()].map((key) => ({ key })) } },
  }
  return { bucket, objects, puts }
}

it('follows R2 list cursors when retention holds more than one listing page of objects', async () => {
  const { bucket, objects } = fakeBucket()
  // Eight 128-shard snapshots: 1,040 objects, more than one 1,000-key R2 page.
  const ids = Array.from({ length: 8 }, (_, day) => `202609${String(10 + day).padStart(2, '0')}T001700Z-${String(day).repeat(12)}`)
  for (const id of ids) for (const part of ['manifest', 'search-index', ...Array.from({ length: 128 }, (_, shard) => `records-${shard}`)]) {
    objects.set(`catalog/v1/snapshots/${id}/${part}.json`, { bytes: new Uint8Array(1), etag: 'e' })
  }
  const paged: R2BucketLike = {
    ...bucket,
    async list(options) {
      const { prefix = '', cursor } = (options ?? {}) as { prefix?: string; cursor?: string }
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort()
      const start = cursor ? Number(cursor) : 0
      return { objects: keys.slice(start, start + 1_000).map((key) => ({ key })), truncated: start + 1_000 < keys.length, cursor: String(start + 1_000) }
    },
  }
  // Newest snapshot is current; the oldest of the other seven is removed.
  expect(await cleanupOldSnapshots(paged, ids[7], 7)).toBe(ids[0])
  expect([...objects.keys()].some((key) => key.includes(ids[0]))).toBe(false)
  expect([...objects.keys()].filter((key) => key.includes(ids[7]))).toHaveLength(130)
})

async function fixtureSnapshot(nowUtc = '2026-09-10T00:17:00Z') {
  const fetched = await new FixtureProvider().fetchCurrentGp({ catalogIds: CATALOGUE_SELECTION_IDS, nowUtc })
  return buildCatalogueSnapshot(fetched, { nowUtc, configurationRevision: 'test', shardCount: 8 })
}

it('acquires the lease against an empty bucket', async () => {
  // If-Match: * requires the key to already exist, so using it here would make
  // the very first run of a new deployment permanently unable to start.
  const { bucket, puts } = fakeBucket()
  const lease = await acquireLease(bucket, 'run-1', '2026-09-10T00:17:00Z')
  expect(lease).toMatchObject({ owned: true, reason: 'acquired' })
  expect(lease.etag).toBeTruthy()
  expect(puts[0].options.onlyIf).toEqual({ etagDoesNotMatch: '*' })
})

it('refuses a second run while a lease is active and takes over an expired one', async () => {
  const { bucket } = fakeBucket()
  await acquireLease(bucket, 'run-1', '2026-09-10T00:17:00Z')
  expect(await acquireLease(bucket, 'run-2', '2026-09-10T00:20:00Z')).toMatchObject({ owned: false, reason: 'skipped_locked' })
  expect(await acquireLease(bucket, 'run-3', '2026-09-10T02:00:00Z')).toMatchObject({ owned: true, reason: 'acquired' })
})

it('publishes a first snapshot with create-only parts and a create-only pointer', async () => {
  const { bucket, objects, puts } = fakeBucket()
  const snapshot = await fixtureSnapshot()
  const { pointer } = await publishSnapshot(bucket, snapshot, null)

  expect(pointer.snapshotId).toBe(snapshot.snapshotId)
  for (const key of snapshot.bytes.keys()) expect(objects.has(key)).toBe(true)
  expect(objects.has('catalog/v1/current.json')).toBe(true)

  // Every immutable part and the first pointer are create-only.
  expect(puts.every((call) => call.options.onlyIf?.etagDoesNotMatch === '*')).toBe(true)
  // R2's sha256 option takes the digest of the body, never the body itself.
  expect(puts.every((call) => typeof call.options.sha256 === 'string' && /^[0-9a-f]{64}$/.test(call.options.sha256 as string))).toBe(true)
})

it('refuses publication when manifest digest descriptors do not cover the immutable parts', async () => {
  const { bucket } = fakeBucket()
  const snapshot = await fixtureSnapshot()
  const malformed = { ...snapshot, bytes: new Map(snapshot.bytes).set(`catalog/v1/snapshots/${snapshot.snapshotId}/unexpected.json`, new TextEncoder().encode('{}')) }
  await expect(publishSnapshot(bucket, malformed, null)).rejects.toThrow('digest descriptors')
})

it('writes the pointer last and never overwrites an immutable part', async () => {
  const { bucket, puts } = fakeBucket()
  const snapshot = await fixtureSnapshot()
  await publishSnapshot(bucket, snapshot, null)
  expect(puts.at(-1)?.key).toBe('catalog/v1/current.json')

  // Republishing the identical snapshot must fail on the first immutable part
  // rather than silently rewriting published bytes.
  await expect(publishSnapshot(bucket, snapshot, null)).rejects.toThrow('could not be verified')
})

it('compare-and-swaps the pointer and leaves the live one intact when it loses', async () => {
  const { bucket, objects } = fakeBucket()
  await publishSnapshot(bucket, await fixtureSnapshot(), null)
  const livePointer = new TextDecoder().decode(objects.get('catalog/v1/current.json')!.bytes)
  const liveEtag = objects.get('catalog/v1/current.json')!.etag

  // A run that lost the pointer race leaves its parts durable but unreachable;
  // the plan makes those eligible for ordinary retention cleanup. What must not
  // happen is the live pointer moving.
  const lost = await fixtureSnapshot('2026-09-10T12:17:00Z')
  await expect(publishSnapshot(bucket, lost, 'a-stale-etag')).rejects.toThrow('changed during publication')
  expect(new TextDecoder().decode(objects.get('catalog/v1/current.json')!.bytes)).toBe(livePointer)
  expect(objects.has(`catalog/v1/snapshots/${lost.snapshotId}/manifest.json`)).toBe(true)

  // The next scheduled run builds its own snapshot id and, holding the current
  // pointer etag, succeeds.
  const next = await fixtureSnapshot('2026-09-11T00:17:00Z')
  const { pointer } = await publishSnapshot(bucket, next, liveEtag)
  expect(pointer.snapshotId).toBe(next.snapshotId)
})

it.each(['r2-shard-write', 'r2-manifest-write', 'before-pointer-write', 'pointer-cas-loss'] as const)(
  'leaves the live pointer byte-identical for the %s preview fault',
  async (fault) => {
    const { bucket, objects } = fakeBucket()
    await publishSnapshot(bucket, await fixtureSnapshot(), null)
    const pointerBefore = new Uint8Array(objects.get('catalog/v1/current.json')!.bytes)
    const etagBefore = objects.get('catalog/v1/current.json')!.etag
    const candidate = await fixtureSnapshot('2026-09-10T12:17:00Z')

    await expect(publishSnapshot(bucket, candidate, etagBefore, fault)).rejects.toThrow()

    expect(objects.get('catalog/v1/current.json')!.bytes).toEqual(pointerBefore)
    expect(objects.get('catalog/v1/current.json')!.etag).toBe(etagBefore)
  },
)

it('retains the current snapshot plus six prior snapshots and removes only the oldest recognized prefix', async () => {
  const { bucket, objects } = fakeBucket()
  const ids = Array.from({ length: 8 }, (_, index) => `202609${String(index + 1).padStart(2, '0')}T001700Z-${String(index + 1).padStart(12, '0')}`)
  for (const id of ids) {
    for (const file of ['manifest.json', 'search-index.json', 'records-0.json']) {
      await bucket.put(`catalog/v1/snapshots/${id}/${file}`, '{}')
    }
  }
  await bucket.put('catalog/v1/snapshots/not-a-snapshot/manifest.json', '{}')

  const removed = await cleanupOldSnapshots(bucket, ids.at(-1)!, 7)

  expect(removed).toBe(ids[0])
  expect([...objects.keys()].some((key) => key.startsWith(`catalog/v1/snapshots/${ids[0]}/`))).toBe(false)
  expect([...objects.keys()].some((key) => key.startsWith(`catalog/v1/snapshots/${ids[1]}/`))).toBe(true)
  expect(objects.has('catalog/v1/snapshots/not-a-snapshot/manifest.json')).toBe(true)
})
