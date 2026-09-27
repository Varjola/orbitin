/** Operator e-mail alerts shared by the catalogue producer and its monitor.
 *
 * Mail is sent through a Cloudflare `send_email` binding declared by name
 * only. Such a binding reaches only destination addresses verified in the
 * deploying Cloudflare account, and the recipient and sender are Worker
 * secrets, so no address is in the repository and a clone deployed elsewhere
 * cannot mail this project's operator. A Worker sends only when the binding
 * and both secrets are present; otherwise alerts are off and nothing else
 * changes.
 *
 * Alert state is a small ledger of conditions (sent at onset, repeated while
 * active, and resolved once when they clear) and one-off events (sent once per
 * instance). Every function here but `deliverAlert` is pure; each Worker
 * stores its own ledger, since shared code holds no storage write. Messages are plain text built from constant titles, keys, ids, counts,
 * times and bounded reasons: never a provider payload, a credential or an
 * address. */

/** The `send_email` binding's message-builder form, as the installed runtime
 *  accepts it (`send({ from, to, subject, text })`). */
export interface AlertMailBinding {
  send(message: { readonly from: string; readonly to: string; readonly subject: string; readonly text: string }): Promise<unknown>
}

export interface AlertMailEnv {
  /** `send_email` binding, declared by name only. */
  readonly CATALOGUE_ALERT_EMAIL?: AlertMailBinding
  /** Worker secrets, set with `wrangler secret put`; never in configuration,
   *  never logged, never written to storage. */
  readonly CATALOGUE_ALERT_TO?: string
  readonly CATALOGUE_ALERT_FROM?: string
}

export interface AlertMailer {
  readonly binding: AlertMailBinding
  readonly to: string
  readonly from: string
}

/** One plain address: no display name, whitespace or line break, so it can
 *  never add a header or a second recipient. */
