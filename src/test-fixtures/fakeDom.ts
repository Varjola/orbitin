/** A deliberately small DOM and Canvas 2D double.
 *
 * The application's test suite runs in Node with no DOM implementation, and
 * the map is the first view whose behaviour - which layer redraws, when,
 * and what is released - is worth asserting directly. Adding a browser
 * environment package for that would be a new dependency for one module, so the
 * map view takes its `Document`, measurement and resize observation as options
 * and this fixture supplies them.
 *
 * It implements only what `GroundTrackMapView` actually uses. Anything else is
 * intentionally missing, so a test cannot quietly start depending on real
 * browser layout behaviour that is not modelled here.
 */

export interface DrawCall {
  readonly op: string
  readonly args: readonly unknown[]
}

export class FakeContext2D {
  readonly calls: DrawCall[] = []
  lineWidth = 1
  strokeStyle: unknown = '#000000'
  fillStyle: unknown = '#000000'
  globalAlpha = 1
  font = ''
  textAlign = ''
  textBaseline = ''
  lineJoin = ''
  lineCap = ''

  readonly canvas: FakeCanvasElement
  constructor(canvas: FakeCanvasElement) { this.canvas = canvas }

  private record(op: string, ...args: unknown[]): void { this.calls.push({ op, args }) }

  setTransform(...args: number[]): void { this.record('setTransform', ...args) }
  clearRect(...args: number[]): void { this.record('clearRect', ...args) }
  fillRect(...args: number[]): void { this.record('fillRect', ...args) }
  strokeRect(...args: number[]): void { this.record('strokeRect', ...args) }
  beginPath(): void { this.record('beginPath') }
  moveTo(x: number, y: number): void { this.record('moveTo', x, y) }
  lineTo(x: number, y: number): void { this.record('lineTo', x, y) }
  arc(...args: number[]): void { this.record('arc', ...args) }
  rect(...args: number[]): void { this.record('rect', ...args) }
  clip(): void { this.record('clip') }
  stroke(): void { this.record('stroke', this.strokeStyle, this.lineWidth) }
  fill(): void { this.record('fill', this.fillStyle) }
  save(): void { this.record('save') }
  restore(): void { this.record('restore') }
  setLineDash(pattern: number[]): void { this.record('setLineDash', [...pattern]) }
  fillText(text: string, x: number, y: number): void { this.record('fillText', text, x, y) }
  strokeText(text: string, x: number, y: number): void { this.record('strokeText', text, x, y) }
  drawImage(...args: unknown[]): void { this.record('drawImage', ...args) }

  countOf(op: string): number { return this.calls.filter((call) => call.op === op).length }
  /** Drawn points, which is what "did this layer redraw" really means here. */
  get lineToCount(): number { return this.countOf('lineTo') }
  clearRecording(): void { this.calls.length = 0 }
}

export class FakeElement {
  readonly children: FakeElement[] = []
  readonly attributes = new Map<string, string>()
  readonly style: Record<string, string> = {}
  readonly listeners = new Map<string, Array<() => void>>()
  parent: FakeElement | null = null
  className = ''
  id = ''
  hidden = false
  type = ''
  private ownText = ''

  readonly tagName: string
  constructor(tagName: string) { this.tagName = tagName }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent?.removeChild(node)
      node.parent = this
      this.children.push(node)
    }
    if (nodes.length > 0) this.ownText = ''
  }

  removeChild(node: FakeElement): void {
    const index = this.children.indexOf(node)
    if (index >= 0) this.children.splice(index, 1)
    if (node.parent === this) node.parent = null
  }

  remove(): void { this.parent?.removeChild(this) }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }

  addEventListener(type: string, listener: () => void): void {
    const existing = this.listeners.get(type) ?? []
    existing.push(listener)
    this.listeners.set(type, existing)
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }

  get textContent(): string {
    return this.children.length > 0 ? this.children.map((child) => child.textContent).join('') : this.ownText
  }

  set textContent(value: string) {
    this.children.splice(0).forEach((child) => { child.parent = null })
    this.ownText = value
  }

  getBoundingClientRect(): { width: number; height: number } { return { width: 0, height: 0 } }

  /** Depth-first search used by assertions, not by the view. */
  queryAll(className: string): FakeElement[] {
    const found: FakeElement[] = []
    const visit = (element: FakeElement): void => {
      if (element.className.split(' ').includes(className)) found.push(element)
      element.children.forEach(visit)
    }
    visit(this)
    return found
  }

  first(className: string): FakeElement | undefined { return this.queryAll(className)[0] }
}

export class FakeCanvasElement extends FakeElement {
  width = 300
  height = 150
  context: FakeContext2D | null = null
  /** Set before construction to model a browser that refuses a 2D surface. */
  static contextAvailable = true

  constructor() { super('canvas') }

  getContext(kind: string): FakeContext2D | null {
    if (kind !== '2d' || !FakeCanvasElement.contextAvailable) return null
    if (!this.context) this.context = new FakeContext2D(this)
    return this.context
  }
}

export interface FakeDom {
  readonly document: Document
  readonly root: FakeElement
  /** Every canvas the view has created, in creation order. */
  readonly canvases: FakeCanvasElement[]
}

export function createFakeDom(): FakeDom {
  const canvases: FakeCanvasElement[] = []
  const documentDouble = {
    createElement(tag: string): FakeElement {
      if (tag === 'canvas') {
        const canvas = new FakeCanvasElement()
        canvases.push(canvas)
        return canvas
      }
      return new FakeElement(tag)
    },
  }
  return { document: documentDouble as unknown as Document, root: new FakeElement('div'), canvases }
}
