import { TAU } from '../core/angles.ts'
import type { SimulationInstant } from '../core/time.ts'
import type { OrbitGeometry } from '../orbital/geometry.ts'
import type { TleDefinition } from '../data/tle.ts'
import type { OmmDefinition } from '../data/omm.ts'
import type { Sgp4MeanElements } from '../data/sgp4MeanElements.ts'
import { j2SecularElementsAt, j2SecularRates, twoBodyRates, type AngleRates } from '../orbital/j2Secular.ts'
import { J2SecularPropagator } from '../orbital/j2SecularPropagator.ts'
import { solveEccentricAnomaly, trueFromEccentricAnomaly } from '../orbital/kepler.ts'
import { KeplerianPropagator, type OrbitPhase } from '../orbital/keplerianPropagator.ts'
import type { OrbitPropagator, OrbitSourceKind } from '../orbital/propagator.ts'
import { Sgp4Propagator } from '../orbital/sgp4Propagator.ts'

export type { OrbitSourceKind }
export type { AngleRates }

/** Where the orbital definition came from. TLE and OMM remain honest source
 * formats while sharing the normalized SGP4 propagation input. */
export type KeplerianOrbitSource = { kind: 'keplerian'; geometry: OrbitGeometry; phase: OrbitPhase }
export type TleOrbitSource = { kind: 'tle'; definition: TleDefinition }
export type OmmOrbitSource = { kind: 'omm'; definition: OmmDefinition }
export type Sgp4OrbitSource = TleOrbitSource | OmmOrbitSource
export type OrbitSource = KeplerianOrbitSource | Sgp4OrbitSource

export function isKeplerianSource(source: OrbitSource): source is KeplerianOrbitSource { return source.kind === 'keplerian' }
export function isSgp4Source(source: OrbitSource): source is Sgp4OrbitSource { return source.kind === 'tle' || source.kind === 'omm' }
export function sgp4MeanElementsForSource(source: Sgp4OrbitSource): Sgp4MeanElements { return source.definition.meanElements }

/** How that definition evolves in time. SGP4 propagation pairs only
 *  with an SGP4 source. It does not pair with 'keplerian',
 *  and 'j2Secular' does not pair with 'tle': SGP4 mean elements come from a
 *  different theory and a different averaging, and nothing converts between
 *  them. */
export type PropagationModel =
  | { kind: 'idealTwoBody' }
  | { kind: 'j2Secular' }
  | { kind: 'sgp4' }

export type KeplerianPropagationModel = Exclude<PropagationModel, { kind: 'sgp4' }>

/** How a learner's edits to that definition are constrained. This is a setting,
 *  not a physical property: two objects differing only in their lock propagate
 *  identically. Deliberately named apart from `ElementConstraint` in
 *  geometry.ts, which is a *result* - what the last edit had to do to stay in
 *  bounds - rather than a setting. */
export type OrbitEditingLock =
  | { kind: 'none' }
  | { kind: 'sunSynchronous' }

export interface OrbitalObjectStyle {
  colorHex: number
  markerSizeRenderUnits: number
}

/** Learner-owned, source-independent sensor intent: the angular properties of
 * the hypothetical instrument itself. They are physical angles, identical at
 * every altitude. This is not payload metadata, contains no current or
 * accumulated geometry and says nothing about the ground. */
export interface IdealizedSensorDefinition {
  readonly fieldOfViewHalfAngleRad: number
  readonly maxOffNadirSteeringRad: number
}

/** A simplified full-azimuth ground access constraint. It is kept apart from
 * the sensor because it describes from where on the ground the spacecraft is
 * usefully reachable, not what the instrument can see. It can illustrate a
 * communications minimum elevation but models no rain, multipath, terrain,
 * antenna gain, atmosphere or site-specific mask. */
export interface GroundReachConstraint {
  /** Surface locations that see the spacecraft lower than this above their
   *  local horizon are excluded. Zero is pure geometric visibility. */
  readonly minimumGroundElevationRad: number
}

export interface OrbitalObjectDisplaySettings {
  orbitPathVisible: boolean
  bodyVisible: boolean
  groundTrackVisible: boolean
  /** Learner intent to accumulate an Earth-fixed trail, not the trail itself.
   *  The recorded points are derived runtime state and never enter AppState. */
  groundTrackHistoryRecording: boolean
  sensorGeometryVisible: boolean
}

export interface OrbitalObject {
  id: string
  name: string
  source: OrbitSource
  /** Required rather than optional, so the compiler enumerates every creation
   *  site once instead of letting a new one silently receive a default. */
  propagation: PropagationModel
  editingLock: OrbitEditingLock
  style: OrbitalObjectStyle
  sensor: IdealizedSensorDefinition
  /** Required and separate from `sensor`, so every creation site states the
   *  ground reach it assumes instead of inheriting it from the instrument. */
  reachConstraint: GroundReachConstraint
  display: OrbitalObjectDisplaySettings
  notes?: string
}

/** Plain, serializable, definition-driven data. No functions are stored inside
 *  it, so the prohibition on history-accumulated paths holds
 *  and nothing executable ends up inside visualization configuration. Both kinds
 *  carry a phase, because the phase is what makes the visualization a complete
 *  description of where the object is on the conic; `phase.referenceInstant` is
 *  the epoch, so no separate epoch field exists. */
export type TrajectoryVisualization =
  | { kind: 'staticConic'; geometry: OrbitGeometry; phase: OrbitPhase }
  | { kind: 'driftingConic'; meanElements: OrbitGeometry; phase: OrbitPhase }
  | { kind: 'sampledWindow'; source: Sgp4MeanElements; nominalPeriodSeconds: number }

