import { sha256Hex, stableJson, type CatalogueManifestV1, type CataloguePointerV1 } from '../../src/data/catalogueSchema.ts'
import type { R2BucketLike } from './types.ts'

/** What publication needs from any snapshot builder: the manifest, whose part
 *  descriptors carry the index and shard digests, and every immutable part's
 *  bytes by R2 key. */
export interface PublishableCatalogueSnapshot {
  readonly snapshotId: string
  readonly manifest: CatalogueManifestV1
  readonly bytes: ReadonlyMap<string, Uint8Array>
  readonly manifestBytes: Uint8Array
}

const LEASE_KEY = 'catalog/v1/control/ingestion-lease.json'
const POINTER_KEY = 'catalog/v1/current.json'
const LEASE_DURATION_SECONDS = 30 * 60
/** If-None-Match: * - succeeds only when the key does not yet exist. This is
 *  what makes an immutable snapshot part impossible to overwrite and what makes
 *  a first publication safe against a concurrent one. */
const CREATE_ONLY = { etagDoesNotMatch: '*' } as const

interface LeaseRecord { readonly schemaVersion: 1; readonly runId: string; readonly acquiredAtUtc: string; readonly expiresAtUtc: string; readonly state: 'active' | 'released' }

export interface LeaseResult { readonly owned: boolean; readonly etag: string | null; readonly reason: 'acquired' | 'skipped_locked' | 'race_lost' }

export type PublicationTestFault = 'r2-shard-write' | 'r2-manifest-write' | 'before-pointer-write' | 'pointer-cas-loss'

export async function acquireLease(bucket: R2BucketLike, runId: string, nowUtc: string): Promise<LeaseResult> {
  const current = await bucket.head(LEASE_KEY)
  const expires = current ? await readLease(bucket) : null
  if (expires && expires.state === 'active' && Date.parse(expires.expiresAtUtc) > Date.parse(nowUtc)) return { owned: false, etag: null, reason: 'skipped_locked' }
  const record: LeaseRecord = { schemaVersion: 1, runId, acquiredAtUtc: nowUtc, expiresAtUtc: new Date(Date.parse(nowUtc) + LEASE_DURATION_SECONDS * 1000).toISOString(), state: 'active' }
  // Create-only is `etagDoesNotMatch: '*'` (If-None-Match), not
  // `etagMatches: '*'` (If-Match), which requires the object to already exist
  // and therefore can never succeed against an empty bucket.
  const result = await bucket.put(LEASE_KEY, stableJson(record), current ? { onlyIf: { etagMatches: current.etag ?? current.httpEtag } } : { onlyIf: CREATE_ONLY })
  if (!result) return { owned: false, etag: null, reason: 'race_lost' }
  return { owned: true, etag: result.etag ?? result.httpEtag ?? null, reason: 'acquired' }
}

export async function releaseLease(bucket: R2BucketLike, runId: string, etag: string | null, nowUtc: string): Promise<void> {
  if (!etag) return
  const record: LeaseRecord = { schemaVersion: 1, runId, acquiredAtUtc: nowUtc, expiresAtUtc: nowUtc, state: 'released' }
  await bucket.put(LEASE_KEY, stableJson(record), { onlyIf: { etagMatches: etag } })
}

/** One immutable part and its content digest, as a streamed builder yields it. */
export interface SnapshotPart { readonly key: string; readonly bytes: Uint8Array; readonly sha256: string }

/** A snapshot whose parts are produced one at a time: every shard and the
 *  index, then the manifest as the generator's return value. */
export interface StreamedCatalogueSnapshot {
  readonly snapshotId: string
  parts(): AsyncGenerator<SnapshotPart, { readonly manifest: CatalogueManifestV1; readonly manifestBytes: Uint8Array }, undefined>
}

