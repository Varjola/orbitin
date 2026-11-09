import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BurnDirection } from '../simulation/maneuverGame.ts'
import { BurnHold } from './burnHold.ts'
import type { ManeuverPanelModel } from './maneuverPanelModel.ts'

/** Just enough of an event target to drive the hold without a DOM. */
class FakeTarget {
  private readonly handlers = new Map<string, Set<(event: unknown) => void>>()
  addEventListener(type: string, handler: (event: unknown) => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
  }
  removeEventListener(type: string, handler: (event: unknown) => void): void { this.handlers.get(type)?.delete(handler) }
  fire(type: string, event: Record<string, unknown> = {}): void {
    for (const handler of this.handlers.get(type) ?? []) handler({ preventDefault: () => {}, stopPropagation: () => {}, ...event })
  }
}

/** An element that is, or sits inside, what `inside` names: `closest` finds it
 *  when that appears in the selector list. */
class FakeElement extends FakeTarget {
  readonly inside: readonly string[]
  constructor(inside: readonly string[] = []) { super(); this.inside = inside }
  closest(selector: string): FakeElement | null {
    const parts = selector.split(',').map((part) => part.trim())
    return this.inside.some((name) => parts.includes(name)) ? this : null
  }
  get isContentEditable(): boolean { return false }
}

vi.stubGlobal('HTMLElement', FakeElement)

function setup() {
  const view = new FakeTarget()
  const documentRef = Object.assign(new FakeTarget(), { visibilityState: 'visible', defaultView: view })
  const log: string[] = []
  const hold = new BurnHold(documentRef as unknown as Document, {
    onBurnPress: (direction: BurnDirection) => log.push(`press ${direction}`),
    onBurnRelease: () => log.push('release'),
  })
  const classes = new Set<string>()
  const button = Object.assign(new FakeTarget(), { disabled: false, classes, classList: { toggle: (name: string, on: boolean) => { if (on) classes.add(name); else classes.delete(name) } }, setPointerCapture: () => { throw new Error('gone') } })
  hold.bindButton(button as unknown as HTMLButtonElement, 'prograde')
  hold.setActive(true)
  hold.setEnabled(true)
  const key = (type: 'keydown' | 'keyup', name: string, extra: Record<string, unknown> = {}) => documentRef.fire(type, { key: name, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: new FakeElement(), ...extra })
  return { hold, log, button, view, documentRef, key }
}

describe('BurnHold', () => {
  let h: ReturnType<typeof setup>
  beforeEach(() => { h = setup() })

  it('burns from pointer down to that pointer going up, even when capture fails', () => {
    h.button.fire('pointerdown', { button: 0, pointerId: 3 })
    h.button.fire('pointerup', { pointerId: 4 })
    expect(h.log).toEqual(['press prograde'])
    h.button.fire('pointerup', { pointerId: 3 })
    h.button.fire('pointerup', { pointerId: 3 })
    expect(h.log).toEqual(['press prograde', 'release'])
  })

  it('ends a hold on every lost release', () => {
    for (const end of [
      () => h.button.fire('pointercancel', { pointerId: 1 }),
      () => h.button.fire('lostpointercapture', { pointerId: 1 }),
      () => h.view.fire('blur'),
      () => { (h.documentRef as unknown as { visibilityState: string }).visibilityState = 'hidden'; h.documentRef.fire('visibilitychange') },
      () => h.hold.setActive(false),
    ]) {
      h.hold.setActive(true)
      ;(h.documentRef as unknown as { visibilityState: string }).visibilityState = 'visible'
      h.log.length = 0
      h.button.fire('pointerdown', { button: 0, pointerId: 1 })
      end()
      expect(h.log).toEqual(['press prograde', 'release'])
    }
  })

  it('holds with keys, ignores repeats and keys meant for a control', () => {
    h.key('keydown', 'S')
    h.key('keydown', 's', { repeat: true })
    h.key('keydown', 'w')
    expect(h.log).toEqual(['press retrograde'])
    h.key('keyup', 's')
    expect(h.log).toEqual(['press retrograde', 'release'])
    h.key('keydown', 'ArrowUp', { target: new FakeElement(['[role="slider"]']) })
    h.key('keydown', 'w', { ctrlKey: true })
    expect(h.log).toHaveLength(2)
  })

  it('starts no burn while disabled or inactive', () => {
    h.hold.setEnabled(false)
    h.button.fire('pointerdown', { button: 0, pointerId: 1 })
    h.hold.setEnabled(true)
    h.hold.setActive(false)
    h.key('keydown', 'w')
    expect(h.log).toEqual([])
  })

  it('leaves keys alone inside a dialog, native or not', () => {
    for (const inside of ['dialog', '[role="dialog"]', '[aria-modal="true"]']) h.key('keydown', 'ArrowDown', { target: new FakeElement([inside]) })
    expect(h.log).toEqual([])
    h.key('keydown', 'ArrowDown', { target: new FakeElement(['button']) })
    expect(h.log).toEqual(['press retrograde'])
  })

  it('takes a click with no pointer press as a tap, and no other click', () => {
    h.button.fire('click', { detail: 0 })
    expect(h.log).toEqual(['press prograde', 'release'])
    h.button.fire('pointerdown', { button: 0, pointerId: 2 })
    h.button.fire('pointerup', { pointerId: 2 })
    h.button.fire('click', { detail: 1 })
    expect(h.log).toEqual(['press prograde', 'release', 'press prograde', 'release'])
    h.hold.setEnabled(false)
    h.button.fire('click', { detail: 0 })
    expect(h.log).toHaveLength(4)
  })

  it('ends a held burn when disabled', () => {
    h.button.fire('pointerdown', { button: 0, pointerId: 5 })
    h.hold.setEnabled(false)
    expect(h.log).toEqual(['press prograde', 'release'])
    h.button.fire('pointerup', { pointerId: 5 })
    expect(h.log).toHaveLength(2)
  })

  it('syncs its buttons with the game: enabled in play, marked while burning, never aria-pressed', () => {
    const model = (changes: Partial<ManeuverPanelModel>) => ({ outcome: null, burning: null, remainingKmPerSecond: 1, ...changes }) as ManeuverPanelModel
    h.hold.sync(model({ burning: 'prograde' }), false)
    expect([h.button.disabled, [...h.button.classes]]).toEqual([false, ['is-burning']])
    h.hold.sync(model({ remainingKmPerSecond: 0, burning: 'prograde' }), false)
    expect(h.button.disabled).toBe(false)
    h.hold.sync(model({ outcome: 'won' }), false)
    expect([h.button.disabled, [...h.button.classes]]).toEqual([true, []])
    h.hold.sync(model({}), true)
    expect(h.button.disabled).toBe(true)
    h.hold.sync(model({}), false)
    expect(h.button.disabled).toBe(false)
  })
})
