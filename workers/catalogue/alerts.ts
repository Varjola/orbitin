import { alertMailer, deliverAlert, EMPTY_ALERT_LEDGER, parseJsonBody, planAlert, validAlertLedger, type AlertLedger, type AlertMailer, type AlertObservation, type AlertPlan, type AlertPolicy } from '../shared/alertMail.ts'
import type { GpSweepState, GpSweepStepResult } from './gpSweep.ts'
import type { CatalogueWorkerEnv, R2BucketLike } from './types.ts'

/** Producer operator alerts: conditions the
 *  producer can see about itself. A producer that crashes or stops running is
 *  reported by the monitor Worker instead.
 *
 * The alert ledger is its own control object, separate from the sweep state:
 * an invalid or missing ledger is reset and logged, never blocks a run, and an
 * earlier producer simply ignores it. Alerts never change ingestion: every
 * failure here is logged and swallowed. */

export const ALERT_STATE_KEY = 'catalog/v1/control/alerts.json'
/** The normal cycle is nine hours; a day without a new catalogue is a fault. */
export const CATALOGUE_STALE_HOURS = 24
const OPERATIONAL_REPEAT_HOURS = 24
const FEATURED_REPEAT_HOURS = 7 * 24
const FEATURED_PREFIX = 'featured-absent:'

const TITLES: Readonly<Record<string, string>> = {
  'catalogue-stale': 'Live catalogue is stale',
  'candidate-held': 'Catalogue candidate held for review',
  'publication-failed': 'Catalogue candidate publication failed',
  'candidate-discarded': 'Catalogue sweep discarded',
  'provider-blocked': 'Space-Track requests blocked',
  'control-state-invalid': 'Producer control state invalid',
  'supplement-failed': 'Curated supplement failed',
}

export const PRODUCER_ALERT_POLICY: AlertPolicy = {
  source: 'orbitin-catalogue',
  repeatHours: (key) => key.startsWith(FEATURED_PREFIX) ? FEATURED_REPEAT_HOURS : OPERATIONAL_REPEAT_HOURS,
  title: (key) => key.startsWith(FEATURED_PREFIX) ? `Featured pick ${key.slice(FEATURED_PREFIX.length)} absent from the catalogue` : TITLES[key] ?? 'Catalogue alert',
}

/** The provider protection record, as far as alerts read it. */
export interface ProviderStateView {
  readonly mode: string
  readonly reason: string
  readonly retryAfterUtc: string | null
}

/** What one evaluation point saw. `undefined` means not looked at; `invalid`
 *  means present but refused. */
export type ProducerAlertInput =
  | { readonly stage: 'start'; readonly live: { readonly snapshotId: string; readonly generatedAtUtc: string } | null }
  | {
    readonly stage: 'finish'
    readonly sweepState: GpSweepState | null | 'invalid' | undefined
    readonly providerState: ProviderStateView | null | 'invalid' | undefined
    readonly result: GpSweepStepResult | null
    readonly featuredIds: readonly string[]
  }

/** Pure: the observations and message plan for one evaluation point. */
export function evaluateAlerts(input: ProducerAlertInput, previous: AlertLedger, nowUtc: string): AlertPlan {
  const { observations, context } = producerObservations(input, nowUtc)
  return planAlert(previous, observations, nowUtc, PRODUCER_ALERT_POLICY, context)
}

