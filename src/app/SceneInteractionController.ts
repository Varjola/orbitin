import { text } from '../i18n/index.ts'
import type { ScreenPoint } from '../core/screenGeometry.ts'
import { isClick, MOUSE_PICK_TOLERANCES, pickTolerances, rankPickHits, type PickHit, type PickTolerances, type RankedPick } from '../interaction/pickRanking.ts'
import type { ChooserEntry } from '../ui/SceneObjectChooserView.ts'
import { selectionIntentFromClick, type SelectionIntent } from '../ui/sceneSelectionIntent.ts'

/** Pointer handling, hover, the chooser and reveal
 *  pulses for the 3D view and the map. Everything here is transient: none of
 *  it is written to `AppState` or serialized. Selection changes go through
 *  the application's one selection path. */

export type InteractionSurface = '3d' | 'map'
export const REVEAL_DURATION_MS = 1200

export interface HoverState { readonly objectId: string; readonly surface: InteractionSurface; readonly ambiguousCount: number }
export interface ChooserState { readonly surface: InteractionSurface; readonly anchor: ScreenPoint; readonly intent: SelectionIntent; readonly candidates: readonly PickHit[] }

export interface ChooserPort {
  readonly isOpen: boolean
  readonly listedIds: readonly string[]
  open(anchor: ScreenPoint, bounds: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }, entries: readonly ChooserEntry[]): void
  close(): void
  contains(target: EventTarget | null): boolean
}

export interface SceneInteractionDeps {
  readonly canvas: HTMLElement
  readonly mapFrame: HTMLElement
  readonly chooser: ChooserPort
  /** Hits on one surface at a surface-relative point; errored objects
   *  excluded. Tolerances follow the pointer. */
  pick(surface: InteractionSurface, point: ScreenPoint, tolerances: PickTolerances): PickHit[]
  objectInfo(id: string): { readonly name: string; readonly colorHex: number; readonly selection: ChooserEntry['selection'] } | null
  select(id: string, intent: SelectionIntent): void
  clearSelection(): void
  /** False for the 3D view while the maximized map covers it, and for a closed map. */
  surfaceActive(surface: InteractionSurface): boolean
  /** Emphasis and label for the hovered object on one surface (null clears). */
  showHover(surface: InteractionSurface, id: string | null, label: string | null, at: ScreenPoint | null): void
  applyReveals(reveals: ReadonlyMap<string, number>, nowMs: number): void
  /** A tap or click that found nothing. */
  emptyTap?(surface: InteractionSurface): void
  now(): number
}

interface Press { readonly surface: InteractionSurface; readonly pointerId: number; readonly button: number; readonly start: ScreenPoint; readonly intent: SelectionIntent; readonly tolerances: PickTolerances; dragging: boolean }

/** The hover label: `<name>`, or `<name> +<k> more` when ambiguous. */
export function hoverLabel(name: string, ranked: RankedPick): string {
  return ranked.ambiguous ? text().map.hoverMore(name, ranked.candidates.length - 1) : name
}

export class SceneInteractionController {
  private readonly deps: SceneInteractionDeps
  private press: Press | null = null
  /** Pointers currently down on either surface; a second one cancels a tap. */
  private readonly activePointers = new Set<number>()
  private pendingHover: { surface: InteractionSurface; point: ScreenPoint } | null = null
  private hoverState: HoverState | null = null
  private chooserState: ChooserState | null = null
  private readonly revealStarts = new Map<string, number>()
  private readonly removeListeners: (() => void)[] = []
  /** Milliseconds the last coalesced hover pick took (harness evidence). */
  lastHoverPickMs = 0

  constructor(deps: SceneInteractionDeps) {
    this.deps = deps
    for (const [surface, element] of [['3d', deps.canvas], ['map', deps.mapFrame]] as const) {
      // Programmatic focus target for chooser focus return; not in tab order.
      element.tabIndex = -1
      this.listen(element, 'pointerdown', (event) => this.onPointerDown(surface, event as PointerEvent))
      this.listen(element, 'pointermove', (event) => this.onPointerMove(surface, event as PointerEvent))
      this.listen(element, 'pointerup', (event) => this.onPointerUp(surface, event as PointerEvent))
      this.listen(element, 'pointerleave', () => this.onPointerLeave(surface))
      this.listen(element, 'pointercancel', (event) => this.onPointerCancel(event as PointerEvent))
      // Right click clears selection here, so the context menu is suppressed
      // on the two picking surfaces only.
      this.listen(element, 'contextmenu', (event) => event.preventDefault())
    }
    const documentRef = deps.canvas.ownerDocument
    this.listen(documentRef, 'pointerdown', (event) => {
      if (this.chooserState && !this.deps.chooser.contains(event.target)) this.closeChooser(false)
    }, true)
  }

