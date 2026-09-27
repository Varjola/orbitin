import type { SimulationInstant } from '../core/time.ts'
import type { Sgp4MeanElements } from '../data/sgp4MeanElements.ts'
import type { EarthOrientation } from '../core/referenceFrames.ts'
import { projectInertialToEarthFixed } from '../core/referenceFrames.ts'
import type { OrbitalState, OrbitPropagator } from '../orbital/propagator.ts'
import { sameConicShape, type OrbitOrientationAngles } from '../orbital/perifocalOrientation.ts'
import { OrbitPropagationError } from '../orbital/propagationError.ts'
import { sampledTrajectoryNeedsRecenter, sampleSgp4Trajectory, type SampledTrajectoryWindow } from '../orbital/sampledTrajectory.ts'
import {
  createTrajectoryEvaluator,
  trajectoryVisualizationFor,
  type ConicFrameSample,
  type OrbitalObject,
  type OrbitSource,
  type PropagationModel,
  isSgp4Source,
  type GroundReachConstraint,
  type IdealizedSensorDefinition,
  type TrajectoryEvaluator,
} from '../simulation/OrbitalObject.ts'
import { createInstantaneousSensorGeometry, type InstantaneousSensorGeometry } from '../simulation/sensorFootprint.ts'
import {
  advanceSamplingState,
  initialSamplingState,
  PLANE_ONLY_MARKER_OPACITY,
  resetSamplingMeasurement,
  type SamplingBand,
  type SamplingState,
} from './samplingPresentation.ts'
import { earthOrientationAt } from '../simulation/earthOrientation.ts'
import {
  nominalOrbitalPeriodSeconds,
  sampleGroundTrack,
  subSatellitePointFromState,
  type GroundTrackWindow,
  type SubSatellitePoint,
} from '../simulation/groundTrack.ts'
import {
  GroundTrackHistoryRecorder,
  groundTrackHistoryStepSeconds,
} from '../simulation/groundTrackHistory.ts'
import type { GroundTrackSegment } from '../simulation/groundTrack.ts'
import {
  groundTrackNeedsRecenter,
  selectGroundTrackEntry,
  type GroundTrackCache,
} from './groundTrackScheduling.ts'

export interface BodyViewPort {
  update(state: OrbitalState): void
  setVisible(visible: boolean): void
  setSize(sizeRenderUnits: number): void
  setZoomScaling(enabled: boolean): void
  setColor(colorHex: number): void
  setOpacity(opacity: number): void
  /** Optional picking and emphasis surface; absent in non-rendering tests. */
  pickPositionRender?(): { readonly x: number; readonly y: number; readonly z: number } | null
  renderedRadiusRender?(): number
  setSelectionEmphasis?(selected: boolean, primary: boolean): void
  setHovered?(hovered: boolean): void
  setHaloColor?(colorHex: number | null): void
  setReveal?(progress: number | null, reducedMotion: boolean): void
  dispose(): void
}
/** A **conic** path port, and this is stated deliberately. When an SGP4 source
 *  arrives its trajectory is a sampled polyline over a time window, not a conic
 *  with an orientation; the seam where that arrives is this port - a
 *  `setPolyline(points)` method - and the evaluator union, **not** the
 *  propagator interface, which stays `stateAt` for both. */