const ADDRESS = /^[^\s@<>(),;:"[\]\\]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

/** The mailer, or `null` when any piece is missing or malformed. */
export function alertMailer(env: AlertMailEnv): AlertMailer | null {
  const binding = env.CATALOGUE_ALERT_EMAIL
  const to = env.CATALOGUE_ALERT_TO?.trim() ?? ''
  const from = env.CATALOGUE_ALERT_FROM?.trim() ?? ''
  if (!binding || typeof binding.send !== 'function' || !ADDRESS.test(to) || !ADDRESS.test(from)) return null
  return { binding, to, from }
}

export const ALERT_SUBJECT_PREFIX = '[Orbitin catalogue]'
/** At most this many messages per rolling 24 hours per Worker. */
export const MAX_ALERTS_PER_DAY = 6
const DAY_MS = 86_400_000
const MAX_DETAIL = 300

export interface AlertCondition {
  readonly sinceUtc: string
  /** `null` until the onset message is sent. */
  readonly lastSentAtUtc: string | null
  readonly detail: string
}

export interface AlertEvent {
  readonly instance: string
  readonly atUtc: string
  readonly detail: string
  readonly sentAtUtc: string | null
}

export interface AlertLedger {
  readonly schemaVersion: 1
  readonly conditions: Readonly<Record<string, AlertCondition>>
  /** Cleared conditions whose resolved notice is still to be sent. */
  readonly resolved: Readonly<Record<string, { readonly sinceUtc: string; readonly resolvedAtUtc: string }>>
  /** The latest instance of each one-off event. */
  readonly events: Readonly<Record<string, AlertEvent>>
  readonly sendTimesUtc: readonly string[]
  /** Latest known facts included in every message body (ids, counts, dates). */
  readonly context: Readonly<Record<string, string>>
}

export const EMPTY_ALERT_LEDGER: AlertLedger = { schemaVersion: 1, conditions: {}, resolved: {}, events: {}, sendTimesUtc: [], context: {} }

/** What one evaluation saw. Keys not observed keep their previous state: a
 *  run that could not look at something neither raises nor clears it. */
export type AlertObservation =
  | { readonly kind: 'condition'; readonly key: string; readonly active: boolean; readonly detail?: string }
  | { readonly kind: 'event'; readonly key: string; readonly instance: string; readonly detail: string }

export interface AlertPolicy {
  /** Hours between repeats of an active condition. */
  repeatHours(key: string): number
  /** Constant human title of a key; never record content. */
  title(key: string): string
  /** Who is sending, for the first body line. */
  readonly source: string
}

export type AlertItem =
  | { readonly kind: 'onset' | 'repeat'; readonly key: string; readonly sinceUtc: string; readonly detail: string }
  | { readonly kind: 'resolved'; readonly key: string; readonly sinceUtc: string; readonly resolvedAtUtc: string }
  | { readonly kind: 'event'; readonly key: string; readonly atUtc: string; readonly detail: string }

export interface AlertPlan {
  /** The ledger to store when nothing is sent, or the send fails. */
  readonly observed: AlertLedger
  /** Present when something is due and the rate cap allows a message. */
  readonly message: { readonly subject: string; readonly text: string; readonly items: readonly AlertItem[] } | null
  /** The ledger to store after a successful send. */
  readonly sent: AlertLedger | null
  /** Something is due, but the rate cap holds it until later. */
  readonly suppressed: boolean
}

/** Folds observations into the ledger and decides whether a message is due. */
export function planAlert(previous: AlertLedger, observations: readonly AlertObservation[], nowUtc: string, policy: AlertPolicy, context: Readonly<Record<string, string>> = {}): AlertPlan {
  const now = Date.parse(nowUtc)
  const conditions: Record<string, AlertCondition> = { ...previous.conditions }
  const resolved: Record<string, { sinceUtc: string; resolvedAtUtc: string }> = { ...previous.resolved }
  const events: Record<string, AlertEvent> = { ...previous.events }
  for (const observation of observations) {
    if (observation.kind === 'event') {
      if (events[observation.key]?.instance !== observation.instance) events[observation.key] = { instance: observation.instance, atUtc: nowUtc, detail: bounded(observation.detail), sentAtUtc: null }
      continue
    }
    const existing = conditions[observation.key]
    if (observation.active) {
      delete resolved[observation.key]
      conditions[observation.key] = existing ? { ...existing, detail: bounded(observation.detail ?? existing.detail) } : { sinceUtc: nowUtc, lastSentAtUtc: null, detail: bounded(observation.detail ?? '') }
    } else if (existing) {
      delete conditions[observation.key]
      // Only a condition the operator was told about is resolved to them.
      if (existing.lastSentAtUtc !== null) resolved[observation.key] = { sinceUtc: existing.sinceUtc, resolvedAtUtc: nowUtc }
    }
  }
  const sendTimesUtc = previous.sendTimesUtc.filter((time) => now - Date.parse(time) < DAY_MS)
  const observed: AlertLedger = { schemaVersion: 1, conditions, resolved, events, sendTimesUtc, context: { ...previous.context, ...context } }

  const items: AlertItem[] = []
  for (const [key, condition] of sorted(conditions)) {
    if (condition.lastSentAtUtc === null) items.push({ kind: 'onset', key, sinceUtc: condition.sinceUtc, detail: condition.detail })
    else if (now - Date.parse(condition.lastSentAtUtc) >= policy.repeatHours(key) * 3_600_000) items.push({ kind: 'repeat', key, sinceUtc: condition.sinceUtc, detail: condition.detail })
  }
  for (const [key, event] of sorted(events)) if (event.sentAtUtc === null) items.push({ kind: 'event', key, atUtc: event.atUtc, detail: event.detail })
  for (const [key, entry] of sorted(resolved)) items.push({ kind: 'resolved', key, ...entry })
  if (items.length === 0) return { observed, message: null, sent: null, suppressed: false }
  if (sendTimesUtc.length >= MAX_ALERTS_PER_DAY) return { observed, message: null, sent: null, suppressed: true }

  const sentConditions = { ...conditions }
  const sentEvents = { ...events }
  for (const item of items) {
    if (item.kind === 'onset' || item.kind === 'repeat') sentConditions[item.key] = { ...conditions[item.key], lastSentAtUtc: nowUtc }
    if (item.kind === 'event') sentEvents[item.key] = { ...events[item.key], sentAtUtc: nowUtc }
  }
  const sent: AlertLedger = { ...observed, conditions: sentConditions, events: sentEvents, resolved: {}, sendTimesUtc: [...sendTimesUtc, nowUtc] }
  return { observed, sent, suppressed: false, message: { subject: subjectFor(items[0], policy), text: bodyFor(items, observed.context, nowUtc, policy), items } }
}

function subjectFor(first: AlertItem, policy: AlertPolicy): string {
  const lead = first.kind === 'resolved' ? `Resolved: ${policy.title(first.key)}` : policy.title(first.key)
  return `${ALERT_SUBJECT_PREFIX} ${lead}`.slice(0, 160)
}

function bodyFor(items: readonly AlertItem[], context: Readonly<Record<string, string>>, nowUtc: string, policy: AlertPolicy): string {
  const lines = [`Orbitin catalogue alert from ${policy.source} at ${nowUtc}.`, '']
  for (const item of items) {
    const title = `${policy.title(item.key)} [${item.key}]`
    if (item.kind === 'onset') lines.push(`NEW: ${title}`, `  since ${item.sinceUtc}`, `  ${item.detail}`)
    else if (item.kind === 'repeat') lines.push(`STILL ACTIVE: ${title}`, `  since ${item.sinceUtc}`, `  ${item.detail}`)
    else if (item.kind === 'event') lines.push(`EVENT: ${title}`, `  at ${item.atUtc}`, `  ${item.detail}`)
    else if (item.kind === 'resolved') lines.push(`RESOLVED: ${title}`, `  active from ${item.sinceUtc} to ${item.resolvedAtUtc}`)
    lines.push('')
  }
  const facts = sorted(context)
  if (facts.length > 0) {
    lines.push('Latest known state:')
    for (const [key, value] of facts) lines.push(`  ${key}: ${value}`)
    lines.push('')
  }
  lines.push('All times are UTC. The operations runbook explains each alert. Deleting either alert secret on this Worker stops its mail.')
  return lines.join('\n')
}

/** Bounded and single-line, whatever produced it. */
function bounded(detail: string): string {
  return detail.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, MAX_DETAIL)
}

