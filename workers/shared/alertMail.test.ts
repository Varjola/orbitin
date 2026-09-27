import { describe, expect, it, vi } from 'vitest'
import { alertMailer, deliverAlert, EMPTY_ALERT_LEDGER, MAX_ALERTS_PER_DAY, planAlert, validAlertLedger, type AlertLedger, type AlertObservation, type AlertPolicy } from './alertMail.ts'

const POLICY: AlertPolicy = { source: 'test-worker', repeatHours: (key) => key.startsWith('weekly') ? 168 : 24, title: (key) => `Title of ${key}` }
const T0 = '2026-09-27T01:17:00.000Z'
const at = (hours: number) => new Date(Date.parse(T0) + hours * 3_600_000).toISOString()
const on = (key: string, detail = `detail of ${key}`): AlertObservation => ({ kind: 'condition', key, active: true, detail })
const off = (key: string): AlertObservation => ({ kind: 'condition', key, active: false })

/** Plans and, when a message is due, accepts it as sent. */
function run(ledger: AlertLedger, observations: readonly AlertObservation[], nowUtc: string) {
  const plan = planAlert(ledger, observations, nowUtc, POLICY)
  return { plan, ledger: plan.sent ?? plan.observed }
}

describe('alert ledger', () => {
  it('sends a condition at onset, then daily while it lasts, then one resolved notice', () => {
    let { plan, ledger } = run(EMPTY_ALERT_LEDGER, [on('a')], at(0))
    expect(plan.message).toMatchObject({ subject: '[Orbitin catalogue] Title of a', items: [{ kind: 'onset', key: 'a', sinceUtc: at(0) }] })
    ;({ plan, ledger } = run(ledger, [on('a')], at(1)))
    expect(plan.message).toBeNull()
    ;({ plan, ledger } = run(ledger, [on('a', 'changed detail')], at(23)))
    expect(plan.message).toBeNull()
    ;({ plan, ledger } = run(ledger, [on('a')], at(24)))
    expect(plan.message?.items).toEqual([{ kind: 'repeat', key: 'a', sinceUtc: at(0), detail: 'detail of a' }])
    ;({ plan, ledger } = run(ledger, [off('a')], at(25)))
    expect(plan.message).toMatchObject({ subject: '[Orbitin catalogue] Resolved: Title of a', items: [{ kind: 'resolved', key: 'a', sinceUtc: at(0), resolvedAtUtc: at(25) }] })
    ;({ plan, ledger } = run(ledger, [off('a')], at(26)))
    expect(plan.message).toBeNull()
    expect(ledger.conditions).toEqual({})
    expect(ledger.resolved).toEqual({})
  })

  it('repeats by the key’s own period', () => {
    let { ledger } = run(EMPTY_ALERT_LEDGER, [on('weekly:1')], at(0))
    expect(run(ledger, [], at(24)).plan.message).toBeNull()
    ;({ ledger } = run(ledger, [], at(167)))
    expect(run(ledger, [], at(168)).plan.message?.items).toMatchObject([{ kind: 'repeat', key: 'weekly:1' }])
  })

  it('leaves keys that were not observed as they were', () => {
    const { ledger } = run(EMPTY_ALERT_LEDGER, [on('a')], at(0))
    const next = run(ledger, [on('b')], at(1))
    expect(Object.keys(next.ledger.conditions).sort()).toEqual(['a', 'b'])
    expect(next.plan.message?.items.map((item) => item.key)).toEqual(['b'])
  })

  it('never resolves a condition the operator was not told about', () => {
    const suppressedLedger: AlertLedger = { ...EMPTY_ALERT_LEDGER, sendTimesUtc: Array.from({ length: MAX_ALERTS_PER_DAY }, () => at(0)) }
    const first = planAlert(suppressedLedger, [on('a')], at(1), POLICY)
    expect(first).toMatchObject({ message: null, suppressed: true })
    const cleared = planAlert(first.observed, [off('a')], at(2), POLICY)
    expect(cleared.message).toBeNull()
    expect(cleared.observed.resolved).toEqual({})
  })

  it('sends an event once per instance', () => {
    const event = (instance: string): AlertObservation => ({ kind: 'event', key: 'e', instance, detail: `event ${instance}` })
    let { plan, ledger } = run(EMPTY_ALERT_LEDGER, [event('sweep-1')], at(0))
    expect(plan.message?.items).toEqual([{ kind: 'event', key: 'e', atUtc: at(0), detail: 'event sweep-1' }])
    ;({ plan, ledger } = run(ledger, [event('sweep-1')], at(1)))
    expect(plan.message).toBeNull()
    ;({ plan } = run(ledger, [event('sweep-2')], at(2)))
    expect(plan.message?.items).toMatchObject([{ kind: 'event', detail: 'event sweep-2' }])
  })

  it('caps messages at six per rolling day and keeps suppressed alerts due', () => {
    let ledger = EMPTY_ALERT_LEDGER
    for (let index = 0; index < MAX_ALERTS_PER_DAY; index += 1) {
      const next = run(ledger, [on(`k${index}`)], at(index))
      expect(next.plan.message).not.toBeNull()
      ledger = next.ledger
    }
    const capped = planAlert(ledger, [on('late')], at(6), POLICY)
    expect(capped).toMatchObject({ message: null, sent: null, suppressed: true })
    // The first send leaves the window 24 hours later; the alert is still due.
    const later = planAlert(capped.observed, [], at(24), POLICY)
    expect(later.message?.items.map((item) => item.key)).toContain('late')
  })

  it('writes a plain, bounded, single-line-per-detail body with the latest facts and no address', () => {
    const plan = planAlert(EMPTY_ALERT_LEDGER, [on('a', 'line one\nline two\u0007'.padEnd(400, 'x'))], at(0), POLICY, { snapshotId: '20260927T011700Z-abcdef01', absentOfficialGroupMembers: '2' })
    const text = plan.message!.text
    expect(text).toContain('Orbitin catalogue alert from test-worker at 2026-09-27T01:17:00.000Z.')
    expect(text).toContain('NEW: Title of a [a]')
    expect(text).toContain('  line one line two ')
    expect(text).toContain('  snapshotId: 20260927T011700Z-abcdef01')
    expect(text).toContain('  absentOfficialGroupMembers: 2')
    expect(text).not.toMatch(/@/)
    expect(text.split('\n').every((line) => line.length <= 320)).toBe(true)
  })

  it('validates a stored ledger and refuses a malformed one', () => {
    const { ledger } = run(EMPTY_ALERT_LEDGER, [on('a'), { kind: 'event', key: 'e', instance: 'x', detail: 'y' }], at(0))
    expect(validAlertLedger(JSON.parse(JSON.stringify(ledger)))).toBe(true)
    for (const broken of [null, [], { ...ledger, schemaVersion: 2 }, { ...ledger, conditions: { a: { sinceUtc: 'yesterday', lastSentAtUtc: null, detail: '' } } }, { ...ledger, sendTimesUtc: ['x'] }]) {
      expect(validAlertLedger(broken)).toBe(false)
    }
  })
})