export interface ConicPathViewPort {
  readonly kind?: 'conic' | 'sampled'
  rebuildShape(shape: { semiMajorAxisKm: number; eccentricity: number }): void
  setOrientation(elements: OrbitOrientationAngles): void
  setSegments?(segments: readonly (readonly import('../core/referenceFrames.ts').ProjectInertialVec3[])[]): void
  setVisible(visible: boolean): void
  setColor(colorHex: number): void
  setSelected(selected: boolean): void
  /** Optional picking and emphasis surface. */
  pickPolylinesRender?(): readonly Float32Array[]
  pickRevision?(): number
  setHovered?(hovered: boolean): void
  dispose(): void
}
export type PathViewPort = ConicPathViewPort
export interface GroundTrackViewPort {
  setCurrent(point: SubSatellitePoint | null): void
  setWindow(window: GroundTrackWindow | null): void
  /** Optional so non-rendering runtime tests may supply a minimal port. */
  setHistory?(segments: readonly GroundTrackSegment[] | null): void
  /** Optional: the 2D map draws a marker for every visible body. */
  setBodyVisible?(visible: boolean): void
  /** Optional: the 2D map names objects in its legend and labels. */
  setName?(name: string): void
  setVisible(visible: boolean): void
  setColor(colorHex: number): void
  setSelected(selected: boolean): void
  dispose(): void
}
export interface SensorGeometryViewPort {
  setGeometry(geometry: InstantaneousSensorGeometry | null): void
  setVisible(visible: boolean): void
  setColor(colorHex: number): void
  setSelected(selected: boolean): void
  dispose(): void
}
/** View preferences that apply to every object rather than to one of them. */
export interface RuntimeViewOptions {
  scaleMarkersWithZoom: boolean
  /** The colour the marker and orbit path draw an object's
   *  stored colour with (the Lab backdrop darkens light colours); identity
   *  when absent. Ground tracks and footprints receive the stored colour,
   *  because they also reach the 2D map; their 3D half adjusts it. */
  displayColor?: (colorHex: number) => number
  /** Halo colour for selection emphasis; the view's own when absent. */
  haloColor?: number
}
export const DEFAULT_RUNTIME_VIEW_OPTIONS: RuntimeViewOptions = { scaleMarkersWithZoom: true }

/** Per-frame derived display data, produced by the runtime and consumed by the
 *  readout layer. Never stored in AppState (INV-10). */
export interface ObjectFrameSample {
  readonly state: OrbitalState
  readonly subSatellitePoint: SubSatellitePoint | null
  readonly samplingBand: SamplingBand
  /** Present for objects whose trajectory is a conic. Absent for sources whose
   *  natural output is a state vector; the readout layer shows only the
   *  state-derived rows for those, and is never asked to invent classical mean
   *  elements a future SGP4 object does not have (INV-9). */
  readonly conic?: ConicFrameSample
  readonly sensorGeometry: InstantaneousSensorGeometry | null
  readonly error?: OrbitPropagationError
}

export interface RuntimeFactories {
  createBody(object: OrbitalObject): BodyViewPort
  createPath(object: OrbitalObject): PathViewPort
  /** Optional for compatibility with non-rendering runtime tests. */
  createGroundTrack?(object: OrbitalObject): GroundTrackViewPort
  /** Optional for compatibility with non-rendering runtime tests. */
  createSensorGeometry?(object: OrbitalObject): SensorGeometryViewPort
  createPropagator(source: OrbitSource, propagation: PropagationModel): OrbitPropagator
}
interface RuntimeEntry {
  readonly id: string
  body: BodyViewPort
  path: PathViewPort
  groundTrack: GroundTrackViewPort
  sensorGeometry: SensorGeometryViewPort
  propagator: OrbitPropagator
  evaluator: TrajectoryEvaluator
  sampling: SamplingState
  /** The orientation angles the path was drawn with in the last frame. */
  drawnOrientation: OrbitOrientationAngles | null
  lastSource: OrbitSource
  lastPropagation: PropagationModel
  lastGroundTrackPeriod: number | null
  sampledPathCache: SampledTrajectoryWindow | null
  sampledPathDirty: boolean
  sampledPathForceRefresh: boolean
  sampledPathLastRebuildAtMs: number
  bodyVisible: boolean
  orbitPathVisible: boolean
  groundTrackCache: GroundTrackCache | null
  groundTrackDirty: boolean
  groundTrackForceRefresh: boolean
  groundTrackVisible: boolean
  /** Created on first use so an object that never records costs nothing. */
  groundTrackHistory: GroundTrackHistoryRecorder | null
  groundTrackHistoryRecording: boolean
  sensor: IdealizedSensorDefinition
  reachConstraint: GroundReachConstraint
  sensorGeometryVisible: boolean
  publishedSensorGeometry: InstantaneousSensorGeometry | null
  /** `-1` means the view holds no history, so a cleared trail still publishes. */
  publishedHistoryRevision: number
}

/** Real milliseconds one frame may spend on window
 *  rebuilds beyond its first ground-track and first sampled-path rebuild.
 *  Measurements showed one rebuild per frame leaving paths stale at 100
 *  objects; the floor of one each keeps the eight-object behaviour. */