export async function publishSnapshot(bucket: R2BucketLike, snapshot: PublishableCatalogueSnapshot, livePointerEtag: string | null, testFault?: PublicationTestFault): Promise<{ pointer: CataloguePointerV1; etag: string | null }> {
  // Snapshot construction has already hashed the index and every shard for the
  // manifest. Reuse those exact content digests instead of hashing the same
  // bytes a second time immediately before publication.
  const manifestKey = `catalog/v1/snapshots/${snapshot.snapshotId}/manifest.json`
  const digests = new Map<string, string>([
    [snapshot.manifest.index.path.replace(/^\//, ''), snapshot.manifest.index.sha256],
    ...snapshot.manifest.shards.map((part) => [part.path.replace(/^\//, ''), part.sha256] as const),
    [manifestKey, ''],
  ])
  if (digests.size !== snapshot.bytes.size || [...snapshot.bytes.keys()].some((key) => !digests.has(key))) throw new Error('Catalogue snapshot digest descriptors do not match the immutable publication parts.')
  return publishSnapshotParts(bucket, {
    snapshotId: snapshot.snapshotId,
    async *parts() {
      for (const [key, bytes] of snapshot.bytes) if (key !== manifestKey) yield { key, bytes, sha256: digests.get(key)! }
      return { manifest: snapshot.manifest, manifestBytes: snapshot.manifestBytes }
    },
  }, livePointerEtag, testFault)
}

/** Publish-last publication of a streamed snapshot.
 *
 * Each part is written create-only and verified as it arrives, so only one
 * part's bytes are held at a time. The manifest, returned after the last part,
 * must describe exactly the parts written; it is written next, every part is
 * then head-verified, and the pointer is compare-and-swapped last. */
export async function publishSnapshotParts(bucket: R2BucketLike, snapshot: StreamedCatalogueSnapshot, livePointerEtag: string | null, testFault?: PublicationTestFault): Promise<{ pointer: CataloguePointerV1; etag: string | null }> {
  // R2's `sha256` option is the expected digest of the body, not the body. It
  // is reused for the upload precondition, the returned-object check and the
  // head check.
  const written: { readonly key: string; readonly size: number; readonly sha256: string }[] = []
  const putPart = async (key: string, bytes: Uint8Array, digest: string) => {
    if (testFault === 'r2-shard-write' && /\/records-\d+\.json$/.test(key)) throw new Error('Injected preview fault during a record-shard write.')
    if (testFault === 'r2-manifest-write' && /\/manifest\.json$/.test(key)) throw new Error('Injected preview fault during the manifest write.')
    const stored = await bucket.put(key, bytes, { onlyIf: CREATE_ONLY, httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' }, sha256: digest })
    if (!stored || stored.size !== bytes.byteLength || !checksumMatches(stored.checksums?.sha256, digest)) throw new Error(`Immutable catalogue part could not be verified: ${key}`)
    written.push({ key, size: bytes.byteLength, sha256: digest })
  }
  const root = `catalog/v1/snapshots/${snapshot.snapshotId}/`
  const iterator = snapshot.parts()
  let step = await iterator.next()
  while (!step.done) {
    if (!step.value.key.startsWith(root)) throw new Error('A catalogue part is outside its snapshot.')
    await putPart(step.value.key, step.value.bytes, step.value.sha256)
    step = await iterator.next()
  }
  const { manifest, manifestBytes } = step.value
  const described = new Map<string, { readonly byteLength: number; readonly sha256: string }>([manifest.index, ...manifest.shards].map((part) => [part.path.replace(/^\//, ''), part]))
  if (manifest.snapshotId !== snapshot.snapshotId || described.size !== written.length || written.some((part) => described.get(part.key)?.sha256 !== part.sha256 || described.get(part.key)?.byteLength !== part.size)) {
    throw new Error('Catalogue snapshot digest descriptors do not match the immutable publication parts.')
  }
  const manifestSha256 = await sha256Hex(manifestBytes)
  await putPart(`${root}manifest.json`, manifestBytes, manifestSha256)
  for (const part of written) {
    const head = await bucket.head(part.key)
    if (!head || head.size !== part.size || !checksumMatches(head.checksums?.sha256, part.sha256)) throw new Error(`Immutable catalogue head verification failed: ${part.key}`)
  }
  const livePointer = await bucket.head(POINTER_KEY)
  const currentPointerEtag = livePointer?.etag ?? livePointer?.httpEtag ?? null
  if (currentPointerEtag !== livePointerEtag) throw new Error('Catalogue pointer changed during publication; leaving the new snapshot unreachable.')
  const pointer: CataloguePointerV1 = { schemaVersion: 1, snapshotId: snapshot.snapshotId, publishedAtUtc: manifest.generatedAtUtc, providerRetrievedAtUtc: manifest.provider.retrievedAtUtc, manifestPath: `/${root}manifest.json`, manifestSha256 }
  const pointerBytes = new TextEncoder().encode(stableJson(pointer))
  if (testFault === 'before-pointer-write') throw new Error('Injected preview fault immediately before the pointer write.')
  const pointerCondition = testFault === 'pointer-cas-loss'
    ? { etagMatches: '__injected_stale_etag__' }
    : livePointerEtag ? { etagMatches: livePointerEtag } : CREATE_ONLY
  const storedPointer = await bucket.put(POINTER_KEY, pointerBytes, { onlyIf: pointerCondition, httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=60' }, sha256: await sha256Hex(pointerBytes) })
  if (!storedPointer) throw new Error('Catalogue pointer compare-and-swap lost the publication race.')
  return { pointer, etag: storedPointer.etag ?? storedPointer.httpEtag ?? null }
}

/** Bounded, post-success cleanup. It never deletes the current snapshot and
 * removes at most one complete, recognized old snapshot prefix per run. */
export async function cleanupOldSnapshots(bucket: R2BucketLike, currentSnapshotId: string, retainCount = 7): Promise<string | null> {
  // At 128 shards seven retained snapshots are about 910 objects, so a single
  // 1,000-key listing page is not enough.
  const listed = await listAllKeys(bucket, 'catalog/v1/snapshots/')
  const ids = [...new Set(listed.map((key) => /^catalog\/v1\/snapshots\/(\d{8}T\d{6}Z-[0-9a-f]{12})\/(?:manifest|search-index|records-\d+)\.json$/.exec(key)?.[1]).filter((id): id is string => !!id))]
    .filter((id) => id !== currentSnapshotId).sort().reverse()
  const removable = ids.slice(retainCount - 1).at(-1)
  if (!removable) return null
  const keys = listed.filter((key) => key.startsWith(`catalog/v1/snapshots/${removable}/`) && /^catalog\/v1\/snapshots\/\d{8}T\d{6}Z-[0-9a-f]{12}\/(?:manifest|search-index|records-\d+)\.json$/.test(key))
  for (const key of keys) await bucket.delete(key)
  return removable
}

/** Every key under `prefix`, following R2 list cursors. */
export async function listAllKeys(bucket: R2BucketLike, prefix: string): Promise<string[]> {
  const keys: string[] = []
  let cursor: string | undefined
  for (let pages = 0; pages < 1_000; pages += 1) {
    const listed = await bucket.list(cursor === undefined ? { prefix } : { prefix, cursor })
    keys.push(...listed.objects.map((object) => object.key).filter((key) => key.startsWith(prefix)))
    if (!listed.truncated || !listed.cursor) return keys
    cursor = listed.cursor
  }
  throw new Error('An R2 listing did not terminate.')
}

function checksumMatches(value: ArrayBuffer | string | undefined, expected: string): boolean {
  if (!value) return false
  if (typeof value === 'string') return value.toLowerCase() === expected
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('') === expected
}

async function readLease(bucket: R2BucketLike): Promise<LeaseRecord | null> {
  const object = await bucket.get(LEASE_KEY)
  if (!object?.body) return null
  try { return JSON.parse(new TextDecoder().decode(await new Response(object.body).arrayBuffer())) as LeaseRecord } catch { return null }
}
