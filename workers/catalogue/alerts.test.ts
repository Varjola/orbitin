import { afterEach, describe, expect, it, vi } from 'vitest'
import { ALERT_STATE_KEY, evaluateAlerts, type ProducerAlertInput } from './alerts.ts'
import { runIngestion } from './index.ts'
import type { GpSweepState, GpSweepStepResult } from './gpSweep.ts'
import { EMPTY_ALERT_LEDGER, type AlertLedger } from '../shared/alertMail.ts'
import { sha256Hex } from '../../src/data/catalogueSchema.ts'
import type { CatalogueWorkerEnv, R2BucketLike, R2ObjectLike } from './types.ts'

const NOW = '2026-09-27T01:17:00Z'
const SWEEP_ID = '20260926T161700Z-0badc0de'
const SNAPSHOT_ID = '20260927T011700Z-1a2b3c4d'
const FEATURED = ['25544', '60423']
const idle: GpSweepState = { schemaVersion: 1, lastGpRequestAtUtc: NOW, lastPageFailure: null, sweep: null, lastOutcome: null }
const PAGE = { index: 0, afterCatalogId: '0', firstCatalogId: '1', lastCatalogId: '9', recordCount: 9, byteLength: 10, sha256: '0'.repeat(64), retrievedAtUtc: NOW }
const withCandidate = (candidate: NonNullable<GpSweepState['sweep']>['candidate']): GpSweepState => ({ ...idle, sweep: { sweepId: SWEEP_ID, providerId: 'space-track', configurationRevision: 'r', pageLimit: 4000, startedAtUtc: NOW, completedAtUtc: NOW, candidate, pages: [PAGE] } })
const finish = (overrides: Partial<Extract<ProducerAlertInput, { stage: 'finish' }>> = {}): ProducerAlertInput => ({ stage: 'finish', sweepState: idle, providerState: null, result: null, featuredIds: FEATURED, ...overrides })
const published = (overrides: Partial<Extract<GpSweepStepResult, { kind: 'published' }>> = {}): GpSweepStepResult => ({
  kind: 'published', sweepId: SWEEP_ID, snapshotId: SNAPSHOT_ID, pageCount: 8, records: 31_876, approvedFindings: [], upstreamRequestCount: 3,
  supplement: { status: 'staged', failureKind: null, added: 3 }, curated: { featuredAbsent: [], featuredEpochs: { 25544: '2026-09-26', 60423: '2026-09-15' }, groupMembersAbsent: 0, supplemented: 3 }, ...overrides,
})
const keys = (input: ProducerAlertInput, previous: AlertLedger = EMPTY_ALERT_LEDGER, nowUtc = NOW) => evaluateAlerts(input, previous, nowUtc).message?.items.map((item) => `${item.kind}:${item.key}`) ?? []

