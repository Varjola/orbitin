/** Classical elements in three explicit regions, not two.
 *
 *     true singularity          the direction does not exist at all
 *                               RAAN:      i = 0 or i = pi
 *                               periapsis: e = 0
 *
 *     ill-conditioned readout   the direction exists, but this model cannot
 *                               report it honestly: it is dominated by effects
 *                               the model omits, or by its own frame accuracy
 *
 *     normal defined region     everything else
 *
 * An orbit at i = 0.2 deg **does** have an ascending node. An orbit at
 * e = 0.0005 **does** have a periapsis. Those quantities are poorly
 * conditioned and physically unhelpful at this model's fidelity, but they are
 * not mathematically undefined, and no comment, label or test name here may say
 * that they are (INV-6).
 *
 * The propagated angles stay usable in every region: RAAN, ArgP and M are
 * advanced linearly for every orbit, and `rotatePerifocalToEci` composes them
 * into a correct state vector because the individual angles' arbitrariness
 * cancels. Only the interpretation of individual angles as separate physical
 * quantities fails. A circular equatorial orbit's separate rates are
 * meaningless; their sum, the mean longitude rate, is exactly right.
 */
import { degToRad, wrapRadians } from '../core/angles.ts'
import type { OrbitGeometry } from './geometry.ts'
import type { AngleRates } from './j2Secular.ts'

/** The orbit plane is indistinguishable from the equator: no line of nodes
 *  exists. This is the mathematical singularity, not a display policy. The
 *  bound is a numerical floor - below it the node direction cannot be recovered
 *  from a double-precision normal at all - and every preset that reaches it
 *  does so exactly, because the GEO preset stores `degToRad(0)`. */
export const NODE_SINGULAR_SIN_INCLINATION = 1e-12

/** The orbit is indistinguishable from a circle: no periapsis exists. Same
 *  character as above; five of the six presets store an exact zero. */
export const PERIAPSIS_SINGULAR_ECCENTRICITY = 1e-12

/** Below this inclination the node direction is dominated by effects this model
 *  does not carry. The model's own 0.015 deg frame-registration error displaces
 *  the node by roughly that error divided by sin(i): at 0.5 deg it is already
 *  1.7 deg of node right ascension, about 7 minutes of MLTAN. The node still
 *  exists; the readout is suppressed because reporting it would imply a
 *  precision the model does not have. 0.5 deg is also exactly one
 *  inclination-slider step. */
export const NODE_READOUT_SUPPRESSION_INCLINATION_RAD = degToRad(0.5)

/** Below this eccentricity a *mean* orbit's periapsis is not a physically
 *  identifiable point at this model's fidelity: the J2 short-period
 *  eccentricity variation this model does not carry is itself about 1.3e-3 at
 *  800 km, so the periapsis direction would be set by omitted physics rather
 *  than by the stored element. The periapsis still exists; the readout is
 *  suppressed. 1e-3 is also exactly one eccentricity-slider step. */
export const PERIAPSIS_READOUT_SUPPRESSION_ECCENTRICITY = 1e-3

export type NodeCondition =
  | { kind: 'defined' }
  | { kind: 'illConditioned'; inclinationRad: number; thresholdRad: number }
  | { kind: 'singular' }

export type PeriapsisCondition =
  | { kind: 'defined' }
  | { kind: 'illConditioned'; eccentricity: number; threshold: number }
  | { kind: 'singular' }

export interface ElementConditioning {
  readonly node: NodeCondition
  readonly periapsis: PeriapsisCondition
}

export function classifyElements(elements: OrbitGeometry): ElementConditioning {
  const inclinationRad = elements.inclinationRad
  let node: NodeCondition
  if (Math.abs(Math.sin(inclinationRad)) <= NODE_SINGULAR_SIN_INCLINATION) node = { kind: 'singular' }
  else if (inclinationRad < NODE_READOUT_SUPPRESSION_INCLINATION_RAD || inclinationRad > Math.PI - NODE_READOUT_SUPPRESSION_INCLINATION_RAD) {
    node = { kind: 'illConditioned', inclinationRad, thresholdRad: NODE_READOUT_SUPPRESSION_INCLINATION_RAD }
  } else node = { kind: 'defined' }

  const eccentricity = elements.eccentricity
  let periapsis: PeriapsisCondition
  if (eccentricity <= PERIAPSIS_SINGULAR_ECCENTRICITY) periapsis = { kind: 'singular' }
  else if (eccentricity < PERIAPSIS_READOUT_SUPPRESSION_ECCENTRICITY) {
    periapsis = { kind: 'illConditioned', eccentricity, threshold: PERIAPSIS_READOUT_SUPPRESSION_ECCENTRICITY }
  } else periapsis = { kind: 'defined' }

  return { node, periapsis }
}

/** A condition is *reportable* only when the element is fully defined. The
 *  singular and ill-conditioned cases select the same substitute combination;
 *  they differ only in the wording the UI attaches. */
export function isReportable(condition: NodeCondition | PeriapsisCondition): boolean {
  return condition.kind === 'defined'
}

export type AngleReadout =
  | { kind: 'raan'; valueRad: number; rateRadPerSecond: number }
  | { kind: 'argOfPeriapsis'; valueRad: number; rateRadPerSecond: number }
  | { kind: 'argOfLatitude'; valueRad: number; rateRadPerSecond: number }
  | { kind: 'longitudeOfPeriapsis'; valueRad: number; rateRadPerSecond: number }
  | { kind: 'meanLongitude'; valueRad: number; rateRadPerSecond: number }

/** The four reportability combinations:
 *
 *     node | periapsis | readouts                          | combination
 *     yes  | yes       | RAAN; argument of periapsis       | RAAN; ArgP
 *     yes  | no        | RAAN; argument of latitude        | RAAN; ArgP + M
 *     no   | yes       | longitude of periapsis            | RAAN + ArgP
 *     no   | no        | mean longitude                    | RAAN + ArgP + M
 */
export function angleReadoutsFor(
  elements: OrbitGeometry,
  meanAnomalyRad: number,
  angleRates: AngleRates,
  conditioning: ElementConditioning = classifyElements(elements),
): readonly AngleReadout[] {
  const node = isReportable(conditioning.node)
  const periapsis = isReportable(conditioning.periapsis)
  const { raanRad, argOfPeriapsisRad } = elements
  const { raanRadPerSecond: dRaan, argOfPeriapsisRadPerSecond: dArgP, meanAnomalyRadPerSecond: dMean } = angleRates
  if (node && periapsis) {
    return [
      { kind: 'raan', valueRad: raanRad, rateRadPerSecond: dRaan },
      { kind: 'argOfPeriapsis', valueRad: argOfPeriapsisRad, rateRadPerSecond: dArgP },
    ]
  }
  if (node) {
    return [
      { kind: 'raan', valueRad: raanRad, rateRadPerSecond: dRaan },
      { kind: 'argOfLatitude', valueRad: wrapRadians(argOfPeriapsisRad + meanAnomalyRad), rateRadPerSecond: dArgP + dMean },
    ]
  }
  if (periapsis) {
    return [{ kind: 'longitudeOfPeriapsis', valueRad: wrapRadians(raanRad + argOfPeriapsisRad), rateRadPerSecond: dRaan + dArgP }]
  }
  return [{ kind: 'meanLongitude', valueRad: wrapRadians(raanRad + argOfPeriapsisRad + meanAnomalyRad), rateRadPerSecond: dRaan + dArgP + dMean }]
}