  get hover(): HoverState | null { return this.hoverState }
  get chooser(): ChooserState | null { return this.chooserState }
  get reveals(): ReadonlyMap<string, number> { return this.revealStarts }

  /** Once per application frame: the coalesced hover pick and reveal expiry. */
  frame(nowMs: number): void {
    if (this.pendingHover && !this.chooserState) {
      const { surface, point } = this.pendingHover
      this.pendingHover = null
      const started = this.deps.now()
      const ranked = this.deps.surfaceActive(surface) ? rankPickHits(this.deps.pick(surface, point, MOUSE_PICK_TOLERANCES)) : { candidates: [], ambiguous: false }
      this.lastHoverPickMs = this.deps.now() - started
      const top = ranked.candidates[0]
      const info = top ? this.deps.objectInfo(top.objectId) : null
      if (!top || !info) this.setHover(null, surface, null, null)
      else this.setHover({ objectId: top.objectId, surface, ambiguousCount: ranked.ambiguous ? ranked.candidates.length - 1 : 0 }, surface, hoverLabel(info.name, ranked), point)
    }
    if (this.revealStarts.size > 0) {
      for (const [id, start] of this.revealStarts) if (nowMs - start > REVEAL_DURATION_MS) this.revealStarts.delete(id)
      this.deps.applyReveals(this.revealStarts, nowMs)
    }
  }

  /** Reveal pulses on the 3D and map markers of `ids`. */
  reveal(ids: readonly string[]): void {
    const start = this.deps.now()
    for (const id of ids) this.revealStarts.set(id, start)
    this.deps.applyReveals(this.revealStarts, start)
  }

  /** Reconcile with the scene: drop hover, chooser and reveals of objects
   *  that are gone. */
  sceneChanged(ids: ReadonlySet<string>): void {
    if (this.hoverState && !ids.has(this.hoverState.objectId)) this.setHover(null, this.hoverState.surface, null, null)
    if (this.chooserState && this.deps.chooser.listedIds.some((id) => !ids.has(id))) this.closeChooser(false)
    let changed = false
    for (const id of this.revealStarts.keys()) if (!ids.has(id)) { this.revealStarts.delete(id); changed = true }
    if (changed) this.deps.applyReveals(this.revealStarts, this.deps.now())
  }

  /** Mode change: every piece of transient interaction state is cleared. */
  reset(): void {
    this.press = null
    this.activePointers.clear()
    this.pendingHover = null
    if (this.hoverState) this.setHover(null, this.hoverState.surface, null, null)
    this.closeChooser(false)
    if (this.revealStarts.size > 0) { this.revealStarts.clear(); this.deps.applyReveals(this.revealStarts, this.deps.now()) }
  }

  /** Maximize or restore: maximizing covers the 3D
   *  view, and every transition moves the map frame, so the state of the
   *  covered view and of the map is closed. Selection is untouched. */
  mapLayoutChanged(maximized: boolean): void {
    this.pendingHover = null
    if (this.hoverState && (this.hoverState.surface === 'map' || maximized)) this.setHover(null, this.hoverState.surface, null, null)
    if (this.chooserState && (this.chooserState.surface === 'map' || maximized)) this.closeChooser(false)
  }

  dispose(): void {
    for (const remove of this.removeListeners.splice(0)) remove()
    this.deps.chooser.close()
  }

  /** The chooser's entry was chosen: apply the captured intent. */
  choose(id: string): void {
    const state = this.chooserState
    if (!state) return
    this.closeChooser(true)
    this.deps.select(id, state.intent)
  }

  /** Chooser hover or focus preview uses the canvas hover emphasis. */
  preview(id: string | null): void {
    const state = this.chooserState
    if (!state) return
    const info = id ? this.deps.objectInfo(id) : null
    this.deps.showHover(state.surface, info ? id : null, null, null)
  }