export const REBUILD_FRAME_BUDGET_MS = 3

export interface RuntimeSchedulingOptions {
  readonly rebuildFrameBudgetMs?: number
  /** Real-time clock for the budget; injected by tests. */
  readonly measureMs?: () => number
}

/** Derived resources only; published object definitions remain immutable state. */
export class OrbitalObjectRuntime {
  private readonly entries = new Map<string, RuntimeEntry>()
  private readonly factories: RuntimeFactories
  private readonly errors = new Map<string, OrbitPropagationError>()
  private readonly rebuildFrameBudgetMs: number
  private readonly measureMs: () => number
  constructor(factories: RuntimeFactories, scheduling: RuntimeSchedulingOptions = {}) {
    this.factories = factories
    this.rebuildFrameBudgetMs = scheduling.rebuildFrameBudgetMs ?? REBUILD_FRAME_BUDGET_MS
    this.measureMs = scheduling.measureMs ?? (() => performance.now())
  }

  /** Read-only view of the live body and path ports, for picking. It adds no
   *  simulation work and exposes nothing that could mutate an entry. */
  *viewPorts(): IterableIterator<{ readonly id: string; readonly body: BodyViewPort; readonly path: PathViewPort; readonly errored: boolean; readonly bodyVisible: boolean; readonly orbitPathVisible: boolean }> {
    for (const entry of this.entries.values()) yield { id: entry.id, body: entry.body, path: entry.path, errored: this.errors.has(entry.id), bodyVisible: entry.bodyVisible, orbitPathVisible: entry.orbitPathVisible }
  }

