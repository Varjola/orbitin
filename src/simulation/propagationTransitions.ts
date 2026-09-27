/** Changing how an orbit is propagated must never move it (INV-2).
 *
 * At the transition instant t*, before and after the model change:
 *
 *     position vector                   identical, bit for bit
 *     velocity vector                   identical, bit for bit
 *     all six classical mean elements   identical, bit for bit
 *     the drawn orbit path              identical
 *
 * What changes at t* is only the time derivatives of RAAN, argument of
 * periapsis and mean anomaly: from (0, 0, n) to the secular J2 rates, or back.
 *
 * Bit-identity is enforceable rather than hopeful, and rests on three
 * properties of the existing code that must not be broken:
 *
 *   1. Both models finish by calling the same `stateVectorEci` through the same
 *      `solveEccentricAnomaly` / `trueFromEccentricAnomaly` chain, with
 *      arguments that are literally the same doubles after re-anchoring.
 *   2. `secondsBetween(t*, t*)` is exactly 0, and `x + rate * 0` is exactly `x`
 *      for finite x and rate, so a re-anchored angle evaluated at its own
 *      reference instant returns the stored value untouched.
 *   3. `wrapRadians` is idempotent on [0, TAU), so the second wrap is a no-op
 *      rather than a rounding step.
 *
 * The claim is about simulation values, not about what a GPU does with them
 * afterwards.
 */
import { clamp } from '../core/angles.ts'
import { EARTH_RADIUS_KM } from '../core/constants.ts'
import type { SimulationInstant } from '../core/time.ts'
import {
  constrainGeometry,
  type EditedGeometryField,
  type ElementConstraint,
  type OrbitGeometry,
} from '../orbital/geometry.ts'
import { j2SecularElementsAt } from '../orbital/j2Secular.ts'
import { reanchorPhase } from '../orbital/keplerianPropagator.ts'
import { solveSunSynchronousInclination } from '../orbital/sunSynchronous.ts'
import { isSgp4Source } from './OrbitalObject.ts'
import type {
  KeplerianOrbitalObject,
  KeplerianOrbitSource,
  KeplerianPropagationModel,
  OrbitalObject,
  OrbitEditingLock,
  OrbitSource,
  PropagationModel,
} from './OrbitalObject.ts'

/** Move an orbit definition's epoch to `atInstant` without changing the state it
 *  describes at that instant. For `idealTwoBody` this only re-anchors the
 *  phase, exactly as 001's `reanchorPhase` already does. */
export function reanchorSource(
  source: KeplerianOrbitSource,
  propagation: KeplerianPropagationModel,
  atInstant: SimulationInstant,
): KeplerianOrbitSource
export function reanchorSource(
  source: OrbitSource,
  propagation: PropagationModel,
  atInstant: SimulationInstant,
): OrbitSource
export function reanchorSource(
  source: OrbitSource,
  propagation: PropagationModel,
  atInstant: SimulationInstant,
): OrbitSource {
  if (source.kind !== 'keplerian') return source
  if (propagation.kind === 'j2Secular') {
    const drifted = j2SecularElementsAt(source.geometry, source.phase, atInstant)
    return {
      kind: source.kind,
      geometry: drifted.geometry,
      phase: { referenceInstant: { ...atInstant }, meanAnomalyAtReferenceRad: drifted.meanAnomalyRad },
    }
  }
  return {
    kind: source.kind,
    geometry: { ...source.geometry },
    phase: reanchorPhase(source.geometry, source.phase, atInstant),
  }
}

/** Why a Sun-synchronous lock changed, or refused to. Carried on the existing
 *  per-object status channel rather than a second competing message area. */
export type SunSynchronousStatus =
  | { kind: 'none' }
  | { kind: 'applied'; inclinationRad: number }
  | { kind: 'unattainable'; maximumSemiMajorAxisKm: number; maximumAltitudeKm: number }
  | { kind: 'releasedByInclinationEdit' }
  | { kind: 'releasedByPropagationChange' }
  | { kind: 'requiresJ2Drift' }

