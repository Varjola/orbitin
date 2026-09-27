import { afterEach, describe, expect, it, vi } from 'vitest'
import monitor from './index.ts'
import * as entry from './index.ts'
import { checkProducerSilence, MONITOR_STATE_KEY, recordProducerEvents, type MonitorWorkerEnv, type ProducerTraceItem } from './monitor.ts'
import type { R2BucketLike, R2ObjectLike } from '../shared/types.ts'

function fakeBucket() {
  const objects = new Map<string, Uint8Array>()
  const object = (bytes: Uint8Array): R2ObjectLike => ({ size: bytes.byteLength, body: new Response(new Uint8Array(bytes).buffer).body! })
  const bucket: R2BucketLike = {
    async get(key) { const bytes = objects.get(key); return bytes ? object(bytes) : null },
    async head(key) { const bytes = objects.get(key); return bytes ? object(bytes) : null },
    async put(key, value) { const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value as ArrayBuffer); objects.set(key, bytes); return object(bytes) },
    async delete(key) { objects.delete(key) },
    async list() { return { objects: [...objects.keys()].map((key) => ({ key })) } },
  }
  return { bucket, objects }
}

const T0 = Date.parse('2026-09-27T01:17:00Z')
const at = (hours: number, minutes = 0) => new Date(T0 + hours * 3_600_000 + minutes * 60_000).toISOString()
const item = (hours: number, outcome = 'ok', overrides: Partial<ProducerTraceItem> = {}): ProducerTraceItem => ({ scriptName: 'orbitin-catalogue', eventTimestamp: T0 + hours * 3_600_000, outcome, ...overrides })

function setup(configured = true) {
  const { bucket, objects } = fakeBucket()
  const sent: { from: string; to: string; subject: string; text: string }[] = []
  const binding = { async send(message: { from: string; to: string; subject: string; text: string }) { sent.push(message); return {} } }
  const env: MonitorWorkerEnv = configured ? { MONITOR_BUCKET: bucket, CATALOGUE_ALERT_EMAIL: binding, CATALOGUE_ALERT_TO: 'operator@example.com', CATALOGUE_ALERT_FROM: 'monitor@example.com' } : { MONITOR_BUCKET: bucket }
  const state = () => JSON.parse(new TextDecoder().decode(objects.get(MONITOR_STATE_KEY)!))
  return { env, sent, objects, state, subjects: () => sent.map((message) => message.subject) }
}

const quiet = () => { for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => undefined) }
afterEach(() => { vi.restoreAllMocks() })