  reconcile(objects: readonly OrbitalObject[], selection: string | null | { readonly primaryId: string | null; readonly selectedIds: ReadonlySet<string> }, view: RuntimeViewOptions = DEFAULT_RUNTIME_VIEW_OPTIONS): void {
    const projection = typeof selection === 'string' || selection === null ? { primaryId: selection, selectedIds: new Set(selection ? [selection] : []) } : selection
    this.selectedIdForPriority = projection.primaryId
    const ids = new Set(objects.map((object) => object.id))
    for (const [id, entry] of this.entries) {
      if (!ids.has(id)) {
        entry.path.dispose()
        entry.groundTrack.dispose()
        entry.sensorGeometry.dispose()
        entry.body.dispose()
        this.entries.delete(id)
      }
    }
    for (const object of objects) {
      let entry = this.entries.get(object.id)
      if (!entry) {
        const propagator = this.factories.createPropagator(object.source, object.propagation)
        const body = this.factories.createBody(object)
        let path: PathViewPort | undefined
        let groundTrack: GroundTrackViewPort | undefined
        let sensorGeometry: SensorGeometryViewPort | undefined
        try {
          path = this.factories.createPath(object)
          groundTrack = this.factories.createGroundTrack?.(object) ?? emptyGroundTrackViewPort()
          sensorGeometry = this.factories.createSensorGeometry?.(object) ?? emptySensorGeometryViewPort()
          entry = {
            id: object.id, body, path: path!, groundTrack: groundTrack!, sensorGeometry: sensorGeometry!, propagator,
            evaluator: createTrajectoryEvaluator(trajectoryVisualizationFor(object)),
            sampling: initialSamplingState(),
            drawnOrientation: null,
            lastSource: object.source, lastPropagation: object.propagation,
            lastGroundTrackPeriod: nominalOrbitalPeriodSeconds(object.source),
            sampledPathCache: null,
            sampledPathDirty: isSgp4Source(object.source) && object.display.orbitPathVisible,
            sampledPathForceRefresh: isSgp4Source(object.source) && object.display.orbitPathVisible,
            sampledPathLastRebuildAtMs: -Infinity,
            bodyVisible: object.display.bodyVisible,
            orbitPathVisible: object.display.orbitPathVisible,
            groundTrackCache: null,
            groundTrackDirty: object.display.groundTrackVisible,
            groundTrackForceRefresh: object.display.groundTrackVisible,
            groundTrackVisible: object.display.groundTrackVisible,
            groundTrackHistory: null,
            groundTrackHistoryRecording: false,
            sensor: object.sensor,
            reachConstraint: object.reachConstraint,
            sensorGeometryVisible: object.display.sensorGeometryVisible,
            publishedSensorGeometry: null,
            publishedHistoryRevision: -1,
          }
        } catch (error) {
          groundTrack?.dispose()
          sensorGeometry?.dispose()
          path?.dispose()
          body.dispose()
          throw error
        }
        this.entries.set(object.id, entry)
      } else {
        const previous = entry.lastSource
        const geometryChanged = previous.kind === 'keplerian' && object.source.kind === 'keplerian' && !sameGeometry(previous.geometry, object.source.geometry)
        const phaseChanged = previous.kind === 'keplerian' && object.source.kind === 'keplerian' && (previous.phase.referenceInstant.unixSeconds !== object.source.phase.referenceInstant.unixSeconds ||
          previous.phase.meanAnomalyAtReferenceRad !== object.source.phase.meanAnomalyAtReferenceRad)
        const sgp4SourceChanged = isSgp4Source(previous) && isSgp4Source(object.source) && (previous.kind !== object.source.kind || !sameSgp4MeanElements(previous.definition.meanElements, object.source.definition.meanElements))
        const sourceKindChanged = previous.kind !== object.source.kind
        const propagationChanged = entry.lastPropagation.kind !== object.propagation.kind
        // The editing lock is deliberately absent from this condition: two
        // objects differing only in their lock propagate identically, and
        // toggling it must never recreate a propagator (INV-3).
        if (geometryChanged || phaseChanged || sgp4SourceChanged || sourceKindChanged || propagationChanged) {
          entry.propagator = this.factories.createPropagator(object.source, object.propagation)
          entry.evaluator = createTrajectoryEvaluator(trajectoryVisualizationFor(object))
          // The unwrapped true anomaly is measured from the phase epoch, so
          // re-deriving the evaluator shifts its origin discontinuously. Discard
          // the anchor rather than reading one enormous fake advance, keeping
          // the band so a faded marker does not flash back to full opacity.
          entry.sampling = resetSamplingMeasurement(entry.sampling)
          entry.groundTrackDirty = true
          entry.groundTrackForceRefresh = true
          entry.sampledPathCache = null
          entry.sampledPathDirty = isSgp4Source(object.source) && object.display.orbitPathVisible
          entry.sampledPathForceRefresh = entry.sampledPathDirty
          entry.sampledPathLastRebuildAtMs = -Infinity
          // A recorded trail describes the orbit it was recorded from. Editing
          // elements or switching propagation makes those points belong to a
          // different object, so they are discarded rather than joined.
          this.discardGroundTrackHistory(entry)
        }
        const nextPeriod = nominalOrbitalPeriodSeconds(object.source)
        if (nextPeriod !== entry.lastGroundTrackPeriod) {
          entry.groundTrackDirty = true
          entry.groundTrackForceRefresh = true
          entry.lastGroundTrackPeriod = nextPeriod
          // The recording cadence is derived from the period, so the recorder is
          // rebuilt rather than continued at a stale grid.
          this.discardGroundTrackHistory(entry)
        }
        if (!entry.groundTrackVisible && object.display.groundTrackVisible) {
          entry.groundTrackDirty = true
          entry.groundTrackForceRefresh = true
        }
        entry.groundTrackVisible = object.display.groundTrackVisible
        if (entry.sensorGeometryVisible && !object.display.sensorGeometryVisible) {
          entry.sensorGeometry.setGeometry(null)
          entry.publishedSensorGeometry = null
        }
        entry.sensorGeometryVisible = object.display.sensorGeometryVisible
        entry.sensor = object.sensor
        entry.reachConstraint = object.reachConstraint
        // Only a or e changes the perifocal sample set; the three angles are
        // written as an orientation instead. TLE paths own sampled segments.
        if (previous.kind === 'keplerian' && object.source.kind === 'keplerian' && entry.path.kind !== 'sampled' && !sameConicShape(previous.geometry, object.source.geometry)) {
          if (entry.evaluator.kind === 'conic') entry.path.rebuildShape?.(entry.evaluator.shape)
        }
        if (isSgp4Source(object.source) && object.display.orbitPathVisible && entry.path.kind === 'sampled' && !entry.sampledPathCache) entry.sampledPathDirty = true
        entry.lastSource = object.source
        entry.lastPropagation = object.propagation
      }
      entry.bodyVisible = object.display.bodyVisible
      entry.orbitPathVisible = object.display.orbitPathVisible
      const recording = object.display.groundTrackVisible && object.display.groundTrackHistoryRecording
      if (recording !== entry.groundTrackHistoryRecording) {
        entry.groundTrackHistoryRecording = recording
        // Turning recording off drops the trail, and turning it on starts a new
        // one from the current instant rather than resuming an older trail.
        this.discardGroundTrackHistory(entry)
        // A recorded trail replaces the computed window, so the window is
        // cleared on the way in and rebuilt on the way out.
        entry.groundTrackDirty = !recording
        entry.groundTrackForceRefresh = !recording
        if (recording) entry.groundTrack.setWindow(null)
      }
      const color = view.displayColor ? view.displayColor(object.style.colorHex) : object.style.colorHex
      entry.body.setColor(color)
      entry.body.setHaloColor?.(view.haloColor ?? null)
      entry.body.setSize(object.style.markerSizeRenderUnits)
      entry.body.setZoomScaling(view.scaleMarkersWithZoom)
      entry.body.setVisible(object.display.bodyVisible)
      entry.body.setSelectionEmphasis?.(projection.selectedIds.has(object.id), projection.primaryId === object.id)
      entry.path.setColor(color)
      entry.path.setVisible(object.display.orbitPathVisible)
      entry.path.setSelected(projection.selectedIds.has(object.id))
      entry.groundTrack.setColor(object.style.colorHex)
      entry.groundTrack.setBodyVisible?.(object.display.bodyVisible)
      entry.groundTrack.setName?.(object.name)
      entry.groundTrack.setVisible(object.display.groundTrackVisible)
      entry.groundTrack.setSelected(projection.selectedIds.has(object.id))
      entry.sensorGeometry.setVisible(object.display.sensorGeometryVisible)
      entry.sensorGeometry.setColor(object.style.colorHex)
      entry.sensorGeometry.setSelected(projection.selectedIds.has(object.id))
    }
  }

