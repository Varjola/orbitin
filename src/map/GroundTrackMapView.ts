import { MAX_DEVICE_PIXEL_RATIO } from '../core/constants.ts'
import { format, text } from '../i18n/index.ts'
import { distanceToPolylineCssPx, pointNearRect, rectOfPoints, type ScreenPoint, type ScreenRect } from '../core/screenGeometry.ts'
import type { GroundTrackSegment, GroundTrackWindow, SubSatellitePoint } from '../simulation/groundTrack.ts'
import { loadCoastline, type CoastlineData, type CoastlineResult } from './coastlineData.ts'
import type { BoundaryData } from './geographyData.ts'
import { nightShadeGrid } from './nightShading.ts'
import {
  isDrawableBounds,
  MAP_ASPECT_RATIO,
  placeCurrentPoint,
  projectDegrees,
  projectGeodeticUnwrapped,
  projectGroundTrackSegment,
  type CurrentPointPlacement,
  type MapBounds,
  type MapPolyline,
} from './equirectangularProjection.ts'
import { planHistoryDraw, type DrawnSegment } from './trackDrawPlan.ts'
import { planFootprintDraw } from './footprintDrawPlan.ts'
import type { InstantaneousSensorGeometry, SphericalSensorCap } from '../simulation/sensorFootprint.ts'

/** What the map needs to know about one object. Deliberately not
 *  `OrbitalObject`: the map layer owns no simulation, propagation or
 *  application state, and this keeps that boundary a compile-time fact. */
export interface MapObjectDescriptor {
  readonly id: string
  readonly name: string
  readonly colorHex: number
  /** Ground track visible. */
  readonly visible: boolean
  readonly sensorVisible?: boolean
  /** The current-position marker is drawn for every visible body. */
  readonly bodyVisible?: boolean
  readonly selected: boolean
}

/** Structurally the runtime's `GroundTrackViewPort`, declared here so `map/`
 *  never imports the application layer. */
export interface GroundTrackMapObjectPort {
  setCurrent(point: SubSatellitePoint | null): void
  setWindow(window: GroundTrackWindow | null): void
  setHistory(segments: readonly GroundTrackSegment[] | null): void
  setVisible(visible: boolean): void
  setColor(colorHex: number): void
  setSelected(selected: boolean): void
  setGeometry(geometry: InstantaneousSensorGeometry | null): void
  setSensorVisible(visible: boolean): void
  setBodyVisible(visible: boolean): void
  setName(name: string): void
  dispose(): void
}

/** A map pick candidate, structurally the interaction layer's `PickHit`.
 *  Map hits carry the neutral depth 0. */
export interface MapPickHit {
  readonly objectId: string
  readonly kind: 'mapMarker' | 'mapTrack'
  readonly distanceCssPx: number
  readonly depth: 0
}

export interface GroundTrackMapViewOptions {
  /** Injected so the view can be exercised without a browser DOM. */
  readonly documentRef?: Document
  readonly devicePixelRatio?: () => number
  readonly loadCoastline?: () => Promise<CoastlineResult>
  readonly measure?: (element: HTMLElement) => { width: number; height: number }
  readonly observeResize?: (element: HTMLElement, onResize: () => void) => () => void
  /** Real-time clock for redraw coalescing and reveal animation. */
  readonly now?: () => number
  readonly onClose?: () => void
  readonly onToggleMaximized?: () => void
}

export const MAP_MAX_CONTENT_WIDTH_CSS_PX = 768
/** Names listed in the legend before `+<k> more`. */
export const MAP_LEGEND_NAME_LIMIT = 10
/** Selected objects named beside their markers, primary first. */
export const MAP_SELECTED_LABEL_LIMIT = 10
export const MAP_MARKER_PICK_RADIUS_CSS_PX = 8
export const MAP_TRACK_PICK_RADIUS_CSS_PX = 5
/** Unselected tracks share one canvas. Window and history updates redraw it
 *  at most this often; selection, visibility, colour and layout changes
 *  redraw it at once. Selected tracks have their own canvas and never wait. */
export const MAP_TRACK_COMPOSITE_MIN_INTERVAL_MS = 100
/** In the maximized map a composite with more tracks
 *  than this is rebuilt progressively - this many tracks per frame into a
 *  back buffer, which then replaces the visible composite in one copy - so
 *  no single frame rasterizes every track on the large canvas. */
export const MAP_TRACK_BUILD_LAYERS_PER_FRAME = 4
/** Unselected window and history updates start a new maximized rebuild at
 *  most this often. */
export const MAP_MAXIMIZED_TRACK_MIN_INTERVAL_MS = 250
export const MAP_REVEAL_DURATION_MS = 1200

export function mapLegendSummary(objects: number, tracks: number, sensors: number): string {
  return text().map.legendSummary(objects, tracks, sensors)
}

/** The one non-fatal condition the map reports, independent of language. */
export type MapStatus = 'coastline-unavailable' | 'canvas-unavailable'

const OCEAN_FILL = '#0a1a2b'
const GRATICULE = 'rgba(140, 175, 210, 0.16)'
const GRATICULE_MAJOR = 'rgba(150, 190, 225, 0.34)'
const COASTLINE = 'rgba(150, 186, 214, 0.55)'
const BORDER_LINE = 'rgba(214, 200, 176, 0.5)'
const BORDER = 'rgba(153, 191, 230, 0.35)'
const LABEL = 'rgba(180, 202, 224, 0.72)'
const UNDERSTROKE = 'rgba(3, 10, 20, 0.85)'
const HALO = 'rgba(231, 251, 255, 0.9)'
const OBSERVER = '#f2c879'
/** The night shade's colour, its grid and the sub-solar mark. */
const NIGHT_RGB: readonly [number, number, number] = [2, 7, 18]
const NIGHT_GRID_COLUMNS = 360
const NIGHT_GRID_ROWS = 180
const SUB_SOLAR = '#ffd98a'
/** The Sun must move this far before the shade is redrawn, at most this often. */
const SUN_REDRAW_RAD = (0.2 * Math.PI) / 180
const SUN_REDRAW_INTERVAL_MS = 250
const TRACK_WIDTH = 1.5
const SELECTED_TRACK_WIDTH = 2.5
const HOVERED_TRACK_WIDTH = 3.5
const SELECTED_UNDERSTROKE_WIDTH = 4
const LEADING_DASH: readonly number[] = [6, 4.5]
const LEADING_ALPHA = 0.55
const TRACK_ALPHA = 0.9
const MARKER_RADIUS = 3
const SELECTED_MARKER_RADIUS = 4.5
const GRATICULE_STEP_DEG = 30
const FOOTPRINT_FILL_ALPHA = 0.2
const FOR_LINE_ALPHA = 0.58
const SENSOR_LINE_WIDTH = 1.5
const SELECTED_SENSOR_LINE_WIDTH = 2.5
const SENSOR_DASH: readonly number[] = [5, 4]

interface CachedPolyline {
  readonly polyline: MapPolyline
  readonly rect: ScreenRect
  readonly dashed: boolean
}

