import { describe, expect, it } from 'vitest'
import { lengthVec3 } from '../core/vec3.ts'
import { projectInertialToRender } from '../core/renderFrame.ts'
import { radToDeg } from '../core/angles.ts'
import { declinationFromDms, equatorialToDirectionEci, rightAscensionFromHms } from './celestial.ts'

const referenceStars = [
  { name: 'Polaris', rightAscensionRad: rightAscensionFromHms(2, 31, 49), declinationRad: declinationFromDms(89, 15, 51) },
  { name: 'Vega', rightAscensionRad: rightAscensionFromHms(18, 36, 56), declinationRad: declinationFromDms(38, 47, 1) },
  { name: 'Sirius', rightAscensionRad: rightAscensionFromHms(6, 45, 9), declinationRad: declinationFromDms(-16, 42, 58) },
]

/** Angle between two unit vectors, in degrees. */
function separationDeg(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z))
  return radToDeg(Math.acos(dot))
}

describe('equatorial to ECI direction', () => {
  it('produces unit vectors for every reference star', () => {
    for (const star of referenceStars) {
      expect(lengthVec3(equatorialToDirectionEci(star))).toBeCloseTo(1, 6)
    }
  })

  it('places the vernal equinox on +X and the north celestial pole on +Z', () => {
    const equinox = equatorialToDirectionEci({ rightAscensionRad: 0, declinationRad: 0 })
    expect(separationDeg(equinox, { x: 1, y: 0, z: 0 })).toBeLessThan(0.05)
    const pole = equatorialToDirectionEci({ rightAscensionRad: 0, declinationRad: Math.PI / 2 })
    expect(separationDeg(pole, { x: 0, y: 0, z: 1 })).toBeLessThan(0.05)
  })

  it('puts Polaris on the celestial pole, and render up is therefore real north', () => {
    const polaris = referenceStars[0]!
    const directionEci = equatorialToDirectionEci(polaris)
    expect(directionEci.z).toBeGreaterThan(0.9997)
    // The check that "up is north" is real rather than a convention: after the
    // render transform, Polaris sits within a degree of +Y.
    const render = projectInertialToRender(directionEci)
    expect(render.y).toBeGreaterThan(0.9997)
    expect(separationDeg(render, { x: 0, y: 1, z: 0 })).toBeLessThan(1)
  })

  it('separates each star from the pole by exactly its polar distance', () => {
    // Independent of right ascension: the angle to the pole is 90 degrees
    // minus declination whatever the hour angle, so this catches right
    // ascension leaking into the polar component.
    for (const star of referenceStars) {
      const directionEci = equatorialToDirectionEci(star)
      const polarDistanceDeg = 90 - radToDeg(star.declinationRad)
      expect(separationDeg(directionEci, { x: 0, y: 0, z: 1 })).toBeCloseTo(polarDistanceDeg, 6)
    }
  })

  it('spaces stars in the equatorial plane by their right ascension difference', () => {
    const vega = equatorialToDirectionEci(referenceStars[1]!)
    const sirius = equatorialToDirectionEci(referenceStars[2]!)
    const hourAngleDifferenceDeg = radToDeg(referenceStars[1]!.rightAscensionRad - referenceStars[2]!.rightAscensionRad)
    const projectedDifferenceDeg = radToDeg(Math.atan2(vega.y, vega.x) - Math.atan2(sirius.y, sirius.x))
    expect(projectedDifferenceDeg).toBeCloseTo(hourAngleDifferenceDeg - 360, 6)
  })

  it('keeps a negative declination negative, including the -00 degrees case', () => {
    expect(equatorialToDirectionEci(referenceStars[2]!).z).toBeLessThan(0)
    expect(declinationFromDms(0, 30, 0, true)).toBeLessThan(0)
    expect(declinationFromDms(0, 30, 0)).toBeGreaterThan(0)
  })

  it('converts right ascension hours across a full turn', () => {
    expect(radToDeg(rightAscensionFromHms(6, 0, 0))).toBeCloseTo(90, 9)
    expect(radToDeg(rightAscensionFromHms(24, 0, 0))).toBeCloseTo(360, 9)
  })
})