  /** Discard every recorded trail.
   *
   * The learner chose clear-and-restart for discontinuities, so a date jump,
   * Now, Reset or a playback reversal drops the trail for every object rather
   * than leaving a gap whose two ends were recorded under different intent.
   */
  clearGroundTrackHistories(): void {
    for (const entry of this.entries.values()) this.discardGroundTrackHistory(entry)
  }

  private discardGroundTrackHistory(entry: RuntimeEntry): void {
    entry.groundTrackHistory = null
    if (entry.publishedHistoryRevision !== -1) {
      entry.groundTrack.setHistory?.(null)
      entry.publishedHistoryRevision = -1
    }
  }

  /** Mark one selected track for an immediate paused/jump refresh. */
  requestGroundTrackRefresh(id: string | null): void {
    if (!id) return
    const entry = this.entries.get(id)
    if (!entry || !entry.groundTrackVisible) return
    entry.groundTrackDirty = true
    entry.groundTrackForceRefresh = true
  }

  updateAt(instant: SimulationInstant, orientation?: EarthOrientation, nowMs = 0): ReadonlyMap<string, ObjectFrameSample> {
    const samples = new Map<string, ObjectFrameSample>()
    const currentOrientation = orientation ?? earthOrientationAt(instant)
    for (const [id, entry] of this.entries) {
      try {
        const state = entry.propagator.stateAt(instant)
        this.errors.delete(id)
        entry.body.setVisible(entry.bodyVisible)
        entry.path.setVisible(entry.orbitPathVisible)
        if (entry.evaluator.kind === 'sampledWindow' && entry.orbitPathVisible && !entry.sampledPathCache) entry.sampledPathDirty = true
        entry.body.update(state)
        let conic: ConicFrameSample | undefined
        if (entry.evaluator.kind === 'conic') {
          conic = entry.evaluator.sampleAt(instant)
          if (entry.path.kind !== 'sampled') entry.path.setOrientation?.(conic.geometry)
          entry.drawnOrientation = conic.geometry
          entry.sampling = advanceSamplingState(entry.sampling, conic.unwrappedTrueAnomalyRad)
        } else {
          const progress = (instant.unixSeconds - entry.evaluator.source.epoch.unixSeconds) / entry.evaluator.nominalPeriodSeconds * Math.PI * 2
          entry.sampling = advanceSamplingState(entry.sampling, progress)
        }
        entry.body.setOpacity(entry.sampling.band === 'planeOnly' ? PLANE_ONLY_MARKER_OPACITY : 1)
        const subSatellitePoint = subSatellitePointFromState(state, currentOrientation)
        entry.groundTrack.setCurrent(subSatellitePoint)
        let sensorGeometry: InstantaneousSensorGeometry | null = null
        if (entry.sensorGeometryVisible && subSatellitePoint) {
          const result = createInstantaneousSensorGeometry({
            instant,
            positionEarthFixedKm: projectInertialToEarthFixed(state.positionProjectInertialKm, currentOrientation),
            centre: subSatellitePoint,
            sensor: entry.sensor,
            reachConstraint: entry.reachConstraint,
          })
          if (result.kind === 'valid') sensorGeometry = result.geometry
        }
        if (entry.sensorGeometryVisible) {
          entry.sensorGeometry.setGeometry(sensorGeometry)
          entry.publishedSensorGeometry = sensorGeometry
        } else if (entry.publishedSensorGeometry !== null) {
          entry.sensorGeometry.setGeometry(null)
          entry.publishedSensorGeometry = null
        }
        if (entry.groundTrackHistoryRecording) this.recordGroundTrackHistory(entry, instant)
        else if (entry.groundTrackVisible && groundTrackNeedsRecenter(instant, entry.groundTrackCache)) entry.groundTrackDirty = true
        if (entry.evaluator.kind === 'sampledWindow' && entry.orbitPathVisible && sampledTrajectoryNeedsRecenter(instant, entry.sampledPathCache?.centreInstant ?? instant, entry.evaluator.nominalPeriodSeconds)) entry.sampledPathDirty = true
        samples.set(id, { state, subSatellitePoint, samplingBand: entry.sampling.band, conic, sensorGeometry })
      } catch (error) {
        const propagationError = error instanceof OrbitPropagationError ? error : new OrbitPropagationError('unknown', 'This object could not be propagated.', instant)
        this.errors.set(id, propagationError)
        entry.body.setVisible(false)
        entry.path.setVisible(false)
        entry.groundTrack.setCurrent(null)
        entry.groundTrack.setWindow(null)
        if (entry.publishedSensorGeometry !== null) {
          entry.sensorGeometry.setGeometry(null)
          entry.publishedSensorGeometry = null
        }
        entry.groundTrackCache = null
        entry.groundTrackDirty = false
        entry.groundTrackForceRefresh = false
        entry.sampledPathCache = null
        entry.sampledPathDirty = false
        entry.sampledPathForceRefresh = false
        entry.path.setSegments?.([])
        if (entry.groundTrackHistoryRecording) this.recordGroundTrackHistory(entry, instant)
      }
    }
    // Window rebuilds: the first ground track and the first sampled path are
    // always allowed, as before; further rebuilds continue, oldest first, while
    // the frame's real-time budget lasts. Each rebuild stamps its entry with
    // `nowMs`, so the real-time floor keeps it out of the rest of this frame.
    // An entry that could not rebuild keeps its dirty flag for the next frame;
    // the attempted sets stop this frame from selecting it again.
    const started = this.measureMs()
    const triedTracks = new Set<RuntimeEntry>()
    const triedPaths = new Set<RuntimeEntry>()
    const rebuildTrack = (entry: RuntimeEntry): void => { triedTracks.add(entry); this.rebuildGroundTrack(entry, instant, currentOrientation, samples, nowMs) }
    const rebuildPath = (entry: RuntimeEntry): void => { triedPaths.add(entry); this.rebuildSampledPath(entry, instant, samples.get(entry.id), nowMs) }
    const track = this.selectGroundTrackRebuild(nowMs)
    if (track) rebuildTrack(track)
    const sampled = this.selectSampledPathEntry(nowMs)
    if (sampled) rebuildPath(sampled)
    while (this.measureMs() - started < this.rebuildFrameBudgetMs) {
      const candidateTrack = this.selectGroundTrackRebuild(nowMs)
      const candidatePath = this.selectSampledPathEntry(nowMs)
      const nextTrack = candidateTrack && !triedTracks.has(candidateTrack) ? candidateTrack : undefined
      const nextPath = candidatePath && !triedPaths.has(candidatePath) ? candidatePath : undefined
      if (!nextTrack && !nextPath) break
      const trackAge = nextTrack?.groundTrackCache?.rebuiltAtMs ?? -Infinity
      if (nextTrack && (!nextPath || trackAge <= nextPath.sampledPathLastRebuildAtMs)) rebuildTrack(nextTrack)
      else if (nextPath) rebuildPath(nextPath)
    }
    return samples
  }

