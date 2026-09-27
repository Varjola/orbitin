import { decodeCatalogueIndex, decodeCatalogueManifest, decodeCataloguePointer, decodeCatalogueShard, sha256Hex, type CataloguePointerV1, type CatalogueRecordShardV1, type CatalogueSearchEntryV1, type CatalogueSnapshotParts } from './catalogueSchema.ts'
import { catalogueProfileMode, indexEntryMatchesRecord } from './catalogueProfile.ts'
import { preparedFacetRows, runCatalogueQuery, type CatalogueQuery, type CatalogueQueryResult } from './catalogueQuery.ts'
import { MAX_CATALOGUE_RESULTS, preparedSearchTexts, QUICK_SEARCH_RESULT_LIMIT, runQuickCatalogueQuery, searchCatalogue, type CatalogueSearchResult } from './catalogueSearch.ts'
import { CatalogueClientError } from './catalogueFailure.ts'

export { CatalogueClientError, catalogueFailureOf, type CatalogueFailure, type CatalogueFailureKind } from './catalogueFailure.ts'

export interface CatalogueClientOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly root?: string
  readonly pointerSessionTtlMs?: number
}

export class CatalogueClient {
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly root: string
  private readonly pointerSessionTtlMs: number
  private readonly controllers = new Set<AbortController>()
  private readonly inFlight = new Map<string, Promise<ArrayBuffer>>()
  private readonly shardCache = new Map<string, CatalogueRecordShardV1>()
  private entriesById = new Map<string, CatalogueSearchEntryV1>()
  private snapshot: CatalogueSnapshotParts | null = null
  private loadedAtMs = -Infinity
  private disposed = false
  private loadGeneration = 0

  constructor(options: CatalogueClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.root = options.root ?? '/catalog/v1/'
    this.pointerSessionTtlMs = options.pointerSessionTtlMs ?? 60_000
  }

  get current(): CatalogueSnapshotParts | null { return this.snapshot }

  async load(force = false): Promise<CatalogueSnapshotParts> {
    if (this.disposed) throw new CatalogueClientError('Catalogue client has been disposed.', { kind: 'disposed' })
    if (!force && this.snapshot && Date.now() - this.loadedAtMs < this.pointerSessionTtlMs) return this.snapshot
    const generation = ++this.loadGeneration
    try {
      const pointer = await this.fetchPointer()
      const manifestBytes = await this.fetchVerified(pointer.manifestPath, pointer.manifestSha256)
      const manifest = decodeCatalogueManifest(parseJson(manifestBytes))
      if (manifest.snapshotId !== pointer.snapshotId) throw new CatalogueClientError('Catalogue pointer and manifest identify different snapshots.')
      const indexBytes = await this.fetchVerified(manifest.index.path, manifest.index.sha256, manifest.index.byteLength)
      const index = decodeCatalogueIndex(parseJson(indexBytes), manifest)
      // Build search text now, inside the explicit load, rather than on the
      // learner's first keystroke (measured 259 ms at 31,885 records on desktop).
      preparedSearchTexts(index.entries)
      preparedFacetRows(index.entries)
      const next = { pointer, manifest, index }
      if (this.disposed) throw new CatalogueClientError('Catalogue client has been disposed.', { kind: 'disposed' })
      if (generation !== this.loadGeneration) return this.snapshot ?? next
      if (this.snapshot?.manifest.snapshotId !== next.manifest.snapshotId) {
        for (const key of this.shardCache.keys()) if (!key.startsWith(`${next.manifest.snapshotId}/`)) this.shardCache.delete(key)
      }
      this.snapshot = next
      this.entriesById = new Map(index.entries.map((entry) => [entry.catalogId, entry]))
      this.loadedAtMs = Date.now()
      return next
    } catch (error) {
      if (this.snapshot) throw new CatalogueClientError('The newer catalogue could not be loaded; the last valid catalogue remains available.', { kind: 'refresh-failed', cause: error })
      throw error instanceof CatalogueClientError ? error : new CatalogueClientError('The catalogue is unavailable.', { kind: 'unavailable', cause: error })
    }
  }

  async refresh(): Promise<CatalogueSnapshotParts> { return this.load(true) }

  search(query: string, group: string | null = null, limit = 100): CatalogueSearchResult {
    if (!this.snapshot) return { entries: [], totalMatches: 0, hasMore: false }
    return searchCatalogue(this.snapshot.index.entries, { query, group, limit })
  }

  quickSearch(text: string, limit = QUICK_SEARCH_RESULT_LIMIT): CatalogueSearchResult {
    if (!this.snapshot) return { entries: [], totalMatches: 0, hasMore: false }
    return runQuickCatalogueQuery(this.snapshot.index.entries, text, limit)
  }

  query(query: CatalogueQuery, referenceUnixMs: number, limit = MAX_CATALOGUE_RESULTS, candidateIds?: ReadonlySet<string> | readonly string[]): CatalogueQueryResult {
    if (!this.snapshot) return { entries: [], totalMatches: 0, hasMore: false, facets: null }
    const mode = catalogueProfileMode(this.snapshot.manifest)
    const profile = mode === 'automatic'
      ? { mode, contractVersion: this.snapshot.manifest.catalogueProfile!.contractVersion } as const
      : { mode, contractVersion: null } as const
    return runCatalogueQuery(this.snapshot.index.entries, query, { referenceUnixMs, profile, limit, candidateIds })
  }

