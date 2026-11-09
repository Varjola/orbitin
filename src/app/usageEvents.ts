import type { ProductMode, SceneMode } from '../state/AppState.ts'

/** Anonymous, cookieless usage and error events.
 *
 * The page records a few coarse facts ("the satellite list loaded", "a link
 * was shared", "the 3D view failed") and sends them to the same origin's
 * write-only `POST /events/v1`. There is no identifier, no timestamp, no
 * search text and no free text: every property is one of the values the
 * Worker's allowlist (`workers/frontend/usageEventSchema.ts`) accepts. The
 * queue lives only in memory for the page's lifetime.
 *
 * Nothing is sent from the development server or tests, from a build made
 * with `VITE_ORBITIN_USAGE_EVENTS=off`, or when the browser signals Global
 * Privacy Control or Do Not Track. */
export type UsageEvent =
  | { readonly type: 'visit'; readonly presentation: 'desktop' | 'mobile'; readonly locale: 'en' | 'fi'; readonly entry: 'plain' | 'scene-link' | 'example' }
  | { readonly type: 'mode'; readonly mode: ProductMode }
  | { readonly type: 'orbit_created'; readonly preset: 'leo' | 'meo' | 'geo' | 'heo' | 'polar' | 'elliptical' | 'sso' | 'custom' }
  | { readonly type: 'catalogue_loaded'; readonly time: 'under-1s' | '1-3s' | '3-10s' | 'over-10s' }
  | { readonly type: 'catalogue_failed'; readonly status: 'network' | 'http-4xx' | 'http-5xx' | 'invalid' | 'other' }
  | { readonly type: 'search'; readonly results: '0' | '1' | '2-8' | '9+' }
  | { readonly type: 'object_added'; readonly source: 'quick-search' | 'catalogue' | 'group' | 'featured' | 'manual'; readonly norad?: string }
  | { readonly type: 'group_added'; readonly group: string }
  | { readonly type: 'example_opened'; readonly example: string }
  | { readonly type: 'share'; readonly kind: 'link' | 'file' | 'native'; readonly mode: SceneMode; readonly objects: '0' | '1' | '2-10' | '11-40' | '41+' }
  | { readonly type: 'scene_opened'; readonly kind: 'link' | 'file' | 'example'; readonly mode: SceneMode }
  | { readonly type: 'maneuver_result'; readonly outcome: 'won' | 'reentered' | 'restarted' | 'new-game'; readonly burns: '0' | '1-2' | '3-5' | '6-10' | '11+'; readonly efficiency?: 'under-1.2' | '1.2-1.5' | '1.5-2' | 'over-2' }
  | { readonly type: 'route_planned'; readonly limits: 'none' | 'time' | 'fuel' | 'both'; readonly family: 'direct' | 'turnAtNode' | 'goHigh' | 'drift'; readonly deltaV: 'under-100' | '100-500' | '500-1000' | '1000-3000' | '3000-6000' | 'over-6000'; readonly duration: 'under-6h' | '6-24h' | '1-7d' | '7-30d' | 'over-30d'; readonly sources: 'example' | 'catalogue' | 'mixed' }
  | { readonly type: 'view'; readonly which: 'map-maximized' | 'language' }
  | { readonly type: 'error'; readonly kind: UsageErrorKind }

export type UsageErrorKind = 'webgl' | 'textures' | 'context-lost' | 'frame' | 'uncaught' | 'rejection'

export const USAGE_EVENTS_ENDPOINT = '/events/v1'
/** One batch never exceeds the Worker's limit; later events wait for the next. */
export const MAX_QUEUED_EVENTS = 40
const FIRST_FLUSH_MS = 60_000

/** Events recorded at most once per page load: the first entry to a mode, a
 *  kind of error, a view change. */
const ONCE_PER_LOAD: ReadonlySet<UsageEvent['type']> = new Set(['visit', 'mode', 'error', 'view'])

export interface UsageTransport {
  /** Hands one batch to the browser; false if it was not accepted. */
  send(body: string): boolean
}

/** The pure queue: records, deduplicates and batches. */
export class UsageEventQueue {
  private queue: UsageEvent[] = []
  private readonly seen = new Set<string>()
  private readonly enabled: boolean
  private readonly transport: UsageTransport

  constructor(enabled: boolean, transport: UsageTransport) {
    this.enabled = enabled
    this.transport = transport
  }

  record(event: UsageEvent): void {
    if (!this.enabled) return
    if (ONCE_PER_LOAD.has(event.type)) {
      const key = JSON.stringify(event)
      if (this.seen.has(key)) return
      this.seen.add(key)
    }
    if (this.queue.length < MAX_QUEUED_EVENTS) this.queue.push(event)
  }