  private selectGroundTrackRebuild(nowMs: number): RuntimeEntry | undefined {
    const candidate = selectGroundTrackEntry(
      [...this.entries.values()].map((entry) => ({
        id: entry.id,
        dirty: entry.groundTrackDirty,
        // A recording object draws its trail instead of a computed window, so it
        // never competes for a window-rebuild slot.
        visible: entry.groundTrackVisible && !entry.groundTrackHistoryRecording && !this.errors.has(entry.id),
        lastRebuildAtMs: entry.groundTrackCache?.rebuiltAtMs ?? -Infinity,
        forced: entry.groundTrackForceRefresh,
      })),
      this.selectedIdForPriority,
      nowMs,
    )
    return candidate ? this.entries.get(candidate.id) : undefined
  }

  errorFor(id: string | null): OrbitPropagationError | null { return id ? this.errors.get(id) ?? null : null }

  /** The orientation angles an Orbit Lab path was drawn
   *  with in the last frame, so guides follow J2 drift; null for real objects
   *  and before the first frame. Read-only. */
  drawnOrientation(id: string): OrbitOrientationAngles | null {
    const angles = this.entries.get(id)?.drawnOrientation
    return angles ? { inclinationRad: angles.inclinationRad, raanRad: angles.raanRad, argOfPeriapsisRad: angles.argOfPeriapsisRad } : null
  }

