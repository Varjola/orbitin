import { text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'
import { icon } from './mobileIcons.ts'
import type { MobileSurface } from './mobileShellState.ts'

let generatedIds = 0
/** The only ids mobile views create are generated,
 *  `m-`-prefixed ids for ARIA references. */
export function mobileId(stem: string): string { generatedIds += 1; return `m-${stem}-${generatedIds}` }

export interface PanelHostCallbacks {
  /** The grab handle, the close button or Escape. */
  onClose(): void
  /** Dragging the handle of an expandable panel up or down. */
  onExpandedChange(expanded: boolean): void
}

export interface PanelOptions {
  /** Heading text; a panel without one names itself with `label`. */
  readonly heading?: string
  readonly label?: string
  /** Panels whose body already carries its own heading. */
  readonly header?: boolean
  readonly expandable?: boolean
}

interface RegisteredPanel {
  readonly body: HTMLElement
  readonly options: PanelOptions
}

/** The drag distance that counts as a gesture on the grab handle. */
const HANDLE_DRAG_PX = 32

export function panelHostMarkup(headingId: string): string {
  const t = text().mobile
  return html`
    <div class="m-panel-grab" aria-hidden="true"><span></span></div>
    <div class="m-panel-header">
      <h2 class="m-panel-heading" id="${headingId}"></h2>
      <button class="m-icon-button m-panel-close" type="button" aria-label="${t.close}">${trusted(icon('close'))}</button>
    </div>
    <div class="m-panel-body"></div>
  `
}

/** One panel at a time, above the dock in portrait and
 *  as a side column in landscape. Compact panels are labelled regions that
 *  frame the scene; expanded panels are dialogs that overlay it: focus moves
 *  in, Escape closes them and focus returns to the control that opened them. */
export class PanelHost {
  readonly element: HTMLElement
  private readonly callbacks: PanelHostCallbacks
  private readonly heading: HTMLElement
  private readonly header: HTMLElement
  private readonly body: HTMLElement
  private readonly grab: HTMLElement
  private readonly panels = new Map<MobileSurface, RegisteredPanel>()
  private current: MobileSurface = 'none'
  private currentExpanded = false
  private returnFocus: HTMLElement | null = null
  private drag: { readonly pointerId: number; readonly startY: number; moved: boolean } | null = null

  constructor(container: HTMLElement, callbacks: PanelHostCallbacks) {
    this.callbacks = callbacks
    const documentRef = container.ownerDocument
    this.element = documentRef.createElement('section')
    this.element.className = 'm-panel'
    this.element.hidden = true
    const headingId = mobileId('panel-heading')
    this.element.innerHTML = panelHostMarkup(headingId)
    this.heading = this.element.querySelector<HTMLElement>('.m-panel-heading')!
    this.header = this.element.querySelector<HTMLElement>('.m-panel-header')!
    this.body = this.element.querySelector<HTMLElement>('.m-panel-body')!
    this.grab = this.element.querySelector<HTMLElement>('.m-panel-grab')!
    this.element.querySelector('.m-panel-close')!.addEventListener('click', () => this.callbacks.onClose())
    this.element.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      this.callbacks.onClose()
    })
    this.grab.addEventListener('pointerdown', (event) => {
      this.drag = { pointerId: event.pointerId, startY: event.clientY, moved: false }
      capturePointer(this.grab, event.pointerId)
    })
    this.grab.addEventListener('pointerup', (event) => this.endDrag(event))
    this.grab.addEventListener('pointercancel', () => { this.drag = null })
    container.append(this.element)
  }

  get surface(): MobileSurface { return this.current }

  register(surface: MobileSurface, body: HTMLElement, options: PanelOptions): void {
    body.hidden = true
    body.classList.add('m-panel-content')
    this.body.append(body)
    this.panels.set(surface, { body, options })
  }

  /** Updates a registered panel's heading, for headings that follow state. */
  setHeading(surface: MobileSurface, heading: string): void {
    const panel = this.panels.get(surface)
    if (!panel) return
    this.panels.set(surface, { body: panel.body, options: { ...panel.options, heading } })
    if (surface === this.current) this.applyHeading(panel.options.header !== false ? heading : '', heading)
  }

  /** Shows `surface` (or nothing), compact or expanded. `opener` receives
   *  focus back when an expanded panel closes. */
  show(surface: MobileSurface, expanded: boolean, compact: boolean, opener: HTMLElement | null = null): void {
    const documentRef = this.element.ownerDocument
    const hadFocus = this.element.contains(documentRef.activeElement)
    const changed = surface !== this.current
    const panel = this.panels.get(surface)
    if (changed) {
      for (const [key, registered] of this.panels) registered.body.hidden = key !== surface
      if (!compact && panel) this.returnFocus = opener ?? (documentRef.activeElement instanceof HTMLElement && !this.element.contains(documentRef.activeElement) ? documentRef.activeElement : null)
    }
    const previous = this.current
    this.current = panel ? surface : 'none'
    this.currentExpanded = expanded
    this.element.hidden = !panel
    this.element.dataset.surface = this.current
    this.element.classList.toggle('is-compact', compact)
    this.element.classList.toggle('is-expanded', !compact)
    if (!panel) {
      this.element.removeAttribute('role')
      if (previous !== 'none' && hadFocus) this.restoreFocus()
      return
    }
    const heading = panel.options.heading ?? ''
    this.applyHeading(panel.options.header !== false ? heading : '', heading || panel.options.label || '')
    this.element.setAttribute('role', compact ? 'region' : 'dialog')
    if (changed && !compact) {
      const target = panel.body.querySelector<HTMLElement>('[data-autofocus]') ?? panel.body.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')
      ;(target ?? this.element.querySelector<HTMLElement>('.m-panel-close'))?.focus({ preventScroll: true })
    } else if (changed && hadFocus) this.restoreFocus()
  }

  dispose(): void { this.element.remove() }

  private applyHeading(visible: string, name: string): void {
    this.heading.textContent = visible
    this.header.hidden = visible === ''
    if (visible) { this.element.setAttribute('aria-labelledby', this.heading.id); this.element.removeAttribute('aria-label') }
    else { this.element.removeAttribute('aria-labelledby'); this.element.setAttribute('aria-label', name) }
  }

  private restoreFocus(): void {
    const target = this.returnFocus
    this.returnFocus = null
    if (target && target.isConnected && !target.closest('[hidden]')) target.focus({ preventScroll: true })
  }

  private endDrag(event: PointerEvent): void {
    const drag = this.drag
    this.drag = null
    if (!drag || drag.pointerId !== event.pointerId) return
    const dy = event.clientY - drag.startY
    const expandable = this.panels.get(this.current)?.options.expandable ?? false
    if (dy <= -HANDLE_DRAG_PX) { if (expandable && !this.currentExpanded) this.callbacks.onExpandedChange(true); return }
    if (dy >= HANDLE_DRAG_PX && expandable && this.currentExpanded) { this.callbacks.onExpandedChange(false); return }
    this.callbacks.onClose()
  }
}

/** Keeps a drag's pointer on `element`. Capture is best-effort: a pointer
 *  that is already gone cannot be captured, and the drag still works. */
export function capturePointer(element: Element, pointerId: number): void {
  try { element.setPointerCapture?.(pointerId) } catch { /* the pointer is no longer active */ }
}
