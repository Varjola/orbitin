import { describe, expect, it } from 'vitest'
import { degToRad, radToDeg, wrapRadians, wrapRadiansSigned } from '../core/angles.ts'
import { MAX_SIMULATION_INSTANT, MIN_SIMULATION_INSTANT, SIMULATION_START_INSTANT } from '../core/constants.ts'
import { applyMat3, identityMat3, multiplyMat3, transposeMat3, type Mat3 } from '../core/mat3.ts'
import { crossVec3, dotVec3, normalizeVec3, type Vec3 } from '../core/vec3.ts'
import { earthOrientationAt } from '../simulation/earthOrientation.ts'
import { nodeOfDate, orbitNormalProjectInertial, raanForNodeRightAscensionOfDate } from './nodeOfDate.ts'
import { rotatePerifocalToEci } from './rotation.ts'
import type { OrbitGeometry } from './geometry.ts'

const elements = (inclinationDeg: number, raanDeg: number): OrbitGeometry =>
  ({ semiMajorAxisKm: 7178.137, eccentricity: 0, inclinationRad: degToRad(inclinationDeg), raanRad: degToRad(raanDeg), argOfPeriapsisRad: 0 })

const rotationX = (rad: number): Mat3 => {
  const c = Math.cos(rad), s = Math.sin(rad)
  return [1, 0, 0, 0, c, -s, 0, s, c]
}

/** The method this module deliberately rejects: rotate the J2000 node vector
 *  into mean-of-date and read its right ascension. The rotated node vector does
 *  not lie in the mean-of-date equator, so this is geometrically wrong. */
const naiveNodeRightAscension = (geometry: OrbitGeometry, precession: Mat3): number => {
  const nodeVectorJ2000: Vec3 = { x: Math.cos(geometry.raanRad), y: Math.sin(geometry.raanRad), z: 0 }
  const rotated = applyMat3(precession, nodeVectorJ2000)
  return wrapRadians(Math.atan2(rotated.y, rotated.x))
}

const definedNode = (geometry: OrbitGeometry, precession: Mat3) => {
  const node = nodeOfDate(geometry, precession)
  if (node.kind !== 'defined') throw new Error('expected a defined node')
  return node
}

describe('orbit plane normal', () => {
  it('matches the perifocal z axis rotated into project-inertial', () => {
    for (const inclinationDeg of [0, 30, 51.5, 90, 98.6, 180]) {
      for (const raanDeg of [0, 45, 175, 300]) {
        const geometry = elements(inclinationDeg, raanDeg)
        const rotated = rotatePerifocalToEci({ x: 0, y: 0, z: 1 }, geometry)
        const normal = orbitNormalProjectInertial(geometry)
        expect(normal.x).toBeCloseTo(rotated.x, 15)
        expect(normal.y).toBeCloseTo(rotated.y, 15)
        expect(normal.z).toBeCloseTo(rotated.z, 15)
      }
    }
  })
})

