import { prepareAutomaticCatalogueSnapshot, type AutomaticPublicationFinding, type PreparedAutomaticSnapshot } from './automaticSnapshot.ts'
import { basicTimestamp, CatalogueIntegrityError } from './ingest.ts'
import { cleanupOldSnapshots, listAllKeys, publishSnapshotParts } from './publish.ts'
import { ProviderFetchError, type CatalogueSourceNormalization, type GpSupplementContribution, type GpSweepProvider, type ProviderFailureKind } from './provider/types.ts'
import { sha256Hex, stableJson, type CatalogueManifestV1 } from '../../src/data/catalogueSchema.ts'
import { compareCatalogIds, type CatalogueSourceBatch } from '../../src/data/catalogueSourceRecord.ts'
import { CURATED_CATALOGUE, curatedGroupMemberIds, curatedSupplementIds } from '../../src/data/curatedCatalogue.ts'
import type { R2BucketLike } from './types.ts'

/** Persistent hourly keyset sweep of the automatic GP catalogue.
 *
 * Every scheduled invocation makes at most one provider page request. The
 * cursor and page descriptors persist in a private control object between
 * invocations, so a complete sweep of the current catalogue spans about eight
 * hours. Pages of an incomplete sweep are private staging data: they are never
 * served, never published and never merged into the live catalogue.
 *
 *   retrieving --- page n (after last id) --> retrieving            full page
 *   retrieving --- page n -------------------> candidate            short page;
 *                                              candidate-staged, not built
 *
 *   candidate, no supplement yet, next permitted hour:
 *     curated supplement request -------> supplement staged or failed; then
 *                                          built and advanced as below in the
 *                                          same invocation
 *   supplement still `requested` (the run was interrupted) -> failed
 *                                          (`interrupted`), never requested again
 *
 *   candidate: awaiting-publication
 *     supplement unusable when built ----> built again from the sweep alone
 *     structural failure ----------------> discarded; next hour starts at 0
 *     policy finding, not approved ------> held-for-review
 *     publication error, attempts left --> awaiting-publication (next hour,
 *                                           no provider request)
 *     publication error, attempts spent -> publication-failed
 *     published -------------------------> no sweep; next hour starts at 0
 *   held-for-review ---- operator approve-publication (matching digest) ->
 *                        awaiting-publication
 *   publication-failed - operator retry-publication -> awaiting-publication
 *   any candidate ------ operator discard-candidate, or older than the
 *                        maximum sweep age -> discarded
 *
 * While a complete candidate exists the only provider request is its one
 * curated supplement: publication retries and review approval never need
 * Space-Track again, and a failed supplement never blocks or discards a
 * candidate, which is then published from the sweep alone. A failed page
 * request changes neither the
 * cursor nor the public catalogue; it is recorded as a request, so the
 * one-per-hour pacing holds, and the same cursor is tried at the next permitted
 * hour. */

export const GP_SWEEP_STATE_KEY = 'catalog/v1/control/gp-sweep/state.json'
export const GP_SWEEP_PAGE_PREFIX = 'catalog/v1/control/gp-sweep/pages/'
/** Private bounded evidence for a candidate held for operator review. */
export const GP_SWEEP_REVIEW_KEY = 'catalog/v1/control/gp-sweep/review.json'
/** Written by the operator with `wrangler r2 object put`; consumed by the next
 *  invocation. */
export const GP_SWEEP_OPERATOR_ACTION_KEY = 'catalog/v1/control/gp-sweep/operator-action.json'
/** Initial page limit. */
export const GP_SWEEP_PAGE_LIMIT = 4_000
/** 120,000 records at the initial limit; a sweep that has not ended by then is
 *  discarded rather than growing without bound. */
export const GP_SWEEP_MAX_PAGES = 30
/** Minimum spacing between provider page requests. The hourly Cron is the
 *  schedule; this guard stops a duplicate or manual trigger inside the same hour
 *  from making a second request while tolerating ordinary Cron start jitter. */
export const GP_SWEEP_MIN_REQUEST_INTERVAL_MINUTES = 55
/** A sweep or candidate older than this, measured from page 0, is discarded and
 *  restarted, so the first pages of a published catalogue are never far older
 *  than its last. Provisional. */
export const GP_SWEEP_MAX_AGE_HOURS = 48
/** Hourly publication attempts for one complete candidate before it is marked
 *  publication-failed for the operator. None of them contacts the provider. */
export const GP_SWEEP_MAX_PUBLICATION_ATTEMPTS = 3

export interface GpSweepPageRecord {
  readonly index: number
  readonly afterCatalogId: string
  readonly firstCatalogId: string | null
  readonly lastCatalogId: string | null
  readonly recordCount: number
  readonly byteLength: number
  readonly sha256: string
  readonly retrievedAtUtc: string
}

export type GpSweepCandidateStatus = 'awaiting-publication' | 'held-for-review' | 'publication-failed'

export interface GpSweepCandidate {
  readonly status: GpSweepCandidateStatus
  /** Attempts since the candidate became complete, was approved or was retried. */
  readonly publicationAttempts: number
  readonly lastPublicationError: { readonly atUtc: string; readonly reason: string } | null
  readonly review: { readonly heldAtUtc: string; readonly contentDigest: string; readonly findings: readonly AutomaticPublicationFinding['kind'][] } | null
  readonly approval: { readonly contentDigest: string; readonly operator: string; readonly approvedAtUtc: string } | null
}

export type GpSweepSupplementFailureKind = ProviderFailureKind | 'interrupted' | 'staging' | 'build'

/** The curated supplement of one candidate. Requested
 *  at most once per sweep; a failure is kept here for the operator. */