export function producerObservations(input: ProducerAlertInput, nowUtc: string): { readonly observations: readonly AlertObservation[]; readonly context: Readonly<Record<string, string>> } {
  const observations: AlertObservation[] = []
  const context: Record<string, string> = {}
  if (input.stage === 'start') {
    // Before any heavy work, so a run that later crashes still reports it.
    if (input.live) {
      const hours = (Date.parse(nowUtc) - Date.parse(input.live.generatedAtUtc)) / 3_600_000
      context.liveSnapshotId = input.live.snapshotId
      context.liveGeneratedAtUtc = input.live.generatedAtUtc
      observations.push({ kind: 'condition', key: 'catalogue-stale', active: hours > CATALOGUE_STALE_HOURS, detail: `The live catalogue ${input.live.snapshotId} was generated at ${input.live.generatedAtUtc}, ${Math.floor(hours)} hours ago. A new catalogue normally appears every nine hours; the alert limit is ${CATALOGUE_STALE_HOURS}.` })
    }
    return { observations, context }
  }

  const { sweepState, providerState, result } = input
  if (sweepState !== undefined && providerState !== undefined) {
    const which = [sweepState === 'invalid' ? 'GP sweep (catalog/v1/control/gp-sweep/state.json)' : null, providerState === 'invalid' ? 'provider (catalog/v1/control/provider-state.json)' : null].filter(Boolean).join(' and ')
    observations.push({ kind: 'condition', key: 'control-state-invalid', active: which.length > 0, detail: `The ${which} control state is invalid. The producer refuses provider runs until an operator repairs or removes it.` })
  }

  if (sweepState !== undefined && sweepState !== 'invalid') {
    const sweep = sweepState?.sweep ?? null
    const candidate = sweep?.candidate ?? null
    observations.push({
      kind: 'condition', key: 'candidate-held', active: candidate?.status === 'held-for-review',
      detail: `Sweep ${sweep?.sweepId ?? 'none'} is held for review (findings: ${candidate?.review?.findings.join(', ') || 'none'}; content digest ${candidate?.review?.contentDigest ?? 'none'}). Approve or discard it with an operator action.`,
    })
    observations.push({
      kind: 'condition', key: 'publication-failed', active: candidate?.status === 'publication-failed',
      detail: `Sweep ${sweep?.sweepId ?? 'none'} could not be published after ${candidate?.publicationAttempts ?? 0} attempts (last error at ${candidate?.lastPublicationError?.atUtc ?? 'unknown'}: ${candidate?.lastPublicationError?.reason ?? 'unknown'}). Retry or discard it with an operator action.`,
    })
    const outcome = sweepState?.lastOutcome ?? null
    // Only a discard made by this run, and not one the operator or a
    // deliberate configuration change caused.
    if (outcome?.kind === 'discarded' && outcome.atUtc === nowUtc && outcome.reason !== 'configuration-changed' && !outcome.reason.startsWith('operator-discard')) {
      observations.push({ kind: 'event', key: 'candidate-discarded', instance: outcome.sweepId, detail: `Sweep ${outcome.sweepId} was discarded: ${outcome.reason}. The live catalogue is unchanged and the next hourly run starts a new sweep.` })
    }
  }

  if (providerState !== undefined && providerState !== 'invalid') {
    const blocked = providerState !== null && (providerState.mode === 'config-fault' || (providerState.mode === 'cooldown' && /^(?:authentication|rate-limit):/.test(providerState.reason) && providerState.retryAfterUtc !== null && Date.parse(providerState.retryAfterUtc) > Date.parse(nowUtc)))
    observations.push({
      kind: 'condition', key: 'provider-blocked', active: blocked,
      detail: `Provider protection state ${providerState?.mode ?? 'none'} (${providerState?.reason ?? 'none'})${providerState?.retryAfterUtc ? `; no Space-Track request before ${providerState.retryAfterUtc}` : '; latched until an operator changes the configuration revision'}.`,
    })
  }

  if (result?.kind === 'published') {
    context.snapshotId = result.snapshotId
    context.sweepId = result.sweepId
    context.absentOfficialGroupMembers = String(result.curated.groupMembersAbsent)
    context.featuredEpochs = Object.entries(result.curated.featuredEpochs).map(([id, date]) => `${id} ${date}`).join(', ') || 'none'
    context.supplement = result.supplement.status === 'failed' ? `failed (${result.supplement.failureKind})` : `${result.supplement.status}, ${result.supplement.added} added`
    if (result.supplement.status === 'failed') {
      observations.push({ kind: 'event', key: 'supplement-failed', instance: result.sweepId, detail: `The curated supplement of sweep ${result.sweepId} failed (${result.supplement.failureKind}); catalogue ${result.snapshotId} was published from the sweep alone. The next sweep tries again.` })
    }
    const absent = new Set(result.curated.featuredAbsent)
    for (const id of input.featuredIds) {
      observations.push({ kind: 'condition', key: `${FEATURED_PREFIX}${id}`, active: absent.has(id), detail: `Featured catalogue id ${id} is absent from catalogue ${result.snapshotId}: decayed, its newest element set is older than the supplement limit, or it is no longer listed. The producer cannot tell which without another request.` })
    }
  }
  return { observations, context }
}