interface ObjectLayer {
  readonly id: string
  name: string
  colorHex: number
  /** Ground track visible. */
  visible: boolean
  sensorVisible: boolean
  bodyVisible: boolean
  selected: boolean
  disposed: boolean
  current: SubSatellitePoint | null
  sensorGeometry: InstantaneousSensorGeometry | null
  window: GroundTrackWindow | null
  history: readonly GroundTrackSegment[] | null
  /** Projected track polylines for the current bounds; also the pick geometry. */
  projectedWindowSource: GroundTrackWindow | null
  projectedWindow: CachedPolyline[]
  projectedHistory: CachedPolyline[]
  drawnHistory: readonly DrawnSegment[] | null
  /** Where the marker was last drawn, for picking. */
  placement: CurrentPointPlacement | null
}

type CompositeKind = 'tracks' | 'selectedTracks'

/** A progressive composite rebuild in the back buffer. */
interface TrackBuild {
  readonly kind: CompositeKind
  readonly layerIds: readonly string[]
  next: number
  /** Layers already drawn into the back buffer; appended history pieces for
   *  these are stroked into it as well, so the swap loses nothing. */
  readonly drawn: Set<string>
}

/** The 2D map: a DOM/Canvas view over data that already exists.
 *
 * It owns no clock, propagator, sampler, history recorder or object collection.
 * Every point it draws arrives through `createObjectLayer`, by the same
 * `GroundTrackViewPort` calls that drive the three.js globe, so the two views
 * cannot disagree about what happened at an instant.
 *
 * The backing store is a fixed set of four canvases - background,
 * unselected tracks, selected tracks and an overlay for sensor areas, markers,
 * emphasis and labels - so map memory no longer grows with the number of
 * tracks.
 */
export class GroundTrackMapView {
  readonly element: HTMLElement
  private readonly documentRef: Document
  private readonly frame: HTMLElement
  private readonly legendSummary: HTMLElement
  private readonly legendList: HTMLElement
  private readonly emptyPrompt: HTMLElement
  private readonly status: HTMLElement
  private readonly closeButton: HTMLButtonElement
  private readonly maximizeButton: HTMLButtonElement
  private readonly title: HTMLElement
  private readonly lineKey: HTMLElement
  private readonly surfaceNote: HTMLElement
  private readonly background: HTMLCanvasElement
  private readonly tracks: HTMLCanvasElement
  private readonly selectedTracks: HTMLCanvasElement
  private readonly overlay: HTMLCanvasElement
  private backgroundContext: CanvasRenderingContext2D | null = null
  private trackContext: CanvasRenderingContext2D | null = null
  private selectedTrackContext: CanvasRenderingContext2D | null = null
  private overlayContext: CanvasRenderingContext2D | null = null
  private readonly layers = new Map<string, ObjectLayer>()
  private readonly devicePixelRatioOf: () => number
  private readonly measure: (element: HTMLElement) => { width: number; height: number }
  private readonly loadCoastlineAsset: () => Promise<CoastlineResult>
  private readonly now: () => number
  private readonly stopObservingResize: () => void
  private coastline: CoastlineData | null = null
  /** Country borders while the learner has them on. */
  private borders: BoundaryData | null = null
  private coastlineState: 'idle' | 'loading' | 'ready' | 'unavailable' = 'idle'
  private isOpen = false
  private isMaximized = false
  private disabled = false
  private disposedView = false
  private backgroundDirty = true
  private overlayDirty = true
  private observer: { readonly geodeticLatitudeRad: number; readonly longitudeRad: number } | null = null
  /** The sub-solar point, and the one the shade shows. */
  private sun: { readonly latitudeRad: number; readonly longitudeRad: number } | null = null
  private shadedSun: { readonly latitudeRad: number; readonly longitudeRad: number } | null = null
  private lastSunRedrawMs = -Infinity
  private nightCanvas: HTMLCanvasElement | null = null
  private legendDirty = true
  private layoutDirty = true
  /** Full redraw needed at once (structure) or when the interval allows (data). */
  private readonly compositeDirty: Record<CompositeKind, 'none' | 'data' | 'structure'> = { tracks: 'structure', selectedTracks: 'structure' }
  private lastCompositeRedrawMs = -Infinity
  /** Maximized map only: one shared back buffer, created on first need. */
  private backBuffer: HTMLCanvasElement | null = null
  private backContext: CanvasRenderingContext2D | null = null
  private build: TrackBuild | null = null
  private lastBuildKind: CompositeKind | null = null
  private drawableSeen = false
  private cssWidth = 0
  private cssHeight = 0
  private pixelRatio = 1
  private layoutMaximized = false
  private bounds: MapBounds = { left: 0, top: 0, width: 0, height: 0 }
  private statusKind: MapStatus | null = null
  private hoveredId: string | null = null
  private hoverLabel: string | null = null
  private primaryId: string | null = null
  private reveals: ReadonlyMap<string, number> = new Map()
  private reducedMotion = false
  /** Redraw counters, exposed for verification. */
  compositeRedraws = 0

