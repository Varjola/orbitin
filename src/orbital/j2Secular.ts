/** First-order secular J2 drift of the three angles an oblate Earth moves.
 *
 * These act on **mean** elements. A real satellite's osculating elements
 * oscillate around them roughly once per orbit; that short-period motion is not
 * modelled here and is not converted to or from. See
 * docs/orbit-perturbation-model.md.
 *
 * With p = a (1 - e^2), n = sqrt(mu / a^3) and k = 1.5 n J2 (Re / p)^2:
 *
 *     dRAAN/dt = -k cos i
 *     dArgP/dt =  (k / 2) (5 cos^2 i - 1)
 *     dM/dt    =  n + (k / 2) sqrt(1 - e^2) (3 cos^2 i - 1)
 *
 * Three consequences the UI later repeats:
 *
 * - dRAAN/dt is zero only at 90 deg inclination, negative (westward regression)
 *   for prograde orbits and positive for retrograde ones. Sun-synchronous
 *   orbits are retrograde because of that sign, not by convention.
 * - dArgP/dt vanishes at cos^2 i = 1/5, that is 63.4349488 deg and
 *   116.5650512 deg: the critical inclination, and the reason the highly
 *   elliptical preset sits at 63.5 deg.
 * - dM/dt differs from n, so the Keplerian period and the mean-anomaly period
 *   are no longer the same quantity - about 0.012% at LEO.
 *
 * Both zeros above are model zeros, not floating-point zeros: at i = 90 deg
 * Math.cos(i) is about 6.1e-17. No code here may branch on an exact zero.
 */
import { wrapRadians } from '../core/angles.ts'
import { EARTH_J2, EARTH_RADIUS_KM } from '../core/constants.ts'
import type { SimulationInstant } from '../core/time.ts'
import { secondsBetween } from '../core/time.ts'
import { meanMotion, validateGeometry, type OrbitGeometry } from './geometry.ts'
import type { OrbitPhase } from './keplerianPropagator.ts'

/** Time derivatives of the three angles a conic propagation model advances. */
export interface AngleRates {
  readonly raanRadPerSecond: number
  readonly argOfPeriapsisRadPerSecond: number
  readonly meanAnomalyRadPerSecond: number
}

/** k = 1.5 n J2 (Re / p)^2, the common factor of both plane-drift rates. */
export function j2SecularFactor(geometry: OrbitGeometry): number {
  validateGeometry(geometry)
  const semiLatusRectumKm = geometry.semiMajorAxisKm * (1 - geometry.eccentricity * geometry.eccentricity)
  return 1.5 * meanMotion(geometry) * EARTH_J2 * (EARTH_RADIUS_KM / semiLatusRectumKm) ** 2
}

/** Constant for the life of a propagator: a, e and i do not change under this
 *  model, so callers compute this once at construction, never per frame. */
export function j2SecularRates(geometry: OrbitGeometry): AngleRates {
  const k = j2SecularFactor(geometry)
  const cosine = Math.cos(geometry.inclinationRad)
  return {
    raanRadPerSecond: -k * cosine,
    argOfPeriapsisRadPerSecond: (k / 2) * (5 * cosine * cosine - 1),
    meanAnomalyRadPerSecond: meanMotion(geometry) + (k / 2) * Math.sqrt(1 - geometry.eccentricity ** 2) * (3 * cosine * cosine - 1),
  }
}

/** The two-body rates, which are the exact rates for `idealTwoBody` rather than
 *  J2 rates set to zero. Nothing invents a perturbation an object does not have. */
export function twoBodyRates(geometry: OrbitGeometry): AngleRates {
  return { raanRadPerSecond: 0, argOfPeriapsisRadPerSecond: 0, meanAnomalyRadPerSecond: meanMotion(geometry) }
}

export interface DriftedElements {
  /** Mean elements at the requested instant. a, e and i are unchanged. */
  readonly geometry: OrbitGeometry
  /** Wrapped into [0, TAU). */
  readonly meanAnomalyRad: number
  /** Mean anomaly measured from the phase reference instant without wrapping,
   *  so a caller can recover the signed whole-revolution count. */
  readonly unwrappedMeanAnomalyRad: number
}

/** Advance the three drifting angles linearly from the phase reference instant.
 *  `rates` is accepted so a propagator or evaluator that already holds the
 *  constant rates does not recompute them per frame. */
export function j2SecularElementsAt(
  geometry: OrbitGeometry,
  phase: OrbitPhase,
  instant: SimulationInstant,
  rates: AngleRates = j2SecularRates(geometry),
): DriftedElements {
  const elapsedSeconds = secondsBetween(instant, phase.referenceInstant)
  const unwrappedMeanAnomalyRad = phase.meanAnomalyAtReferenceRad + rates.meanAnomalyRadPerSecond * elapsedSeconds
  return {
    geometry: {
      ...geometry,
      raanRad: wrapRadians(geometry.raanRad + rates.raanRadPerSecond * elapsedSeconds),
      argOfPeriapsisRad: wrapRadians(geometry.argOfPeriapsisRad + rates.argOfPeriapsisRadPerSecond * elapsedSeconds),
    },
    meanAnomalyRad: wrapRadians(unwrappedMeanAnomalyRad),
    unwrappedMeanAnomalyRad,
  }
}