describe('alert mailer', () => {
  const binding = { send: vi.fn(async () => ({ messageId: 'x' })) }

  it('is off unless the binding and two plain addresses are present', () => {
    expect(alertMailer({})).toBeNull()
    expect(alertMailer({ CATALOGUE_ALERT_EMAIL: binding, CATALOGUE_ALERT_TO: 'operator@example.com' })).toBeNull()
    expect(alertMailer({ CATALOGUE_ALERT_EMAIL: binding, CATALOGUE_ALERT_FROM: 'alerts@example.com' })).toBeNull()
    expect(alertMailer({ CATALOGUE_ALERT_TO: 'operator@example.com', CATALOGUE_ALERT_FROM: 'alerts@example.com' })).toBeNull()
    for (const bad of ['Operator <operator@example.com>', 'operator@example.com\nBcc: x@example.com', 'a@example.com, b@example.com', 'operator', 'operator@localhost']) {
      expect(alertMailer({ CATALOGUE_ALERT_EMAIL: binding, CATALOGUE_ALERT_TO: bad, CATALOGUE_ALERT_FROM: 'alerts@example.com' }), bad).toBeNull()
    }
    expect(alertMailer({ CATALOGUE_ALERT_EMAIL: binding, CATALOGUE_ALERT_TO: ' operator@example.com ', CATALOGUE_ALERT_FROM: 'alerts@example.com' })).toEqual({ binding, to: 'operator@example.com', from: 'alerts@example.com' })
  })

  it('sends one message through the binding and records it; a failed send keeps it due and reports only the error class', async () => {
    const mailer = alertMailer({ CATALOGUE_ALERT_EMAIL: binding, CATALOGUE_ALERT_TO: 'operator@example.com', CATALOGUE_ALERT_FROM: 'alerts@example.com' })!
    const plan = planAlert(EMPTY_ALERT_LEDGER, [on('a')], at(0), POLICY)
    const sent = await deliverAlert(mailer, plan)
    expect(sent).toMatchObject({ delivery: 'sent', ledger: plan.sent })
    expect(binding.send).toHaveBeenCalledWith({ from: 'alerts@example.com', to: 'operator@example.com', subject: '[Orbitin catalogue] Title of a', text: plan.message!.text })

    const failing = { ...mailer, binding: { send: async () => { throw new TypeError('destination operator@example.com is not verified') } } }
    const failed = await deliverAlert(failing, plan)
    expect(failed).toEqual({ delivery: 'send_failed', ledger: plan.observed, reason: 'TypeError' })
    expect(planAlert(failed.ledger, [], at(1), POLICY).message?.items).toMatchObject([{ kind: 'onset', key: 'a' }])

    expect(await deliverAlert(mailer, planAlert(EMPTY_ALERT_LEDGER, [], at(0), POLICY))).toMatchObject({ delivery: 'none' })
  })
})