export interface TransitionResult<TObject extends OrbitalObject = OrbitalObject> {
  readonly object: TObject
  readonly status: SunSynchronousStatus
  readonly constraint: ElementConstraint
}

const unattainable = (maximumSemiMajorAxisKm: number): SunSynchronousStatus =>
  ({ kind: 'unattainable', maximumSemiMajorAxisKm, maximumAltitudeKm: maximumSemiMajorAxisKm - EARTH_RADIUS_KM })

/** Switching the model re-anchors first, so the object does not teleport. The
 *  lock releases when leaving j2Secular, because the nodal rate it exists to
 *  hold does not exist under two-body propagation. */
export function switchPropagation(
  object: KeplerianOrbitalObject,
  next: KeplerianPropagationModel,
  atInstant: SimulationInstant,
): TransitionResult<KeplerianOrbitalObject>
export function switchPropagation(
  object: OrbitalObject,
  next: PropagationModel,
  atInstant: SimulationInstant,
): TransitionResult
export function switchPropagation(
  object: OrbitalObject,
  next: PropagationModel,
  atInstant: SimulationInstant,
): TransitionResult {
  if (isSgp4Source(object.source)) {
    if (next.kind !== 'sgp4') throw new Error('A TLE source can only use SGP4/SDP4 propagation.')
    return { object: { ...object, propagation: next, editingLock: { kind: 'none' } }, status: { kind: 'none' }, constraint: { kind: 'none' } }
  }
  if (object.propagation.kind === 'sgp4') throw new Error('A Keplerian source cannot use SGP4/SDP4 propagation.')
  if (object.propagation.kind === next.kind) return { object, status: { kind: 'none' }, constraint: { kind: 'none' } }
  const leavingDrift = object.propagation.kind === 'j2Secular' && object.editingLock.kind === 'sunSynchronous'
  const editingLock: OrbitEditingLock = next.kind === 'j2Secular' ? object.editingLock : { kind: 'none' }
  return {
    object: { ...object, source: reanchorSource(object.source, object.propagation, atInstant), propagation: next, editingLock },
    status: leavingDrift ? { kind: 'releasedByPropagationChange' } : { kind: 'none' },
    constraint: { kind: 'none' },
  }
}

/** Turning the lock on re-anchors, solves inclination from the object's current
 *  a and e, and applies it if attainable. It never changes RAAN: the
 *  Sun-synchronous condition constrains the nodal *rate*, not the local
 *  crossing time, and which local time an orbit holds is a design choice the
 *  learner owns. Turning it off is a pure settings change with no visible
 *  effect until the next edit (INV-3). */
export function setSunSynchronousLock(
  object: KeplerianOrbitalObject,
  enabled: boolean,
  atInstant: SimulationInstant,
): TransitionResult<KeplerianOrbitalObject>
export function setSunSynchronousLock(
  object: OrbitalObject,
  enabled: boolean,
  atInstant: SimulationInstant,
): TransitionResult
export function setSunSynchronousLock(
  object: OrbitalObject,
  enabled: boolean,
  atInstant: SimulationInstant,
): TransitionResult {
  if (object.source.kind !== 'keplerian') return { object, status: { kind: 'none' }, constraint: { kind: 'none' } }
  if (!enabled) {
    if (object.editingLock.kind === 'none') return { object, status: { kind: 'none' }, constraint: { kind: 'none' } }
    return { object: { ...object, editingLock: { kind: 'none' } }, status: { kind: 'none' }, constraint: { kind: 'none' } }
  }
  if (object.propagation.kind !== 'j2Secular') return { object, status: { kind: 'requiresJ2Drift' }, constraint: { kind: 'none' } }
  const source = reanchorSource(object.source, object.propagation, atInstant)
  if (source.kind !== 'keplerian') return { object, status: { kind: 'none' }, constraint: { kind: 'none' } }
  const solution = solveSunSynchronousInclination(source.geometry.semiMajorAxisKm, source.geometry.eccentricity)
  if (solution.kind === 'unattainable') {
    // Leave the lock off and change nothing, rather than clamping silently.
    return { object, status: unattainable(solution.maximumSemiMajorAxisKm), constraint: { kind: 'none' } }
  }
  return {
    object: {
      ...object,
      source: { ...source, geometry: { ...source.geometry, inclinationRad: solution.inclinationRad } },
      editingLock: { kind: 'sunSynchronous' },
    },
    status: { kind: 'applied', inclinationRad: solution.inclinationRad },
    constraint: { kind: 'none' },
  }
}