  private selectSampledPathEntry(nowMs: number): RuntimeEntry | undefined {
    const candidates = [...this.entries.values()].filter((entry) => entry.path.kind === 'sampled' && entry.orbitPathVisible && entry.sampledPathDirty && (entry.sampledPathForceRefresh || nowMs - entry.sampledPathLastRebuildAtMs >= 250))
    const selected = candidates.find((entry) => entry.id === this.selectedIdForPriority)
    return selected ?? candidates.reduce<RuntimeEntry | undefined>((oldest, entry) => oldest && oldest.sampledPathLastRebuildAtMs <= entry.sampledPathLastRebuildAtMs ? oldest : entry, undefined)
  }

  private rebuildSampledPath(entry: RuntimeEntry, centreInstant: SimulationInstant, frameSample: ObjectFrameSample | undefined, nowMs: number): void {
    if (!frameSample || entry.evaluator.kind !== 'sampledWindow' || entry.path.kind !== 'sampled') return
    const window = sampleSgp4Trajectory({
      centreInstant,
      nominalPeriodSeconds: entry.evaluator.nominalPeriodSeconds,
      currentState: frameSample.state,
      stateAt: (at) => entry.propagator.stateAt(at),
    })
    entry.sampledPathCache = window
    entry.sampledPathDirty = false
    entry.sampledPathForceRefresh = false
    entry.sampledPathLastRebuildAtMs = nowMs
    entry.path.setSegments?.(window?.segments ?? [])
  }

  /** Advance one object's trail and publish it only when it actually changed.
   *
   * The recorder samples on a fixed simulation-time grid, so most frames record
   * nothing and this costs one comparison. It reuses the entry's own propagator
   * and the shared Earth-orientation model, so a trail is the same curve the
   * window sampler would draw over the same interval.
   */
  private recordGroundTrackHistory(entry: RuntimeEntry, instant: SimulationInstant): void {
    if (!entry.groundTrackHistory) {
      entry.groundTrackHistory = new GroundTrackHistoryRecorder(groundTrackHistoryStepSeconds(entry.lastGroundTrackPeriod))
    }
    const recorder = entry.groundTrackHistory
    recorder.advanceTo({
      instant,
      stateAt: (at) => entry.propagator.stateAt(at),
      earthOrientationAt,
    })
    if (recorder.revision === entry.publishedHistoryRevision) return
    entry.groundTrack.setHistory?.(recorder.segments)
    entry.publishedHistoryRevision = recorder.revision
  }

