import { alertMailer, deliverAlert, EMPTY_ALERT_LEDGER, parseJsonBody, planAlert, validAlertLedger, type AlertLedger, type AlertMailEnv, type AlertObservation, type AlertPolicy } from '../shared/alertMail.ts'
import type { R2BucketLike } from '../shared/types.ts'

/** orbitin-catalogue-monitor: the producer's Tail
 *  Worker. The entry point (`index.ts`) exports only the handlers; the
 *  runtime refuses any other named export of an entry module. It reports what the producer cannot report about itself: an
 *  invocation that ended in anything but `ok` (killed for CPU or memory, an
 *  uncaught exception, canceled) and a producer that has stopped running.
 *
 * It binds only its own bucket, never the catalogue bucket, and holds no
 * Space-Track secret: it has no power over catalogue data. From each trace
 * item it keeps only the time, the outcome and an exception's name and
 * truncated message, never the producer's logs. Without the alert binding and
 * both secrets it records heartbeats and sends nothing. */

export const PRODUCER_SCRIPT_NAME = 'orbitin-catalogue'
export const MONITOR_STATE_KEY = 'monitor/state.json'
/** The producer's Cron is hourly; three silent hours is a fault. */
export const PRODUCER_SILENCE_HOURS = 3
const REPEAT_HOURS = 24
const MAX_EXCEPTION_MESSAGE = 180

export interface MonitorWorkerEnv extends AlertMailEnv {
  readonly MONITOR_BUCKET: R2BucketLike
}

/** The fields of a Workers trace item this Worker reads. */
export interface ProducerTraceItem {
  readonly scriptName: string | null
  readonly eventTimestamp: number | null
  /** `ok`, `exception`, `exceededCpu`, `exceededMemory`, `canceled`,
   *  `scriptNotFound`, `responseStreamDisconnected` or `unknown`. */
  readonly outcome: string
  readonly exceptions?: readonly { readonly name?: unknown; readonly message?: unknown }[]
}

export interface MonitorState {
  readonly schemaVersion: 1
  readonly startedAtUtc: string
  readonly lastProducerEventAtUtc: string | null
  readonly lastOutcome: string | null
  readonly consecutiveNonOk: number
  readonly alerts: AlertLedger
}

const TITLES: Readonly<Record<string, string>> = {
  'producer-crashed': 'Catalogue producer invocation failed',
  'producer-silent': 'Catalogue producer has stopped running',
}

export const MONITOR_ALERT_POLICY: AlertPolicy = {
  source: 'orbitin-catalogue-monitor',
  repeatHours: () => REPEAT_HOURS,
  title: (key) => TITLES[key] ?? 'Catalogue monitor alert',
}

/** Pure: the state after a batch of trace items, and what it observed. */
export function observeProducerEvents(previous: MonitorState | null, events: readonly ProducerTraceItem[], nowUtc: string): { readonly state: MonitorState; readonly observations: readonly AlertObservation[] } | null {
  const producer = events.filter((item) => item.scriptName === PRODUCER_SCRIPT_NAME).sort((a, b) => (a.eventTimestamp ?? 0) - (b.eventTimestamp ?? 0))
  if (producer.length === 0) return null
  let consecutiveNonOk = previous?.consecutiveNonOk ?? 0
  for (const item of producer) consecutiveNonOk = item.outcome === 'ok' ? 0 : consecutiveNonOk + 1
  const latest = producer.at(-1)!
  const atUtc = latest.eventTimestamp !== null && Number.isFinite(latest.eventTimestamp) ? new Date(latest.eventTimestamp).toISOString() : nowUtc
  const state: MonitorState = { ...(previous ?? initialState(nowUtc)), lastProducerEventAtUtc: atUtc, lastOutcome: latest.outcome.slice(0, 40), consecutiveNonOk }
  const exception = [...producer].reverse().flatMap((item) => item.exceptions ?? []).at(0)
  const exceptionText = exception ? ` (${String(exception.name ?? 'Error').slice(0, 60)}: ${String(exception.message ?? '').replace(/\s+/g, ' ').slice(0, MAX_EXCEPTION_MESSAGE)})` : ''
  return {
    state,
    observations: [
      { kind: 'condition', key: 'producer-crashed', active: latest.outcome !== 'ok', detail: `The latest orbitin-catalogue invocation, at ${atUtc}, ended with outcome ${state.lastOutcome}${latest.outcome === 'ok' ? '' : exceptionText}; ${consecutiveNonOk} consecutive invocation(s) did not end ok.` },
      // A producer invocation was seen, so it is not silent.
      { kind: 'condition', key: 'producer-silent', active: false },
    ],
  }
}