  constructor(parent: HTMLElement, options: GroundTrackMapViewOptions = {}) {
    this.documentRef = options.documentRef ?? globalThis.document
    this.devicePixelRatioOf = options.devicePixelRatio ?? (() => Math.min(MAX_DEVICE_PIXEL_RATIO, globalThis.devicePixelRatio || 1))
    this.measure = options.measure ?? ((element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
    this.loadCoastlineAsset = options.loadCoastline ?? (() => loadCoastline())
    this.now = options.now ?? (() => performance.now())

    const create = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] => {
      const element = this.documentRef.createElement(tag)
      if (className) element.className = className
      return element
    }

    this.element = create('section', 'ground-track-map')
    this.element.hidden = true

    const heading = create('div', 'map-heading')
    const title = create('span', 'map-title')
    this.title = title
    this.closeButton = create('button', 'action-button map-close')
    this.closeButton.type = 'button'
    if (options.onClose) this.closeButton.addEventListener('click', options.onClose)
    this.maximizeButton = create('button', 'action-button map-maximize')
    this.maximizeButton.type = 'button'
    this.maximizeButton.setAttribute('aria-pressed', 'false')
    if (options.onToggleMaximized) this.maximizeButton.addEventListener('click', options.onToggleMaximized)
    const headingActions = create('div', 'map-heading-actions')
    headingActions.append(this.maximizeButton, this.closeButton)
    heading.append(title, headingActions)

    this.frame = create('div', 'map-frame')
    this.frame.setAttribute('role', 'img')
    this.frame.setAttribute('aria-describedby', 'ground-track-map-legend')
    this.background = create('canvas', 'map-layer map-background')
    this.tracks = create('canvas', 'map-layer map-tracks')
    this.selectedTracks = create('canvas', 'map-layer map-selected-tracks')
    this.overlay = create('canvas', 'map-layer map-overlay')
    this.frame.append(this.background, this.tracks, this.selectedTracks, this.overlay)

    // No text below the map. The empty prompt and the
    // one non-fatal status are small notices over the map, shown only when
    // they apply; the legend stays as visually hidden text describing it.
    this.status = create('p', 'map-status')
    this.status.setAttribute('role', 'status')
    this.emptyPrompt = create('p', 'map-empty')
    const stage = create('div', 'map-stage')
    stage.append(this.frame, this.emptyPrompt, this.status)

    const legend = create('div', 'map-legend sr-only')
    legend.id = 'ground-track-map-legend'
    this.legendSummary = create('p', 'map-legend-summary')
    this.legendList = create('ul', 'map-legend-objects')
    this.lineKey = create('p', 'map-legend-key')
    this.surfaceNote = create('p', 'map-legend-note')
    legend.append(this.legendSummary, this.legendList, this.lineKey, this.surfaceNote)
    this.applyLocale()

    this.element.append(heading, stage, legend)
    parent.append(this.element)

    const observe = options.observeResize ?? defaultObserveResize
    this.stopObservingResize = observe(this.frame, () => { this.layoutDirty = true })
  }

  get open(): boolean { return this.isOpen }
  get maximized(): boolean { return this.isMaximized }
  /** The element the interaction controller listens on; the canvases stay
   *  `pointer-events: none`. */
  get frameElement(): HTMLElement { return this.frame }
  /** Exposed for verification: the single non-fatal message the map shows. */
  get statusMessage(): string { return this.statusKind === null ? '' : statusText(this.statusKind) }

  /** The map's words follow the language. Canvas labels
   *  are read when drawn, so the background and legend are redrawn. */
  applyLocale(): void {
    const t = text().map
    this.element.setAttribute('aria-label', t.title)
    this.title.textContent = t.title
    this.closeButton.textContent = t.close
    this.maximizeButton.textContent = this.isMaximized ? t.restore : t.maximize
    this.frame.setAttribute('aria-label', t.description)
    this.emptyPrompt.textContent = t.emptyPrompt
    this.lineKey.textContent = `${t.lineKey} ${t.sensorKey}`
    this.surfaceNote.textContent = t.surfaceNote
    this.status.textContent = this.statusMessage
    this.backgroundDirty = true
    this.legendDirty = true
  }
  get unavailable(): boolean { return this.disabled }

  /** One lightweight port per runtime object. It stores references to data the
   *  runtime already owns and never asks for anything back. */
  createObjectLayer(descriptor: MapObjectDescriptor): GroundTrackMapObjectPort {
    const existing = this.layers.get(descriptor.id)
    if (existing) this.removeLayer(existing)
    const layer: ObjectLayer = {
      id: descriptor.id,
      name: descriptor.name,
      colorHex: descriptor.colorHex,
      visible: descriptor.visible,
      sensorVisible: descriptor.sensorVisible ?? false,
      bodyVisible: descriptor.bodyVisible ?? true,
      selected: descriptor.selected,
      disposed: false,
      current: null,
      sensorGeometry: null,
      window: null,
      history: null,
      projectedWindowSource: null,
      projectedWindow: [],
      projectedHistory: [],
      drawnHistory: null,
      placement: null,
    }
    this.layers.set(descriptor.id, layer)
    this.legendDirty = true
    this.overlayDirty = true
    if (layer.visible) this.markComposite(layer, 'structure')
    return {
      setCurrent: (point) => {
        if (layer.disposed || (point === null && layer.current === null)) return
        layer.current = point
        this.overlayDirty = true
      },
      setGeometry: (geometry) => {
        if (layer.disposed || geometry === layer.sensorGeometry) return
        layer.sensorGeometry = geometry
        this.overlayDirty = true
      },
      setSensorVisible: (visible) => {
        if (layer.disposed || visible === layer.sensorVisible) return
        layer.sensorVisible = visible
        this.overlayDirty = true
        this.legendDirty = true
      },
      setBodyVisible: (visible) => {
        if (layer.disposed || visible === layer.bodyVisible) return
        layer.bodyVisible = visible
        this.overlayDirty = true
        this.legendDirty = true
      },
      setName: (name) => {
        if (layer.disposed || name === layer.name) return
        layer.name = name
        this.legendDirty = true
        this.overlayDirty = true
      },
      setWindow: (window) => {
        if (layer.disposed || window === layer.window) return
        // Window and recorded history are separate stores, exactly as in the
        // three.js adapter. The runtime already guarantees only one of them is
        // populated, and keeping them independent means a propagation failure's
        // `setWindow(null)` cannot erase an honest recorded trail.
        layer.window = window
        if (layer.visible) this.markComposite(layer, 'data')
      },
      setHistory: (segments) => {
        if (layer.disposed) return
        layer.history = segments
      },
      setVisible: (visible) => {
        if (layer.disposed || visible === layer.visible) return
        layer.visible = visible
        this.markComposite(layer, 'structure')
        this.legendDirty = true
        this.overlayDirty = true
      },
      setColor: (colorHex) => {
        if (layer.disposed || colorHex === layer.colorHex) return
        layer.colorHex = colorHex
        if (layer.visible) this.markComposite(layer, 'structure')
        this.legendDirty = true
        this.overlayDirty = true
      },
      setSelected: (selected) => {
        if (layer.disposed || selected === layer.selected) return
        layer.selected = selected
        // The track moves between the two composites.
        if (layer.visible) { this.compositeDirty.tracks = 'structure'; this.compositeDirty.selectedTracks = 'structure' }
        this.legendDirty = true
        this.overlayDirty = true
      },
      dispose: () => {
        if (layer.disposed) return
        this.removeLayer(layer)
      },
    }
  }

  /** Global view intent only. Opening or closing changes no object state and
   *  never asks the runtime to rebuild anything. */
  setOpen(open: boolean): void {
    if (this.disposedView || open === this.isOpen) return
    this.isOpen = open
    this.element.hidden = !open
    if (!open) {
      // A closed map keeps its small domain references and releases every
      // pixel-sized backing store.
      this.releaseBackingStores()
      return
    }
    this.layoutDirty = true
    this.backgroundDirty = true
    this.overlayDirty = true
    this.legendDirty = true
    this.compositeDirty.tracks = 'structure'
    this.compositeDirty.selectedTracks = 'structure'
    this.beginCoastlineLoad()
  }

  /** Maximized is shell presentation state. It changes layout only and does
   *  not create a second map or alter ground-track data. */
  setMaximized(maximized: boolean): void {
    if (this.disposedView || maximized === this.isMaximized) return
    this.isMaximized = maximized
    this.element.className = maximized ? 'ground-track-map is-maximized' : 'ground-track-map'
    this.maximizeButton.textContent = maximized ? text().map.restore : text().map.maximize
    this.maximizeButton.setAttribute('aria-pressed', String(maximized))
    this.layoutDirty = true
  }

  /** Forces a re-measure on the next render (used where resize observers
   *  cannot fire, such as a hidden measurement page). */
  invalidateLayout(): void { this.layoutDirty = true }

  /** Transient emphasis owned by the interaction controller. */
  /** `label` replaces the name in the hover label (for `<name> +<k> more`). */
  setHovered(id: string | null, label: string | null = null): void {
    if (label !== this.hoverLabel) { this.hoverLabel = label; this.overlayDirty = true }
    if (id === this.hoveredId) return
    const previous = this.hoveredId === null ? undefined : this.layers.get(this.hoveredId)
    this.hoveredId = id
    this.overlayDirty = true
    // Only the composites holding the old or new hovered track redraw.
    for (const layer of [previous, id === null ? undefined : this.layers.get(id)]) if (layer?.visible) this.markComposite(layer, 'structure')
  }
  setPrimary(id: string | null): void { if (id !== this.primaryId) { this.primaryId = id; this.overlayDirty = true } }

  /** The learner's own location (geodetic, as the map draws),
   *  held for drawing only; null hides it. */
  setObserver(observer: { readonly geodeticLatitudeRad: number; readonly longitudeRad: number } | null): void {
    if (observer === this.observer) return
    this.observer = observer
    this.overlayDirty = true
  }
  /** The sub-solar point from the frame's environment,
   *  the same Sun direction that lights the globe; null hides day and night. */
  setSun(point: { readonly latitudeRad: number; readonly longitudeRad: number } | null): void {
    this.sun = point
    if ((point === null) !== (this.shadedSun === null)) this.backgroundDirty = true
  }

  /** `reveals` maps object id to reveal start time (same clock as `now`). */
  setReveals(reveals: ReadonlyMap<string, number>, reducedMotion: boolean): void {
    this.reveals = reveals
    this.reducedMotion = reducedMotion
    this.overlayDirty = true
  }

  /** Called once per application frame. A closed, disabled or unchanged map
   *  performs no Canvas work at all. */
  render(): void {
    if (this.disposedView || this.disabled || !this.isOpen) return
    if (this.layoutDirty && !this.applyLayout()) return
    if (!isDrawableBounds(this.bounds)) return
    const nowMs = this.now()
    if (this.sunMoved() && nowMs - this.lastSunRedrawMs >= SUN_REDRAW_INTERVAL_MS) this.backgroundDirty = true
    if (this.backgroundDirty) { this.lastSunRedrawMs = nowMs; this.drawBackground() }
    this.updateProjections()
    this.renderComposites(nowMs)
    if (this.reveals.size > 0) this.overlayDirty = true
    if (this.overlayDirty) this.drawOverlay(nowMs)
    if (this.legendDirty) this.renderLegend()
  }

  /** Map pick candidates at `point` (CSS px, relative to the map frame).
   *  Uses only geometry cached at draw time; nothing is re-sampled. */
  /** `radii` are touch-sized for a finger or pen. */
  pickAt(point: ScreenPoint, radii: { readonly markerCssPx: number; readonly trackCssPx: number } = { markerCssPx: MAP_MARKER_PICK_RADIUS_CSS_PX, trackCssPx: MAP_TRACK_PICK_RADIUS_CSS_PX }): MapPickHit[] {
    if (!this.isOpen || this.disabled) return []
    const hits: MapPickHit[] = []
    for (const layer of this.layers.values()) {
      let best: MapPickHit | null = null
      if (layer.bodyVisible && layer.placement) {
        const placement = layer.placement
        const distance = placement.kind === 'point'
          ? Math.hypot(point.x - placement.x, point.y - placement.y)
          // The whole highlighted edge is the one physical pole point.
          : point.x >= placement.left && point.x <= placement.right ? Math.abs(point.y - placement.y) : Infinity
        if (distance <= radii.markerCssPx) best = { objectId: layer.id, kind: 'mapMarker', distanceCssPx: distance, depth: 0 }
      }
      if (!best && layer.visible) {
        let trackDistance = Infinity
        for (const cached of [...layer.projectedWindow, ...layer.projectedHistory]) {
          if (!pointNearRect(point, cached.rect, radii.trackCssPx)) continue
          trackDistance = Math.min(trackDistance, distanceToPolylineCssPx(point, cached.polyline.points))
        }
        if (trackDistance <= radii.trackCssPx) best = { objectId: layer.id, kind: 'mapTrack', distanceCssPx: trackDistance, depth: 0 }
      }
      if (best) hits.push(best)
    }
    return hits
  }

  /** Marker position (CSS px in the frame) of one object, for anchoring. */
  markerPosition(id: string): ScreenPoint | null {
    const placement = this.layers.get(id)?.placement
    if (!placement) return null
    return placement.kind === 'point' ? { x: placement.x, y: placement.y } : { x: (placement.left + placement.right) / 2, y: placement.y }
  }

  dispose(): void {
    if (this.disposedView) return
    this.disposedView = true
    this.stopObservingResize()
    for (const layer of [...this.layers.values()]) this.removeLayer(layer)
    this.layers.clear()
    this.backgroundContext = null
    this.trackContext = null
    this.selectedTrackContext = null
    this.overlayContext = null
    this.releaseBackBuffer()
    this.coastline = null
    this.nightCanvas = null
    for (const canvas of this.canvases()) canvas.remove()
    this.element.remove()
  }

  private canvases(): HTMLCanvasElement[] { return [this.background, this.tracks, this.selectedTracks, this.overlay] }

  private markComposite(layer: ObjectLayer, reason: 'data' | 'structure'): void {
    const kind: CompositeKind = layer.selected ? 'selectedTracks' : 'tracks'
    this.compositeDirty[kind] = maxDirty(this.compositeDirty[kind], reason)
  }

  private removeLayer(layer: ObjectLayer): void {
    layer.disposed = true
    if (layer.visible) this.markComposite(layer, 'structure')
    layer.current = null
    layer.sensorGeometry = null
    layer.window = null
    layer.history = null
    layer.projectedWindow = []
    layer.projectedHistory = []
    layer.projectedWindowSource = null
    layer.drawnHistory = null
    layer.placement = null
    if (this.layers.get(layer.id) === layer) this.layers.delete(layer.id)
    this.legendDirty = true
    this.overlayDirty = true
  }

  private releaseBackBuffer(): void {
    this.build = null
    this.backContext = null
    if (this.backBuffer) { this.backBuffer.width = 1; this.backBuffer.height = 1 }
    this.backBuffer = null
  }

  private releaseBackingStores(): void {
    for (const canvas of this.canvases()) {
      canvas.width = 1
      canvas.height = 1
    }
    this.releaseBackBuffer()
    for (const layer of this.layers.values()) this.dropProjections(layer)
    this.cssWidth = 0
    this.cssHeight = 0
    this.layoutMaximized = false
    this.bounds = { left: 0, top: 0, width: 0, height: 0 }
  }

  private dropProjections(layer: ObjectLayer): void {
    layer.projectedWindowSource = null
    layer.projectedWindow = []
    layer.projectedHistory = []
    layer.drawnHistory = null
    layer.placement = null
  }

  /** Returns false while the container has no drawable size, so nothing is ever
   *  allocated at zero. */
  private applyLayout(): boolean {
    const { width, height } = this.measure(this.frame)
    const ratio = clampPixelRatio(this.devicePixelRatioOf())
    if (!(width >= 1) || !(height >= 1)) return false
    if (width === this.cssWidth && height === this.cssHeight && ratio === this.pixelRatio && this.isMaximized === this.layoutMaximized) {
      this.layoutDirty = false
      return true
    }
    this.cssWidth = width
    this.cssHeight = height
    this.pixelRatio = ratio
    this.layoutMaximized = this.isMaximized
    const contentWidth = Math.min(width, height * MAP_ASPECT_RATIO, this.isMaximized ? width : MAP_MAX_CONTENT_WIDTH_CSS_PX)
    const contentHeight = contentWidth / MAP_ASPECT_RATIO
    this.bounds = {
      left: (width - contentWidth) / 2,
      top: (height - contentHeight) / 2,
      width: contentWidth,
      height: contentHeight,
    }
    for (const canvas of this.canvases()) this.resizeCanvas(canvas)
    // A restored map needs no back buffer; a maximized one resizes it on use.
    this.build = null
    if (this.backBuffer && !this.isMaximized) this.releaseBackBuffer()
    this.backgroundContext = this.acquireContext(this.background)
    this.trackContext = this.acquireContext(this.tracks)
    this.selectedTrackContext = this.acquireContext(this.selectedTracks)
    this.overlayContext = this.acquireContext(this.overlay)
    for (const layer of this.layers.values()) this.dropProjections(layer)
    this.backgroundDirty = true
    this.overlayDirty = true
    this.compositeDirty.tracks = 'structure'
    this.compositeDirty.selectedTracks = 'structure'
    this.layoutDirty = false
    return !this.disabled
  }

  private resizeCanvas(canvas: HTMLCanvasElement): void {
    canvas.width = Math.max(1, Math.round(this.cssWidth * this.pixelRatio))
    canvas.height = Math.max(1, Math.round(this.cssHeight * this.pixelRatio))
    canvas.style.width = `${this.cssWidth}px`
    canvas.style.height = `${this.cssHeight}px`
  }

  /** A browser without a 2D surface disables the map locally and leaves the
   *  simulation, globe and controls untouched. */
  private acquireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const context = canvas.getContext('2d')
    if (!context) {
      this.disableMap()
      return null
    }
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0)
    return context
  }

  private disableMap(): void {
    if (this.disabled) return
    this.disabled = true
    this.setStatus('canvas-unavailable')
    for (const layer of this.layers.values()) this.dropProjections(layer)
    this.backgroundContext = null
    this.trackContext = null
    this.selectedTrackContext = null
    this.overlayContext = null
  }

  private setStatus(kind: MapStatus): void {
    if (kind === this.statusKind) return
    this.statusKind = kind
    this.status.textContent = statusText(kind)
  }

  /** Country borders, or null to hide them. */
  setBorders(borders: BoundaryData | null): void {
    if (borders === this.borders) return
    this.borders = borders
    this.backgroundDirty = true
  }

  private beginCoastlineLoad(): void {
    if (this.coastlineState !== 'idle') return
    this.coastlineState = 'loading'
    void this.loadCoastlineAsset().then((result) => {
      if (this.disposedView) return
      if (result.ok) {
        this.coastline = result.data
        this.coastlineState = 'ready'
      } else {
        this.coastlineState = 'unavailable'
        // One warning, once. The map keeps its grid and every track.
        console.warn(`Ground-track map coastline unavailable: ${result.reason}`)
        this.setStatus('coastline-unavailable')
      }
      this.backgroundDirty = true
    })
  }

  /** Counts, then selected and track- or sensor-enabled names, capped. */
  private renderLegend(): void {
    this.legendDirty = false
    const layers = [...this.layers.values()]
    const tracks = layers.filter((layer) => layer.visible).length
    const sensors = layers.filter((layer) => layer.sensorVisible).length
    this.legendSummary.textContent = mapLegendSummary(layers.length, tracks, sensors)
    const named = [...layers.filter((layer) => layer.selected), ...layers.filter((layer) => !layer.selected && (layer.visible || layer.sensorVisible))]
    this.legendList.textContent = ''
    for (const layer of named.slice(0, MAP_LEGEND_NAME_LIMIT)) {
      const row = this.documentRef.createElement('li')
      row.className = 'map-legend-row'
      const swatch = this.documentRef.createElement('span')
      swatch.className = 'map-legend-swatch'
      swatch.style.background = cssColor(layer.colorHex)
      const name = this.documentRef.createElement('span')
      name.className = 'map-legend-name'
      // Selection is stated in words, so colour is never the only meaning.
      name.textContent = layer.selected ? text().map.selectedName(layer.name) : layer.name
      row.append(swatch, name)
      this.legendList.append(row)
    }
    if (named.length > MAP_LEGEND_NAME_LIMIT) {
      const more = this.documentRef.createElement('li')
      more.className = 'map-legend-row map-legend-more'
      more.textContent = text().map.more(named.length - MAP_LEGEND_NAME_LIMIT)
      this.legendList.append(more)
    }
    this.syncEmptyPrompt()
  }

  private syncEmptyPrompt(): void {
    this.emptyPrompt.hidden = this.drawableSeen
  }

  /** Brings every visible layer's projected polylines up to date with its
   *  data and the current bounds, stroking appended history directly. */
  private updateProjections(): void {
    for (const layer of this.layers.values()) {
      if (!layer.visible) continue
      if (layer.projectedWindowSource !== layer.window) {
        layer.projectedWindow = []
        for (const segment of layer.window?.trailing ?? []) this.pushProjected(layer.projectedWindow, segment, false)
        for (const segment of layer.window?.leading ?? []) this.pushProjected(layer.projectedWindow, segment, true)
        layer.projectedWindowSource = layer.window
      }
      const plan = planHistoryDraw(layer.history, layer.drawnHistory)
      if (plan.kind === 'none') continue
      if (plan.kind === 'full') {
        layer.projectedHistory = []
        for (const segment of layer.history ?? []) this.pushProjected(layer.projectedHistory, segment, false)
        layer.drawnHistory = plan.drawn
        this.markComposite(layer, 'data')
        continue
      }
      const kind: CompositeKind = layer.selected ? 'selectedTracks' : 'tracks'
      const context = kind === 'tracks' ? this.trackContext : this.selectedTrackContext
      for (const piece of plan.pieces) {
        const added = this.pushProjected(layer.projectedHistory, { points: piece.segment.points.slice(piece.fromIndex) }, false)
        // The composite already shows the older part; add just the new stroke.
        if (added && context && this.compositeDirty[kind] === 'none') this.strokeTrack(context, layer, added.polyline, false)
        if (added && this.backContext && this.build?.kind === kind && this.build.drawn.has(layer.id)) this.strokeTrack(this.backContext, layer, added.polyline, false)
      }
      layer.drawnHistory = plan.drawn
    }
  }

  private pushProjected(target: CachedPolyline[], segment: GroundTrackSegment, dashed: boolean): CachedPolyline | null {
    const polyline = projectGroundTrackSegment(segment, this.bounds)
    if (!polyline) return null
    const cached = { polyline, rect: rectOfPoints(polyline.points), dashed }
    target.push(cached)
    return cached
  }

  private renderComposites(nowMs: number): void {
    // A progressive rebuild restarts when its own composite changes
    // structurally; otherwise it finishes before the next one starts.
    if (this.build && this.compositeDirty[this.build.kind] === 'structure') this.build = null
    if (this.build?.kind !== 'selectedTracks') this.renderSelectedComposite(nowMs)
    if (!this.build && this.tracksDue(nowMs)) {
      this.redrawComposite('tracks')
      this.lastCompositeRedrawMs = nowMs
    }
    if (this.build) this.continueBuild()
  }

  private tracksDue(nowMs: number): boolean {
    const dirty = this.compositeDirty.tracks
    const interval = this.isMaximized ? MAP_MAXIMIZED_TRACK_MIN_INTERVAL_MS : MAP_TRACK_COMPOSITE_MIN_INTERVAL_MS
    return dirty === 'structure' || (dirty === 'data' && nowMs - this.lastCompositeRedrawMs >= interval)
  }

  /** Selected tracks that redraw in one step never wait, even during an
   *  unselected rebuild. A large selected set in the maximized map rebuilds
   *  progressively: a selection change preempts an unselected rebuild, and
   *  continuous data updates take turns with it so neither starves. */
  private renderSelectedComposite(nowMs: number): void {
    const dirty = this.compositeDirty.selectedTracks
    if (dirty === 'none') return
    if (!this.isProgressive('selectedTracks')) { this.redrawComposite('selectedTracks'); return }
    if (this.build) {
      if (dirty !== 'structure') return
      this.compositeDirty[this.build.kind] = maxDirty(this.compositeDirty[this.build.kind], 'data')
      this.build = null
    } else if (dirty === 'data' && this.lastBuildKind === 'selectedTracks' && this.tracksDue(nowMs)) return
    this.redrawComposite('selectedTracks')
  }

  private isProgressive(kind: CompositeKind): boolean {
    return this.isMaximized && this.compositeLayers(kind).length > MAP_TRACK_BUILD_LAYERS_PER_FRAME
  }

  private compositeLayers(kind: CompositeKind): ObjectLayer[] {
    const selected = kind === 'selectedTracks'
    return [...this.layers.values()].filter((layer) => layer.visible && layer.selected === selected)
  }

  private redrawComposite(kind: CompositeKind): void {
    this.compositeDirty[kind] = 'none'
    const layers = this.compositeLayers(kind)
    if (this.isMaximized && layers.length > MAP_TRACK_BUILD_LAYERS_PER_FRAME && this.ensureBackBuffer()) {
      // Drawn from the next continueBuild call, in this same frame.
      this.build = { kind, layerIds: layers.map((layer) => layer.id), next: 0, drawn: new Set() }
      this.backContext!.clearRect(0, 0, this.cssWidth, this.cssHeight)
      return
    }
    const context = kind === 'tracks' ? this.trackContext : this.selectedTrackContext
    if (!context) return
    this.compositeRedraws += 1
    context.clearRect(0, 0, this.cssWidth, this.cssHeight)
    this.strokeComposite(context, layers)
  }

  /** One clip for the whole pass and one stroke per layer and dash style: at
   *  100 tracks this is a few hundred strokes rather than thousands of
   *  clipped save/restore pairs. */
  private strokeComposite(context: CanvasRenderingContext2D, layers: readonly ObjectLayer[]): void {
    context.save()
    context.beginPath()
    this.clipToContent(context)
    context.lineJoin = 'round'
    context.lineCap = 'round'
    for (const layer of layers) {
      const solid = [...layer.projectedWindow.filter((cached) => !cached.dashed), ...layer.projectedHistory].map((cached) => cached.polyline)
      const dashed = layer.projectedWindow.filter((cached) => cached.dashed).map((cached) => cached.polyline)
      this.strokeLayerPolylines(context, layer, solid, false)
      this.strokeLayerPolylines(context, layer, dashed, true)
    }
    context.restore()
  }

  /** Draws the next few layers of the rebuild into the back buffer; the last
   *  step copies the finished image over the visible composite. */
  private continueBuild(): void {
    const build = this.build
    const back = this.backContext
    if (!build || !back || !this.backBuffer) { this.build = null; return }
    const batch: ObjectLayer[] = []
    while (build.next < build.layerIds.length && batch.length < MAP_TRACK_BUILD_LAYERS_PER_FRAME) {
      const layer = this.layers.get(build.layerIds[build.next++])
      if (layer && !layer.disposed && layer.visible) batch.push(layer)
    }
    this.strokeComposite(back, batch)
    for (const layer of batch) build.drawn.add(layer.id)
    if (build.next < build.layerIds.length) return
    this.build = null
    this.lastBuildKind = build.kind
    const front = build.kind === 'tracks' ? this.trackContext : this.selectedTrackContext
    if (!front) return
    this.compositeRedraws += 1
    front.clearRect(0, 0, this.cssWidth, this.cssHeight)
    front.drawImage(this.backBuffer, 0, 0, this.cssWidth, this.cssHeight)
  }

  private ensureBackBuffer(): boolean {
    if (!this.backBuffer) this.backBuffer = this.documentRef.createElement('canvas')
    const width = Math.max(1, Math.round(this.cssWidth * this.pixelRatio))
    const height = Math.max(1, Math.round(this.cssHeight * this.pixelRatio))
    if (!this.backContext || this.backBuffer.width !== width || this.backBuffer.height !== height) {
      this.backBuffer.width = width
      this.backBuffer.height = height
      this.backContext = this.backBuffer.getContext('2d')
      this.backContext?.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0)
    }
    return this.backContext !== null
  }

  /** Canvas count and backing bytes, including the back buffer. */
  canvasStats(): { readonly canvases: number; readonly backingBytes: number } {
    const canvases = [...this.canvases(), ...(this.backBuffer ? [this.backBuffer] : [])]
    return { canvases: canvases.length, backingBytes: canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0) }
  }

  /** Strokes polylines of one layer and dash style inside an existing clip. */
  private strokeLayerPolylines(context: CanvasRenderingContext2D, layer: ObjectLayer, polylines: readonly MapPolyline[], dashed: boolean): void {
    if (polylines.length === 0) return
    const emphasized = layer.selected || layer.id === this.hoveredId
    if (emphasized) {
      // A dark under-stroke keeps the selected track legible over coastlines.
      context.beginPath()
      for (const polyline of polylines) tracePolyline(context, polyline)
      context.setLineDash([])
      context.globalAlpha = 1
      context.lineWidth = SELECTED_UNDERSTROKE_WIDTH
      context.strokeStyle = UNDERSTROKE
      context.stroke()
    }
    context.beginPath()
    for (const polyline of polylines) tracePolyline(context, polyline)
    context.setLineDash(dashed ? [...LEADING_DASH] : [])
    context.globalAlpha = dashed ? LEADING_ALPHA : TRACK_ALPHA
    context.lineWidth = layer.id === this.hoveredId ? HOVERED_TRACK_WIDTH : layer.selected ? SELECTED_TRACK_WIDTH : TRACK_WIDTH
    context.strokeStyle = cssColor(layer.colorHex)
    context.stroke()
  }

  /** One appended piece, drawn onto the existing composite image. */
  private strokeTrack(context: CanvasRenderingContext2D, layer: ObjectLayer, polyline: MapPolyline, dashed: boolean): void {
    context.save()
    context.beginPath()
    this.clipToContent(context)
    context.lineJoin = 'round'
    context.lineCap = 'round'
    this.strokeLayerPolylines(context, layer, [polyline], dashed)
    context.restore()
  }

  /** Sensor areas, then markers (unselected, selected, hovered), reveal
   *  rings and labels. Redrawn whenever a current point moves. */
  private drawOverlay(nowMs: number): void {
    this.overlayDirty = false
    const context = this.overlayContext
    let drawable = false
    for (const layer of this.layers.values()) {
      layer.placement = layer.bodyVisible && layer.current ? placeCurrentPoint(layer.current, this.bounds) : null
      if (layer.placement || layer.visible || (layer.sensorVisible && layer.sensorGeometry)) drawable = true
    }
    if (drawable !== this.drawableSeen) { this.drawableSeen = drawable; this.syncEmptyPrompt() }
    if (!context) return
    context.clearRect(0, 0, this.cssWidth, this.cssHeight)
    const ordered = [...this.layers.values()].sort((a, b) => rank(a, this.hoveredId) - rank(b, this.hoveredId))
    for (const layer of ordered) {
      if (layer.sensorVisible && layer.sensorGeometry) {
        this.drawSensorCap(context, layer, layer.sensorGeometry.footprint, false)
        if (layer.sensorGeometry.fieldOfRegard !== layer.sensorGeometry.footprint) this.drawSensorCap(context, layer, layer.sensorGeometry.fieldOfRegard, true)
      }
    }
    context.save()
    context.beginPath()
    this.clipToContent(context)
    for (const layer of ordered) {
      const placement = layer.placement
      if (!placement) continue
      const emphasized = layer.selected || layer.id === this.hoveredId
      context.strokeStyle = UNDERSTROKE
      context.fillStyle = cssColor(layer.colorHex)
      context.globalAlpha = 1
      context.setLineDash([])
      if (placement.kind === 'poleEdge') {
        // Longitude is undefined at a pole, and the whole edge is that one
        // physical point, so the edge is highlighted instead of a dot placed
        // at an invented longitude.
        context.lineWidth = emphasized ? SELECTED_UNDERSTROKE_WIDTH : SELECTED_TRACK_WIDTH
        context.beginPath()
        context.moveTo(placement.left, placement.y)
        context.lineTo(placement.right, placement.y)
        context.stroke()
        context.beginPath()
        context.moveTo(placement.left, placement.y)
        context.lineTo(placement.right, placement.y)
        context.lineWidth = emphasized ? SELECTED_TRACK_WIDTH : TRACK_WIDTH
        context.strokeStyle = cssColor(layer.colorHex)
        context.stroke()
        continue
      }
      const radius = emphasized ? SELECTED_MARKER_RADIUS : MARKER_RADIUS
      context.beginPath()
      context.arc(placement.x, placement.y, radius, 0, Math.PI * 2)
      context.fill()
      context.lineWidth = 1
      context.stroke()
      if (layer.selected || layer.id === this.hoveredId) {
        context.beginPath()
        context.arc(placement.x, placement.y, radius + 3, 0, Math.PI * 2)
        context.lineWidth = layer.id === this.primaryId ? 2.5 : 1.5
        context.strokeStyle = HALO
        context.stroke()
      }
      const revealStart = this.reveals.get(layer.id)
      if (revealStart !== undefined) {
        const progress = (nowMs - revealStart) / MAP_REVEAL_DURATION_MS
        if (progress >= 0 && progress <= 1) {
          context.beginPath()
          context.arc(placement.x, placement.y, this.reducedMotion ? radius + 7 : radius + 4 + progress * 18, 0, Math.PI * 2)
          context.lineWidth = 2
          context.globalAlpha = this.reducedMotion ? 1 : 1 - progress
          context.strokeStyle = HALO
          context.stroke()
          context.globalAlpha = 1
        }
      }
    }
    // The learner's own location, under the object labels.
    if (this.observer) {
      const point = projectGeodeticUnwrapped(this.observer.longitudeRad, this.observer.geodeticLatitudeRad, this.bounds)
      if (point) {
        context.setLineDash([])
        context.globalAlpha = 1
        context.beginPath()
        context.arc(point.x, point.y, 5, 0, Math.PI * 2)
        context.lineWidth = 4
        context.strokeStyle = UNDERSTROKE
        context.stroke()
        context.lineWidth = 2
        context.strokeStyle = OBSERVER
        context.stroke()
        context.beginPath()
        context.arc(point.x, point.y, 1.75, 0, Math.PI * 2)
        context.fillStyle = OBSERVER
        context.fill()
      }
    }
    // Selected objects are named beside their markers, primary first, up to
    // the limit; the hovered object is always named.
    const selectedIds = [...this.layers.values()].filter((layer) => layer.selected && layer.id !== this.primaryId).map((layer) => layer.id)
    const primaryIds = this.primaryId !== null && this.layers.get(this.primaryId)?.selected ? [this.primaryId] : []
    const labelled = [...primaryIds, ...selectedIds].slice(0, MAP_SELECTED_LABEL_LIMIT)
    for (const id of new Set([...labelled, this.hoveredId])) {
      const layer = id ? this.layers.get(id) : undefined
      const position = layer && this.markerPosition(layer.id)
      if (!layer || !position) continue
      const text = layer.id === this.hoveredId && this.hoverLabel ? this.hoverLabel : layer.name
      context.font = '11px system-ui, sans-serif'
      context.textAlign = 'left'
      context.textBaseline = 'middle'
      context.lineWidth = 3
      context.strokeStyle = UNDERSTROKE
      context.strokeText(text, position.x + 9, position.y - 9)
      context.fillStyle = '#e8f1fb'
      context.fillText(text, position.x + 9, position.y - 9)
    }
    context.restore()
  }

  private drawSensorCap(context: CanvasRenderingContext2D, layer: ObjectLayer, cap: SphericalSensorCap, regard: boolean): void {
    const plan = planFootprintDraw(layer.sensorGeometry!.centre, cap)
    for (const offset of plan.longitudeOffsetsRad) {
      const projectedFill = plan.fill.map((point) => projectGeodeticUnwrapped(point.longitudeRad + offset, point.geodeticLatitudeRad, this.bounds))
      const projectedOutline = plan.outline.map((point) => projectGeodeticUnwrapped(point.longitudeRad + offset, point.geodeticLatitudeRad, this.bounds))
      if (projectedFill.length < 3 || projectedFill.some((point) => point === null) || projectedOutline.some((point) => point === null)) continue
      const fill = projectedFill as { x: number; y: number }[]
      const outline = projectedOutline as { x: number; y: number }[]
      context.save()
      this.clipToContent(context)
      if (!regard) {
        context.beginPath()
        traceClosedPath(context, fill)
        context.globalAlpha = FOOTPRINT_FILL_ALPHA
        context.fillStyle = cssColor(layer.colorHex)
        context.fill()
      }
      context.beginPath()
      if (plan.outlineClosed) traceClosedPath(context, outline)
      else tracePolyline(context, { points: outline })
      context.globalAlpha = regard ? FOR_LINE_ALPHA : 0.95
      context.lineWidth = layer.selected ? SELECTED_SENSOR_LINE_WIDTH : SENSOR_LINE_WIDTH
      context.lineJoin = 'round'
      context.setLineDash(regard ? [...SENSOR_DASH] : [])
      context.strokeStyle = cssColor(layer.colorHex)
      context.stroke()
      context.restore()
    }
  }

  private sunMoved(): boolean {
    const sun = this.sun
    const shaded = this.shadedSun
    if (!sun || !shaded) return sun !== shaded
    return Math.abs(sun.latitudeRad - shaded.latitudeRad) > SUN_REDRAW_RAD || Math.abs(Math.atan2(Math.sin(sun.longitudeRad - shaded.longitudeRad), Math.cos(sun.longitudeRad - shaded.longitudeRad))) > SUN_REDRAW_RAD
  }

  /** The night shade as a small image, drawn scaled over the ocean. */
  private drawNight(context: CanvasRenderingContext2D, sun: { readonly latitudeRad: number; readonly longitudeRad: number }): void {
    const { left, top, width, height } = this.bounds
    this.nightCanvas ??= this.frameElement.ownerDocument.createElement('canvas')
    const canvas = this.nightCanvas
    if (canvas.width !== NIGHT_GRID_COLUMNS || canvas.height !== NIGHT_GRID_ROWS) { canvas.width = NIGHT_GRID_COLUMNS; canvas.height = NIGHT_GRID_ROWS }
    const nightContext = canvas.getContext('2d')
    if (!nightContext || typeof ImageData === 'undefined') return
    nightContext.putImageData(new ImageData(nightShadeGrid(NIGHT_GRID_COLUMNS, NIGHT_GRID_ROWS, sun.latitudeRad, sun.longitudeRad, NIGHT_RGB), NIGHT_GRID_COLUMNS, NIGHT_GRID_ROWS), 0, 0)
    context.imageSmoothingEnabled = true
    context.drawImage(canvas, left, top, width, height)
  }

  /** The point where the Sun is overhead: a small Sun symbol. */
  private drawSubSolarPoint(context: CanvasRenderingContext2D, sun: { readonly latitudeRad: number; readonly longitudeRad: number }): void {
    const point = projectDegrees((sun.longitudeRad * 180) / Math.PI, (sun.latitudeRad * 180) / Math.PI, this.bounds)
    if (!point) return
    context.save()
    context.strokeStyle = SUB_SOLAR
    context.fillStyle = SUB_SOLAR
    context.lineWidth = 1.25
    context.beginPath()
    context.arc(point.x, point.y, 3.5, 0, Math.PI * 2)
    context.fill()
    context.beginPath()
    for (let ray = 0; ray < 8; ray += 1) {
      const angle = (ray * Math.PI) / 4
      context.moveTo(point.x + Math.cos(angle) * 5.5, point.y + Math.sin(angle) * 5.5)
      context.lineTo(point.x + Math.cos(angle) * 8, point.y + Math.sin(angle) * 8)
    }
    context.stroke()
    context.restore()
  }

  private drawBackground(): void {
    this.backgroundDirty = false
    const context = this.backgroundContext
    if (!context) return
    const { left, top, width, height } = this.bounds
    context.clearRect(0, 0, this.cssWidth, this.cssHeight)
    context.save()
    context.fillStyle = OCEAN_FILL
    context.fillRect(left, top, width, height)
    const sun = this.sun
    this.shadedSun = sun
    if (sun) this.drawNight(context, sun)

    context.beginPath()
    this.clipToContent(context)
    context.lineWidth = 1
    context.strokeStyle = GRATICULE
    context.beginPath()
    for (let longitude = -180 + GRATICULE_STEP_DEG; longitude < 180; longitude += GRATICULE_STEP_DEG) {
      if (longitude === 0) continue
      const x = projectDegrees(longitude, 0, this.bounds)!.x
      context.moveTo(x, top)
      context.lineTo(x, top + height)
    }
    for (let latitude = -90 + GRATICULE_STEP_DEG; latitude < 90; latitude += GRATICULE_STEP_DEG) {
      if (latitude === 0) continue
      const y = projectDegrees(0, latitude, this.bounds)!.y
      context.moveTo(left, y)
      context.lineTo(left + width, y)
    }
    context.stroke()

    if (this.coastline) {
      context.beginPath()
      for (const line of this.coastline.lines) {
        for (let index = 0; index < line.length; index += 1) {
          const projected = projectDegrees(line[index][0], line[index][1], this.bounds)
          if (!projected) break
          if (index === 0) context.moveTo(projected.x, projected.y)
          else context.lineTo(projected.x, projected.y)
        }
      }
      context.lineWidth = 1
      context.lineJoin = 'round'
      context.strokeStyle = COASTLINE
      context.stroke()
    }

    if (this.borders) {
      // Agreed boundaries solid, disputed ones dashed; below the tracks.
      for (const disputed of [false, true]) {
        context.beginPath()
        for (const line of this.borders.lines) {
          if (line.disputed !== disputed) continue
          line.points.forEach(([longitude, latitude], index) => {
            const projected = projectDegrees(longitude, latitude, this.bounds)
            if (!projected) return
            if (index === 0) context.moveTo(projected.x, projected.y)
            else context.lineTo(projected.x, projected.y)
          })
        }
        context.setLineDash(disputed ? [3, 3] : [])
        context.lineWidth = 0.8
        context.strokeStyle = BORDER_LINE
        context.stroke()
      }
      context.setLineDash([])
    }

    // The equator and the prime meridian are the two lines the lesson names.
    context.beginPath()
    const equatorY = projectDegrees(0, 0, this.bounds)!.y
    const greenwichX = projectDegrees(0, 0, this.bounds)!.x
    context.moveTo(left, equatorY)
    context.lineTo(left + width, equatorY)
    context.moveTo(greenwichX, top)
    context.lineTo(greenwichX, top + height)
    context.lineWidth = 1
    context.strokeStyle = GRATICULE_MAJOR
    context.stroke()
    if (sun) this.drawSubSolarPoint(context, sun)
    context.restore()

    context.save()
    context.strokeStyle = BORDER
    context.lineWidth = 1
    context.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1)
    context.fillStyle = LABEL
    context.font = '9px system-ui, sans-serif'
    context.textBaseline = 'bottom'
    // Sparse enough to stay legible on a 320 px-wide map. Both borders read
    // 180 deg, because they are the same meridian.
    const longitudeStep = width >= 420 ? 60 : 90
    for (let longitude = -180; longitude <= 180; longitude += longitudeStep) {
      const x = projectDegrees(longitude, 0, this.bounds)!.x
      context.textAlign = longitude === -180 ? 'left' : longitude === 180 ? 'right' : 'center'
      context.fillText(formatLongitudeLabel(longitude), x, top + height - 2)
    }
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    for (const latitude of width >= 420 ? [60, 30, -30, -60] : [60, -60]) {
      const y = projectDegrees(0, latitude, this.bounds)!.y
      context.fillText(formatLatitudeLabel(latitude), left + 3, y)
    }
    context.restore()
  }

  private clipToContent(context: CanvasRenderingContext2D): void {
    context.rect(this.bounds.left, this.bounds.top, this.bounds.width, this.bounds.height)
    context.clip()
  }
}