describe('orbitin-catalogue-monitor', () => {
  it('exposes only fetch, tail and scheduled, and serves nothing', async () => {
    // The runtime refuses an entry module with any other named export.
    expect(Object.keys(entry)).toEqual(['default'])
    expect(Object.keys(monitor).sort()).toEqual(['fetch', 'scheduled', 'tail'])
    const response = await monitor.fetch()
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('ignores trace items of any other script', async () => {
    quiet()
    const { env, sent, objects } = setup()
    await recordProducerEvents(env, [item(0, 'exception', { scriptName: 'orbitin' }), item(0, 'exceededCpu', { scriptName: null })], at(0))
    expect(objects.size).toBe(0)
    expect(sent).toEqual([])
  })

  it.each(['exception', 'exceededCpu', 'exceededMemory', 'canceled', 'scriptNotFound', 'responseStreamDisconnected', 'unknown'])('alerts a producer invocation that ended %s, repeats daily and resolves once', async (outcome) => {
    quiet()
    const { env, subjects, sent, state } = setup()
    await recordProducerEvents(env, [item(0, outcome, { exceptions: [{ name: 'Error', message: `boom ${'x'.repeat(400)}` }] })], at(0))
    expect(subjects()).toEqual(['[Orbitin catalogue] Catalogue producer invocation failed'])
    expect(sent[0].text).toContain(`ended with outcome ${outcome} (Error: boom `)
    expect(sent[0].text.split('\n').every((line) => line.length <= 320)).toBe(true)
    expect(state()).toMatchObject({ lastOutcome: outcome, consecutiveNonOk: 1, lastProducerEventAtUtc: at(0) })

    await recordProducerEvents(env, [item(1, outcome)], at(1))
    expect(sent).toHaveLength(1)
    expect(state().consecutiveNonOk).toBe(2)
    await recordProducerEvents(env, [item(24, outcome)], at(24))
    expect(subjects()).toHaveLength(2)
    expect(sent[1].text).toContain('STILL ACTIVE: Catalogue producer invocation failed')
    await recordProducerEvents(env, [item(25)], at(25))
    expect(subjects().at(-1)).toBe('[Orbitin catalogue] Resolved: Catalogue producer invocation failed')
    await recordProducerEvents(env, [item(26)], at(26))
    expect(sent).toHaveLength(3)
    expect(state()).toMatchObject({ lastOutcome: 'ok', consecutiveNonOk: 0 })
  })

  it('sends at most one message for a batch, judged by its latest producer item', async () => {
    quiet()
    const { env, sent } = setup()
    await recordProducerEvents(env, [item(0, 'exceededCpu'), item(0.5, 'exception')], at(1))
    expect(sent).toHaveLength(1)
    await recordProducerEvents(env, [item(2, 'exception'), item(1.5)], at(2))
    expect(sent).toHaveLength(1)
  })

  it('reports a producer that has stopped running, including one never seen since the monitor started', async () => {
    quiet()
    const { env, subjects, sent, state } = setup()
    await checkProducerSilence(env, at(0))
    expect(state()).toMatchObject({ startedAtUtc: at(0), lastProducerEventAtUtc: null })
    await checkProducerSilence(env, at(2, 59))
    expect(sent).toEqual([])
    await checkProducerSilence(env, at(3))
    expect(subjects()).toEqual(['[Orbitin catalogue] Catalogue producer has stopped running'])
    expect(sent[0].text).toContain(`since the monitor started at ${at(0)}`)

    // A heartbeat resolves it at once.
    await recordProducerEvents(env, [item(3.5)], at(3.5))
    expect(subjects().at(-1)).toBe('[Orbitin catalogue] Resolved: Catalogue producer has stopped running')
    await checkProducerSilence(env, at(4))
    await checkProducerSilence(env, at(6, 29))
    expect(sent).toHaveLength(2)
    await checkProducerSilence(env, at(6, 30))
    expect(subjects().at(-1)).toBe('[Orbitin catalogue] Catalogue producer has stopped running')
    expect(sent.at(-1)!.text).toContain(`since the last one, at ${at(3.5)}`)
  })

  it('records heartbeats and sends nothing without the binding and both secrets', async () => {
    quiet()
    const { env, state } = setup(false)
    await recordProducerEvents(env, [item(0, 'exceededMemory')], at(0))
    await checkProducerSilence(env, at(10))
    expect(state()).toMatchObject({ lastOutcome: 'exceededMemory', consecutiveNonOk: 1, alerts: { conditions: {} } })
  })

  it('keeps only the outcome and a truncated exception, never the producer’s logs', async () => {
    quiet()
    const { env, objects } = setup()
    await recordProducerEvents(env, [{ ...item(0, 'exception', { exceptions: [{ name: 'TypeError', message: 'bad' }] }), logs: [{ message: ['SECRET-LOOKING LOG LINE'] }] } as ProducerTraceItem], at(0))
    const stored = new TextDecoder().decode(objects.get(MONITOR_STATE_KEY)!)
    expect(stored).not.toContain('SECRET-LOOKING')
    expect(stored).not.toContain('example.com')
  })

  it('resets an invalid state and carries on', async () => {
    const lines: string[] = []
    for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation((line: unknown) => { lines.push(String(line)) })
    const { env, objects, state } = setup()
    objects.set(MONITOR_STATE_KEY, new TextEncoder().encode('{"schemaVersion":1,"startedAtUtc":"x"}'))
    await checkProducerSilence(env, at(0))
    expect(lines.some((line) => line.includes('state_reset'))).toBe(true)
    expect(state()).toMatchObject({ schemaVersion: 1, startedAtUtc: at(0) })
  })

  it('runs its handlers through waitUntil', async () => {
    quiet()
    const { env, state } = setup()
    const waits: Promise<unknown>[] = []
    const context = { waitUntil(promise: Promise<unknown>) { waits.push(promise) } }
    await monitor.tail([item(0)], env, context)
    await Promise.all(waits)
    await monitor.scheduled(undefined, env, context)
    await Promise.all(waits)
    expect(waits).toHaveLength(2)
    expect(state().lastOutcome).toBe('ok')
  })
})
