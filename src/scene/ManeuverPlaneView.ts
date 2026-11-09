import { MAX_DEVICE_PIXEL_RATIO } from '../core/constants.ts'
import type { ProjectInertialVec3 } from '../core/referenceFrames.ts'
import { lengthVec3 } from '../core/vec3.ts'
import type { OrbitPlaneBasis } from '../orbital/inPlaneState.ts'
import type { OrbitApsis } from '../simulation/maneuverGame.ts'
import {
  ALTITUDE_VIEW_FLOOR_KM, altitudeRadius, altitudeViewPoint, FLOOR_DISC_UNITS, fitAltitudeCamera, panAltitudeCamera, ringAltitudes, toScreen, zoomAltitudeCamera,
  type AltitudeCamera, type ViewPoint,
} from './altitudeProjection.ts'
import { MANEUVER_COLORS } from './ManeuverSceneView.ts'

export interface PlaneFrame {
  readonly basis: OrbitPlaneBasis
  readonly player: ProjectInertialVec3
  readonly target: ProjectInertialVec3
  /** Oldest first, ending at the satellite. */
  readonly playerTrail: readonly ProjectInertialVec3[]
  readonly targetTrail: readonly ProjectInertialVec3[]
  /** The dashed aim line, or null when there is none. */
  readonly arc: readonly ProjectInertialVec3[] | null
  /** The apogee and perigee marks; empty when Aid is off. */
  readonly apsides: readonly OrbitApsis[]
  readonly warningRadiusKm: number
  /** The highest altitude the view must hold when it fits itself. */
  readonly extentAltitudeKm: number
}

/** The parts of the canvas covered by interface panels, in CSS pixels. */
export interface PlaneInsets {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface PlaneWords {
  /** One line saying what distance from the centre means. */
  readonly note: string
  readonly label: string
  readonly ring: (altitudeKm: number) => string
}

const css = (hex: number, alpha = 1): string => `rgba(${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}, ${alpha})`
const TAP_SLOP_PX = 6
const TAP_MS = 500

/** The orbital plane altitude view: Interception's default view, drawn on its
 *  own 2D canvas in place of the 3D view. Distance from the centre shows
 *  altitude (see `altitudeProjection.ts`); a drag pans and a wheel or pinch
 *  zooms. There is no rotation. A plain tap is passed on, so the phone's
 *  empty-tap rules still apply. */
export class ManeuverPlaneView {
  readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D | null
  private readonly onTap: () => void
  private words: PlaneWords
  private camera: AltitudeCamera | null = null
  private fittedExtentKm = 0
  /** The learner moved or zoomed the view since it last fitted itself. */
  private adjusted = false
  private insets: PlaneInsets = { left: 0, top: 0, right: 0, bottom: 0 }
  private noteShown = true
  private readonly pointers = new Map<number, ViewPoint>()
  private gesture: { readonly start: ViewPoint; readonly startedMs: number; moved: boolean } | null = null
  private markers: { player: ViewPoint | null; target: ViewPoint | null; apsides: readonly (ViewPoint | null)[] } = { player: null, target: null, apsides: [] }

  constructor(after: HTMLElement, words: PlaneWords, onTap: () => void) {
    this.canvas = after.ownerDocument.createElement('canvas')
    this.canvas.className = 'altitude-view'
    this.canvas.hidden = true
    this.context = this.canvas.getContext('2d')
    this.onTap = onTap
    this.words = words
    this.applyWords()
    after.after(this.canvas)
    this.bindInput()
  }

  setVisible(visible: boolean): void {
    if (this.canvas.hidden === !visible) return
    this.canvas.hidden = !visible
    if (!visible) { this.pointers.clear(); this.gesture = null }
  }

  setWords(words: PlaneWords): void { this.words = words; this.applyWords() }

  /** Whether the "not to scale" line is drawn: phones leave it to the label. */
  setNoteShown(shown: boolean): void { this.noteShown = shown }

  setInsets(insets: PlaneInsets): void { this.insets = insets }

  /** Fits the view to the game again on the next frame. */
  fit(): void { this.camera = null; this.adjusted = false }

  /** Screen positions of the markers drawn last, for the labels. */
  markerPositions(): { readonly player: ViewPoint | null; readonly target: ViewPoint | null; readonly apsides: readonly (ViewPoint | null)[] } { return this.markers }