  closeChooser(returnFocus: boolean): void {
    const state = this.chooserState
    if (!state) return
    this.chooserState = null
    const hadFocus = this.deps.chooser.contains(this.deps.canvas.ownerDocument.activeElement)
    this.deps.chooser.close()
    this.deps.showHover(state.surface, this.hoverState?.surface === state.surface ? this.hoverState.objectId : null, null, null)
    if (returnFocus || hadFocus) (state.surface === '3d' ? this.deps.canvas : this.deps.mapFrame).focus({ preventScroll: true })
  }

  private setHover(next: HoverState | null, surface: InteractionSurface, label: string | null, at: ScreenPoint | null): void {
    const previous = this.hoverState
    if (previous && previous.surface !== surface) this.deps.showHover(previous.surface, null, null, null)
    this.hoverState = next
    this.deps.showHover(surface, next?.objectId ?? null, label, at)
  }

  private localPoint(element: HTMLElement, event: PointerEvent): ScreenPoint {
    const rect = element.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  private onPointerDown(surface: InteractionSurface, event: PointerEvent): void {
    this.activePointers.add(event.pointerId)
    // A gesture with two fingers never selects anything.
    if (this.activePointers.size > 1) { this.press = null; return }
    if (event.button !== 0 && event.button !== 2) return
    this.press = { surface, pointerId: event.pointerId, button: event.button, start: { x: event.clientX, y: event.clientY }, intent: selectionIntentFromClick(event), tolerances: pickTolerances(event.pointerType), dragging: false }
  }

  private onPointerCancel(event: PointerEvent): void {
    this.activePointers.delete(event.pointerId)
    if (this.press?.pointerId === event.pointerId) this.press = null
  }

  private onPointerMove(surface: InteractionSurface, event: PointerEvent): void {
    const press = this.press
    if (press && press.pointerId === event.pointerId) {
      if (!press.dragging && !isClick(press.start, { x: event.clientX, y: event.clientY }, press.tolerances)) {
        // Camera navigation: never a selection, and it dismisses the chooser.
        press.dragging = true
        this.closeChooser(false)
        if (this.hoverState) this.setHover(null, this.hoverState.surface, null, null)
      }
      return
    }
    this.pendingHover = { surface, point: this.localPoint(surface === '3d' ? this.deps.canvas : this.deps.mapFrame, event) }
  }

  private onPointerUp(surface: InteractionSurface, event: PointerEvent): void {
    this.activePointers.delete(event.pointerId)
    const press = this.press
    this.press = null
    if (!press || press.surface !== surface || press.pointerId !== event.pointerId || press.button !== event.button || press.dragging) return
    if (!isClick(press.start, { x: event.clientX, y: event.clientY }, press.tolerances)) return
    if (!this.deps.surfaceActive(surface)) return
    if (press.button === 2) {
      // Right click clears the selection whatever is under the pointer.
      this.closeChooser(false)
      this.deps.clearSelection()
      return
    }
    const element = surface === '3d' ? this.deps.canvas : this.deps.mapFrame
    const point = this.localPoint(element, event)
    const ranked = rankPickHits(this.deps.pick(surface, point, press.tolerances))
    // An empty left click never changes selection; mobile uses it for panels
    // and immersive mode.
    if (ranked.candidates.length === 0) { this.deps.emptyTap?.(surface); return }
    if (!ranked.ambiguous) { this.deps.select(ranked.candidates[0].objectId, press.intent); return }
    this.openChooser(surface, element, { x: event.clientX, y: event.clientY }, press.intent, ranked.candidates)
  }

  private onPointerLeave(surface: InteractionSurface): void {
    this.pendingHover = null
    if (this.hoverState?.surface === surface && !this.chooserState) this.setHover(null, surface, null, null)
  }

  private openChooser(surface: InteractionSurface, element: HTMLElement, anchor: ScreenPoint, intent: SelectionIntent, candidates: readonly PickHit[]): void {
    const entries: ChooserEntry[] = []
    for (const candidate of candidates) {
      const info = this.deps.objectInfo(candidate.objectId)
      if (info) entries.push({ id: candidate.objectId, name: info.name, colorHex: info.colorHex, kind: candidate.kind, selection: info.selection })
    }
    if (entries.length === 0) return
    this.chooserState = { surface, anchor, intent, candidates }
    const rect = element.getBoundingClientRect()
    this.deps.chooser.open(anchor, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, entries)
  }

  private listen(target: EventTarget, type: string, handler: (event: Event) => void, capture = false): void {
    target.addEventListener(type, handler, capture)
    this.removeListeners.push(() => target.removeEventListener(type, handler, capture))
  }
}
