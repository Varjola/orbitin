import { buildCatalogueSnapshot } from './ingest.ts'
import { CATALOGUE_SELECTION_IDS } from './catalogues.ts'
import { ProducerAlerts, type ProducerAlertInput } from './alerts.ts'
import { ControlStateInvalidError, readGpSweepState, runGpSweepStep, type GpSweepStepResult } from './gpSweep.ts'
import { FixtureProvider, FIXTURE_PROVIDER_ID, MAX_FIXTURE_SWEEP_RECORDS } from './provider/fixture.ts'
import { SpaceTrackProvider, SPACE_TRACK_PROVIDER_ID, readSpaceTrackCredentials } from './provider/spaceTrack.ts'
import { ProviderFetchError, type CatalogueProvider, type GpSweepProvider, type ProviderFailureKind } from './provider/types.ts'
import { acquireLease, cleanupOldSnapshots, publishSnapshot, releaseLease, type PublicationTestFault } from './publish.ts'
import { decodeCatalogueManifest, decodeCataloguePointer, sha256Hex, stableJson, type CatalogueManifestV1 } from '../../src/data/catalogueSchema.ts'
import { CURATED_CATALOGUE } from '../../src/data/curatedCatalogue.ts'
import type { R2BucketLike, R2ObjectLike, CatalogueWorkerEnv, WorkerExecutionContext } from './types.ts'

const PROVIDER_STATE_KEY = 'catalog/v1/control/provider-state.json'
const PROVIDER_TIMEOUT_MS = 120_000
type ProviderStateMode = 'healthy' | 'cooldown' | 'config-fault'
export interface ProviderState { readonly schemaVersion: 1; readonly mode: ProviderStateMode; readonly configurationRevision: string; readonly updatedAtUtc: string; readonly retryAfterUtc: string | null; readonly reason: string }

export default {
  /** orbitin-catalogue: the sole automatic catalogue producer. It serves no
   * application or catalogue request; the frontends read what it publishes. */
  async fetch(): Promise<Response> {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  },
  async scheduled(_event: unknown, env: CatalogueWorkerEnv, context: WorkerExecutionContext): Promise<void> {
    context.waitUntil(runIngestion(env))
  },
}

/** Chooses the provider for this deployment.
 *
 * The fixture provider is the default. A deployment that has not been told
 * explicitly to use a live provider therefore produces no upstream traffic, and
 * a live provider without credentials fails before it can make a request rather
 * than after it has already been refused. */
export function selectProvider(env: CatalogueWorkerEnv): { readonly provider: CatalogueProvider & GpSweepProvider } | { readonly configurationFault: string } {
  const mode = env.CATALOGUE_PROVIDER ?? FIXTURE_PROVIDER_ID
  if (mode === FIXTURE_PROVIDER_ID) {
    const count = env.CATALOGUE_FIXTURE_SWEEP_RECORDS
    if (count === undefined || count === '') return { provider: new FixtureProvider() }
    if (!/^[1-9]\d{0,5}$/.test(count) || Number(count) > MAX_FIXTURE_SWEEP_RECORDS) return { configurationFault: 'invalid_fixture_sweep_records' }
    return { provider: new FixtureProvider({ sweepRecordCount: Number(count) }) }
  }
  if (mode !== SPACE_TRACK_PROVIDER_ID) return { configurationFault: 'unknown_provider' }
  const credentials = readSpaceTrackCredentials(env)
  if (!credentials) return { configurationFault: 'missing_credentials' }
  return { provider: new SpaceTrackProvider({ credentials }) }
}