  /** Sends what is queued as one batch. A refused batch is dropped rather
   *  than retried: these are statistics, not records. */
  flush(): void {
    if (!this.enabled || this.queue.length === 0) return
    const events = this.queue
    this.queue = []
    this.transport.send(JSON.stringify({ events }))
  }

  get pending(): readonly UsageEvent[] { return this.queue }
}

/** Coarse buckets, so no exact count or duration is sent. */
export function loadTimeBucket(milliseconds: number): Extract<UsageEvent, { type: 'catalogue_loaded' }>['time'] {
  return milliseconds < 1000 ? 'under-1s' : milliseconds < 3000 ? '1-3s' : milliseconds < 10_000 ? '3-10s' : 'over-10s'
}
export function resultCountBucket(count: number): Extract<UsageEvent, { type: 'search' }>['results'] {
  return count <= 0 ? '0' : count === 1 ? '1' : count <= 8 ? '2-8' : '9+'
}
export function objectCountBucket(count: number): Extract<UsageEvent, { type: 'share' }>['objects'] {
  return count <= 0 ? '0' : count === 1 ? '1' : count <= 10 ? '2-10' : count <= 40 ? '11-40' : '41+'
}
export function burnCountBucket(count: number): Extract<UsageEvent, { type: 'maneuver_result' }>['burns'] {
  return count <= 0 ? '0' : count <= 2 ? '1-2' : count <= 5 ? '3-5' : count <= 10 ? '6-10' : '11+'
}
/** Δv used over the Hohmann minimum. */
export function efficiencyBucket(ratio: number): NonNullable<Extract<UsageEvent, { type: 'maneuver_result' }>['efficiency']> {
  return ratio < 1.2 ? 'under-1.2' : ratio < 1.5 ? '1.2-1.5' : ratio < 2 ? '1.5-2' : 'over-2'
}
export function routeDeltaVBucket(kmPerSecond: number): Extract<UsageEvent, { type: 'route_planned' }>['deltaV'] {
  return kmPerSecond < 0.1 ? 'under-100' : kmPerSecond < 0.5 ? '100-500' : kmPerSecond < 1 ? '500-1000' : kmPerSecond < 3 ? '1000-3000' : kmPerSecond < 6 ? '3000-6000' : 'over-6000'
}
export function routeDurationBucket(seconds: number): Extract<UsageEvent, { type: 'route_planned' }>['duration'] {
  const hours = seconds / 3600
  return hours < 6 ? 'under-6h' : hours < 24 ? '6-24h' : hours < 7 * 24 ? '1-7d' : hours < 30 * 24 ? '7-30d' : 'over-30d'
}
export function httpStatusClass(status: number | undefined): Extract<UsageEvent, { type: 'catalogue_failed' }>['status'] {
  if (status === undefined) return 'other'
  return status >= 500 ? 'http-5xx' : status >= 400 ? 'http-4xx' : 'other'
}

/** True when the browser asks not to be tracked. */
export function privacySignalSet(navigatorRef: Navigator | undefined): boolean {
  if (!navigatorRef) return true
  const signals = navigatorRef as Navigator & { readonly globalPrivacyControl?: boolean; readonly doNotTrack?: string | null }
  return signals.globalPrivacyControl === true || signals.doNotTrack === '1' || signals.doNotTrack === 'yes'
}

let instance: UsageEventQueue | null = null

/** The page's one queue. It flushes when the page is hidden and once after
 *  the first minute, so a long visit still reports and a short one is not
 *  lost. */
export function usageEvents(): UsageEventQueue {
  if (instance) return instance
  const view = typeof window === 'undefined' ? undefined : window
  const enabled = import.meta.env.PROD && __ORBITIN_USAGE_EVENTS__ && !privacySignalSet(view?.navigator) && typeof view?.navigator.sendBeacon === 'function'
  instance = new UsageEventQueue(enabled, {
    send: (body) => {
      try { return view!.navigator.sendBeacon(USAGE_EVENTS_ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' })) } catch { return false }
    },
  })
  if (enabled && view) {
    const queue = instance
    view.document.addEventListener('visibilitychange', () => { if (view.document.visibilityState === 'hidden') queue.flush() })
    view.setTimeout(() => queue.flush(), FIRST_FLUSH_MS)
  }
  return instance
}

/** Shorthand for recording one event on the page's queue. */
export function recordUsage(event: UsageEvent): void { usageEvents().record(event) }
