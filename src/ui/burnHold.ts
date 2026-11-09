import type { BurnDirection } from '../simulation/maneuverGame.ts'
import { keyBelongsToControl } from './keyTargets.ts'
import type { ManeuverPanelModel } from './maneuverPanelModel.ts'
import type { UiCallbacks } from './uiTypes.ts'

export type BurnHoldCallbacks = Pick<UiCallbacks, 'onBurnPress' | 'onBurnRelease'>

const KEY_DIRECTIONS: Readonly<Record<string, BurnDirection>> = { w: 'prograde', arrowup: 'prograde', s: 'retrograde', arrowdown: 'retrograde' }

type Holder = { readonly kind: 'pointer'; readonly id: number } | { readonly kind: 'key'; readonly key: string } | { readonly kind: 'click' }

/** Hold-to-burn input, shared by both presentations. A burn runs from a press
 *  to its release, and every way a hold can end (pointer up or cancelled, lost
 *  capture, key up, lost window focus, a hidden page, the controls going away)
 *  ends it: the thrusters never fire without a held input. The hold belongs to
 *  the input alone; no model update ever ends it. */
export class BurnHold {
  private readonly callbacks: BurnHoldCallbacks
  private readonly documentRef: Document
  private active = false
  private enabled = false
  private holder: Holder | null = null
  private readonly buttons: { readonly button: HTMLButtonElement; readonly direction: BurnDirection }[] = []
  private readonly onKeyDown = (event: KeyboardEvent): void => this.keyDown(event)
  private readonly onKeyUp = (event: KeyboardEvent): void => this.keyUp(event)
  private readonly onBlur = (): void => this.release()
  private readonly onVisibility = (): void => { if (this.documentRef.visibilityState === 'hidden') this.onBlur() }

  constructor(documentRef: Document, callbacks: BurnHoldCallbacks) {
    this.documentRef = documentRef
    this.callbacks = callbacks
    documentRef.addEventListener('keydown', this.onKeyDown)
    documentRef.addEventListener('keyup', this.onKeyUp)
    documentRef.addEventListener('visibilitychange', this.onVisibility)
    documentRef.defaultView?.addEventListener('blur', this.onBlur)
  }

  /** Makes a button fire in one direction while it is held. */
  bindButton(button: HTMLButtonElement, direction: BurnDirection): void {
    this.buttons.push({ button, direction })
    button.addEventListener('contextmenu', (event) => event.preventDefault())
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || this.holder) return
      event.preventDefault()
      // A pointer already gone cannot be captured; its release still ends the burn.
      try { button.setPointerCapture(event.pointerId) } catch { /* nothing to capture */ }
      this.press(direction, { kind: 'pointer', id: event.pointerId })
    })
    const end = (event: PointerEvent) => { if (this.holder?.kind === 'pointer' && this.holder.id === event.pointerId) this.release() }
    button.addEventListener('pointerup', end)
    button.addEventListener('pointercancel', end)
    button.addEventListener('lostpointercapture', end)
    // Space or Enter held on the focused button burns too.
    button.addEventListener('keydown', (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat && !this.holder) this.press(direction, { kind: 'key', key: event.key })
    })
    button.addEventListener('keyup', (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      event.preventDefault()
      event.stopPropagation()
      if (this.holder?.kind === 'key' && this.holder.key === event.key) this.release()
    })
    // A click with no pointer press (a screen reader, voice or switch access)
    // has nothing to hold: it is a tap, the shortest burn.
    button.addEventListener('click', (event) => {
      if (event.detail !== 0 || this.holder) return
      this.press(direction, { kind: 'click' })
      this.release()
    })
  }

  /** Burns may run in a game in play with fuel left. A button stays enabled
   *  while its own burn runs, so it still hears the release. Not aria-pressed:
   *  a hold button is not a toggle, and a status line says a burn runs. */
  sync(model: ManeuverPanelModel | null, loading: boolean): void {
    const enabled = !loading && model !== null && model.outcome === null && model.remainingKmPerSecond > 0
    this.setEnabled(enabled)
    for (const { button, direction } of this.buttons) {
      button.disabled = !enabled && model?.burning !== direction
      button.classList.toggle('is-burning', model?.burning === direction)
    }
  }

  /** Listening only while the controls are shown; going away ends a burn. */
  setActive(active: boolean): void {
    this.active = active
    if (!active) this.release()
  }

  /** Whether a burn may run (a game in play with fuel left). Disabling ends a
   *  held burn, as a disabled button may never hear its release. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.release()
  }

  dispose(): void {
    this.release()
    this.documentRef.removeEventListener('keydown', this.onKeyDown)
    this.documentRef.removeEventListener('keyup', this.onKeyUp)
    this.documentRef.removeEventListener('visibilitychange', this.onVisibility)
    this.documentRef.defaultView?.removeEventListener('blur', this.onBlur)
  }

  private keyDown(event: KeyboardEvent): void {
    const direction = KEY_DIRECTIONS[event.key.toLowerCase()]
    if (!this.active || !direction || event.ctrlKey || event.metaKey || event.altKey || keyBelongsToControl(event.target)) return
    event.preventDefault()
    if (event.repeat || this.holder) return
    this.press(direction, { kind: 'key', key: event.key.toLowerCase() })
  }

  private keyUp(event: KeyboardEvent): void {
    if (this.holder?.kind === 'key' && this.holder.key === event.key.toLowerCase()) this.release()
  }

  private press(direction: BurnDirection, holder: Holder): void {
    if (!this.active || !this.enabled) return
    this.holder = holder
    this.callbacks.onBurnPress(direction)
  }

  private release(): void {
    if (!this.holder) return
    this.holder = null
    this.callbacks.onBurnRelease()
  }
}