describe('producer alert conditions', () => {
  it('catalogue-stale: a live catalogue older than 24 hours, evaluated at the start of the run', () => {
    expect(keys({ stage: 'start', live: { snapshotId: SNAPSHOT_ID, generatedAtUtc: '2026-09-26T01:17:00Z' } })).toEqual([])
    const plan = evaluateAlerts({ stage: 'start', live: { snapshotId: SNAPSHOT_ID, generatedAtUtc: '2026-09-26T01:16:00Z' } }, EMPTY_ALERT_LEDGER, NOW)
    expect(plan.message).toMatchObject({ subject: '[Orbitin catalogue] Live catalogue is stale', items: [{ kind: 'onset', key: 'catalogue-stale' }] })
    expect(plan.message!.text).toContain(`The live catalogue ${SNAPSHOT_ID} was generated at 2026-09-26T01:16:00Z, 24 hours ago.`)
    // No live catalogue yet (bootstrap): nothing to call stale.
    expect(keys({ stage: 'start', live: null })).toEqual([])
  })

  it('candidate-held and publication-failed follow the candidate status, and resolve when it leaves it', () => {
    const held = withCandidate({ status: 'held-for-review', publicationAttempts: 0, lastPublicationError: null, review: { heldAtUtc: NOW, contentDigest: 'a'.repeat(64), findings: ['published-count-drop'] }, approval: null })
    const plan = evaluateAlerts(finish({ sweepState: held }), EMPTY_ALERT_LEDGER, NOW)
    expect(plan.message?.items.map((item) => item.key)).toEqual(['candidate-held'])
    expect(plan.message!.text).toContain(`Sweep ${SWEEP_ID} is held for review (findings: published-count-drop; content digest ${'a'.repeat(64)})`)
    expect(keys(finish(), plan.sent!, '2026-09-27T02:17:00Z')).toEqual(['resolved:candidate-held'])

    const failed = withCandidate({ status: 'publication-failed', publicationAttempts: 3, lastPublicationError: { atUtc: NOW, reason: 'R2 unavailable' }, review: null, approval: null })
    const failedPlan = evaluateAlerts(finish({ sweepState: failed }), EMPTY_ALERT_LEDGER, NOW)
    expect(failedPlan.message?.items.map((item) => item.key)).toEqual(['publication-failed'])
    expect(failedPlan.message!.text).toContain('could not be published after 3 attempts (last error at 2026-09-27T01:17:00Z: R2 unavailable)')
  })

  it('candidate-discarded: once per sweep, only for this run’s structural discards', () => {
    const discarded = (reason: string, atUtc = NOW): GpSweepState => ({ ...idle, lastOutcome: { kind: 'discarded', sweepId: SWEEP_ID, atUtc, reason } })
    for (const reason of ['candidate-invalid: normalization refused the run (mixed-omm-version)', 'page-cap', 'expired']) {
      expect(keys(finish({ sweepState: discarded(reason) })), reason).toEqual(['event:candidate-discarded'])
    }
    for (const reason of ['configuration-changed', 'operator-discard:maintainer']) expect(keys(finish({ sweepState: discarded(reason) })), reason).toEqual([])
    expect(keys(finish({ sweepState: discarded('expired', '2026-09-27T00:17:00Z') }))).toEqual([])
    const sent = evaluateAlerts(finish({ sweepState: discarded('expired') }), EMPTY_ALERT_LEDGER, NOW).sent!
    expect(keys(finish({ sweepState: discarded('expired') }), sent)).toEqual([])
  })

  it('provider-blocked: a latched fault or a protection cooldown, not an expired or transient one', () => {
    expect(keys(finish({ providerState: { mode: 'config-fault', reason: 'operator-required:rate-limit:429', retryAfterUtc: null } }))).toEqual(['onset:provider-blocked'])
    expect(keys(finish({ providerState: { mode: 'cooldown', reason: 'authentication:403', retryAfterUtc: '2026-09-28T01:17:00.000Z' } }))).toEqual(['onset:provider-blocked'])
    expect(keys(finish({ providerState: { mode: 'cooldown', reason: 'rate-limit:429', retryAfterUtc: '2026-09-27T00:00:00.000Z' } }))).toEqual([])
    expect(keys(finish({ providerState: { mode: 'cooldown', reason: 'transient:503', retryAfterUtc: '2026-09-28T01:17:00.000Z' } }))).toEqual([])
    expect(keys(finish({ providerState: { mode: 'healthy', reason: 'published', retryAfterUtc: null } }))).toEqual([])
  })

  it('control-state-invalid: either control object refused; not observed when it could not be read', () => {
    expect(evaluateAlerts(finish({ sweepState: 'invalid' }), EMPTY_ALERT_LEDGER, NOW).message!.text).toContain('The GP sweep (catalog/v1/control/gp-sweep/state.json) control state is invalid.')
    expect(keys(finish({ providerState: 'invalid' }))).toEqual(['onset:control-state-invalid'])
    const raised = evaluateAlerts(finish({ sweepState: 'invalid' }), EMPTY_ALERT_LEDGER, NOW).sent!
    expect(keys(finish({ sweepState: undefined }), raised, '2026-09-27T02:17:00Z')).toEqual([])
    expect(keys(finish(), raised, '2026-09-27T02:17:00Z')).toEqual(['resolved:control-state-invalid'])
  })

  it('supplement-failed: once per sweep for the published catalogue', () => {
    const failed = published({ supplement: { status: 'failed', failureKind: 'rate-limit', added: 0 } })
    const plan = evaluateAlerts(finish({ result: failed }), EMPTY_ALERT_LEDGER, NOW)
    expect(plan.message?.items.map((item) => `${item.kind}:${item.key}`)).toEqual(['event:supplement-failed'])
    expect(plan.message!.text).toContain(`The curated supplement of sweep ${SWEEP_ID} failed (rate-limit); catalogue ${SNAPSHOT_ID} was published from the sweep alone.`)
    expect(keys(finish({ result: failed }), plan.sent!)).toEqual([])
    expect(keys(finish({ result: published() }))).toEqual([])
  })

  it('featured-absent: onset per id, weekly repeat, resolved when present again, and the curated facts in every body', () => {
    const absent = published({ curated: { featuredAbsent: ['60423'], featuredEpochs: { 25544: '2026-09-26' }, groupMembersAbsent: 2, supplemented: 1 } })
    const plan = evaluateAlerts(finish({ result: absent }), EMPTY_ALERT_LEDGER, NOW)
    expect(plan.message).toMatchObject({ subject: '[Orbitin catalogue] Featured pick 60423 absent from the catalogue', items: [{ kind: 'onset', key: 'featured-absent:60423' }] })
    expect(plan.message!.text).toContain('decayed, its newest element set is older than the supplement limit, or it is no longer listed')
    expect(plan.message!.text).toContain('  absentOfficialGroupMembers: 2')
    expect(plan.message!.text).toContain('  featuredEpochs: 25544 2026-09-26')
    expect(keys(finish({ result: absent }), plan.sent!, '2026-09-28T01:17:00Z')).toEqual([])
    expect(keys(finish({ result: absent }), plan.sent!, '2026-10-04T01:17:00Z')).toEqual(['repeat:featured-absent:60423'])
    expect(keys(finish({ result: published() }), plan.sent!, '2026-09-27T10:17:00Z')).toEqual(['resolved:featured-absent:60423'])
    // A run that published nothing says nothing about the featured picks.
    expect(evaluateAlerts(finish(), plan.sent!, '2026-09-27T10:17:00Z').observed.conditions).toHaveProperty('featured-absent:60423')
  })
})

