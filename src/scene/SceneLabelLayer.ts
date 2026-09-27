import type { ScreenPoint } from '../core/screenGeometry.ts'

/** DOM labels over the 3D view: one hover label near
 *  the pointer and one persistent label for the primary selection. There are
 *  deliberately no labels for other objects. */
export class SceneLabelLayer {
  readonly element: HTMLElement
  private readonly hover: HTMLElement
  private readonly primary: HTMLElement

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

  dispose(): void { this.element.remove() }
}

function place(label: HTMLElement, text: string | null, at: ScreenPoint | null, dx: number, dy: number): void {
  const visible = text !== null && at !== null
  if (label.hidden === visible) label.hidden = !visible
  if (!visible) return
  if (label.textContent !== text) label.textContent = text
  label.style.transform = `translate(${Math.round(at.x + dx)}px, ${Math.round(at.y + dy)}px)`
}