export interface GpSweepSupplement {
  /** Written before the request, like `lastGpRequestAtUtc`. */
  readonly requestedAtUtc: string
  readonly status: 'requested' | 'staged' | 'failed'
  /** Present exactly when staged. */
  readonly staged: { readonly recordCount: number; readonly byteLength: number; readonly sha256: string; readonly retrievedAtUtc: string } | null
  /** Present exactly when failed. */
  readonly failure: { readonly atUtc: string; readonly kind: GpSweepSupplementFailureKind; readonly status: number | null } | null
}

export interface GpSweepInProgress {
  readonly sweepId: string
  readonly providerId: string
  readonly configurationRevision: string
  readonly pageLimit: number
  /** Retrieval time of page 0. Published as `sourceRun.retrievalStartedAtUtc`. */
  readonly startedAtUtc: string
  /** Retrieval time of the terminal short page, once staged. Published as
   *  `sourceRun.retrievedAtUtc`. */
  readonly completedAtUtc: string | null
  /** Present exactly when the terminal page is staged. */
  readonly candidate: GpSweepCandidate | null
  readonly pages: readonly GpSweepPageRecord[]
  /** Absent until the supplement hour. Optional, so a state
   *  written by an earlier producer validates, and an earlier producer, which
   *  ignores unknown fields, keeps it through its own writes. */
  readonly supplement?: GpSweepSupplement
}

/** The curated ids a sweep supplements and reports on. Defaults to
 *  the deployed `curatedCatalogue.ts`; tests supply their own. */
export interface GpSweepCuratedSelection {
  /** Sorted, de-duplicated: exactly the ids the supplement requests. */
  readonly catalogIds: readonly string[]
  readonly maxEpochAgeDays: number
  readonly featuredIds: readonly string[]
  readonly groupMemberIds: readonly string[]
}

export const DEFAULT_CURATED_SELECTION: GpSweepCuratedSelection = {
  catalogIds: curatedSupplementIds(),
  maxEpochAgeDays: CURATED_CATALOGUE.maxSupplementEpochAgeDays,
  featuredIds: CURATED_CATALOGUE.featured,
  groupMemberIds: curatedGroupMemberIds(),
}

/** What a built catalogue holds of the curated ids, for logs and operator
 *  alerts. */
export interface GpSweepCuratedStatus {
  readonly featuredAbsent: readonly string[]
  /** Epoch date (UTC, `YYYY-MM-DD`) of each featured pick present. */
  readonly featuredEpochs: Readonly<Record<string, string>>
  readonly groupMembersAbsent: number
  /** Records the supplement added: curated ids the sweep lacked. */
  readonly supplemented: number
}

export interface GpSweepSupplementSummary {
  readonly status: 'staged' | 'failed' | 'none'
  readonly failureKind: GpSweepSupplementFailureKind | null
  readonly added: number
}

export interface GpSweepOutcome {
  readonly kind: 'published' | 'discarded'
  readonly sweepId: string
  readonly atUtc: string
  readonly reason: string
  readonly snapshotId?: string
}

/** Operator visibility for page failures; cleared by the next staged page. */
export interface GpSweepPageFailure {
  readonly atUtc: string
  readonly afterCatalogId: string
  readonly kind: ProviderFailureKind
  readonly status: number | null
  readonly consecutiveFailures: number
}

export interface GpSweepState {
  readonly schemaVersion: 1
  /** Last provider page request, successful or not. */
  readonly lastGpRequestAtUtc: string | null
  readonly lastPageFailure: GpSweepPageFailure | null
  readonly sweep: GpSweepInProgress | null
  readonly lastOutcome: GpSweepOutcome | null
}

export interface GpSweepOperatorAction {
  readonly schemaVersion: 1
  readonly action: 'approve-publication' | 'retry-publication' | 'discard-candidate'
  readonly sweepId: string
  /** Required for approve-publication: the held candidate's content digest. */
  readonly contentDigest?: string
  readonly operator: string
}

export interface GpSweepStepOptions {
  readonly bucket: R2BucketLike
  readonly provider: GpSweepProvider
  /** False for the offline fixture, which is exempt from request pacing. */
  readonly usesUpstream: boolean
  readonly configurationRevision: string
  readonly nowUtc: string
  readonly runId: string
  readonly live: { readonly manifest: CatalogueManifestV1; readonly etag: string | null } | null
  readonly signal?: AbortSignal
  readonly pageLimit?: number
  readonly shardCount?: number
  /** Defaults to `usesUpstream`: the first automatic publication from a live
   *  provider waits for operator review. */
  readonly requireBootstrapReview?: boolean
  /** Defaults to `DEFAULT_CURATED_SELECTION`. */
  readonly curated?: GpSweepCuratedSelection
  /** Called with the supplement's provider failure, which never fails the
   *  step. The scheduler applies provider protection to it after
   *  the step, whether the step then publishes or throws. */
  readonly onSupplementProviderFailure?: (error: ProviderFetchError) => void
}

type FindingKinds = readonly AutomaticPublicationFinding['kind'][]

export type GpSweepStepResult =
  | { readonly kind: 'paced'; readonly nextRequestNotBeforeUtc: string }
  | { readonly kind: 'page-staged'; readonly sweepId: string; readonly pageIndex: number; readonly recordCount: number; readonly upstreamRequestCount: number }
  | { readonly kind: 'candidate-staged'; readonly sweepId: string; readonly pageCount: number; readonly recordCount: number; readonly upstreamRequestCount: number }
  | { readonly kind: 'published'; readonly sweepId: string; readonly snapshotId: string; readonly pageCount: number; readonly records: number; readonly approvedFindings: FindingKinds; readonly upstreamRequestCount: number; readonly supplement: GpSweepSupplementSummary; readonly curated: GpSweepCuratedStatus }
  | { readonly kind: 'held-for-review'; readonly sweepId: string; readonly contentDigest: string; readonly findings: FindingKinds; readonly upstreamRequestCount: number; readonly supplement: GpSweepSupplementSummary; readonly curated: GpSweepCuratedStatus | null }
  | { readonly kind: 'publication-failed'; readonly sweepId: string; readonly publicationAttempts: number; readonly upstreamRequestCount: number; readonly supplement: GpSweepSupplementSummary; readonly curated: GpSweepCuratedStatus | null }
  | { readonly kind: 'discarded'; readonly sweepId: string; readonly reason: string; readonly upstreamRequestCount: number }