// End to end through the scheduled run, with a fake send_email binding.

interface Stored { readonly bytes: Uint8Array; readonly etag: string }

function fakeBucket() {
  const objects = new Map<string, Stored>()
  let nextEtag = 0
  const describe = async (stored: Stored): Promise<R2ObjectLike> => ({ size: stored.bytes.byteLength, etag: stored.etag, httpEtag: stored.etag, checksums: { sha256: await sha256Hex(stored.bytes) }, body: new Response(new Uint8Array(stored.bytes).buffer).body! })
  const bucket: R2BucketLike = {
    async get(key) { const stored = objects.get(key); return stored ? describe(stored) : null },
    async head(key) { const stored = objects.get(key); return stored ? describe(stored) : null },
    async put(key, value, options) {
      const existing = objects.get(key)
      const onlyIf = (options as { onlyIf?: { etagDoesNotMatch?: string; etagMatches?: string } } | undefined)?.onlyIf
      if (onlyIf?.etagDoesNotMatch === '*' && existing) return null
      if (onlyIf?.etagMatches !== undefined && onlyIf.etagMatches !== existing?.etag) return null
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value)
      const stored = { bytes, etag: `etag-${nextEtag++}` }
      objects.set(key, stored)
      return describe(stored)
    },
    async delete(key) { objects.delete(key) },
    async list() { return { objects: [...objects.keys()].map((key) => ({ key })) } },
  }
  return { bucket, objects }
}

const TO = 'operator@example.com'
const FROM = 'catalogue-alerts@example.com'
const PASSWORD = 'not-a-real-password'

function mail() {
  const sent: { from: string; to: string; subject: string; text: string }[] = []
  let failing = false
  const binding = { async send(message: { from: string; to: string; subject: string; text: string }) { if (failing) throw new Error('send refused'); sent.push(message); return {} } }
  return { binding, sent, fail(value: boolean) { failing = value } }
}