function maxDirty(current: 'none' | 'data' | 'structure', next: 'data' | 'structure'): 'data' | 'structure' {
  return current === 'structure' || next === 'structure' ? 'structure' : 'data'
}

/** Draw order: unselected first, then selected, then the hovered object. */
function rank(layer: ObjectLayer, hoveredId: string | null): number {
  return layer.id === hoveredId ? 2 : layer.selected ? 1 : 0
}

function tracePolyline(context: CanvasRenderingContext2D, polyline: MapPolyline): void {
  polyline.points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y)
    else context.lineTo(point.x, point.y)
  })
}

function traceClosedPath(context: CanvasRenderingContext2D, points: readonly { x: number; y: number }[]): void {
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y)
    else context.lineTo(point.x, point.y)
  })
  const first = points[0]
  if (first) context.lineTo(first.x, first.y)
}

function clampPixelRatio(ratio: number): number {
  return Number.isFinite(ratio) && ratio > 0 ? Math.min(MAX_DEVICE_PIXEL_RATIO, ratio) : 1
}

export function cssColor(colorHex: number): string {
  return `#${(colorHex >>> 0 & 0xffffff).toString(16).padStart(6, '0')}`
}

function statusText(kind: MapStatus): string {
  return kind === 'coastline-unavailable' ? text().map.coastlineUnavailable : text().map.canvasUnavailable
}

/** Graticule labels in whole degrees. Both borders read 180° without a
 *  hemisphere, because they are the same meridian. */
function formatLongitudeLabel(longitudeDeg: number): string {
  if (Math.abs(longitudeDeg) === 180) return `${format().number(180)}°`
  return format().longitude(longitudeDeg * Math.PI / 180, 0)
}

function formatLatitudeLabel(latitudeDeg: number): string {
  return format().latitude(latitudeDeg * Math.PI / 180, 0)
}

function defaultObserveResize(element: HTMLElement, onResize: () => void): () => void {
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => onResize())
    observer.observe(element)
    return () => observer.disconnect()
  }
  const handler = (): void => onResize()
  globalThis.addEventListener('resize', handler)
  return () => globalThis.removeEventListener('resize', handler)
}
