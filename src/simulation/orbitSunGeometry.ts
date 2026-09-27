/** Node-versus-Sun geometry: the readouts that turn "the plane drifts" into
 *  "the satellite keeps crossing the equator at the same local mean solar time".
 *
 * Pure functions of elements plus an instant's `EnvironmentState`. No three.js,
 * no state, derived every frame and stored nowhere.
 *
 * Two Suns are used, and which one is deliberate in each case:
 *
 *   MLTAN / MLTDN   the **mean** Sun's right ascension, mean-of-date, compared
 *                   against the node right ascension recomputed in mean-of-date.
 *                   A timekeeping quantity.
 *   beta angle      the **apparent** Sun's direction, in project-inertial,
 *                   against the orbit normal in project-inertial. A physical
 *                   illumination quantity.
 */
import { TAU, wrapRadians } from '../core/angles.ts'
import { dotVec3 } from '../core/vec3.ts'
import {
  classifyElements,
  NODE_READOUT_SUPPRESSION_INCLINATION_RAD,
  type ElementConditioning,
} from '../orbital/elementConditioning.ts'
import type { OrbitGeometry } from '../orbital/geometry.ts'
import { nodeOfDate, orbitNormalProjectInertial } from '../orbital/nodeOfDate.ts'
import type { EnvironmentState } from './environment.ts'

export type NodeSunGeometry =
  | { kind: 'defined'
      rightAscensionOfDateRad: number
      meanLocalTimeAscendingNodeHours: number
      meanLocalTimeDescendingNodeHours: number }
  /** The node exists but this model will not report it. */
  | { kind: 'suppressed'; inclinationRad: number; thresholdRad: number }
  /** The node does not exist: the orbit plane is the equator. */
  | { kind: 'singular' }

export interface OrbitSunGeometry {
  readonly node: NodeSunGeometry
  /** Sun elevation above the orbital plane. Nonsingular: it depends only on the
   *  orbit normal, which is well defined for every inclination including zero,
   *  so it survives the equatorial and circular cases. */
  readonly betaAngleRad: number
}

/** Local mean solar time at a point is its hour angle from the mean Sun's
 *  anti-meridian. Greenwich sidereal time cancels out of the derivation - the
 *  node's terrestrial longitude is RAAN_mod - GMST and the mean Sun's hour angle
 *  there adds GMST straight back - so this isolates exactly the plane-versus-Sun
 *  geometry. It is constant for a Sun-synchronous orbit by construction. */
export function meanLocalSolarTimeHours(nodeRightAscensionOfDateRad: number, meanSunRightAscensionOfDateRad: number): number {
  const hours = 12 + ((nodeRightAscensionOfDateRad - meanSunRightAscensionOfDateRad) / TAU) * 24
  return ((hours % 24) + 24) % 24
}

export function betaAngleRad(elements: OrbitGeometry, environment: EnvironmentState): number {
  // Both vectors in project-inertial, named at the call site.
  return Math.asin(Math.max(-1, Math.min(1, dotVec3(environment.sunDirectionProjectInertial, orbitNormalProjectInertial(elements)))))
}

/** A true singularity is reported as one even though it also satisfies the
 *  suppression threshold, so `singular` is decided before `suppressed`.
 *
 *  It has **two** independent sources, and both must be checked:
 *
 *   1. The stored element set is equatorial (`classifyElements`). An orbit at
 *      i = 0 in J2000 has no line of nodes there, and every RAAN describes the
 *      same orbit. Precession tilts that plane about 0.34 deg away from the
 *      mean-of-date equator, so `nodeOfDate` does return a node - but that
 *      node's right ascension is produced entirely by the precession matrix and
 *      carries no information about the orbit, so reporting it would be
 *      reporting noise. This is the case every circular equatorial preset hits.
 *   2. The *transformed* plane coincides with the mean-of-date equator
 *      (`nodeOfDate`), where no line of nodes exists to compute at all.
 */
export function orbitSunGeometry(
  elements: OrbitGeometry,
  environment: EnvironmentState,
  conditioning: ElementConditioning = classifyElements(elements),
): OrbitSunGeometry {
  const beta = betaAngleRad(elements, environment)
  if (conditioning.node.kind === 'singular') return { node: { kind: 'singular' }, betaAngleRad: beta }
  const node = nodeOfDate(elements, environment.orientation.precessionToMeanOfDate)
  if (node.kind === 'singular') return { node: { kind: 'singular' }, betaAngleRad: beta }
  if (conditioning.node.kind !== 'defined') {
    return {
      node: {
        kind: 'suppressed',
        inclinationRad: elements.inclinationRad,
        thresholdRad: conditioning.node.kind === 'illConditioned' ? conditioning.node.thresholdRad : NODE_READOUT_SUPPRESSION_INCLINATION_RAD,
      },
      betaAngleRad: beta,
    }
  }
  const rightAscensionOfDateRad = wrapRadians(node.rightAscensionRad)
  const ascending = meanLocalSolarTimeHours(rightAscensionOfDateRad, environment.meanSunRightAscensionOfDateRad)
  return {
    node: {
      kind: 'defined',
      rightAscensionOfDateRad,
      meanLocalTimeAscendingNodeHours: ascending,
      meanLocalTimeDescendingNodeHours: (ascending + 12) % 24,
    },
    betaAngleRad: beta,
  }
}