/** Every element edit re-anchors the epoch first, generalising the rule
 *  `Application.changeGeometry` already follows for phase to the elements this
 *  model drifts, so the drawn orbit does not jump.
 *
 * The lock never fights the learner and never silently changes a value the
 * learner just set: an inclination edit releases it, and an a or e edit past
 * the attainability bound keeps the edited value and releases it.
 */
export function applyGeometryEdit(
  object: KeplerianOrbitalObject,
  field: EditedGeometryField,
  value: number,
  bounds: { min: number; max: number },
  atInstant: SimulationInstant,
): TransitionResult<KeplerianOrbitalObject>
export function applyGeometryEdit(
  object: OrbitalObject,
  field: EditedGeometryField,
  value: number,
  bounds: { min: number; max: number },
  atInstant: SimulationInstant,
): TransitionResult
export function applyGeometryEdit(
  object: OrbitalObject,
  field: EditedGeometryField,
  value: number,
  bounds: { min: number; max: number },
  atInstant: SimulationInstant,
): TransitionResult {
  if (object.source.kind !== 'keplerian') return { object, status: { kind: 'none' }, constraint: { kind: 'none' } }
  if (object.propagation.kind === 'sgp4') return { object, status: { kind: 'none' }, constraint: { kind: 'none' } }
  const source = reanchorSource(object.source, object.propagation, atInstant)
  if (source.kind !== 'keplerian') return { object, status: { kind: 'none' }, constraint: { kind: 'none' } }
  const edited: OrbitGeometry = { ...source.geometry, [field]: clamp(value, bounds.min, bounds.max) }
  const constrained = constrainGeometry(edited, field)
  const locked = object.editingLock.kind === 'sunSynchronous' && object.propagation.kind === 'j2Secular'
  const withEdit = (geometry: OrbitGeometry, editingLock: OrbitEditingLock, status: SunSynchronousStatus): TransitionResult =>
    ({ object: { ...object, source: { ...source, geometry }, editingLock }, status, constraint: constrained.constraint })

  if (!locked) return withEdit(constrained.geometry, object.editingLock, { kind: 'none' })

  if (field === 'inclinationRad') {
    return withEdit(constrained.geometry, { kind: 'none' }, { kind: 'releasedByInclinationEdit' })
  }
  if (field === 'semiMajorAxisKm' || field === 'eccentricity') {
    const solution = solveSunSynchronousInclination(constrained.geometry.semiMajorAxisKm, constrained.geometry.eccentricity)
    if (solution.kind === 'unattainable') {
      // The edited value is kept and inclination is left as it was; only the
      // lock gives way.
      return withEdit(constrained.geometry, { kind: 'none' }, unattainable(solution.maximumSemiMajorAxisKm))
    }
    return withEdit(
      { ...constrained.geometry, inclinationRad: solution.inclinationRad },
      { kind: 'sunSynchronous' },
      { kind: 'applied', inclinationRad: solution.inclinationRad },
    )
  }
  // RAAN and argument of periapsis do not enter the Sun-synchronous condition.
  return withEdit(constrained.geometry, object.editingLock, { kind: 'none' })
}