  private selectedIdForPriority: string | null = null

  /** Keep selection as a runtime scheduling hint without making it derived state. */
  setSelectedId(id: string | null): void { this.selectedIdForPriority = id }

  private rebuildGroundTrack(
    entry: RuntimeEntry,
    centreInstant: SimulationInstant,
    currentOrientation: EarthOrientation,
    samples: ReadonlyMap<string, ObjectFrameSample>,
    nowMs: number,
  ): void {
    const frameSample = samples.get(entry.id)
    const period = entry.lastGroundTrackPeriod
    if (!frameSample || !entry.groundTrackVisible) return
    if (!period) {
      // A future source may not yet expose a nominal period. Do not spin the
      // queue; reconciliation will dirty the entry when that source becomes
      // period-capable.
      entry.groundTrackDirty = false
      entry.groundTrackForceRefresh = false
      entry.groundTrack.setWindow(null)
      return
    }
    const window = sampleGroundTrack({
      centreInstant,
      nominalPeriodSeconds: period,
      currentState: frameSample.state,
      currentOrientation,
      stateAt: (instant) => entry.propagator.stateAt(instant),
      earthOrientationAt,
    })
    entry.groundTrackCache = window ? {
      window,
      centreInstant: { ...centreInstant },
      nominalPeriodSeconds: period,
      revision: (entry.groundTrackCache?.revision ?? 0) + 1,
      rebuiltAtMs: nowMs,
    } : null
    entry.groundTrackDirty = false
    entry.groundTrackForceRefresh = false
    entry.groundTrack.setWindow(window)
  }

  dispose(): void {
    for (const entry of this.entries.values()) { entry.groundTrackHistory = null; entry.path.dispose(); entry.groundTrack.dispose(); entry.sensorGeometry.dispose(); entry.body.dispose() }
    this.entries.clear()
  }
}

function emptyGroundTrackViewPort(): GroundTrackViewPort {
  return {
    setCurrent: () => {}, setWindow: () => {}, setVisible: () => {}, setColor: () => {}, setSelected: () => {}, dispose: () => {},
  }
}

function sameGeometry(a: OrbitOrientationAngles & { semiMajorAxisKm: number; eccentricity: number },
  b: OrbitOrientationAngles & { semiMajorAxisKm: number; eccentricity: number }): boolean {
  return a.semiMajorAxisKm === b.semiMajorAxisKm && a.eccentricity === b.eccentricity &&
    a.inclinationRad === b.inclinationRad && a.raanRad === b.raanRad && a.argOfPeriapsisRad === b.argOfPeriapsisRad
}

function emptySensorGeometryViewPort(): SensorGeometryViewPort {
  return { setGeometry: () => {}, setVisible: () => {}, setColor: () => {}, setSelected: () => {}, dispose: () => {} }
}

function sameSgp4MeanElements(a: Sgp4MeanElements, b: Sgp4MeanElements): boolean {
  return a.catalogId === b.catalogId && a.epoch.unixSeconds === b.epoch.unixSeconds &&
    a.meanMotionRadPerMinute === b.meanMotionRadPerMinute &&
    a.meanMotionFirstDerivativeRadPerMinuteSquared === b.meanMotionFirstDerivativeRadPerMinuteSquared &&
    a.meanMotionSecondDerivativeRadPerMinuteCubed === b.meanMotionSecondDerivativeRadPerMinuteCubed &&
    a.bstarPerEarthRadius === b.bstarPerEarthRadius && a.eccentricity === b.eccentricity &&
    a.inclinationRad === b.inclinationRad && a.raanRad === b.raanRad &&
    a.argumentOfPerigeeRad === b.argumentOfPerigeeRad && a.meanAnomalyRad === b.meanAnomalyRad
}
