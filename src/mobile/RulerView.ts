import { EARTH_RADIUS_KM } from '../core/constants.ts'
import { text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'
import { icon } from './mobileIcons.ts'
import { capturePointer } from './PanelHost.ts'
import { dragValue, normalizeRulerValue, snapAt, stepBy, type RulerSpec, type SnapPoint } from './shapeRulerModel.ts'

export interface RulerCallbacks {
  /** A new value from a drag, a step or a key. */
  onChange(value: number, snap: SnapPoint | null): void
  /** An adjustment starts or ends (containment follows Size and Shape). */
  onAdjust(phase: 'start' | 'end'): void
}

export interface RulerEnvironment {
  /** `navigator.vibrate` where it exists; iOS Safari has none. */
  readonly vibrate?: (durationMs: number) => void
  readonly setTimeout: (handler: () => void, ms: number) => number
  readonly clearTimeout: (id: number) => void
  readonly setInterval: (handler: () => void, ms: number) => number
  readonly clearInterval: (id: number) => void
}

/** − and + repeat when held, after 400 ms, 8 steps per second. */
export const HOLD_DELAY_MS = 400
export const HOLD_INTERVAL_MS = 125
/** After this many repeats (one second) a held button moves three steps at a time. */
export const HOLD_ACCELERATE_AFTER = 8
export const HOLD_ACCELERATED_STEPS = 3
/** Page Up and Page Down move this many button steps. */
export const PAGE_STEPS = 5
/** A 10 ms vibration on arriving at a snap point. */
export const SNAP_VIBRATION_MS = 10

export function rulerMarkup(): string {
  const t = text().mobile.shape
  return html`
    <button class="m-icon-button m-ruler-step" type="button" data-step="-1" aria-label="${t.decrease}">${trusted(icon('minus'))}</button>
    <div class="m-ruler-track" role="slider" tabindex="0" aria-orientation="horizontal">
      <canvas class="m-ruler-scale" aria-hidden="true"></canvas>
      <span class="m-ruler-needle" aria-hidden="true"></span>
      <span class="m-ruler-snap" aria-hidden="true"></span>
    </div>
    <button class="m-icon-button m-ruler-step" type="button" data-step="1" aria-label="${t.increase}">${trusted(icon('plus'))}</button>
  `
}

/** Tick spacing for the drawn scale, in ruler units: minor and major. */
function tickSteps(spec: RulerSpec): readonly [number, number] {
  switch (spec.parameter) {
    case 'shape': return [0.01, 0.1]
    case 'tilt': return [5, 30]
    default: return [10, 90]
  }
}

/** Altitude ticks for the logarithmic Size scale: 1, 2 and 5 of each decade major. */
function sizeTicks(): readonly { readonly value: number; readonly major: boolean }[] {
  const ticks: { value: number; major: boolean }[] = []
  for (const decade of [100, 1000, 10000]) for (let multiple = 1; multiple <= 9; multiple += 1) ticks.push({ value: decade * multiple, major: multiple === 1 || multiple === 2 || multiple === 5 })
  return ticks
}

/** The horizontal scale read at a fixed centre needle.
 *  Dragging moves the scale; release stops it (no fling). − and + step once
 *  and repeat when held. Arrows step, Page Up and Page Down step ten, Home
 *  and End go to the limits. It is a `slider` with value text that includes
 *  the unit and any snap label. */
export class RulerView {
  readonly root: HTMLElement
  private readonly callbacks: RulerCallbacks
  private readonly environment: RulerEnvironment
  private readonly track: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly snapLabel: HTMLElement
  private spec: RulerSpec | null = null
  private value = 0
  private drag: { readonly pointerId: number; readonly startX: number; readonly startValue: number; lastSnap: SnapPoint | null } | null = null
  private hold: { timeout: number | null; interval: number | null; direction: -1 | 1; repeats: number } | null = null
  private resizeObserver: ResizeObserver | null = null
  private snapText: (snap: SnapPoint) => string = () => ''

  constructor(documentRef: Document, callbacks: RulerCallbacks, environment: RulerEnvironment) {
    this.callbacks = callbacks
    this.environment = environment
    this.root = documentRef.createElement('div')
    this.root.className = 'm-ruler'
    this.root.innerHTML = rulerMarkup()
    this.track = this.root.querySelector<HTMLElement>('.m-ruler-track')!
    this.canvas = this.root.querySelector<HTMLCanvasElement>('.m-ruler-scale')!
    this.snapLabel = this.root.querySelector<HTMLElement>('.m-ruler-snap')!
    this.track.addEventListener('pointerdown', (event) => this.startDrag(event))
    this.track.addEventListener('pointermove', (event) => this.moveDrag(event))
    this.track.addEventListener('pointerup', (event) => this.endDrag(event.pointerId))
    this.track.addEventListener('pointercancel', (event) => this.endDrag(event.pointerId))
    this.track.addEventListener('keydown', (event) => this.onKey(event))
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.m-ruler-step')) {
      const direction = Number(button.dataset.step) as -1 | 1
      button.addEventListener('pointerdown', (event) => { if (event.button === 0) this.startHold(direction) })
      for (const type of ['pointerup', 'pointerleave', 'pointercancel'] as const) button.addEventListener(type, () => this.stopHold())
      // A keyboard or assistive activation steps once.
      button.addEventListener('click', (event) => { if (event.detail === 0) { this.callbacks.onAdjust('start'); this.step(direction, 1); this.callbacks.onAdjust('end') } })
    }
    const view = documentRef.defaultView
    if (view && typeof view.ResizeObserver === 'function') {
      this.resizeObserver = new view.ResizeObserver(() => this.draw())
      this.resizeObserver.observe(this.track)
    }
  }

  get dragging(): boolean { return this.drag !== null || this.hold !== null }

  /** A new chip or orbit: the scale, its value and how snap labels read. */
  setSpec(spec: RulerSpec, value: number, snapText: (snap: SnapPoint) => string): void {
    this.spec = spec
    this.snapText = snapText
    this.track.setAttribute('aria-valuemin', String(spec.min))
    this.track.setAttribute('aria-valuemax', String(spec.wraps ? 360 - spec.step : spec.max))
    this.setValue(value)
  }

  /** The value the application holds (clamped if it clamped). During a drag
   *  the scale still follows the finger from where the drag started. */
  setValue(value: number): void {
    if (!this.spec) return
    const next = normalizeRulerValue(this.spec, value)
    const changed = next !== this.value
    this.value = next
    this.track.setAttribute('aria-valuenow', String(Number(next.toFixed(3))))
    const snap = snapAt(this.spec, next)
    const label = snap?.label ? this.snapText(snap) : ''
    if (this.snapLabel.textContent !== label) this.snapLabel.textContent = label
    if (changed || this.canvas.width === 0) this.draw()
  }

  /** The accessible name and value text (value, unit and snap label). */
  setAccessibleText(name: string, valueText: string): void {
    this.track.setAttribute('aria-label', name)
    this.track.setAttribute('aria-valuetext', valueText)
  }

  setDisabled(disabled: boolean): void {
    this.root.classList.toggle('is-disabled', disabled)
    this.track.setAttribute('aria-disabled', String(disabled))
    this.track.tabIndex = disabled ? -1 : 0
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.m-ruler-step')) button.disabled = disabled
    if (disabled) { this.cancel() }
  }

  dispose(): void {
    this.cancel()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
  }

  private cancel(): void {
    if (this.drag) { this.drag = null; this.callbacks.onAdjust('end') }
    this.stopHold()
  }

  private emit(value: number, snap: SnapPoint | null): void {
    if (!this.spec) return
    const next = normalizeRulerValue(this.spec, value)
    if (next === this.value) return
    this.setValue(next)
    this.callbacks.onChange(next, snap)
  }

  private step(direction: -1 | 1, count: number): void {
    if (!this.spec) return
    const next = stepBy(this.spec, this.value, direction, count)
    this.emit(next, snapAt(this.spec, next))
  }

  private startDrag(event: PointerEvent): void {
    if (!this.spec || this.root.classList.contains('is-disabled') || (event.button !== 0 && event.pointerType === 'mouse')) return
    this.drag = { pointerId: event.pointerId, startX: event.clientX, startValue: this.value, lastSnap: snapAt(this.spec, this.value) }
    capturePointer(this.track, event.pointerId)
    this.callbacks.onAdjust('start')
  }

  private moveDrag(event: PointerEvent): void {
    const drag = this.drag
    if (!drag || !this.spec || drag.pointerId !== event.pointerId) return
    const result = dragValue(this.spec, drag.startValue, event.clientX - drag.startX)
    if (result.snap && result.snap !== drag.lastSnap) this.environment.vibrate?.(SNAP_VIBRATION_MS)
    drag.lastSnap = result.snap
    this.emit(result.value, result.snap)
  }

  private endDrag(pointerId: number): void {
    if (!this.drag || this.drag.pointerId !== pointerId) return
    this.drag = null
    this.callbacks.onAdjust('end')
  }

  private startHold(direction: -1 | 1): void {
    this.stopHold()
    this.callbacks.onAdjust('start')
    this.step(direction, 1)
    const hold: { timeout: number | null; interval: number | null; direction: -1 | 1; repeats: number } = { timeout: null, interval: null, direction, repeats: 0 }
    hold.timeout = this.environment.setTimeout(() => {
      hold.timeout = null
      hold.interval = this.environment.setInterval(() => {
        hold.repeats += 1
        this.step(hold.direction, hold.repeats > HOLD_ACCELERATE_AFTER ? HOLD_ACCELERATED_STEPS : 1)
      }, HOLD_INTERVAL_MS)
    }, HOLD_DELAY_MS)
    this.hold = hold
  }

  private stopHold(): void {
    const hold = this.hold
    if (!hold) return
    this.hold = null
    if (hold.timeout !== null) this.environment.clearTimeout(hold.timeout)
    if (hold.interval !== null) this.environment.clearInterval(hold.interval)
    this.callbacks.onAdjust('end')
  }

  private onKey(event: KeyboardEvent): void {
    const spec = this.spec
    if (!spec || this.root.classList.contains('is-disabled')) return
    let next: number | null = null
    switch (event.key) {
      case 'ArrowRight': case 'ArrowUp': next = stepBy(spec, this.value, 1); break
      case 'ArrowLeft': case 'ArrowDown': next = stepBy(spec, this.value, -1); break
      case 'PageUp': next = stepBy(spec, this.value, 1, PAGE_STEPS); break
      case 'PageDown': next = stepBy(spec, this.value, -1, PAGE_STEPS); break
      case 'Home': next = spec.min; break
      case 'End': next = spec.wraps ? 360 - spec.step : spec.max; break
      default: return
    }
    event.preventDefault()
    this.callbacks.onAdjust('start')
    this.emit(next, snapAt(spec, next))
    this.callbacks.onAdjust('end')
  }

  /** Draws the ticks around the current value, centred on the needle. */
  private draw(): void {
    const spec = this.spec
    const width = this.track.clientWidth
    const height = this.track.clientHeight
    if (!spec || width <= 0 || height <= 0) return
    const ratio = Math.min(this.canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1, 3)
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio)
      this.canvas.height = Math.round(height * ratio)
    }
    const context = this.canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    const centre = spec.valueToPosition(this.value)
    const toX = (position: number) => width / 2 + position - centre
    const period = spec.wraps ? spec.valueToPosition(spec.min + 360) - spec.valueToPosition(spec.min) : 0
    const copies = period ? [-period, 0, period] : [0]
    const drawTick = (x: number, length: number, alpha: number) => {
      if (x < -2 || x > width + 2) return
      context.globalAlpha = alpha
      context.fillRect(Math.round(x) - 0.5, height - length, 1, length)
    }
    context.fillStyle = '#b9c9da'
    if (spec.parameter === 'size') {
      for (const tick of sizeTicks()) {
        const x = toX(spec.valueToPosition(tick.value + EARTH_RADIUS_KM))
        drawTick(x, tick.major ? height * 0.55 : height * 0.3, tick.major ? 0.85 : 0.45)
      }
    } else {
      const [minor, major] = tickSteps(spec)
      const count = Math.round((spec.max - spec.min) / minor)
      for (let index = 0; index <= count; index += 1) {
        const value = spec.min + index * minor
        const isMajor = Math.abs(value / major - Math.round(value / major)) < 1e-6
        for (const offset of copies) drawTick(toX(spec.valueToPosition(value) + offset), isMajor ? height * 0.55 : height * 0.3, isMajor ? 0.85 : 0.45)
      }
    }
    context.globalAlpha = 1
    context.fillStyle = '#72d7e5'
    for (const snap of spec.snaps) for (const offset of copies) {
      const x = toX(spec.valueToPosition(snap.value) + offset)
      if (x < -4 || x > width + 4) continue
      context.beginPath()
      context.arc(x, height * 0.25, snap.label ? 3 : 2, 0, Math.PI * 2)
      context.fill()
    }
  }
}