function liveEnv(bucket: R2BucketLike, binding: ReturnType<typeof mail>['binding'], overrides: Partial<CatalogueWorkerEnv> = {}): CatalogueWorkerEnv {
  return {
    CATALOGUE_BUCKET: bucket, CATALOGUE_ENABLED: 'true', CATALOGUE_PROVIDER: 'space-track', CATALOGUE_RETRIEVAL: 'gp-sweep', CATALOGUE_CONFIG_REVISION: 'test-revision',
    SPACETRACK_IDENTITY: 'operator@example.invalid', SPACETRACK_PASSWORD: PASSWORD,
    CATALOGUE_ALERT_EMAIL: binding, CATALOGUE_ALERT_TO: TO, CATALOGUE_ALERT_FROM: FROM, ...overrides,
  }
}

function wire(id: number): Record<string, unknown> {
  return {
    CCSDS_OMM_VERS: '3.0', CREATION_DATE: '2026-09-13T06:26:37', ORIGINATOR: '18 SPCS', OBJECT_NAME: `SYNTHETIC ${id}`, OBJECT_ID: `2020-${String(id).padStart(3, '0')}A`,
    CENTER_NAME: 'EARTH', REF_FRAME: 'TEME', TIME_SYSTEM: 'UTC', MEAN_ELEMENT_THEORY: 'SGP4', EPOCH: '2026-09-12T22:41:08.689632',
    MEAN_MOTION: '15.49180977', ECCENTRICITY: '0.00016340', INCLINATION: '51.6446', RA_OF_ASC_NODE: '60.1', ARG_OF_PERICENTER: '35.3131', MEAN_ANOMALY: '60.2620',
    EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: String(id), ELEMENT_SET_NO: '999', REV_AT_EPOCH: '47210', BSTAR: '0.00001654', MEAN_MOTION_DOT: '0.00000915', MEAN_MOTION_DDOT: '0', OBJECT_TYPE: 'PAYLOAD',
  }
}

function upstream(gpStatus: () => number = () => 200) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/ajaxauth/login')) return new Response('""', { status: 200, headers: { 'set-cookie': 'chocolatechip=session; path=/' } })
    if (url.includes('/ajaxauth/logout')) return new Response('', { status: 200 })
    if (gpStatus() !== 200) return new Response('', { status: gpStatus() })
    const curated = /\/class\/gp\/NORAD_CAT_ID\/\d/.test(url)
    return new Response(JSON.stringify(curated ? [] : [wire(101), wire(102), wire(103)]), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}

