import { describe, expect, it } from 'vitest'
import { degToRad } from '../../core/angles.ts'
import { addSeconds } from '../../core/time.ts'
import { lengthVec3, subtractVec3 } from '../../core/vec3.ts'
import { editedSatellite, limitedHeights, orbitValuesAt, phaseAheadDeg, planeAngleBetween, routeSeparation, satelliteFromValues, targetPlacedAhead, type RouteOrbitValues } from './routeObjects.ts'
import { exampleSatellites, routeExample } from './routeSetup.ts'
import { satelliteState } from './routeState.ts'

const START = { unixSeconds: 1_800_000_000 }
const DAY = 86_400
const ELLIPSE: RouteOrbitValues = { perigeeAltitudeKm: 500, apogeeAltitudeKm: 4000, inclinationDeg: 63.4, raanDeg: 120, argOfPerigeeDeg: 270, argumentOfLatitudeDeg: 30 }

describe('an object’s orbit values', () => {
  it('read back as they were set, at the instant they were set', () => {
    const values = orbitValuesAt(satelliteFromValues('x', ELLIPSE, START), START)
    for (const key of Object.keys(ELLIPSE) as (keyof RouteOrbitValues)[]) expect(values[key]).toBeCloseTo(ELLIPSE[key], 6)
  })

  it('drift with J2 afterwards, as the scene runs', () => {
    const satellite = satelliteFromValues('x', { ...ELLIPSE, inclinationDeg: 53, argOfPerigeeDeg: 0, apogeeAltitudeKm: 500 }, START)
    const later = orbitValuesAt(satellite, addSeconds(START, DAY))
    // A low orbit at 53° turns its node back by about 4° a day.
    expect(later.raanDeg - 120).toBeLessThan(-3)
    expect(later.raanDeg - 120).toBeGreaterThan(-6)
    expect(later.perigeeAltitudeKm).toBeCloseTo(500, 6)
  })

  it('are kept within the model’s heights, the apogee never below the perigee', () => {
    expect(limitedHeights(100, 50)).toEqual({ perigeeAltitudeKm: 200, apogeeAltitudeKm: 200 })
    expect(limitedHeights(900, 400)).toEqual({ perigeeAltitudeKm: 900, apogeeAltitudeKm: 900 })
    expect(limitedHeights(500, 1e6)).toEqual({ perigeeAltitudeKm: 500, apogeeAltitudeKm: 100_000 })
  })

  it('give a circular orbit no perigee to point, measuring place from the node', () => {
    const satellite = satelliteFromValues('x', { ...ELLIPSE, apogeeAltitudeKm: 500 }, START)
    expect(satellite.geometry).toMatchObject({ eccentricity: 0, argOfPeriapsisRad: 0 })
    expect(orbitValuesAt(satellite, START).argumentOfLatitudeDeg).toBeCloseTo(30, 9)
  })

  it('change one value where the object is now, and leave the others', () => {
    const satellite = satelliteFromValues('x', ELLIPSE, START)
    const now = addSeconds(START, 1234)
    const before = orbitValuesAt(satellite, now)
    const changed = editedSatellite(satellite, now, { inclinationDeg: 70 })
    const after = orbitValuesAt(changed, now)
    expect(after.inclinationDeg).toBeCloseTo(70, 9)
    for (const key of ['perigeeAltitudeKm', 'apogeeAltitudeKm', 'raanDeg', 'argOfPerigeeDeg', 'argumentOfLatitudeDeg'] as const) expect(after[key]).toBeCloseTo(before[key], 6)
    expect(changed.phase.referenceInstant).toEqual(now)
    // Same height and place along the orbit: only the plane turned.
    expect(lengthVec3(satelliteState(changed, now).positionProjectInertialKm)).toBeCloseTo(lengthVec3(satelliteState(satellite, now).positionProjectInertialKm), 6)
  })

  it('a change of nothing leaves the object where it is', () => {
    const satellite = satelliteFromValues('x', ELLIPSE, START)
    const now = addSeconds(START, 600)
    const same = editedSatellite(satellite, now, {})
    expect(lengthVec3(subtractVec3(satelliteState(same, now).positionProjectInertialKm, satelliteState(satellite, now).positionProjectInertialKm))).toBeLessThan(1e-6)
  })
})

describe('placing the target ahead', () => {
  it('puts it at the angle asked for, in one plane and between planes apart', () => {
    const { own, target } = exampleSatellites(routeExample('lowAndMedium'), START)
    for (const ahead of [-170, -45, 0, 30, 179]) expect(phaseAheadDeg(own, targetPlacedAhead(own, target, START, ahead), START)).toBeCloseTo(ahead, 4)
    const tilted = editedSatellite(target, START, { inclinationDeg: 20, raanDeg: 70 })
    expect(phaseAheadDeg(own, targetPlacedAhead(own, tilted, START, 60), START)).toBeCloseTo(60, 4)
  })
})

describe('routeSeparation', () => {
  it('measures height, plane and place apart', () => {
    const { own, target } = exampleSatellites(routeExample('oneShell'), START)
    const separation = routeSeparation(own, target, START)
    expect(separation.altitudeGapKm).toBeCloseTo(0, 9)
    expect(separation.planeAngleRad).toBeCloseTo(2 * Math.asin(Math.sin(degToRad(53)) * Math.sin(degToRad(30))), 12)
    expect(separation.nodeDriftRadPerDay).toBeCloseTo(0, 12)
    expect(separation.altitudeOnlyKmPerSecond).toBeCloseTo(0, 12)
  })

  it('says when J2 lines the planes up by itself, and only when the tilts match', () => {
    // 30° between the nodes, the lower orbit's turning about half a degree a day faster:
    // the target's node is behind yours and drifts back towards it.
    const { own, target } = exampleSatellites(routeExample('waitForPlanes'), START)
    const lineUp = routeSeparation(own, target, START).lineUpSeconds!
    expect(lineUp / DAY).toBeGreaterThan(40)
    expect(lineUp / DAY).toBeLessThan(90)
    // Either way round it is the same gap; the long way round takes over a year.
    expect(routeSeparation(target, own, START).lineUpSeconds).toBeCloseTo(lineUp, 3)
    expect(routeSeparation(own, editedSatellite(target, START, { raanDeg: 60 }), START).lineUpSeconds! / DAY).toBeGreaterThan(365)
    expect(routeSeparation(own, editedSatellite(target, START, { inclinationDeg: 60 }), START).lineUpSeconds).toBeNull()
  })

  it('is zero for one plane and the inclination difference at a shared node', () => {
    const orbit = (inclinationDeg: number, raanDeg: number) => ({ inclinationRad: degToRad(inclinationDeg), raanRad: degToRad(raanDeg) })
    expect(planeAngleBetween(orbit(51.6, 10), orbit(51.6, 10))).toBeCloseTo(0, 6)
    expect(planeAngleBetween(orbit(28.5, 10), orbit(51.6, 10))).toBeCloseTo(degToRad(23.1), 12)
  })
})