export async function runIngestion(env: CatalogueWorkerEnv, nowUtc = new Date().toISOString()): Promise<void> {
  const runId = crypto.randomUUID()
  const configurationRevision = env.CATALOGUE_CONFIG_REVISION ?? 'initial'
  if (env.CATALOGUE_ENABLED !== 'true') { console.log(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'gate', outcome: 'disabled' })); return }
  const retrieval = env.CATALOGUE_RETRIEVAL ?? 'selected-ids'
  if (retrieval !== 'selected-ids' && retrieval !== 'gp-sweep') {
    console.error(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'provider-config', outcome: 'configuration_fault', reason: 'unknown_retrieval' }))
    return
  }
  const testFault = publicationTestFault(env.CATALOGUE_TEST_FAULT)
  const holdsLeaseForTest = env.CATALOGUE_TEST_FAULT === 'hold-after-lease'
  if (env.CATALOGUE_TEST_FAULT !== undefined && testFault === null && !holdsLeaseForTest) {
    console.error(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'provider-config', outcome: 'configuration_fault', reason: 'unknown_test_fault' }))
    return
  }
  if (testFault && retrieval === 'gp-sweep') {
    console.error(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'provider-config', outcome: 'configuration_fault', reason: 'test_fault_requires_selected_ids' }))
    return
  }
  const selected = selectProvider(env)
  if ('configurationFault' in selected) {
    // No upstream request was made, so there is nothing to cool down from. The
    // fix is a deployment or secret change, and the next scheduled run will
    // pick it up with no provider traffic in between.
    console.error(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'provider-config', outcome: 'configuration_fault', reason: selected.configurationFault }))
    return
  }
  const provider = selected.provider
  // The fixture provider makes no upstream request, so provider protection
  // state neither applies to it nor should be written by it. Local and preview
  // runs stay unaffected by a cooldown recorded against a live provider.
  const usesUpstream = provider.id !== FIXTURE_PROVIDER_ID
  if ((testFault || holdsLeaseForTest) && usesUpstream) {
    console.error(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'provider-config', outcome: 'configuration_fault', reason: 'test_fault_requires_fixture' }))
    return
  }
  const lease = await acquireLease(env.CATALOGUE_BUCKET, runId, nowUtc)
  if (!lease.owned) { console.log(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'lease', outcome: lease.reason })); return }
  // Operator alerts for the automatic sweep, off unless
  // fully configured. They never change what ingestion does.
  const alerts = retrieval === 'gp-sweep' ? ProducerAlerts.create(env, usesUpstream, runId) : null
  let sweepResult: GpSweepStepResult | null = null
  try {
    if (holdsLeaseForTest) await new Promise((resolve) => setTimeout(resolve, 15_000))
    const live = await readLiveCatalogue(env.CATALOGUE_BUCKET)
    await alerts?.evaluate({ stage: 'start', live: live ? { snapshotId: live.manifest.snapshotId, generatedAtUtc: live.manifest.generatedAtUtc } : null }, nowUtc)
    const providerState = usesUpstream ? await readProviderState(env.CATALOGUE_BUCKET) : null
    const providerBlocked = providerState && providerState.configurationRevision === configurationRevision && (providerState.mode === 'config-fault' || (providerState.mode === 'cooldown' && !!providerState.retryAfterUtc && Date.parse(providerState.retryAfterUtc) > Date.parse(nowUtc)))
    if (providerBlocked) {
      console.log(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'provider-state', outcome: providerState.mode, retryAfterUtc: providerState.retryAfterUtc })); return
    }
    if (retrieval === 'gp-sweep') {
      sweepResult = await runSweepInvocation(env, provider, usesUpstream, providerState, configurationRevision, nowUtc, runId, live)
      return
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
    let fetched
    try {
      fetched = await provider.fetchCurrentGp({ catalogIds: CATALOGUE_SELECTION_IDS, nowUtc, signal: controller.signal })
    } catch (error) {
      if (usesUpstream) {
        try { await writeProviderState(env.CATALOGUE_BUCKET, providerFailureState(error, configurationRevision, nowUtc)) }
        catch (stateError) { console.error(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'provider-state', outcome: 'write_failed', reason: safeReason(stateError) })) }
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
    console.log(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'provider', outcome: 'fetched', providerId: fetched.providerId, upstreamRequests: fetched.upstreamRequestCount, received: fetched.receivedCount, rejected: fetched.rejectedCount }))
    const snapshot = await buildCatalogueSnapshot(fetched, { nowUtc, configurationRevision, shardCount: 8, previousManifest: live?.manifest })
    if (snapshot.missingMembers.length > 0 || snapshot.rejections.unselected > 0 || snapshot.rejections['designator-mismatch'] > 0) {
      console.warn(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'selection', outcome: 'incomplete', missingMembers: snapshot.missingMembers, rejections: snapshot.rejections }))
    }
    await publishSnapshot(env.CATALOGUE_BUCKET, snapshot, live?.etag ?? null, testFault ?? undefined)
    if (usesUpstream) await writeProviderState(env.CATALOGUE_BUCKET, { schemaVersion: 1, mode: 'healthy', configurationRevision, updatedAtUtc: nowUtc, retryAfterUtc: null, reason: 'published' })
    try { await cleanupOldSnapshots(env.CATALOGUE_BUCKET, snapshot.snapshotId, 7) } catch (error) { console.error(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'cleanup', outcome: 'failed', reason: safeReason(error) })) }
    console.log(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'publish', outcome: 'published', snapshotId: snapshot.snapshotId, records: snapshot.manifest.totals.deduplicatedCount }))
  } catch (error) {
    console.error(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'run', outcome: 'failed', reason: safeReason(error) }))
  } finally {
    if (alerts) await alerts.evaluate(await finishAlertInput(env.CATALOGUE_BUCKET, configurationRevision, sweepResult), nowUtc)
    await releaseLease(env.CATALOGUE_BUCKET, runId, lease.etag, nowUtc)
  }
}