/** Pure: the silence check of the monitor's own hourly Cron. */
export function observeProducerSilence(previous: MonitorState | null, nowUtc: string): { readonly state: MonitorState; readonly observations: readonly AlertObservation[] } {
  const state = previous ?? initialState(nowUtc)
  const reference = state.lastProducerEventAtUtc ?? state.startedAtUtc
  const hours = (Date.parse(nowUtc) - Date.parse(reference)) / 3_600_000
  const since = state.lastProducerEventAtUtc ? `the last one, at ${reference}` : `the monitor started at ${reference}`
  return {
    state,
    observations: [{ kind: 'condition', key: 'producer-silent', active: hours >= PRODUCER_SILENCE_HOURS, detail: `No orbitin-catalogue invocation has been seen since ${since} (${Math.floor(hours)} hours; the producer runs every hour at minute 17). Check its Cron Trigger, its deployment and its tail_consumers entry.` }],
  }
}

function initialState(nowUtc: string): MonitorState {
  return { schemaVersion: 1, startedAtUtc: nowUtc, lastProducerEventAtUtc: null, lastOutcome: null, consecutiveNonOk: 0, alerts: EMPTY_ALERT_LEDGER }
}

export async function recordProducerEvents(env: MonitorWorkerEnv, events: readonly ProducerTraceItem[], nowUtc: string): Promise<void> {
  await withState(env, 'tail', nowUtc, (previous) => observeProducerEvents(previous, events, nowUtc))
}

export async function checkProducerSilence(env: MonitorWorkerEnv, nowUtc: string): Promise<void> {
  await withState(env, 'scheduled', nowUtc, (previous) => observeProducerSilence(previous, nowUtc))
}

/** Read, observe, alert at most once, write. Nothing here throws out of the
 *  handler: a failure is logged and the next invocation starts again.
 *  The tail handler runs just after the producer's minute-17 invocation and
 *  the Cron at minute 47, so the two do not overlap in normal operation; if
 *  they ever did, the later write wins and the next hour corrects it. */
async function withState(env: MonitorWorkerEnv, phase: 'tail' | 'scheduled', nowUtc: string, observe: (previous: MonitorState | null) => { readonly state: MonitorState; readonly observations: readonly AlertObservation[] } | null): Promise<void> {
  try {
    const previous = await readMonitorState(env.MONITOR_BUCKET, phase)
    const observed = observe(previous)
    if (!observed) return
    let alerts = observed.state.alerts
    const mailer = alertMailer(env)
    if (mailer) {
      const plan = planAlert(alerts, observed.observations, nowUtc, MONITOR_ALERT_POLICY)
      const delivered = await deliverAlert(mailer, plan)
      alerts = delivered.ledger
      if (delivered.delivery !== 'none') {
        const log = delivered.delivery === 'sent' ? console.log : console.warn
        log(JSON.stringify({ event: 'catalogue_monitor', phase, outcome: delivered.delivery, keys: plan.message?.items.map((item) => `${item.kind}:${item.key}`) ?? [], ...(delivered.reason ? { reason: delivered.reason } : {}) }))
      }
    } else if (phase === 'scheduled') {
      console.log(JSON.stringify({ event: 'catalogue_monitor', phase, outcome: 'alerts-disabled' }))
    }
    await writeJsonObject(env.MONITOR_BUCKET, MONITOR_STATE_KEY, { ...observed.state, alerts })
  } catch (error) {
    console.error(JSON.stringify({ event: 'catalogue_monitor', phase, outcome: 'failed', reason: error instanceof Error ? error.message.slice(0, 180) : 'unknown' }))
  }
}

async function readMonitorState(bucket: R2BucketLike, phase: string): Promise<MonitorState | null> {
  const stored = await readJsonObject(bucket, MONITOR_STATE_KEY)
  if (stored === 'absent') return null
  if (stored !== 'invalid' && validMonitorState(stored.value)) return stored.value
  // Reset rather than stop: the next hours rebuild it.
  console.warn(JSON.stringify({ event: 'catalogue_monitor', phase, outcome: 'state_reset' }))
  return null
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const isTime = (value: unknown): value is string => typeof value === 'string' && ISO_UTC.test(value)

export function validMonitorState(value: unknown): value is MonitorState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  return state.schemaVersion === 1 && isTime(state.startedAtUtc) && (state.lastProducerEventAtUtc === null || isTime(state.lastProducerEventAtUtc))
    && (state.lastOutcome === null || (typeof state.lastOutcome === 'string' && state.lastOutcome.length <= 40))
    && typeof state.consecutiveNonOk === 'number' && Number.isSafeInteger(state.consecutiveNonOk) && state.consecutiveNonOk >= 0
    && validAlertLedger(state.alerts)
}

async function readJsonObject(bucket: R2BucketLike, key: string): Promise<{ readonly value: unknown } | 'absent' | 'invalid'> {
  const object = await bucket.get(key)
  return object?.body ? parseJsonBody(object.body) : 'absent'
}

async function writeJsonObject(bucket: R2BucketLike, key: string, value: unknown): Promise<void> {
  const stored = await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' } })
  if (!stored) throw new Error('An alert state object could not be written.')
}