describe('mean-of-date node', () => {
  // atan2 reconstructs the angle from its sine and cosine, so
  // this is a tight numerical equality rather than a bit-identity claim.
  it('reduces to the stored RAAN under an identity precession matrix', () => {
    for (const inclinationDeg of [1, 30, 51.5, 90, 98.6, 179]) {
      for (const raanDeg of [0, 45, 175, 300]) {
        const node = definedNode(elements(inclinationDeg, raanDeg), identityMat3())
        expect(Math.abs(wrapRadiansSigned(node.rightAscensionRad - degToRad(raanDeg)))).toBeLessThan(1e-12)
        expect(node.inclinationOfDateRad).toBeCloseTo(degToRad(inclinationDeg), 12)
      }
    }
    // At J2000 itself every precession angle is exactly zero, so the matrix is
    // exactly the identity.
    const atJ2000 = earthOrientationAt({ unixSeconds: 946728000 }).precessionToMeanOfDate
    expect(atJ2000).toEqual(identityMat3())
    expect(Math.abs(wrapRadiansSigned(definedNode(elements(51.5, 175), atJ2000).rightAscensionRad - degToRad(175)))).toBeLessThan(1e-12)
  })

  // Hand-derived closed form under an injected rotation.
  it('matches the analytic closed form under an injected Rx(10 deg)', () => {
    const theta = degToRad(10)
    const geometry = elements(30, 45)
    const analytic = Math.atan2(
      Math.sin(geometry.inclinationRad) * Math.sin(geometry.raanRad),
      Math.sin(geometry.inclinationRad) * Math.cos(geometry.raanRad) * Math.cos(theta) + Math.cos(geometry.inclinationRad) * Math.sin(theta),
    )
    const node = definedNode(geometry, rotationX(theta))
    expect(Math.abs(wrapRadiansSigned(node.rightAscensionRad - analytic))).toBeLessThan(1e-12)
    expect(radToDeg(node.rightAscensionRad)).toBeCloseTo(35.342009, 5)
  })

  // This test must fail if the implementation takes the
  // rejected shortcut.
  it('differs from the rotated-node-vector shortcut by the measured sizes', () => {
    const injected = rotationX(degToRad(10))
    const injectedGeometry = elements(30, 45)
    const injectedDelta = Math.abs(radToDeg(wrapRadiansSigned(
      definedNode(injectedGeometry, injected).rightAscensionRad - naiveNodeRightAscension(injectedGeometry, injected))))
    expect(injectedDelta).toBeGreaterThan(9)
    expect(injectedDelta).toBeCloseTo(9.2194, 3)

    const precession2050 = earthOrientationAt(MAX_SIMULATION_INSTANT).precessionToMeanOfDate
    const realGeometry = elements(30, 175)
    const realDelta = Math.abs(radToDeg(wrapRadiansSigned(
      definedNode(realGeometry, precession2050).rightAscensionRad - naiveNodeRightAscension(realGeometry, precession2050))))
    expect(realDelta).toBeGreaterThan(0.3)
    expect(realDelta).toBeCloseTo(0.4809, 3)
  })

  // An independently written construction: transform two
  // in-plane basis vectors, intersect the transformed plane with the
  // mean-of-date equator, and select the northbound crossing.
  it('agrees with a separately constructed plane-equator intersection', () => {
    for (const instant of [MIN_SIMULATION_INSTANT, SIMULATION_START_INSTANT, MAX_SIMULATION_INSTANT]) {
      const precession = earthOrientationAt(instant).precessionToMeanOfDate
      for (const inclinationDeg of [20, 51.5, 63.5, 98.6, 160]) {
        for (const raanDeg of [0, 45, 175, 300]) {
          const geometry = elements(inclinationDeg, raanDeg)
          // Two in-plane basis vectors in project-inertial, transformed.
          const inPlaneA = applyMat3(precession, rotatePerifocalToEci({ x: 1, y: 0, z: 0 }, geometry))
          const inPlaneB = applyMat3(precession, rotatePerifocalToEci({ x: 0, y: 1, z: 0 }, geometry))
          // The intersection of the orbit plane with the equator z = 0 is
          // perpendicular to both plane normals.
          const planeNormal = crossVec3(inPlaneA, inPlaneB)
          const line = normalizeVec3(crossVec3(planeNormal, { x: 0, y: 0, z: 1 }))
          // Pick the end where the orbit crosses northward: the in-plane
          // tangent there has a positive z component.
          const tangent = crossVec3(planeNormal, line)
          const ascending = dotVec3(tangent, { x: 0, y: 0, z: 1 }) > 0 ? line : { x: -line.x, y: -line.y, z: -line.z }
          const expected = wrapRadians(Math.atan2(ascending.y, ascending.x))
          expect(Math.abs(wrapRadiansSigned(definedNode(geometry, precession).rightAscensionRad - expected))).toBeLessThan(1e-12)
        }
      }
    }
  })

  it('inverts to a project-inertial RAAN that reproduces the target', () => {
    for (const instant of [{ unixSeconds: Date.UTC(1950, 0, 1) / 1000 }, SIMULATION_START_INSTANT, MAX_SIMULATION_INSTANT]) {
      const precession = earthOrientationAt(instant).precessionToMeanOfDate
      for (const inclinationDeg of [51.5, 98.6, 160]) {
        for (const targetDeg of [0, 77.3, 155.53247, 300]) {
          const target = degToRad(targetDeg)
          const raanRad = raanForNodeRightAscensionOfDate(degToRad(inclinationDeg), target, precession)
          const node = definedNode({ ...elements(inclinationDeg, 0), raanRad }, precession)
          expect(Math.abs(wrapRadiansSigned(node.rightAscensionRad - target))).toBeLessThan(1e-12)
        }
      }
    }
  })

  // The 0.2 deg case is inside the display-suppression
  // threshold but is NOT singular: a node exists there and nodeOfDate reports
  // it. Suppression is a separate, later decision made in the readout layer.
  it('is singular only when the transformed plane is the mean-of-date equator', () => {
    const precession = earthOrientationAt(SIMULATION_START_INSTANT).precessionToMeanOfDate
    expect(nodeOfDate(elements(0, 0), identityMat3()).kind).toBe('singular')
    expect(nodeOfDate({ ...elements(0, 0), inclinationRad: Math.PI }, identityMat3()).kind).toBe('singular')
    expect(nodeOfDate(elements(0.2, 45), precession).kind).toBe('defined')
    expect(nodeOfDate(elements(0.2, 45), identityMat3()).kind).toBe('defined')
    // An equatorial orbit tilted into the mean-of-date equator by the inverse
    // precession is singular there, which is a condition on the transformed
    // normal rather than on the stored inclination.
    const inverse = transposeMat3(precession)
    const tilted = multiplyMat3(precession, inverse)
    expect(nodeOfDate(elements(0, 0), tilted).kind).toBe('singular')
    expect(() => raanForNodeRightAscensionOfDate(0, 1, identityMat3())).toThrow(/mean-of-date equator/)
  })
})