/** The control state as the run left it, for the alert evaluation after the
 *  sweep step; an unreadable object is `invalid`, a failed read unobserved. */
async function finishAlertInput(bucket: R2BucketLike, configurationRevision: string, result: GpSweepStepResult | null): Promise<ProducerAlertInput> {
  const read = async <T>(reader: () => Promise<T>): Promise<T | 'invalid' | undefined> => {
    try { return await reader() } catch (error) { return error instanceof ControlStateInvalidError ? 'invalid' : undefined }
  }
  const sweepState = await read(() => readGpSweepState(bucket))
  const providerState = await read(() => readProviderState(bucket))
  // A record for another configuration revision no longer blocks anything.
  const current = providerState && providerState !== 'invalid' && providerState.configurationRevision !== configurationRevision ? null : providerState
  return { stage: 'finish', sweepState, providerState: current, result, featuredIds: CURATED_CATALOGUE.featured }
}

/** One hourly step of the automatic-catalogue sweep: at most one provider page
 *  request, and publication only when that page completes a sweep. */
async function runSweepInvocation(
  env: CatalogueWorkerEnv, provider: GpSweepProvider, usesUpstream: boolean, providerState: ProviderState | null,
  configurationRevision: string, nowUtc: string, runId: string, live: Awaited<ReturnType<typeof readLiveCatalogue>>,
): Promise<GpSweepStepResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
  // A failed curated supplement never fails the step; its
  // provider protection is applied here after the step, whether the step then
  // published, held, or threw for a publication retry.
  let supplementError = null as ProviderFetchError | null
  const applyProtection = async (error: ProviderFetchError): Promise<void> => {
    const failureState = usesUpstream ? sweepProviderFailureState(error, providerState, configurationRevision, nowUtc) : null
    if (!failureState) return
    try { await writeProviderState(env.CATALOGUE_BUCKET, failureState) }
    catch (stateError) { console.error(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'provider-state', outcome: 'write_failed', reason: safeReason(stateError) })) }
  }
  let result
  try {
    result = await runGpSweepStep({ bucket: env.CATALOGUE_BUCKET, provider, usesUpstream, configurationRevision, nowUtc, runId, live, signal: controller.signal, onSupplementProviderFailure: (error) => { supplementError = error } })
  } catch (error) {
    // Only an authentication, rate-limit or configuration failure changes
    // provider protection state (sweepProviderFailureState). Storage or
    // publication errors leave the sweep where it was for the next hourly
    // invocation.
    const providerError = error instanceof ProviderFetchError ? error : supplementError
    if (providerError) await applyProtection(providerError)
    throw error
  } finally {
    clearTimeout(timeout)
  }
  const { kind, ...fields } = result
  const log = kind === 'publication-failed' || kind === 'held-for-review' || kind === 'discarded' ? console.warn : console.log
  log(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'gp-sweep', outcome: kind, providerId: provider.id, ...fields }))
  if (supplementError) {
    // After publication: a cooldown delays the next sweep, not this catalogue.
    // A failed request is no evidence of health, so healthy is not written.
    await applyProtection(supplementError)
    return result
  }
  if (usesUpstream && 'upstreamRequestCount' in result && result.upstreamRequestCount > 0 && providerState?.mode !== 'healthy') {
    await writeProviderState(env.CATALOGUE_BUCKET, { schemaVersion: 1, mode: 'healthy', configurationRevision, updatedAtUtc: nowUtc, retryAfterUtc: null, reason: result.kind })
  }
  return result
}

