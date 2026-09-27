import { applyMat3, multiplyMat3, rotationXMat3, rotationZMat3 } from '../core/mat3.ts'
import type { Vec3 } from '../core/vec3.ts'
import { classifyElements } from './elementConditioning.ts'
import type { OrbitGeometry } from './geometry.ts'

/** The geometry of the Shape strip's visual guides, in
 *  the project-inertial frame the Orbit Lab elements are defined in (km).
 *  The reference plane is that frame's equator, which is by definition the
 *  plane inclination and RAAN are measured from. Pure: no DOM, no three.js. */
export interface OrbitGuideGeometry {
  /** Unit vector towards the ascending node, in the reference plane. */
  readonly ascendingNode: Vec3
  /** Radius of the dashed reference ring: the orbit's size. */
  readonly ringRadiusKm: number
  /** Where the orbit crosses the reference plane going north and south. */
  readonly ascendingNodeKm: Vec3
  readonly descendingNodeKm: Vec3
  readonly periapsisKm: Vec3
  readonly apoapsisKm: Vec3
  /** The periapsis direction is undefined. */
  readonly circular: boolean
  /** The node is undefined. */
  readonly equatorial: boolean
}

/** `angles` are the orientation drawn this frame, so J2 drift is followed. */
export function orbitGuideGeometry(geometry: Pick<OrbitGeometry, 'semiMajorAxisKm' | 'eccentricity'>, angles: Pick<OrbitGeometry, 'inclinationRad' | 'raanRad' | 'argOfPeriapsisRad'>): OrbitGuideGeometry {
  const perifocalToInertial = multiplyMat3(multiplyMat3(rotationZMat3(angles.raanRad), rotationXMat3(angles.inclinationRad)), rotationZMat3(angles.argOfPeriapsisRad))
  const a = geometry.semiMajorAxisKm
  const e = geometry.eccentricity
  const conditioning = classifyElements({ semiMajorAxisKm: a, eccentricity: e, ...angles })
  const node = { x: Math.cos(angles.raanRad), y: Math.sin(angles.raanRad), z: 0 }
  // The true anomaly at the ascending node is −ω, and at the descending node π − ω.
  const semiLatusRectum = a * (1 - e * e)
  const ascending = semiLatusRectum / (1 + e * Math.cos(angles.argOfPeriapsisRad))
  const descending = semiLatusRectum / (1 - e * Math.cos(angles.argOfPeriapsisRad))
  return {
    ascendingNode: node,
    ascendingNodeKm: { x: node.x * ascending, y: node.y * ascending, z: 0 },
    descendingNodeKm: { x: -node.x * descending, y: -node.y * descending, z: 0 },
    ringRadiusKm: a,
    periapsisKm: applyMat3(perifocalToInertial, { x: a * (1 - e), y: 0, z: 0 }),
    apoapsisKm: applyMat3(perifocalToInertial, { x: -a * (1 + e), y: 0, z: 0 }),
    circular: conditioning.periapsis.kind === 'singular',
    equatorial: conditioning.node.kind === 'singular',
  }
}