export interface ConicFrameSample {
  /** Mean elements at this instant. Drives path orientation and every element
   *  readout. */
  readonly geometry: OrbitGeometry
  /** Wrapped into [0, TAU). */
  readonly meanAnomalyRad: number
  /** Wrapped into [0, TAU), consistent with meanAnomalyRad. */
  readonly trueAnomalyRad: number
  /** trueAnomalyRad plus TAU times the number of whole revolutions completed
   *  since phase.referenceInstant, signed. The only quantity here that is not
   *  wrapped; the sampling band needs it and nothing else may. */
  readonly unwrappedTrueAnomalyRad: number
  readonly angleRates: AngleRates
}

export interface ConicTrajectoryEvaluator {
  readonly kind: 'conic'
  /** a and e, constant under both models, driving path resampling. */
  readonly shape: { semiMajorAxisKm: number; eccentricity: number }
  sampleAt(instant: SimulationInstant): ConicFrameSample
}

export type KeplerianOrbitalObject = Omit<OrbitalObject, 'source' | 'propagation'> & {
  source: KeplerianOrbitSource
  propagation: KeplerianPropagationModel
}

export interface SampledWindowEvaluator {
  readonly kind: 'sampledWindow'
  readonly source: Sgp4MeanElements
  readonly nominalPeriodSeconds: number
  /** Deliberately unusable for sampled windows; retained only so legacy
   * evaluator consumers must still inspect the discriminant before drawing. */
  sampleAt(instant: SimulationInstant): never
}

export type TrajectoryEvaluator = ConicTrajectoryEvaluator | SampledWindowEvaluator

export function isPropagationCompatible(source: OrbitSource, propagation: PropagationModel): boolean {
  return source.kind === 'keplerian'
    ? propagation.kind === 'idealTwoBody' || propagation.kind === 'j2Secular'
    : propagation.kind === 'sgp4'
}

export function createPropagator(source: OrbitSource, propagation: PropagationModel): OrbitPropagator {
  if (!isPropagationCompatible(source, propagation)) throw new Error(`Incompatible propagation model ${propagation.kind} for source ${source.kind}`)
  if (isSgp4Source(source)) return new Sgp4Propagator(source.definition.meanElements)
  switch (propagation.kind) {
    case 'idealTwoBody': return new KeplerianPropagator(source.geometry, source.phase)
    case 'j2Secular': return new J2SecularPropagator(source.geometry, source.phase)
    case 'sgp4': throw new Error('SGP4 cannot propagate a Keplerian source')
  }
}

export function trajectoryVisualizationFor(object: OrbitalObject): TrajectoryVisualization {
  if (isSgp4Source(object.source)) return { kind: 'sampledWindow', source: object.source.definition.meanElements, nominalPeriodSeconds: object.source.definition.meanElements.nominalPeriodSeconds }
  if (object.propagation.kind === 'j2Secular') {
    return { kind: 'driftingConic', meanElements: object.source.geometry, phase: object.source.phase }
  }
  return { kind: 'staticConic', geometry: object.source.geometry, phase: object.source.phase }
}

/** Derived from the visualization exactly the way a propagator is derived from
 *  a source. The evaluator and the propagator stay independent: OrbitPropagator
 *  keeps exactly one method, `stateAt`. Both paths call the same pure functions
 *  with the same arguments, so they agree bit for bit; the duplicated Kepler
 *  solve is accepted deliberately. */
export function createTrajectoryEvaluator(visualization: TrajectoryVisualization): TrajectoryEvaluator {
  if (visualization.kind === 'sampledWindow') return { ...visualization, sampleAt: (_instant: SimulationInstant): never => { throw new Error('A sampled trajectory has no conic frame sample.') } }
  const geometry = visualization.kind === 'driftingConic' ? visualization.meanElements : visualization.geometry
  const phase = visualization.phase
  // Two-body objects get the exact two-body rates, not J2 rates set to zero.
  const angleRates = visualization.kind === 'driftingConic' ? j2SecularRates(geometry) : twoBodyRates(geometry)
  const { eccentricity } = geometry
  return {
    kind: 'conic',
    shape: { semiMajorAxisKm: geometry.semiMajorAxisKm, eccentricity },
    sampleAt(instant: SimulationInstant): ConicFrameSample {
      // The same pure function the propagator calls, with the same arguments,
      // so the two agree bit for bit rather than merely closely. Under
      // idealTwoBody the rates are (0, 0, n), which reduces this to exactly the
      // arithmetic KeplerianPropagator performs.
      const drifted = j2SecularElementsAt(geometry, phase, instant, angleRates)
      const trueAnomalyRad = trueFromEccentricAnomaly(solveEccentricAnomaly(drifted.meanAnomalyRad, eccentricity), eccentricity)
      // Constructed rather than accumulated, so it is a pure function of the
      // instant and carries no frame history. Taken as the difference of the
      // unwrapped and wrapped mean anomalies, it is an exact integer.
      const revolutions = Math.round((drifted.unwrappedMeanAnomalyRad - drifted.meanAnomalyRad) / TAU)
      return {
        geometry: drifted.geometry,
        meanAnomalyRad: drifted.meanAnomalyRad,
        trueAnomalyRad,
        // True and mean anomaly lie in the same revolution: both are zero at
        // periapsis, both pass PI at apoapsis, and both are monotonic within a
        // revolution.
        unwrappedTrueAnomalyRad: trueAnomalyRad + revolutions * TAU,
        angleRates,
      }
    },
  }
}