function publicationTestFault(value: string | undefined): PublicationTestFault | null {
  if (value === undefined || value === '') return null
  return value === 'r2-shard-write' || value === 'r2-manifest-write' || value === 'before-pointer-write' || value === 'pointer-cas-loss' ? value : null
}

/** How long the pipeline stays away from a provider that has just failed.
 *
 * A refused credential or a protection response is a reason to back off for a
 * day rather than to present the same rejected identity twice more before
 * anyone notices; an outage only needs to skip the next run. A configuration
 * fault latches until the configuration revision changes, because no amount of
 * waiting repairs a wrong endpoint. Data-integrity failures never reach here:
 * they happen after the provider phase and simply preserve the live catalogue
 * until the next schedule. */
const COOLDOWN_HOURS: Readonly<Record<Exclude<ProviderFailureKind, 'configuration'>, number>> = {
  authentication: 24,
  'rate-limit': 24,
  transient: 12,
  data: 12,
}

/** Provider protection for the hourly automatic sweep.
 *
 * The sweep already makes at most one GP request per hour, so an outage or a
 * malformed page needs nothing more: it consumes that hour's retrieval slot,
 * leaves the cursor unchanged, and the same cursor is tried at the next
 * ordinary hourly slot. A refused credential or a protection response (401,
 * 403, 429, a rejected login) is evidence that further requests could breach
 * provider policy: it backs off for a day, and the same class failing again
 * after that cooldown latches until an operator changes the configuration
 * revision. A configuration failure latches immediately. */
export const SWEEP_COOLDOWN_HOURS: Readonly<Record<'authentication' | 'rate-limit', number>> = { authentication: 24, 'rate-limit': 24 }

export function sweepProviderFailureState(error: ProviderFetchError, previous: ProviderState | null, configurationRevision: string, nowUtc: string): ProviderState | null {
  const { kind, status } = error
  if (kind === 'transient' || kind === 'data') return null
  if (kind === 'configuration') return { schemaVersion: 1, mode: 'config-fault', configurationRevision, updatedAtUtc: nowUtc, retryAfterUtc: null, reason: `configuration:${status ?? 'none'}` }
  const repeated = previous?.configurationRevision === configurationRevision && previous.mode === 'cooldown' && previous.reason.startsWith(`${kind}:`)
  if (repeated) return { schemaVersion: 1, mode: 'config-fault', configurationRevision, updatedAtUtc: nowUtc, retryAfterUtc: null, reason: `operator-required:${kind}:${status ?? 'none'}` }
  return { schemaVersion: 1, mode: 'cooldown', configurationRevision, updatedAtUtc: nowUtc, retryAfterUtc: new Date(Date.parse(nowUtc) + SWEEP_COOLDOWN_HOURS[kind] * 3_600_000).toISOString(), reason: `${kind}:${status ?? 'none'}` }
}

