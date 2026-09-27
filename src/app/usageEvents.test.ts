import { expect, it } from 'vitest'
import { USAGE_EVENT_RULES, validateUsageEvent } from '../../workers/frontend/usageEventSchema.ts'
import { httpStatusClass, loadTimeBucket, MAX_QUEUED_EVENTS, objectCountBucket, privacySignalSet, resultCountBucket, UsageEventQueue, usageEvents, type UsageEvent } from './usageEvents.ts'

/** One example of every event the application records, with every value of
 *  each enumerated property, so the client and the Worker allowlist cannot drift. */
const EXAMPLES: readonly UsageEvent[] = [
  { type: 'visit', presentation: 'desktop', locale: 'en', entry: 'plain' },
  { type: 'visit', presentation: 'mobile', locale: 'fi', entry: 'scene-link' },
  { type: 'visit', presentation: 'mobile', locale: 'en', entry: 'example' },
  { type: 'mode', mode: 'orbitLab' }, { type: 'mode', mode: 'realObjects' },
  ...(['leo', 'meo', 'geo', 'heo', 'polar', 'elliptical', 'sso', 'custom'] as const).map((preset) => ({ type: 'orbit_created', preset }) as const),
  ...[0, 1500, 5000, 20_000].map((ms) => ({ type: 'catalogue_loaded', time: loadTimeBucket(ms) }) as const),
  ...([undefined, 404, 503] as const).map((status) => ({ type: 'catalogue_failed', status: httpStatusClass(status) }) as const),
  { type: 'catalogue_failed', status: 'network' }, { type: 'catalogue_failed', status: 'invalid' },
  ...[0, 1, 5, 40].map((count) => ({ type: 'search', results: resultCountBucket(count) }) as const),
  { type: 'object_added', source: 'quick-search', norad: '25544' }, { type: 'object_added', source: 'featured', norad: '5' },
  { type: 'object_added', source: 'catalogue', norad: '100690' }, { type: 'object_added', source: 'group' }, { type: 'object_added', source: 'manual' },
  { type: 'group_added', group: 'gps-operational' },
  { type: 'example_opened', example: 'gps-now' },
  ...[0, 1, 5, 20, 90].map((count) => ({ type: 'share', kind: 'link', mode: 'realObjects', objects: objectCountBucket(count) }) as const),
  { type: 'share', kind: 'file', mode: 'orbitLab', objects: '1' }, { type: 'share', kind: 'native', mode: 'orbitLab', objects: '1' },
  { type: 'scene_opened', kind: 'link', mode: 'orbitLab' }, { type: 'scene_opened', kind: 'file', mode: 'realObjects' }, { type: 'scene_opened', kind: 'example', mode: 'realObjects' },
  { type: 'view', which: 'map-maximized' }, { type: 'view', which: 'language' },
  ...(['webgl', 'textures', 'context-lost', 'frame', 'uncaught', 'rejection'] as const).map((kind) => ({ type: 'error', kind }) as const),
]

it('records only events the Worker allowlist accepts, covering every event type', () => {
  for (const event of EXAMPLES) expect(validateUsageEvent(event), JSON.stringify(event)).not.toBeNull()
  expect(new Set(EXAMPLES.map((event) => event.type))).toEqual(new Set(Object.keys(USAGE_EVENT_RULES)))
})

it('batches, deduplicates once-per-load events and caps the queue', () => {
  const sent: string[] = []
  const queue = new UsageEventQueue(true, { send: (body) => { sent.push(body); return true } })
  queue.record({ type: 'mode', mode: 'realObjects' })
  queue.record({ type: 'mode', mode: 'realObjects' })
  queue.record({ type: 'error', kind: 'frame' })
  queue.record({ type: 'error', kind: 'frame' })
  queue.record({ type: 'object_added', source: 'group' })
  queue.record({ type: 'object_added', source: 'group' })
  queue.flush()
  expect(sent).toHaveLength(1)
  expect(JSON.parse(sent[0]).events).toEqual([
    { type: 'mode', mode: 'realObjects' }, { type: 'error', kind: 'frame' },
    { type: 'object_added', source: 'group' }, { type: 'object_added', source: 'group' },
  ])
  queue.flush()
  expect(sent).toHaveLength(1)
  for (let index = 0; index < MAX_QUEUED_EVENTS + 10; index += 1) queue.record({ type: 'search', results: '1' })
  expect(queue.pending).toHaveLength(MAX_QUEUED_EVENTS)
})

it('records and sends nothing while disabled', () => {
  const sent: string[] = []
  const queue = new UsageEventQueue(false, { send: (body) => { sent.push(body); return true } })
  queue.record({ type: 'mode', mode: 'orbitLab' })
  queue.flush()
  expect(queue.pending).toEqual([])
  expect(sent).toEqual([])
})

it('is disabled in tests and development, and honours Global Privacy Control and Do Not Track', () => {
  usageEvents().record({ type: 'mode', mode: 'orbitLab' })
  expect(usageEvents().pending).toEqual([])
  expect(privacySignalSet({ globalPrivacyControl: true } as unknown as Navigator)).toBe(true)
  expect(privacySignalSet({ doNotTrack: '1' } as unknown as Navigator)).toBe(true)
  expect(privacySignalSet({ doNotTrack: null } as unknown as Navigator)).toBe(false)
  expect(privacySignalSet(undefined)).toBe(true)
})
