import type { OmmDefinition } from '../../../src/data/omm.ts'
import type { CatalogueSourceBatch } from '../../../src/data/catalogueSourceRecord.ts'

/** What the ingestion run asks an upstream provider for.
 *
 * The request is expressed in application terms - the union of catalogue
 * identifiers the Orbitin catalogues select - so a provider
 * implementation owns the whole question of how to turn that into upstream
 * traffic. Nothing above this boundary knows a provider URL, query syntax,
 * authentication scheme or wire dialect. */
export interface GpFetchRequest {
  /** Canonical digit-string catalogue identifiers, deduplicated and sorted. */
  readonly catalogIds: readonly string[]
  readonly nowUtc: string
  readonly signal?: AbortSignal
}

/** Provider-neutral result of one ingestion fetch.
 *
 * `definitions` are already normalized into the application's `OmmDefinition`
 * shape, so validation, deduplication, snapshot construction, R2 storage and
 * API serving all operate on internal types. The provider descriptors exist for
 * provenance and attribution in the published manifest, not for browser logic. */
export interface GpFetchResult {
  readonly providerId: string
  readonly providerName: string
  readonly providerHomepage: string
  /** The originating authority for the underlying data, recorded so that a
   *  published snapshot can carry the citation the provider requires. */
  readonly sourceAuthority: string
  readonly retrievedAtUtc: string
  /** Upstream HTTP requests this fetch made, including any authentication and
   *  session-disposal calls. Recorded so provider request volume stays a
   *  measured quantity rather than an assumption. */
  readonly upstreamRequestCount: number
  readonly receivedCount: number
  readonly rejectedCount: number
  readonly definitions: readonly OmmDefinition[]
}

export interface CatalogueProvider {
  readonly id: string
  fetchCurrentGp(request: GpFetchRequest): Promise<GpFetchResult>
}

// ---------------------------------------------------------------------------
// Automatic catalogue: persistent keyset sweep

/** Provenance a sweep provider contributes to the published manifest. */
export interface GpSweepProviderDescriptor {
  readonly providerId: string
  readonly providerName: string
  readonly providerHomepage: string
  readonly sourceAuthority: string
  /** The adopted selection, described without credentials or query syntax. */
  readonly queryDescription: string
  /** Appended to `queryDescription` for a catalogue built with the curated
   *  supplement. Starts with `; `. */
  readonly supplementDescription: string
}

/** One bounded page: records whose catalogue id is greater than the cursor, in
 *  ascending id order, at most `limit` of them. */
export interface GpSweepPageRequest {
  /** Canonical catalogue id, or `0` for the first page of a sweep. */
  readonly afterCatalogId: string
  readonly limit: number
  readonly nowUtc: string
  readonly signal?: AbortSignal
}

export interface GpSweepPage {
  readonly retrievedAtUtc: string
  readonly upstreamRequestCount: number
  readonly recordCount: number
  /** `null` exactly when the page is empty. */
  readonly firstCatalogId: string | null
  readonly lastCatalogId: string | null
  /** Provider wire bytes, already checked for shape, size, order and cursor.
   *  They are staging data only: stored privately until the sweep completes and
   *  never published or served. */
  readonly body: Uint8Array
}

/** Normalization summary keyed only by bounded reasons and domain field names,
 *  never by provider keys or record content. */
export interface CatalogueSourceReport {
  readonly receivedCount: number
  readonly publishedCount: number
  readonly identicalDuplicateCount: number
  readonly rejectedCount: number
  readonly rejectedByReason: Readonly<Record<string, number>>
  readonly optionalFieldErrors: Readonly<Record<string, number>>
  readonly sharedInternationalDesignatorCount: number
}

export type CatalogueSourceNormalization =
  | { readonly ok: true; readonly batch: CatalogueSourceBatch; readonly report: CatalogueSourceReport }
  | { readonly ok: false; readonly failure: string; readonly report: CatalogueSourceReport }

/** Curated members by catalogue id: the one batched
 *  request of a sweep's supplement hour. Only element sets with no decay date
 *  and an epoch within `maxEpochAgeDays` are asked for. */
export interface GpCuratedRequest {
  /** Canonical, sorted, de-duplicated; 1..MAX_BATCHED_CATALOG_IDS. */
  readonly catalogIds: readonly string[]
  /** Integer, 11..60 (the sweep already covers 10). */
  readonly maxEpochAgeDays: number
  readonly nowUtc: string
  readonly signal?: AbortSignal
}

export interface GpCuratedResult {
  readonly retrievedAtUtc: string
  readonly upstreamRequestCount: number
  readonly recordCount: number
  /** Provider wire bytes, checked for shape, size, order and requested ids.
   *  Staging data only, like a sweep page. */
  readonly body: Uint8Array
}