const INITIAL_STATE: GpSweepState = { schemaVersion: 1, lastGpRequestAtUtc: null, lastPageFailure: null, sweep: null, lastOutcome: null }
const NEW_CANDIDATE: GpSweepCandidate = { status: 'awaiting-publication', publicationAttempts: 0, lastPublicationError: null, review: null, approval: null }

/** A control object the producer refuses to act on (fail closed). Raised as
 *  an operator alert (`control-state-invalid`). */
export class ControlStateInvalidError extends Error {
  constructor(message: string) { super(message); this.name = 'ControlStateInvalidError' }
}

/** A complete candidate that cannot become a catalogue however often it is
 *  retried: the sweep is discarded instead of kept for another attempt. */
class SweepCandidateError extends Error {
  constructor(message: string) { super(message); this.name = 'SweepCandidateError' }
}

export async function runGpSweepStep(options: GpSweepStepOptions): Promise<GpSweepStepResult> {
  const pageLimit = options.pageLimit ?? GP_SWEEP_PAGE_LIMIT
  let state = (await readGpSweepState(options.bucket)) ?? INITIAL_STATE
  let sweep = state.sweep

  if (sweep) {
    const reason = sweep.providerId !== options.provider.id || sweep.configurationRevision !== options.configurationRevision || sweep.pageLimit !== pageLimit
      ? 'configuration-changed'
      : Date.parse(options.nowUtc) - Date.parse(sweep.startedAtUtc) > GP_SWEEP_MAX_AGE_HOURS * 3_600_000 ? 'expired' : null
    if (reason) {
      state = await discardSweep(options, state, sweep, reason)
      sweep = null
    }
  }

  // The terminal page is already staged: at most the one curated supplement
  // request, then publication without any further request.
  if (sweep?.candidate) {
    let upstreamRequestCount = 0
    if (sweep.supplement?.status === 'requested') {
      // An earlier run stopped between the request and its result: the
      // request may have been made, so it is not repeated.
      sweep = { ...sweep, supplement: failedSupplement(sweep.supplement, options.nowUtc, 'interrupted', null) }
      state = { ...state, sweep }
      await writeGpSweepState(options.bucket, state)
      logSupplementFailure(options, sweep.sweepId, 'interrupted', null)
    } else if (!sweep.supplement && sweep.candidate.status === 'awaiting-publication') {
      const paced = pacing(options, state)
      if (paced) return paced
      ;({ state, sweep, upstreamRequestCount } = await requestSupplement(options, state, sweep))
    }
    return advanceCandidate(options, state, sweep, upstreamRequestCount)
  }

  const paced = pacing(options, state)
  if (paced) return paced

  if (!sweep) await deleteCandidateArtifacts(options)
  const pageIndex = sweep?.pages.length ?? 0
  const afterCatalogId = sweep ? sweep.pages[pageIndex - 1].lastCatalogId! : '0'

  // Record the attempt before making it, so a failed or interrupted request
  // still counts against the one-request-per-hour pacing.
  state = { ...state, lastGpRequestAtUtc: options.nowUtc }
  await writeGpSweepState(options.bucket, state)
  let page
  try {
    page = await options.provider.fetchGpPage({ afterCatalogId, limit: pageLimit, nowUtc: options.nowUtc, signal: options.signal })
    if (page.recordCount > pageLimit || (page.recordCount === 0) !== (page.lastCatalogId === null) || (page.firstCatalogId !== null && compareCatalogIds(page.firstCatalogId, afterCatalogId) <= 0)) {
      throw new ProviderFetchError('data', 'The provider returned a GP page outside the keyset contract.')
    }
  } catch (error) {
    // The cursor is unchanged. The failure is recorded for the operator; the
    // scheduler decides from its class whether anything beyond the ordinary
    // hourly pacing applies.
    if (error instanceof ProviderFetchError) {
      const consecutiveFailures = (state.lastPageFailure?.consecutiveFailures ?? 0) + 1
      try { await writeGpSweepState(options.bucket, { ...state, lastPageFailure: { atUtc: options.nowUtc, afterCatalogId, kind: error.kind, status: error.status, consecutiveFailures } }) }
      catch (stateError) { logFailure(options.runId, 'gp-sweep-state', stateError) }
    }
    throw error
  }

  const sweepId = sweep?.sweepId ?? `${basicTimestamp(options.nowUtc)}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
  const digest = await sha256Hex(page.body)
  // Staging objects are private and owned by the lease holder, so a page left
  // by an interrupted earlier attempt at the same index is simply replaced.
  const stored = await options.bucket.put(pageKey(sweepId, pageIndex), page.body, { httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' }, sha256: digest })
  if (!stored || stored.size !== page.body.byteLength) throw new Error('A GP sweep page could not be staged.')

  const record: GpSweepPageRecord = { index: pageIndex, afterCatalogId, firstCatalogId: page.firstCatalogId, lastCatalogId: page.lastCatalogId, recordCount: page.recordCount, byteLength: page.body.byteLength, sha256: digest, retrievedAtUtc: page.retrievedAtUtc }
  const terminal = page.recordCount < pageLimit
  let next: GpSweepInProgress = sweep
    ? { ...sweep, pages: [...sweep.pages, record] }
    : { sweepId, providerId: options.provider.id, configurationRevision: options.configurationRevision, pageLimit, startedAtUtc: page.retrievedAtUtc, completedAtUtc: null, candidate: null, pages: [record] }
  state = { ...state, lastPageFailure: null }
  if (terminal) next = { ...next, completedAtUtc: page.retrievedAtUtc, candidate: NEW_CANDIDATE }
  else if (next.pages.length >= GP_SWEEP_MAX_PAGES) {
    await discardSweep(options, state, next, 'page-cap')
    return { kind: 'discarded', sweepId, reason: 'page-cap', upstreamRequestCount: page.upstreamRequestCount }
  }
  state = { ...state, sweep: next }
  await writeGpSweepState(options.bucket, state)
  if (!terminal) return { kind: 'page-staged', sweepId, pageIndex, recordCount: page.recordCount, upstreamRequestCount: page.upstreamRequestCount }
  // The candidate is built in the next permitted hour, after its curated
  // supplement: this hour's request was the terminal page.
  return { kind: 'candidate-staged', sweepId, pageCount: next.pages.length, recordCount: next.pages.reduce((sum, staged) => sum + staged.recordCount, 0), upstreamRequestCount: page.upstreamRequestCount }
}

/** The one-request-per-hour rule, for pages and the supplement alike. The
 *  offline fixture makes no upstream request and is exempt. */
function pacing(options: GpSweepStepOptions, state: GpSweepState): Extract<GpSweepStepResult, { kind: 'paced' }> | null {
  if (!options.usesUpstream || state.lastGpRequestAtUtc === null) return null
  const notBefore = Date.parse(state.lastGpRequestAtUtc) + GP_SWEEP_MIN_REQUEST_INTERVAL_MINUTES * 60_000
  return Date.parse(options.nowUtc) < notBefore ? { kind: 'paced', nextRequestNotBeforeUtc: new Date(notBefore).toISOString() } : null
}

/** The supplement request of a complete candidate. It never throws for a
 *  provider or staging failure: the failure is recorded and the candidate
 *  continues to publication from the sweep alone. Only a failure to write the
 *  control state propagates. */
async function requestSupplement(options: GpSweepStepOptions, state: GpSweepState, sweep: GpSweepInProgress): Promise<{ state: GpSweepState; sweep: GpSweepInProgress; upstreamRequestCount: number }> {
  const curated = options.curated ?? DEFAULT_CURATED_SELECTION
  const requested: GpSweepSupplement = { requestedAtUtc: options.nowUtc, status: 'requested', staged: null, failure: null }
  // Recorded before the request, with the pacing time, so an interrupted run
  // neither repeats the request nor makes another inside the hour.
  state = { ...state, lastGpRequestAtUtc: options.nowUtc, sweep: { ...sweep, supplement: requested } }
  await writeGpSweepState(options.bucket, state)

  let supplement: GpSweepSupplement
  let upstreamRequestCount = 0
  try {
    const result = await options.provider.fetchCuratedGp({ catalogIds: curated.catalogIds, maxEpochAgeDays: curated.maxEpochAgeDays, nowUtc: options.nowUtc, signal: options.signal })
    upstreamRequestCount = result.upstreamRequestCount
    try {
      const digest = await sha256Hex(result.body)
      const stored = await options.bucket.put(supplementKey(sweep.sweepId), result.body, { httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' }, sha256: digest })
      if (!stored || stored.size !== result.body.byteLength) throw new Error('The curated supplement could not be staged.')
      supplement = { ...requested, status: 'staged', staged: { recordCount: result.recordCount, byteLength: result.body.byteLength, sha256: digest, retrievedAtUtc: result.retrievedAtUtc } }
    } catch (error) {
      logFailure(options.runId, 'gp-sweep-supplement-staging', error)
      supplement = failedSupplement(requested, options.nowUtc, 'staging', null)
    }
  } catch (error) {
    const providerError = error instanceof ProviderFetchError ? error : null
    supplement = failedSupplement(requested, options.nowUtc, providerError?.kind ?? 'transient', providerError?.status ?? null)
    if (providerError) options.onSupplementProviderFailure?.(providerError)
  }
  if (supplement.status === 'failed') logSupplementFailure(options, sweep.sweepId, supplement.failure!.kind, supplement.failure!.status)
  const next = { ...sweep, supplement }
  state = { ...state, sweep: next }
  await writeGpSweepState(options.bucket, state)
  return { state, sweep: next, upstreamRequestCount }
}

function failedSupplement(supplement: GpSweepSupplement, atUtc: string, kind: GpSweepSupplementFailureKind, status: number | null): GpSweepSupplement {
  return { requestedAtUtc: supplement.requestedAtUtc, status: 'failed', staged: null, failure: { atUtc, kind, status } }
}

function logSupplementFailure(options: GpSweepStepOptions, sweepId: string, kind: GpSweepSupplementFailureKind, status: number | null): void {
  console.warn(JSON.stringify({ event: 'catalogue_ingestion', runId: options.runId, phase: 'gp-sweep-supplement', outcome: 'failed', sweepId, kind, status }))
}

function supplementSummary(sweep: GpSweepInProgress, added: number): GpSweepSupplementSummary {
  const supplement = sweep.supplement
  if (!supplement) return { status: 'none', failureKind: null, added: 0 }
  if (supplement.status === 'staged') return { status: 'staged', failureKind: null, added }
  return { status: 'failed', failureKind: supplement.failure?.kind ?? null, added: 0 }
}

async function advanceCandidate(options: GpSweepStepOptions, state: GpSweepState, initialSweep: GpSweepInProgress, upstreamRequestCount: number): Promise<GpSweepStepResult> {
  let sweep = initialSweep
  let candidate = sweep.candidate!
  let action = await readOperatorAction(options)
  if (action && action.sweepId !== sweep.sweepId) {
    await consumeOperatorAction(options, action, 'stale-sweep-id')
    action = null
  }
  if (action?.action === 'discard-candidate') {
    await consumeOperatorAction(options, action, 'applied')
    await discardSweep(options, state, sweep, `operator-discard:${action.operator}`)
    return { kind: 'discarded', sweepId: sweep.sweepId, reason: 'operator-discard', upstreamRequestCount }
  }
  if (candidate.status === 'publication-failed') {
    if (action?.action !== 'retry-publication') {
      if (action) await consumeOperatorAction(options, action, 'not-applicable')
      return { kind: 'publication-failed', sweepId: sweep.sweepId, publicationAttempts: candidate.publicationAttempts, upstreamRequestCount, supplement: supplementSummary(sweep, 0), curated: null }
    }
    await consumeOperatorAction(options, action, 'applied')
    candidate = { ...candidate, status: 'awaiting-publication', publicationAttempts: 0 }
    action = null
  }
  if (candidate.status === 'held-for-review') {
    if (action?.action !== 'approve-publication' || action.contentDigest === undefined || action.contentDigest !== candidate.review?.contentDigest) {
      if (action) await consumeOperatorAction(options, action, action.action === 'approve-publication' ? 'digest-mismatch' : 'not-applicable')
      return { kind: 'held-for-review', sweepId: sweep.sweepId, contentDigest: candidate.review!.contentDigest, findings: candidate.review!.findings, upstreamRequestCount, supplement: supplementSummary(sweep, 0), curated: null }
    }
    await consumeOperatorAction(options, action, 'applied')
    candidate = { ...candidate, status: 'awaiting-publication', publicationAttempts: 0, approval: { contentDigest: action.contentDigest, operator: action.operator, approvedAtUtc: options.nowUtc } }
    action = null
  }
  if (action) await consumeOperatorAction(options, action, 'not-applicable')

  candidate = { ...candidate, publicationAttempts: candidate.publicationAttempts + 1 }
  const withCandidate = (next: GpSweepCandidate): GpSweepState => ({ ...state, sweep: { ...sweep, candidate: next } })
  await writeGpSweepState(options.bucket, withCandidate(candidate))

  let built: BuiltCandidate
  try {
    built = await buildCandidate(options, sweep)
  } catch (error) {
    if (error instanceof SweepCandidateError || error instanceof CatalogueIntegrityError) {
      const reason = `candidate-invalid: ${error.message}`.slice(0, 180)
      await discardSweep(options, state, sweep, reason)
      return { kind: 'discarded', sweepId: sweep.sweepId, reason, upstreamRequestCount }
    }
    return failPublication(options, withCandidate, sweep, candidate, error, upstreamRequestCount, null)
  }
  if (built.supplementUnusable && sweep.supplement) {
    // Recorded once: every later build, retry or approval uses the sweep alone,
    // so the reviewed content digest stays stable from here on.
    sweep = { ...sweep, supplement: failedSupplement(sweep.supplement, options.nowUtc, 'build', null) }
    await writeGpSweepState(options.bucket, withCandidate(candidate))
    logSupplementFailure(options, sweep.sweepId, 'build', null)
  }
  const { snapshot, curated } = built
  const supplement = supplementSummary(sweep, curated.supplemented)

  const findings = snapshot.findings.map((finding) => finding.kind)
  if (findings.length > 0 && candidate.approval?.contentDigest !== snapshot.contentDigest) {
    const review: GpSweepCandidate['review'] = { heldAtUtc: options.nowUtc, contentDigest: snapshot.contentDigest, findings }
    const evidence = { schemaVersion: 1, sweepId: sweep.sweepId, heldAtUtc: options.nowUtc, retrievalStartedAtUtc: sweep.startedAtUtc, retrievedAtUtc: sweep.completedAtUtc, pageCount: sweep.pages.length, stagedBytes: sweep.pages.reduce((sum, page) => sum + page.byteLength, 0), findings: snapshot.findings, supplement, curated, ...snapshot.reviewEvidence }
    await options.bucket.put(GP_SWEEP_REVIEW_KEY, stableJson(evidence), { httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' } })
    await writeGpSweepState(options.bucket, withCandidate({ ...candidate, status: 'held-for-review', publicationAttempts: 0, review, approval: null }))
    console.warn(JSON.stringify({ event: 'catalogue_ingestion', runId: options.runId, phase: 'gp-sweep', outcome: 'held-for-review', sweepId: sweep.sweepId, contentDigest: snapshot.contentDigest, findings: snapshot.findings }))
    return { kind: 'held-for-review', sweepId: sweep.sweepId, contentDigest: snapshot.contentDigest, findings, upstreamRequestCount, supplement, curated }
  }

  // A publication failure leaves the live pointer untouched (publisher
  // guarantees) and keeps the complete candidate.
  try {
    // Parts are encoded and written one at a time.
    await publishSnapshotParts(options.bucket, snapshot, options.live?.etag ?? null)
  } catch (error) {
    return failPublication(options, withCandidate, sweep, candidate, error, upstreamRequestCount, curated)
  }
  const approvedBy = candidate.approval ? `; approved by ${candidate.approval.operator}` : ''
  await writeGpSweepState(options.bucket, { ...state, sweep: null, lastOutcome: { kind: 'published', sweepId: sweep.sweepId, atUtc: options.nowUtc, reason: `published${approvedBy}`.slice(0, 180), snapshotId: snapshot.snapshotId } })
  try { await deleteCandidateArtifacts(options) } catch (error) { logFailure(options.runId, 'staging-cleanup', error) }
  try { await cleanupOldSnapshots(options.bucket, snapshot.snapshotId, 7) } catch (error) { logFailure(options.runId, 'cleanup', error) }
  return { kind: 'published', sweepId: sweep.sweepId, snapshotId: snapshot.snapshotId, pageCount: sweep.pages.length, records: snapshot.publishedCount, approvedFindings: findings, upstreamRequestCount, supplement, curated }
}

/** Storage or publication failure of a valid candidate. Below the attempt
 *  bound it is rethrown and retried next hour; at the bound the candidate is
 *  kept, marked for the operator, and the public snapshot stays active. */
async function failPublication(
  options: GpSweepStepOptions, withCandidate: (candidate: GpSweepCandidate) => GpSweepState, sweep: GpSweepInProgress,
  candidate: GpSweepCandidate, error: unknown, upstreamRequestCount: number, curated: GpSweepCuratedStatus | null,
): Promise<GpSweepStepResult> {
  const lastPublicationError = { atUtc: options.nowUtc, reason: safeMessage(error) }
  const exhausted = candidate.publicationAttempts >= GP_SWEEP_MAX_PUBLICATION_ATTEMPTS
  try {
    await writeGpSweepState(options.bucket, withCandidate({ ...candidate, lastPublicationError, status: exhausted ? 'publication-failed' : 'awaiting-publication' }))
  } catch (stateError) {
    logFailure(options.runId, 'gp-sweep-state', stateError)
    throw error
  }
  if (!exhausted) throw error
  console.error(JSON.stringify({ event: 'catalogue_ingestion', runId: options.runId, phase: 'gp-sweep', outcome: 'publication-failed', sweepId: sweep.sweepId, publicationAttempts: candidate.publicationAttempts, reason: lastPublicationError.reason }))
  return { kind: 'publication-failed', sweepId: sweep.sweepId, publicationAttempts: candidate.publicationAttempts, upstreamRequestCount, supplement: supplementSummary(sweep, curated?.supplemented ?? 0), curated }
}

interface BuiltCandidate {
  readonly snapshot: PreparedAutomaticSnapshot
  readonly curated: GpSweepCuratedStatus
  /** The staged supplement could not be used; the candidate was built from
   *  the sweep alone. */
  readonly supplementUnusable: boolean
}

/** A staged supplement that cannot become part of the catalogue. It never
 *  discards a sweep: the candidate is built again without it. */
class SupplementUnusableError extends Error {
  constructor(message: string) { super(message); this.name = 'SupplementUnusableError' }
}

/** Builds the candidate with its staged supplement, or from the sweep alone
 *  when there is none or it cannot be used. A failure of the sweep itself is
 *  a `SweepCandidateError` or `CatalogueIntegrityError` either way. */
async function buildCandidate(options: GpSweepStepOptions, sweep: GpSweepInProgress): Promise<BuiltCandidate> {
  checkPageChain(sweep)
  if (sweep.supplement?.status !== 'staged') return { ...(await buildFrom(options, sweep, false)), supplementUnusable: false }
  try {
    return { ...(await buildFrom(options, sweep, true)), supplementUnusable: false }
  } catch (error) {
    if (!(error instanceof SupplementUnusableError)) throw error
    return { ...(await buildFrom(options, sweep, false)), supplementUnusable: true }
  }
}

/** Reads every staged page in order, checks it against its recorded digest and
 *  the keyset chain, adds the supplement after the last page when asked, and
 *  validates the complete candidate as one catalogue. With the supplement,
 *  any failure that the sweep alone might not have is a
 *  `SupplementUnusableError`. */
async function buildFrom(options: GpSweepStepOptions, sweep: GpSweepInProgress, withSupplement: boolean): Promise<{ snapshot: PreparedAutomaticSnapshot; curated: GpSweepCuratedStatus }> {
  const curatedSelection = options.curated ?? DEFAULT_CURATED_SELECTION
  const normalizer = options.provider.createSweepNormalizer()
  for (const page of sweep.pages) {
    const bytes = await readStaged(options, pageKey(sweep.sweepId, page.index), page.byteLength, page.sha256)
    if (!bytes) throw new SweepCandidateError('a staged page is missing or does not match its recorded digest')
    try { normalizer.addPage(bytes, page.afterCatalogId, sweep.pageLimit) } catch { throw new SweepCandidateError('a staged page failed its structural check') }
  }
  let contribution: GpSupplementContribution = { added: 0, alreadyInSweep: 0, notCurated: 0 }
  if (withSupplement) {
    const staged = sweep.supplement!.staged!
    const bytes = await readStaged(options, supplementKey(sweep.sweepId), staged.byteLength, staged.sha256)
    if (!bytes) throw new SupplementUnusableError('the staged supplement is missing or does not match its recorded digest')
    try { contribution = normalizer.addSupplement(bytes, new Set(curatedSelection.catalogIds)) } catch { throw new SupplementUnusableError('the staged supplement failed its structural check') }
  }
  const normalized: CatalogueSourceNormalization = normalizer.finish({ retrievalStartedAtUtc: sweep.startedAtUtc, retrievedAtUtc: sweep.completedAtUtc!, supplemented: withSupplement })
  if (!normalized.ok) {
    const message = `normalization refused the run (${normalized.failure})`
    throw withSupplement ? new SupplementUnusableError(message) : new SweepCandidateError(message)
  }
  let snapshot: PreparedAutomaticSnapshot
  try {
    snapshot = await prepareAutomaticCatalogueSnapshot(
      { providerName: options.provider.sweepDescriptor.providerName, providerHomepage: options.provider.sweepDescriptor.providerHomepage, batch: normalized.batch, report: normalized.report },
      { nowUtc: options.nowUtc, configurationRevision: options.configurationRevision, shardCount: options.shardCount, previousManifest: options.live?.manifest ?? null, requireBootstrapReview: options.requireBootstrapReview ?? options.usesUpstream },
    )
  } catch (error) {
    if (withSupplement && error instanceof CatalogueIntegrityError) throw new SupplementUnusableError(error.message)
    throw error
  }
  return { snapshot, curated: curatedStatus(normalized.batch, curatedSelection, contribution.added) }
}

async function readStaged(options: GpSweepStepOptions, key: string, byteLength: number, sha256: string): Promise<Uint8Array | null> {
  const object = await options.bucket.get(key)
  const bytes = object?.body ? new Uint8Array(await new Response(object.body).arrayBuffer()) : null
  return bytes && bytes.byteLength === byteLength && await sha256Hex(bytes) === sha256 ? bytes : null
}

/** One pass over the normalized records, checking only the few curated ids. */
function curatedStatus(batch: CatalogueSourceBatch, selection: GpSweepCuratedSelection, supplemented: number): GpSweepCuratedStatus {
  const featured = new Set(selection.featuredIds)
  const members = new Set(selection.groupMemberIds)
  const featuredEpochs: Record<string, string> = {}
  let membersPresent = 0
  for (const record of batch.records) {
    const id = record.identity.catalogId
    if (members.has(id)) membersPresent += 1
    if (featured.has(id)) featuredEpochs[id] = new Date(record.gp.definition.meanElements.epoch.unixSeconds * 1000).toISOString().slice(0, 10)
  }
  return {
    featuredAbsent: selection.featuredIds.filter((id) => !(id in featuredEpochs)),
    featuredEpochs: Object.fromEntries(selection.featuredIds.filter((id) => id in featuredEpochs).map((id) => [id, featuredEpochs[id]])),
    groupMembersAbsent: members.size - membersPresent,
    supplemented,
  }
}

/** Exhaustive and non-overlapping: page 0 starts after 0, each later page
 *  starts after the previous page's last id, every page but the last is full,
 *  and the last is short. */
function checkPageChain(sweep: GpSweepInProgress): void {
  if (sweep.pages.length === 0 || sweep.pages.length > GP_SWEEP_MAX_PAGES) throw new SweepCandidateError('the sweep page count is outside its bound')
  sweep.pages.forEach((page, position) => {
    const expectedAfter = position === 0 ? '0' : sweep.pages[position - 1].lastCatalogId
    const last = position === sweep.pages.length - 1
    if (page.index !== position || page.afterCatalogId !== expectedAfter || (last ? page.recordCount >= sweep.pageLimit : page.recordCount !== sweep.pageLimit)) throw new SweepCandidateError('the staged pages do not form one keyset chain')
  })
}

async function discardSweep(options: GpSweepStepOptions, state: GpSweepState, sweep: GpSweepInProgress, reason: string): Promise<GpSweepState> {
  const next: GpSweepState = { ...state, sweep: null, lastOutcome: { kind: 'discarded', sweepId: sweep.sweepId, atUtc: options.nowUtc, reason: reason.slice(0, 180) } }
  await writeGpSweepState(options.bucket, next)
  console.warn(JSON.stringify({ event: 'catalogue_ingestion', runId: options.runId, phase: 'gp-sweep', outcome: 'discarded', sweepId: sweep.sweepId, pages: sweep.pages.length, candidateStatus: sweep.candidate?.status ?? null, reason: reason.slice(0, 180) }))
  try { await deleteCandidateArtifacts(options) } catch (error) { logFailure(options.runId, 'staging-cleanup', error) }
  return next
}

/** Removes every staged page and any review evidence. Called only when no
 *  sweep is in progress. */
async function deleteCandidateArtifacts(options: GpSweepStepOptions): Promise<void> {
  for (const key of await listAllKeys(options.bucket, GP_SWEEP_PAGE_PREFIX)) await options.bucket.delete(key)
  if (await options.bucket.head(GP_SWEEP_REVIEW_KEY)) await options.bucket.delete(GP_SWEEP_REVIEW_KEY)
}

function pageKey(sweepId: string, index: number): string {
  return `${GP_SWEEP_PAGE_PREFIX}${sweepId}/page-${String(index).padStart(3, '0')}.json`
}

/** Under the page prefix, so every cleanup of staged pages, including an
 *  earlier producer's, removes it too. */
export function supplementKey(sweepId: string): string {
  return `${GP_SWEEP_PAGE_PREFIX}${sweepId}/supplement.json`
}

function safeMessage(error: unknown): string {
  return error instanceof Error && typeof error.message === 'string' ? error.message.slice(0, 180) : 'unknown'
}

function logFailure(runId: string, phase: string, error: unknown): void {
  console.error(JSON.stringify({ event: 'catalogue_ingestion', runId, phase, outcome: 'failed', reason: safeMessage(error) }))
}

/** A malformed action object is logged and removed; it never blocks the sweep. */
async function readOperatorAction(options: GpSweepStepOptions): Promise<GpSweepOperatorAction | null> {
  const object = await options.bucket.get(GP_SWEEP_OPERATOR_ACTION_KEY)
  if (!object?.body) return null
  let value: unknown
  try { value = JSON.parse(new TextDecoder().decode(await new Response(object.body).arrayBuffer())) } catch { value = null }
  if (validOperatorAction(value)) return value
  console.warn(JSON.stringify({ event: 'catalogue_ingestion', runId: options.runId, phase: 'gp-sweep-operator', outcome: 'invalid-action' }))
  await options.bucket.delete(GP_SWEEP_OPERATOR_ACTION_KEY)
  return null
}

async function consumeOperatorAction(options: GpSweepStepOptions, action: GpSweepOperatorAction, result: 'applied' | 'stale-sweep-id' | 'digest-mismatch' | 'not-applicable'): Promise<void> {
  await options.bucket.delete(GP_SWEEP_OPERATOR_ACTION_KEY)
  const log = result === 'applied' ? console.log : console.warn
  log(JSON.stringify({ event: 'catalogue_ingestion', runId: options.runId, phase: 'gp-sweep-operator', outcome: result, action: action.action, sweepId: action.sweepId, operator: action.operator }))
}

export async function readGpSweepState(bucket: R2BucketLike): Promise<GpSweepState | null> {
  const object = await bucket.get(GP_SWEEP_STATE_KEY)
  if (!object?.body) return null
  let value: unknown
  try { value = JSON.parse(new TextDecoder().decode(await new Response(object.body).arrayBuffer())) } catch { value = null }
  if (!validState(value)) throw new ControlStateInvalidError('The GP sweep control state is invalid; refusing a provider run.')
  return value
}

async function writeGpSweepState(bucket: R2BucketLike, state: GpSweepState): Promise<void> {
  const stored = await bucket.put(GP_SWEEP_STATE_KEY, stableJson(state), { httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' } })
  if (!stored) throw new Error('The GP sweep control state could not be written.')
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const CATALOG_ID = /^[1-9]\d{0,8}$/
const SWEEP_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/
const DIGEST = /^[0-9a-f]{64}$/
const OPERATOR = /^[A-Za-z0-9 ._@-]{1,80}$/
const FAILURE_KINDS: readonly unknown[] = ['configuration', 'authentication', 'rate-limit', 'transient', 'data']
const SUPPLEMENT_FAILURE_KINDS: readonly unknown[] = [...FAILURE_KINDS, 'interrupted', 'staging', 'build']
const FINDING_KINDS: readonly unknown[] = ['bootstrap-first-automatic-snapshot', 'published-count-drop', 'rejected-ratio-exceeded']
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isTime = (value: unknown): value is string => typeof value === 'string' && ISO_UTC.test(value)
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isCursor = (value: unknown): boolean => value === '0' || (typeof value === 'string' && CATALOG_ID.test(value))

function validOperatorAction(value: unknown): value is GpSweepOperatorAction {
  if (!isObject(value) || value.schemaVersion !== 1 || typeof value.sweepId !== 'string' || !SWEEP_ID.test(value.sweepId) || typeof value.operator !== 'string' || !OPERATOR.test(value.operator)) return false
  if (value.action === 'approve-publication') return typeof value.contentDigest === 'string' && DIGEST.test(value.contentDigest)
  return value.action === 'retry-publication' || value.action === 'discard-candidate'
}

function validCandidate(value: unknown): boolean {
  if (!isObject(value) || !['awaiting-publication', 'held-for-review', 'publication-failed'].includes(value.status as string) || !isCount(value.publicationAttempts)) return false
  const error = value.lastPublicationError
  if (error !== null && !(isObject(error) && isTime(error.atUtc) && typeof error.reason === 'string')) return false
  const review = value.review
  if (review !== null && !(isObject(review) && isTime(review.heldAtUtc) && typeof review.contentDigest === 'string' && DIGEST.test(review.contentDigest) && Array.isArray(review.findings) && review.findings.every((kind) => FINDING_KINDS.includes(kind)))) return false
  if ((value.status === 'held-for-review') !== (review !== null)) return false
  const approval = value.approval
  return approval === null || (isObject(approval) && typeof approval.contentDigest === 'string' && DIGEST.test(approval.contentDigest) && typeof approval.operator === 'string' && OPERATOR.test(approval.operator) && isTime(approval.approvedAtUtc))
}

/** Consistent by status: `staged` exactly when staged, `failure` exactly when
 *  failed. */
function validSupplement(value: unknown): boolean {
  if (!isObject(value) || !isTime(value.requestedAtUtc) || !['requested', 'staged', 'failed'].includes(value.status as string)) return false
  const { staged, failure } = value
  if ((value.status === 'staged') !== (staged !== null) || (value.status === 'failed') !== (failure !== null)) return false
  if (staged !== null && !(isObject(staged) && isCount(staged.recordCount) && isCount(staged.byteLength) && typeof staged.sha256 === 'string' && DIGEST.test(staged.sha256) && isTime(staged.retrievedAtUtc))) return false
  return failure === null || (isObject(failure) && isTime(failure.atUtc) && SUPPLEMENT_FAILURE_KINDS.includes(failure.kind) && (failure.status === null || isCount(failure.status)))
}

function validState(value: unknown): value is GpSweepState {
  if (!isObject(value) || value.schemaVersion !== 1 || !(value.lastGpRequestAtUtc === null || isTime(value.lastGpRequestAtUtc))) return false
  const failure = value.lastPageFailure
  if (failure !== null && !(isObject(failure) && isTime(failure.atUtc) && isCursor(failure.afterCatalogId) && FAILURE_KINDS.includes(failure.kind) && (failure.status === null || isCount(failure.status)) && isCount(failure.consecutiveFailures) && failure.consecutiveFailures >= 1)) return false
  const outcome = value.lastOutcome
  if (outcome !== null && !(isObject(outcome) && (outcome.kind === 'published' || outcome.kind === 'discarded') && typeof outcome.sweepId === 'string' && isTime(outcome.atUtc) && typeof outcome.reason === 'string')) return false
  const sweep = value.sweep
  if (sweep === null) return true
  if (!isObject(sweep) || typeof sweep.sweepId !== 'string' || !SWEEP_ID.test(sweep.sweepId) || typeof sweep.providerId !== 'string' || typeof sweep.configurationRevision !== 'string' || !isCount(sweep.pageLimit) || sweep.pageLimit < 1 || !isTime(sweep.startedAtUtc) || !(sweep.completedAtUtc === null || isTime(sweep.completedAtUtc)) || !Array.isArray(sweep.pages) || sweep.pages.length === 0 || sweep.pages.length > GP_SWEEP_MAX_PAGES) return false
  if ((sweep.completedAtUtc === null) !== (sweep.candidate === null) || (sweep.candidate !== null && !validCandidate(sweep.candidate))) return false
  // A supplement belongs to a complete candidate only.
  if (sweep.supplement !== undefined && (sweep.candidate === null || !validSupplement(sweep.supplement))) return false
  return sweep.pages.every((page) => isObject(page) && isCount(page.index) && isCursor(page.afterCatalogId) && (page.firstCatalogId === null || (typeof page.firstCatalogId === 'string' && CATALOG_ID.test(page.firstCatalogId))) && (page.lastCatalogId === null || (typeof page.lastCatalogId === 'string' && CATALOG_ID.test(page.lastCatalogId))) && isCount(page.recordCount) && isCount(page.byteLength) && typeof page.sha256 === 'string' && DIGEST.test(page.sha256) && isTime(page.retrievedAtUtc))
}