export function providerFailureState(error: unknown, configurationRevision: string, nowUtc: string): ProviderState {
  const kind: ProviderFailureKind = error instanceof ProviderFetchError ? error.kind : 'transient'
  const status = error instanceof ProviderFetchError ? error.status : null
  if (kind === 'configuration') {
    return { schemaVersion: 1, mode: 'config-fault', configurationRevision, updatedAtUtc: nowUtc, retryAfterUtc: null, reason: `configuration:${status ?? 'none'}` }
  }
  return {
    schemaVersion: 1, mode: 'cooldown', configurationRevision, updatedAtUtc: nowUtc,
    retryAfterUtc: new Date(Date.parse(nowUtc) + COOLDOWN_HOURS[kind] * 60 * 60 * 1000).toISOString(),
    reason: `${kind}:${status ?? 'none'}`,
  }
}

/** Failure text that is safe to write to a log.
 *
 * Provider errors carry constant messages by construction, but this run also
 * handles R2, integrity and decode failures, so the reason is truncated and
 * anything without a string message becomes an opaque marker rather than a
 * stringified object that might have picked up request details. */
function safeReason(error: unknown): string {
  if (error instanceof ProviderFetchError) return `${error.kind}:${error.status ?? 'none'}`
  return error instanceof Error && typeof error.message === 'string' ? error.message.slice(0, 180) : 'unknown'
}

export async function readLiveCatalogue(bucket: R2BucketLike): Promise<{ readonly manifest: CatalogueManifestV1; readonly etag: string | null } | null> {
  const pointerObject = await bucket.get('catalog/v1/current.json')
  if (!pointerObject) return null
  const pointerBytes = await bytesFromObject(pointerObject)
  if (!pointerBytes) throw new Error('The published catalogue pointer has no body.')
  let pointer
  try { pointer = decodeCataloguePointer(JSON.parse(new TextDecoder().decode(pointerBytes))) } catch { throw new Error('The published catalogue pointer is invalid; refusing to fetch or overwrite it.') }
  const manifestObject = await bucket.get(pointer.manifestPath.replace(/^\/+/, ''))
  const manifestBytes = manifestObject ? await bytesFromObject(manifestObject) : null
  if (!manifestBytes) throw new Error('The published catalogue manifest is unavailable; refusing to fetch or overwrite it.')
  if (await sha256Hex(manifestBytes) !== pointer.manifestSha256) throw new Error('The published catalogue manifest checksum is invalid; refusing to fetch or overwrite it.')
  let manifest
  try { manifest = decodeCatalogueManifest(JSON.parse(new TextDecoder().decode(manifestBytes))) } catch { throw new Error('The published catalogue manifest is invalid; refusing to fetch or overwrite it.') }
  if (manifest.snapshotId !== pointer.snapshotId) throw new Error('The published catalogue pointer and manifest disagree; refusing to fetch or overwrite them.')
  return { manifest, etag: pointerObject.etag ?? pointerObject.httpEtag ?? null }
}

async function bytesFromObject(object: R2ObjectLike): Promise<ArrayBuffer | null> {
  return object.body ? new Response(object.body).arrayBuffer() : null
}

export async function readProviderState(bucket: R2BucketLike): Promise<ProviderState | null> {
  const object = await bucket.get(PROVIDER_STATE_KEY)
  if (!object?.body) return null
  try {
    const value = JSON.parse(new TextDecoder().decode(await new Response(object.body).arrayBuffer())) as Partial<ProviderState>
    if (value.schemaVersion !== 1 || (value.mode !== 'healthy' && value.mode !== 'cooldown' && value.mode !== 'config-fault') || typeof value.configurationRevision !== 'string' || typeof value.updatedAtUtc !== 'string' || (value.retryAfterUtc !== null && typeof value.retryAfterUtc !== 'string') || typeof value.reason !== 'string') throw new Error('invalid provider state')
    return value as ProviderState
  } catch { throw new ControlStateInvalidError('The provider control state is invalid; refusing a provider run.') }
}

async function writeProviderState(bucket: R2BucketLike, state: ProviderState): Promise<void> {
  await bucket.put(PROVIDER_STATE_KEY, stableJson(state), { httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' } })
}