/** What the supplement contributed to one normalized run. */
export interface GpSupplementContribution {
  /** Records passed on to normalization: curated ids the sweep lacks. */
  readonly added: number
  /** Curated ids the sweep already holds; the sweep's record wins. */
  readonly alreadyInSweep: number
  /** Ids in the body that are not curated; ignored. */
  readonly notCurated: number
}

/** Turns the staged pages of one complete sweep into one source batch. Pages
 *  are fed in sweep order; `addPage` throws on a page that fails its structural
 *  check. */
export interface GpSweepNormalizer {
  addPage(body: Uint8Array, afterCatalogId: string, limit: number): void
  /** Called at most once, after the last `addPage`. Throws on a body that
   *  fails its structural check. */
  addSupplement(body: Uint8Array, curatedIds: ReadonlySet<string>): GpSupplementContribution
  /** `supplemented` extends the run's query description; a run published
   *  without the supplement describes itself exactly as before the supplement existed. */
  finish(retrieval: { readonly retrievalStartedAtUtc: string; readonly retrievedAtUtc: string; readonly supplemented: boolean }): CatalogueSourceNormalization
}

export interface GpSweepProvider {
  readonly id: string
  readonly sweepDescriptor: GpSweepProviderDescriptor
  fetchGpPage(request: GpSweepPageRequest): Promise<GpSweepPage>
  fetchCuratedGp(request: GpCuratedRequest): Promise<GpCuratedResult>
  createSweepNormalizer(): GpSweepNormalizer
}

/** How a provider failure should be treated by the scheduled run.
 *
 * These are ingestion-policy classes, not HTTP codes. Adapting a provider means
 * mapping its own error surface onto these, so the scheduler never has to know
 * one provider's status conventions. */
export type ProviderFailureKind =
  /** The deployment is wrong - absent credentials, a moved endpoint, an
   *  unexpected redirect. Retrying on schedule cannot fix it. */
  | 'configuration'
  /** Credentials were presented and refused. */
  | 'authentication'
  /** The provider is protecting itself: quota, throttle or refusal. */
  | 'rate-limit'
  /** Outage, network error or timeout. The next scheduled run is the retry. */
  | 'transient'
  /** A well-formed exchange carrying content this application cannot trust. */
  | 'data'

/** A provider failure that is safe to log.
 *
 * Its message is always built from module constants plus a status code, never
 * from a credential, cookie, request header or response body. Nothing that
 * could carry session material is stored on the instance, so serializing or
 * logging one cannot leak authentication state. */
export class ProviderFetchError extends Error {
  readonly kind: ProviderFailureKind
  readonly status: number | null

  constructor(kind: ProviderFailureKind, message: string, status: number | null = null) {
    super(message)
    this.name = 'ProviderFetchError'
    this.kind = kind
    this.status = status
  }
}

/** Oldest supplement age accepted; the sweep itself already covers ten days. */
export const MIN_CURATED_EPOCH_AGE_DAYS = 11
export const MAX_CURATED_EPOCH_AGE_DAYS = 60

/** Shared request-shape checks for the curated supplement, so every provider
 *  refuses an empty, oversized or non-canonical list or an out-of-range age
 *  before producing any traffic. */
export function assertCuratedRequest(request: GpCuratedRequest, maxIds: number): void {
  const ids = request.catalogIds
  if (ids.length === 0 || ids.length > maxIds) throw new ProviderFetchError('configuration', 'The curated id list is empty or exceeds the batched query bound.')
  if (ids.some((id) => !/^[1-9]\d{0,8}$/.test(id))) throw new ProviderFetchError('configuration', 'A curated catalogue id is not a canonical digit string.')
  for (let position = 1; position < ids.length; position += 1) {
    const previous = ids[position - 1]
    const current = ids[position]
    if (previous.length > current.length || (previous.length === current.length && previous >= current)) throw new ProviderFetchError('configuration', 'The curated id list is not sorted and de-duplicated.')
  }
  if (!Number.isSafeInteger(request.maxEpochAgeDays) || request.maxEpochAgeDays < MIN_CURATED_EPOCH_AGE_DAYS || request.maxEpochAgeDays > MAX_CURATED_EPOCH_AGE_DAYS) throw new ProviderFetchError('configuration', 'The curated epoch age is outside its bound.')
}

/** Shared request-shape checks for a sweep page, so every provider refuses the
 *  same untrusted cursor or limit before producing any traffic. */
export function assertSweepPageRequest(request: GpSweepPageRequest, maxLimit: number): void {
  if (!/^(?:0|[1-9]\d{0,8})$/.test(request.afterCatalogId)) throw new ProviderFetchError('configuration', 'The sweep cursor is not a canonical catalogue id.')
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > maxLimit) throw new ProviderFetchError('configuration', 'The sweep page limit is outside the provider response bound.')
}
