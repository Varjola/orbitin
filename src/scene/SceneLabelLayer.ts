import type { ScreenPoint } from '../core/screenGeometry.ts'

/** DOM labels over the 3D view: one hover label near
 *  the pointer and one persistent label for the primary selection. There are
 *  deliberately no labels for other objects. */
export class SceneLabelLayer {
  readonly element: HTMLElement
  private readonly hover: HTMLElement
  private readonly primary: HTMLElement
  private readonly pinned: HTMLElement[] = []

  constructor(container: HTMLElement) {
    const documentRef = container.ownerDocument
    this.element = documentRef.createElement('div')
    this.element.className = 'scene-labels'
    this.element.setAttribute('aria-hidden', 'true')
    this.hover = documentRef.createElement('div')
    this.hover.className = 'scene-label scene-label-hover'
    this.primary = documentRef.createElement('div')
    this.primary.className = 'scene-label scene-label-primary'
    this.hover.hidden = true
    this.primary.hidden = true
    this.element.append(this.primary, this.hover)
    container.append(this.element)
  }

  setHover(text: string | null, at: ScreenPoint | null): void { place(this.hover, text, at, 14, 16) }

  /** `at` is null when the marker is occluded, behind the camera, outside the
   *  view, hidden or in error: the label is then hidden, never left stale. */
  setPrimary(text: string | null, at: ScreenPoint | null): void { place(this.primary, text, at, 10, -22) }

  /** Persistent labels on markers that are not scene objects, such as the
   *  Interception game's You and Target. An empty list hides them all. */
  setPinned(labels: readonly { readonly text: string; readonly at: ScreenPoint | null }[]): void {
    while (this.pinned.length < labels.length) {
      const label = this.element.ownerDocument.createElement('div')
      label.className = 'scene-label scene-label-pinned'
      label.hidden = true
      this.element.append(label)
      this.pinned.push(label)
    }
    this.pinned.forEach((label, index) => {
      place(label, labels[index]?.text ?? null, labels[index]?.at ?? null, 10, -22, this.element.clientWidth)
    })
  }

  dispose(): void { this.element.remove() }
}

const VIEW_EDGE_PX = 4

/** With `viewWidth` a long label shifts left to stay readable inside the view. */
function place(label: HTMLElement, text: string | null, at: ScreenPoint | null, dx: number, dy: number, viewWidth?: number): void {
  const visible = text !== null && at !== null
  if (label.hidden === visible) label.hidden = !visible
  if (!visible) return
  if (label.textContent !== text) label.textContent = text
  const x = viewWidth === undefined ? at.x + dx : Math.max(VIEW_EDGE_PX, Math.min(at.x + dx, viewWidth - label.offsetWidth - VIEW_EDGE_PX))
  label.style.transform = `translate(${Math.round(x)}px, ${Math.round(at.y + dy)}px)`
}