  async loadShard(shard: number): Promise<CatalogueRecordShardV1> {
    const snapshot = this.snapshot
    if (!snapshot) throw new CatalogueClientError('Load the catalogue before requesting catalogue records.', { kind: 'not-loaded' })
    if (!Number.isSafeInteger(shard) || shard < 0 || shard >= snapshot.manifest.shardCount) throw new CatalogueClientError('The requested catalogue shard is outside the declared snapshot.')
    const descriptor = snapshot.manifest.shards[shard]
    const key = `${snapshot.manifest.snapshotId}/${descriptor.path}`
    const cached = this.shardCache.get(key)
    if (cached) return cached
    const bytes = await this.fetchVerified(descriptor.path, descriptor.sha256, descriptor.byteLength)
    const decoded = decodeCatalogueShard(parseJson(bytes), snapshot.manifest, shard)
    if (Object.keys(decoded.records).length !== descriptor.entryCount) throw new CatalogueClientError('The catalogue shard count does not match its manifest.')
    if (!this.disposed && this.snapshot?.manifest.snapshotId === snapshot.manifest.snapshotId) this.shardCache.set(key, decoded)
    return decoded
  }

  async loadRecord(catalogId: string): Promise<CatalogueRecordShardV1['records'][string]> {
    const snapshot = this.snapshot
    if (!snapshot) throw new CatalogueClientError('Load the catalogue before requesting catalogue records.', { kind: 'not-loaded' })
    const entry = this.entriesById.get(catalogId)
    if (!entry) throw new CatalogueClientError('The catalogue record is not in the current index.', { kind: 'not-indexed' })
    const shard = await this.loadShard(entry.shard)
    const record = shard.records[catalogId]
    if (!record) throw new CatalogueClientError('The catalogue shard does not contain the indexed record.')
    if (!indexEntryMatchesRecord(entry, record)) throw new CatalogueClientError('The catalogue record does not match its search index entry.')
    return record
  }

  dispose(): void {
    this.disposed = true
    this.loadGeneration += 1
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear(); this.inFlight.clear(); this.shardCache.clear(); this.entriesById.clear(); this.snapshot = null
  }

  indexEntry(catalogId: string): CatalogueSearchEntryV1 | undefined { return this.entriesById.get(catalogId) }
  get cachedShardCount(): number { return this.shardCache.size }

  private async fetchPointer(): Promise<CataloguePointerV1> {
    const bytes = await this.fetchBytes(this.path('current.json'), MAX_POINTER_BYTES)
    try { return decodeCataloguePointer(parseJson(bytes)) } catch (error) { throw new CatalogueClientError('The published catalogue pointer is invalid.', { cause: error }) }
  }

  private async fetchVerified(path: string, expectedSha256: string, expectedLength?: number): Promise<ArrayBuffer> {
    const bytes = await this.fetchBytes(path, expectedLength ?? MAX_MANIFEST_BYTES)
    if (expectedLength !== undefined && bytes.byteLength !== expectedLength) throw new CatalogueClientError(`Catalogue byte-length mismatch for ${path}.`)
    const actual = await sha256Hex(bytes)
    if (actual !== expectedSha256) throw new CatalogueClientError(`Catalogue checksum mismatch for ${path}.`)
    return bytes
  }

  /** At most `maxBytes` are read: a larger body fails before it is held. */
  private fetchBytes(path: string, maxBytes: number): Promise<ArrayBuffer> {
    const safePath = this.path(path)
    const existing = this.inFlight.get(safePath)
    if (existing) return existing
    const controller = new AbortController(); this.controllers.add(controller)
    const request = this.fetchImpl(safePath, { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new CatalogueClientError(`Catalogue request failed with HTTP ${response.status}.`, { kind: 'http', status: response.status })
        return readBounded(response, maxBytes)
      })
      .finally(() => { this.controllers.delete(controller); this.inFlight.delete(safePath) })
    this.inFlight.set(safePath, request)
    return request
  }

  private path(path: string): string {
    const normalized = path.startsWith('/') ? path : `${this.root}${path}`
    if (!normalized.startsWith(this.root) || normalized.includes('\\') || normalized.includes('//') || normalized.includes('%2f') || normalized.includes('%2F') || normalized.includes('%5c') || normalized.includes('%5C') || normalized.includes('..')) throw new CatalogueClientError('Catalogue path escaped the same-origin catalogue root.')
    return normalized
  }
}

function parseJson(bytes: ArrayBuffer): unknown {
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown } catch { throw new CatalogueClientError('Catalogue response is not valid JSON.') }
}

/** Upper bounds for the parts whose length is not declared in advance. */
const MAX_POINTER_BYTES = 64 * 1024
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024

/** The response body, refused once it exceeds `maxBytes`. */
async function readBounded(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  const declared = Number(response.headers.get('Content-Length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > maxBytes) throw new CatalogueClientError('Catalogue response is larger than expected.')
  if (!response.body) {
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > maxBytes) throw new CatalogueClientError('Catalogue response is larger than expected.')
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new CatalogueClientError('Catalogue response is larger than expected.') }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return joined.buffer
}