/** One run's alert evaluations: at most one message per run, and alerts off
 *  unless the producer uses a live provider and the binding and both secrets
 *  are present. */
export class ProducerAlerts {
  private sentThisRun = false
  private readonly bucket: R2BucketLike
  private readonly mailer: AlertMailer
  private readonly runId: string

  private constructor(bucket: R2BucketLike, mailer: AlertMailer, runId: string) {
    this.bucket = bucket
    this.mailer = mailer
    this.runId = runId
  }

  /** `null`, logged once, when alerts are off for this run. */
  static create(env: CatalogueWorkerEnv, usesUpstream: boolean, runId: string): ProducerAlerts | null {
    const mailer = usesUpstream ? alertMailer(env) : null
    if (!mailer) {
      console.log(JSON.stringify({ event: 'catalogue_ingestion', runId, phase: 'alerts', outcome: 'disabled' }))
      return null
    }
    return new ProducerAlerts(env.CATALOGUE_BUCKET, mailer, runId)
  }

  async evaluate(input: ProducerAlertInput, nowUtc: string): Promise<void> {
    try {
      const previous = await this.readLedger()
      const plan = evaluateAlerts(input, previous, nowUtc)
      if (this.sentThisRun && plan.message) {
        // Already one message this run: keep what was seen, send next run.
        await writeJsonObject(this.bucket, ALERT_STATE_KEY, plan.observed)
        return
      }
      const { delivery, ledger, reason } = await deliverAlert(this.mailer, plan)
      await writeJsonObject(this.bucket, ALERT_STATE_KEY, ledger)
      if (delivery === 'sent') this.sentThisRun = true
      if (delivery !== 'none') {
        const log = delivery === 'sent' ? console.log : console.warn
        log(JSON.stringify({ event: 'catalogue_ingestion', runId: this.runId, phase: 'alerts', outcome: delivery, keys: plan.message?.items.map((item) => `${item.kind}:${item.key}`) ?? [], ...(reason ? { reason } : {}) }))
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'catalogue_ingestion', runId: this.runId, phase: 'alerts', outcome: 'failed', reason: error instanceof Error ? error.message.slice(0, 180) : 'unknown' }))
    }
  }

  private async readLedger(): Promise<AlertLedger> {
    const stored = await readJsonObject(this.bucket, ALERT_STATE_KEY)
    if (stored === 'absent') return EMPTY_ALERT_LEDGER
    if (stored !== 'invalid' && validAlertLedger(stored.value)) return stored.value
    console.warn(JSON.stringify({ event: 'catalogue_ingestion', runId: this.runId, phase: 'alerts', outcome: 'state_reset' }))
    return EMPTY_ALERT_LEDGER
  }
}

async function readJsonObject(bucket: R2BucketLike, key: string): Promise<{ readonly value: unknown } | 'absent' | 'invalid'> {
  const object = await bucket.get(key)
  return object?.body ? parseJsonBody(object.body) : 'absent'
}

async function writeJsonObject(bucket: R2BucketLike, key: string, value: unknown): Promise<void> {
  const stored = await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' } })
  if (!stored) throw new Error('An alert state object could not be written.')
}