function sorted<T>(record: Readonly<Record<string, T>>): [string, T][] {
  return Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

export type AlertDelivery = 'none' | 'sent' | 'suppressed' | 'send_failed'

/** Sends a planned message. A send failure is reported, never thrown: the
 *  alert stays due and is tried again at the next evaluation. */
export async function deliverAlert(mailer: AlertMailer, plan: AlertPlan): Promise<{ readonly delivery: AlertDelivery; readonly ledger: AlertLedger; readonly reason?: string }> {
  if (!plan.message) return { delivery: plan.suppressed ? 'suppressed' : 'none', ledger: plan.observed }
  try {
    await mailer.binding.send({ from: mailer.from, to: mailer.to, subject: plan.message.subject, text: plan.message.text })
    return { delivery: 'sent', ledger: plan.sent! }
  } catch (error) {
    // The runtime's message may name an address; only its class is kept.
    return { delivery: 'send_failed', ledger: plan.observed, reason: error instanceof Error ? error.name.slice(0, 60) : 'unknown' }
  }
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isTime = (value: unknown): value is string => typeof value === 'string' && ISO_UTC.test(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.length <= 1_000
const everyValue = (value: unknown, check: (entry: Record<string, unknown>) => boolean): boolean => isObject(value) && Object.values(value).every((entry) => isObject(entry) && check(entry))

export function validAlertLedger(value: unknown): value is AlertLedger {
  return isObject(value) && value.schemaVersion === 1
    && everyValue(value.conditions, (entry) => isTime(entry.sinceUtc) && (entry.lastSentAtUtc === null || isTime(entry.lastSentAtUtc)) && isText(entry.detail))
    && everyValue(value.resolved, (entry) => isTime(entry.sinceUtc) && isTime(entry.resolvedAtUtc))
    && everyValue(value.events, (entry) => isText(entry.instance) && isTime(entry.atUtc) && isText(entry.detail) && (entry.sentAtUtc === null || isTime(entry.sentAtUtc)))
    && Array.isArray(value.sendTimesUtc) && value.sendTimesUtc.length <= 100 && value.sendTimesUtc.every(isTime)
    && isObject(value.context) && Object.values(value.context).every(isText)
}

/** Parses a stored ledger object; `invalid` when it cannot be read as JSON. */
export async function parseJsonBody(body: ReadableStream<Uint8Array>): Promise<{ readonly value: unknown } | 'invalid'> {
  try { return { value: JSON.parse(new TextDecoder().decode(await new Response(body).arrayBuffer())) } } catch { return 'invalid' }
}
