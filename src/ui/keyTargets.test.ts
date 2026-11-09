import { describe, expect, it, vi } from 'vitest'
import { keyBelongsToControl } from './keyTargets.ts'

/** An element inside what `inside` names; `closest` finds it in the selector list. */
class FakeElement {
  readonly inside: readonly string[]
  readonly isContentEditable: boolean
  constructor(inside: readonly string[], editable = false) { this.inside = inside; this.isContentEditable = editable }
  closest(selector: string): FakeElement | null {
    const parts = selector.split(',').map((part) => part.trim())
    return this.inside.some((name) => parts.includes(name)) ? this : null
  }
}

vi.stubGlobal('HTMLElement', FakeElement)

const at = (...inside: string[]) => new FakeElement(inside) as unknown as EventTarget

describe('keyBelongsToControl', () => {
  it('gives keys to fields, controls that move and every kind of dialog', () => {
    for (const inside of ['input', 'textarea', '[role="slider"]', '[role="radiogroup"]', '[role="tablist"]', 'dialog', '[role="dialog"]', '[aria-modal="true"]']) {
      expect(keyBelongsToControl(at(inside)), inside).toBe(true)
    }
    expect(keyBelongsToControl(new FakeElement([], true) as unknown as EventTarget)).toBe(true)
  })

  it('leaves the page and, unless asked, buttons to the shortcut', () => {
    expect(keyBelongsToControl(at())).toBe(false)
    expect(keyBelongsToControl(null)).toBe(false)
    expect(keyBelongsToControl(at('button'))).toBe(false)
    expect(keyBelongsToControl(at('button'), { pressable: true })).toBe(true)
    expect(keyBelongsToControl(at('a[href]'), { pressable: true })).toBe(true)
  })
})
