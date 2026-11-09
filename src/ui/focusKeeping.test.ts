import { describe, expect, it, vi } from 'vitest'
import { focusIsLost, replaceKeepingFocus } from './focusKeeping.ts'

/** Just enough of a document for one container of controls. */
class FakeDocument {
  activeElement: FakeElement | null = null
  readonly body = new FakeElement(this, 'body')
}

/** An element matched by a tag and attribute selector like `button[data-route="1"]`;
 *  `hiddenInside` stands for a hidden region or closed dialog around it. */
class FakeElement {
  readonly ownerDocument: FakeDocument
  readonly localName: string
  readonly attributes: { name: string; value: string }[]
  children: FakeElement[] = []
  isConnected = true
  hiddenInside = false

  constructor(ownerDocument: FakeDocument, localName: string, attributes: Record<string, string> = {}) {
    this.ownerDocument = ownerDocument
    this.localName = localName
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }))
  }

  get id(): string { return this.attributes.find((attribute) => attribute.name === 'id')?.value ?? '' }
  focus(): void { this.ownerDocument.activeElement = this }
  contains(other: unknown): boolean { return other === this || this.children.some((child) => child.contains(other)) }
  closest(): FakeElement | null { return this.hiddenInside ? this : null }

  matches(selector: string): boolean {
    const match = /^([a-z]*)((?:\[[a-z-]+="[^"]*"\])*)$/.exec(selector)
    if (match === null) throw new Error(`unsupported selector ${selector}`)
    if (match[1] && match[1] !== this.localName) return false
    return [...match[2].matchAll(/\[([a-z-]+)="([^"]*)"\]/g)].every(([, name, value]) => this.attributes.some((attribute) => attribute.name === name && attribute.value === value))
  }

  querySelector(selector: string): FakeElement | null { return this.children.find((child) => child.matches(selector)) ?? null }

  /** Markup stands for a list of controls the test builds. */
  set innerHTML(markup: string) {
    this.children = markup === '' ? [] : markup.split(' ').map((spec) => {
      const [tag, ...pairs] = spec.split('|')
      return new FakeElement(this.ownerDocument, tag, Object.fromEntries(pairs.map((pair) => pair.split('='))))
    })
  }
}

vi.stubGlobal('HTMLElement', FakeElement)

function list(markup: string) {
  const documentRef = new FakeDocument()
  const container = new FakeElement(documentRef, 'div')
  container.innerHTML = markup
  return { documentRef, container, replace: (next: string) => replaceKeepingFocus(container as unknown as HTMLElement, next) }
}

describe('replaceKeepingFocus', () => {
  it('focuses the same route again in the new rows', () => {
    const { documentRef, container, replace } = list('button|data-route=0 button|data-route=1')
    container.children[1].focus()
    replace('button|data-route=0 button|data-route=1 button|data-route=2')
    expect(documentRef.activeElement).toBe(container.children[1])
    expect(documentRef.activeElement?.attributes).toEqual([{ name: 'data-route', value: '1' }])
  })

  it('finds a control by its id first', () => {
    const { documentRef, container, replace } = list('button|id=play|data-route=4')
    container.children[0].focus()
    replace('a button|id=play|data-route=9')
    expect(documentRef.activeElement).toBe(container.children[1])
  })

  it('keeps the focus in the container when its control is gone', () => {
    const { documentRef, container, replace } = list('button|data-route=0 button|data-route=1')
    container.children[1].focus()
    replace('p')
    expect(documentRef.activeElement).toBe(container)
  })

  it('leaves a focus outside the container where it is', () => {
    const { documentRef, container, replace } = list('button|data-route=0')
    const outside = new FakeElement(documentRef, 'button')
    outside.focus()
    replace('button|data-route=0')
    expect(documentRef.activeElement).toBe(outside)
    expect(container.children).toHaveLength(1)
  })
})

describe('focusIsLost', () => {
  it('is lost on the page, when removed, or inside a hidden region or closed dialog', () => {
    const documentRef = new FakeDocument()
    const lost = () => focusIsLost(documentRef as unknown as Document)
    expect(lost()).toBe(true)
    documentRef.body.focus()
    expect(lost()).toBe(true)
    const button = new FakeElement(documentRef, 'button')
    button.focus()
    expect(lost()).toBe(false)
    button.hiddenInside = true
    expect(lost()).toBe(true)
    button.hiddenInside = false
    button.isConnected = false
    expect(lost()).toBe(true)
  })
})
