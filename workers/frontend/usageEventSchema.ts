/** The complete allowlist of anonymous usage and error events the frontend
 * Worker accepts at `POST /events/v1`. Every property is a coarse, enumerated
 * or strictly patterned value; there is no free text, identifier, URL, search
 * text or timestamp. An event that is not described here exactly is dropped.
 *
 * The browser sends these through `src/app/usageEvents.ts`; a test there keeps
 * the two sides identical. Nothing here reads or stores anything about the
 * visitor: the Worker adds only the request's country and a coarse browser
 * family (see `index.ts`). */

type PropertyRule = readonly string[] | RegExp

interface EventRule {
  readonly required: Readonly<Record<string, PropertyRule>>
  readonly optional?: Readonly<Record<string, PropertyRule>>
}

const MODES = ['orbitLab', 'realObjects'] as const
const SHORT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
/** A NORAD catalogue number of a public catalogue object: data about the
 * object, not about the visitor. */
const NORAD_ID = /^[1-9]\d{0,8}$/

export const USAGE_EVENT_RULES: Readonly<Record<string, EventRule>> = {
  visit: { required: { presentation: ['desktop', 'mobile'], locale: ['en', 'fi'], entry: ['plain', 'scene-link', 'example'] } },
  mode: { required: { mode: MODES } },
  orbit_created: { required: { preset: ['leo', 'meo', 'geo', 'heo', 'polar', 'elliptical', 'sso', 'custom'] } },
  catalogue_loaded: { required: { time: ['under-1s', '1-3s', '3-10s', 'over-10s'] } },
  catalogue_failed: { required: { status: ['network', 'http-4xx', 'http-5xx', 'invalid', 'other'] } },
  search: { required: { results: ['0', '1', '2-8', '9+'] } },
  object_added: { required: { source: ['quick-search', 'catalogue', 'group', 'featured', 'manual'] }, optional: { norad: NORAD_ID } },
  group_added: { required: { group: SHORT_ID } },
  example_opened: { required: { example: SHORT_ID } },
  share: { required: { kind: ['link', 'file', 'native'], mode: MODES, objects: ['0', '1', '2-10', '11-40', '41+'] } },
  scene_opened: { required: { kind: ['link', 'file', 'example'], mode: MODES } },
  view: { required: { which: ['map-maximized', 'language'] } },
  error: { required: { kind: ['webgl', 'textures', 'context-lost', 'frame', 'uncaught', 'rejection'] } },
}

/** Request limits: one small batch, never a stream. */
export const MAX_EVENT_BODY_BYTES = 4096
export const MAX_EVENTS_PER_BATCH = 40

export interface ValidUsageEvent {
  readonly type: string
  /** Property values in the rule's declared order, required then optional;
   *  an absent optional property is an empty string. */
  readonly values: readonly string[]
}

function matches(rule: PropertyRule, value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) return false
  return Array.isArray(rule) ? rule.includes(value) : (rule as RegExp).test(value)
}

/** One event checked against the allowlist, or null. Unknown properties make
 *  the whole event invalid, so nothing unexpected can ride along. */
export function validateUsageEvent(input: unknown): ValidUsageEvent | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  const type = record.type
  if (typeof type !== 'string' || !Object.hasOwn(USAGE_EVENT_RULES, type)) return null
  const rule = USAGE_EVENT_RULES[type]
  const optional = rule.optional ?? {}
  for (const key of Object.keys(record)) {
    if (key !== 'type' && !Object.hasOwn(rule.required, key) && !Object.hasOwn(optional, key)) return null
  }
  const values: string[] = []
  for (const [key, propertyRule] of Object.entries(rule.required)) {
    if (!matches(propertyRule, record[key])) return null
    values.push(record[key] as string)
  }
  for (const [key, propertyRule] of Object.entries(optional)) {
    if (record[key] === undefined) { values.push(''); continue }
    if (!matches(propertyRule, record[key])) return null
    values.push(record[key] as string)
  }
  return { type, values }
}

/** The events of one batch body that pass the allowlist; invalid ones are
 *  dropped individually. Null when the body itself is malformed. */
export function parseUsageBatch(body: string): readonly ValidUsageEvent[] | null {
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { return null }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const events = (parsed as { readonly events?: unknown }).events
  if (!Array.isArray(events) || events.length > MAX_EVENTS_PER_BATCH) return null
  const valid: ValidUsageEvent[] = []
  for (const event of events) {
    const checked = validateUsageEvent(event)
    if (checked) valid.push(checked)
  }
  return valid
}

/** A coarse browser family from the User-Agent header. Only this label is
 *  stored; the header itself is not. */
export function browserFamily(userAgent: string | null): string {
  const ua = userAgent ?? ''
  if (/LinkedInApp/i.test(ua)) return 'linkedin-app'
  if (/FBAN|FBAV|Instagram/i.test(ua)) return 'social-app'
  if (/SamsungBrowser/i.test(ua)) return 'samsung'
  if (/Edg(?:e|A|iOS)?\//.test(ua)) return 'edge'
  if (/OPR\/|Opera/.test(ua)) return 'opera'
  if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox'
  if (/CriOS\/|Chrome\//.test(ua)) return /; wv\)/.test(ua) ? 'android-webview' : 'chrome'
  if (/iPhone|iPad|iPod/.test(ua)) return /Safari\//.test(ua) ? 'safari-ios' : 'ios-webview'
  if (/Safari\//.test(ua)) return 'safari'
  return 'other'
}