const readJson = (objects: Map<string, Stored>, key: string) => JSON.parse(new TextDecoder().decode(objects.get(key)!.bytes))
const logs = () => {
  const lines: Record<string, unknown>[] = []
  for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation((line: unknown) => { try { lines.push(JSON.parse(String(line))) } catch { /* not ours */ } })
  return lines
}
const at = (hour: number) => new Date(Date.parse('2026-09-14T00:17:00Z') + hour * 3_600_000).toISOString()

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('producer alerts in the scheduled run', () => {
  it('are off, logged once, and leave no state unless a live provider, the binding and both secrets are present', async () => {
    const lines = logs()
    upstream()
    const { binding, sent } = mail()
    for (const overrides of [{ CATALOGUE_PROVIDER: 'fixture' }, { CATALOGUE_ALERT_TO: undefined }, { CATALOGUE_ALERT_FROM: '' }, { CATALOGUE_ALERT_EMAIL: undefined }] as Partial<CatalogueWorkerEnv>[]) {
      const { bucket, objects } = fakeBucket()
      lines.length = 0
      await runIngestion(liveEnv(bucket, binding, overrides), at(0))
      expect(lines.filter((line) => line.phase === 'alerts')).toEqual([expect.objectContaining({ outcome: 'disabled' })])
      expect(objects.has(ALERT_STATE_KEY)).toBe(false)
    }
    expect(sent).toEqual([])
  })

  it('raises a held first catalogue once, and never puts an address, credential or payload in the message', async () => {
    const lines = logs()
    upstream()
    const { bucket, objects } = fakeBucket()
    const { binding, sent } = mail()
    await runIngestion(liveEnv(bucket, binding), at(0))
    expect(sent).toEqual([])
    await runIngestion(liveEnv(bucket, binding), at(1))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: TO, from: FROM, subject: '[Orbitin catalogue] Catalogue candidate held for review' })
    for (const secret of [TO, FROM, PASSWORD, 'operator@example.invalid', 'SYNTHETIC', 'chocolatechip']) expect(sent[0].text).not.toContain(secret)
    expect(sent[0].text).not.toMatch(/@/)
    expect(lines).toContainEqual(expect.objectContaining({ phase: 'alerts', outcome: 'sent', keys: ['onset:candidate-held'] }))
    expect(JSON.stringify(lines.filter((line) => line.phase === 'alerts'))).not.toContain(TO)
    // Still held an hour later: nothing new until the daily repeat.
    await runIngestion(liveEnv(bucket, binding), at(2))
    expect(sent).toHaveLength(1)
    expect(readJson(objects, ALERT_STATE_KEY).conditions['candidate-held']).toMatchObject({ sinceUtc: at(1), lastSentAtUtc: at(1) })
  })

  it('sends at most one message per run: a stale catalogue at the start, the blocked provider at the next run', async () => {
    logs()
    upstream()
    const { bucket } = fakeBucket()
    const { binding, sent } = mail()
    // A catalogue published by the offline fixture 30 hours ago.
    await runIngestion(liveEnv(bucket, binding, { CATALOGUE_PROVIDER: 'fixture' }), at(0))
    await runIngestion(liveEnv(bucket, binding, { CATALOGUE_PROVIDER: 'fixture' }), at(0))
    await bucket.put('catalog/v1/control/provider-state.json', JSON.stringify({ schemaVersion: 1, mode: 'config-fault', configurationRevision: 'test-revision', updatedAtUtc: at(29), retryAfterUtc: null, reason: 'operator-required:rate-limit:429' }))

    await runIngestion(liveEnv(bucket, binding), at(30))
    expect(sent.map((message) => message.subject)).toEqual(['[Orbitin catalogue] Live catalogue is stale'])
    await runIngestion(liveEnv(bucket, binding), at(31))
    expect(sent.map((message) => message.subject)).toEqual(['[Orbitin catalogue] Live catalogue is stale', '[Orbitin catalogue] Space-Track requests blocked'])
    expect(sent[1].text).toContain('latched until an operator changes the configuration revision')
  })

  it('reports an invalid control state from the failed run', async () => {
    logs()
    upstream()
    const { bucket } = fakeBucket()
    const { binding, sent } = mail()
    await bucket.put('catalog/v1/control/gp-sweep/state.json', '{"schemaVersion":1,"sweep":"broken"}')
    await runIngestion(liveEnv(bucket, binding), at(0))
    expect(sent.map((message) => message.subject)).toEqual(['[Orbitin catalogue] Producer control state invalid'])
  })

  it('never lets a failed send change ingestion, and sends the alert at the next run', async () => {
    const lines = logs()
    upstream()
    const { bucket, objects } = fakeBucket()
    const { binding, sent, fail } = mail()
    await runIngestion(liveEnv(bucket, binding), at(0))
    fail(true)
    await runIngestion(liveEnv(bucket, binding), at(1))
    expect(readJson(objects, 'catalog/v1/control/gp-sweep/state.json').sweep.candidate.status).toBe('held-for-review')
    expect(lines).toContainEqual(expect.objectContaining({ phase: 'alerts', outcome: 'send_failed', reason: 'Error' }))
    expect(sent).toEqual([])
    fail(false)
    await runIngestion(liveEnv(bucket, binding), at(2))
    expect(sent.map((message) => message.subject)).toEqual(['[Orbitin catalogue] Catalogue candidate held for review'])
  })

  it('resets an invalid alert state instead of blocking the run', async () => {
    const lines = logs()
    upstream()
    const { bucket, objects } = fakeBucket()
    const { binding } = mail()
    await bucket.put(ALERT_STATE_KEY, '{"schemaVersion":7}')
    await runIngestion(liveEnv(bucket, binding), at(0))
    expect(lines).toContainEqual(expect.objectContaining({ phase: 'alerts', outcome: 'state_reset' }))
    expect(readJson(objects, ALERT_STATE_KEY)).toMatchObject({ schemaVersion: 1 })
    expect(readJson(objects, 'catalog/v1/control/gp-sweep/state.json').sweep.candidate.status).toBe('awaiting-publication')
  })
})