  draw(frame: PlaneFrame): void {
    const context = this.context
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (!context || width === 0 || height === 0) return
    const ratio = Math.min(this.canvas.ownerDocument.defaultView?.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO)
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio)
      this.canvas.height = Math.round(height * ratio)
    }
    const free = this.freeArea(width, height)
    // The view grows to hold a raised orbit until the learner takes over.
    if (!this.camera || (!this.adjusted && frame.extentAltitudeKm > this.fittedExtentKm + 1)) {
      this.camera = fitAltitudeCamera(frame.extentAltitudeKm, free.width, free.height)
      this.fittedExtentKm = frame.extentAltitudeKm
    }
    const camera = this.camera
    const origin = free.origin
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.fillStyle = '#030a14'
    context.fillRect(0, 0, width, height)
    const centre = toScreen({ x: 0, y: 0 }, camera, origin)
    this.drawRings(context, centre, camera.scale, width, height)
    const project = (points: readonly ProjectInertialVec3[]) => points.map((point) => toScreen(altitudeViewPoint(point, frame.basis), camera, origin))
    this.drawTrail(context, project(frame.targetTrail), MANEUVER_COLORS.target)
    this.drawTrail(context, project(frame.playerTrail), MANEUVER_COLORS.player)
    if (frame.arc) this.drawArc(context, frame.arc, project(frame.arc), frame.warningRadiusKm)
    const apsides = project(frame.apsides.map((apsis) => apsis.state.positionProjectInertialKm))
    for (const apsis of apsides) this.drawApsis(context, apsis)
    const target = toScreen(altitudeViewPoint(frame.target, frame.basis), camera, origin)
    const player = toScreen(altitudeViewPoint(frame.player, frame.basis), camera, origin)
    this.drawMarker(context, target, MANEUVER_COLORS.target)
    this.drawMarker(context, player, MANEUVER_COLORS.player)
    const inside = (point: ViewPoint) => point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height ? point : null
    this.markers = { player: inside(player), target: inside(target), apsides: apsides.map(inside) }
    if (this.noteShown) this.drawNote(context, free.width)
  }

  /** The "not to scale" line, on a dark backing so rings never hide it. */
  private drawNote(context: CanvasRenderingContext2D, freeWidth: number): void {
    context.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif'
    context.textAlign = 'left'
    context.textBaseline = 'top'
    const x = this.insets.left + 12
    const y = this.insets.top + 10
    const maxWidth = Math.max(80, freeWidth - 32)
    const width = Math.min(maxWidth, context.measureText(this.words.note).width)
    context.fillStyle = 'rgba(3, 10, 20, 0.82)'
    context.beginPath()
    context.roundRect(x - 6, y - 4, width + 12, 22, 6)
    context.fill()
    context.fillStyle = 'rgba(205, 219, 233, 0.9)'
    context.fillText(this.words.note, x, y + 1, maxWidth)
  }

  dispose(): void { this.canvas.remove() }

  private applyWords(): void {
    this.canvas.setAttribute('role', 'img')
    this.canvas.setAttribute('aria-label', `${this.words.label}. ${this.words.note}`)
  }

  private freeArea(width: number, height: number): { readonly width: number; readonly height: number; readonly origin: ViewPoint } {
    const free = { width: Math.max(40, width - this.insets.left - this.insets.right), height: Math.max(40, height - this.insets.top - this.insets.bottom) }
    return { ...free, origin: { x: this.insets.left + free.width / 2, y: this.insets.top + free.height / 2 } }
  }

  private drawRings(context: CanvasRenderingContext2D, centre: ViewPoint, scale: number, width: number, height: number): void {
    const farthestPx = Math.max(...[[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => Math.hypot(x - centre.x, y - centre.y)))
    const maxAltitude = farthestPx / scale - FLOOR_DISC_UNITS + ALTITUDE_VIEW_FLOOR_KM
    context.lineWidth = 1
    context.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'bottom'
    for (const altitude of ringAltitudes(maxAltitude, scale)) {
      const radius = altitudeRadius(altitude) * scale
      context.strokeStyle = 'rgba(145, 180, 216, 0.2)'
      context.beginPath()
      context.arc(centre.x, centre.y, radius, 0, Math.PI * 2)
      context.stroke()
      context.fillStyle = 'rgba(185, 201, 218, 0.62)'
      context.fillText(this.words.ring(altitude), centre.x, centre.y - radius - 2)
    }
    const floor = FLOOR_DISC_UNITS * scale
    context.fillStyle = css(MANEUVER_COLORS.warning, 0.16)
    context.strokeStyle = css(MANEUVER_COLORS.warning, 0.7)
    context.beginPath()
    context.arc(centre.x, centre.y, floor, 0, Math.PI * 2)
    context.fill()
    context.stroke()
    context.fillStyle = css(MANEUVER_COLORS.warning, 0.95)
    context.fillText(this.words.ring(ALTITUDE_VIEW_FLOOR_KM), centre.x, centre.y - floor - 2)
  }

  /** Brightens from the tail to the satellite, so the trail reads as a
   *  direction of travel. */
  private drawTrail(context: CanvasRenderingContext2D, points: readonly ViewPoint[], colorHex: number): void {
    if (points.length < 2) return
    context.lineWidth = 2
    context.setLineDash([])
    for (let index = 1; index < points.length; index += 1) {
      context.strokeStyle = css(colorHex, 0.15 + 0.85 * (index / (points.length - 1)))
      context.beginPath()
      context.moveTo(points[index - 1].x, points[index - 1].y)
      context.lineTo(points[index].x, points[index].y)
      context.stroke()
    }
  }

  /** A hollow mark, so it reads as a place on the orbit and not a satellite. */
  private drawApsis(context: CanvasRenderingContext2D, point: ViewPoint): void {
    context.fillStyle = '#030a14'
    context.strokeStyle = css(MANEUVER_COLORS.apsis)
    context.lineWidth = 2
    context.beginPath()
    context.arc(point.x, point.y, 5, 0, Math.PI * 2)
    context.fill()
    context.stroke()
  }

  /** The dashed aim line. Each run of one colour is a single path, or the dash
   *  pattern would restart at every sample. Runs start from the far end, so
   *  the dashes stay still while the satellite flies along them. */
  private drawArc(context: CanvasRenderingContext2D, points: readonly ProjectInertialVec3[], screen: readonly ViewPoint[], warningRadiusKm: number): void {
    const isLow = (index: number) => lengthVec3(points[index]) < warningRadiusKm
    context.lineWidth = 2
    context.setLineDash([8, 6])
    let index = screen.length - 1
    while (index > 0) {
      const low = isLow(index)
      context.strokeStyle = css(low ? MANEUVER_COLORS.warning : MANEUVER_COLORS.player, 0.95)
      context.beginPath()
      context.moveTo(screen[index].x, screen[index].y)
      while (index > 0 && isLow(index) === low) {
        index -= 1
        context.lineTo(screen[index].x, screen[index].y)
      }
      context.stroke()
    }
    context.setLineDash([])
  }

  private drawMarker(context: CanvasRenderingContext2D, point: ViewPoint, colorHex: number): void {
    context.fillStyle = css(colorHex)
    context.strokeStyle = 'rgba(231, 251, 255, 0.9)'
    context.lineWidth = 1.5
    context.beginPath()
    context.arc(point.x, point.y, 5.5, 0, Math.PI * 2)
    context.fill()
    context.stroke()
  }

  private origin(): ViewPoint { return this.freeArea(this.canvas.clientWidth, this.canvas.clientHeight).origin }

  private bindInput(): void {
    const canvas = this.canvas
    const at = (event: PointerEvent | WheelEvent): ViewPoint => ({ x: event.offsetX, y: event.offsetY })
    canvas.addEventListener('pointerdown', (event) => {
      try { canvas.setPointerCapture(event.pointerId) } catch { /* the pointer is already gone */ }
      this.pointers.set(event.pointerId, at(event))
      if (this.pointers.size === 1) this.gesture = { start: at(event), startedMs: event.timeStamp, moved: false }
      else if (this.gesture) this.gesture.moved = true
    })
    canvas.addEventListener('pointermove', (event) => {
      const previous = this.pointers.get(event.pointerId)
      if (!previous || !this.camera) return
      const next = at(event)
      if (this.pointers.size === 1) {
        this.camera = panAltitudeCamera(this.camera, next.x - previous.x, next.y - previous.y)
        if (this.gesture && Math.hypot(next.x - this.gesture.start.x, next.y - this.gesture.start.y) > TAP_SLOP_PX) this.gesture.moved = true
      } else {
        // Pinch: zoom about the fingers' midpoint and follow it.
        const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)?.[1]
        if (other) {
          const before = Math.hypot(previous.x - other.x, previous.y - other.y)
          const after = Math.hypot(next.x - other.x, next.y - other.y)
          const midpoint = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 }
          this.camera = panAltitudeCamera(this.camera, (next.x - previous.x) / 2, (next.y - previous.y) / 2)
          if (before > 0) this.camera = zoomAltitudeCamera(this.camera, this.origin(), midpoint, after / before)
        }
      }
      if (this.gesture?.moved) this.adjusted = true
      this.pointers.set(event.pointerId, next)
    })
    const end = (event: PointerEvent) => {
      if (!this.pointers.delete(event.pointerId)) return
      if (this.pointers.size > 0) return
      const gesture = this.gesture
      this.gesture = null
      if (event.type === 'pointerup' && gesture && !gesture.moved && event.timeStamp - gesture.startedMs < TAP_MS) this.onTap()
    }
    canvas.addEventListener('pointerup', end)
    canvas.addEventListener('pointercancel', end)
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault()
      if (!this.camera) return
      this.camera = zoomAltitudeCamera(this.camera, this.origin(), at(event), Math.exp(-event.deltaY * 0.0015))
      this.adjusted = true
    }, { passive: false })
    canvas.addEventListener('dblclick', () => this.fit())
  }
}
