import { describe, expect, it } from 'vitest'
import { degToRad, radToDeg, TAU, wrapRadians } from '../core/angles.ts'
import { MAX_SIMULATION_INSTANT, SIMULATION_START_INSTANT } from '../core/constants.ts'
import { SECONDS_PER_DAY } from '../core/julianDate.ts'
import { angleReadoutsFor, classifyElements } from '../orbital/elementConditioning.ts'
import { j2SecularRates } from '../orbital/j2Secular.ts'
import { nodeOfDate, orbitNormalProjectInertial } from '../orbital/nodeOfDate.ts'
import { j2SecularElementsAt } from '../orbital/j2Secular.ts'
import { MEAN_SUN_RATE_DEG_PER_DAY } from './meanSun.ts'
import { environmentAt } from './environment.ts'
import { createObjectFromPreset, ORBIT_PRESETS } from './orbitPresets.ts'
import { betaAngleRad, meanLocalSolarTimeHours, orbitSunGeometry } from './orbitSunGeometry.ts'
import type { OrbitGeometry } from '../orbital/geometry.ts'

const presetById = (id: string) => ORBIT_PRESETS.find((candidate) => candidate.id === id)!
const sample = (geometry: OrbitGeometry, instant = SIMULATION_START_INSTANT) => orbitSunGeometry(geometry, environmentAt(instant))
const definedNode = (geometry: OrbitGeometry, instant = SIMULATION_START_INSTANT) => {
  const node = sample(geometry, instant).node
  if (node.kind !== 'defined') throw new Error(`expected a defined node, got ${node.kind}`)
  return node
}
/** Signed difference of two local solar times, wrapped into (-12, 12] hours. */
const hoursApart = (a: number, b: number) => ((a - b + 36) % 24) - 12
const elements = (inclinationDeg: number, raanRad: number, eccentricity = 0): OrbitGeometry =>
  ({ semiMajorAxisKm: 7178.137, eccentricity, inclinationRad: degToRad(inclinationDeg), raanRad, argOfPeriapsisRad: 0 })

describe('mean local solar time', () => {
  // Anchor cases that fix the sign convention.
  it.each([
    ['equal to the mean Sun', 0, 12],
    ['opposite the mean Sun', 180, 0],
    ['90 deg behind the mean Sun', -90, 6],
    ['90 deg ahead of the mean Sun', 90, 18],
  ])('gives a node %s', (_name, offsetDeg, expectedHours) => {
    const meanSunRa = 1.234
    const hours = meanLocalSolarTimeHours(meanSunRa + degToRad(offsetDeg), meanSunRa)
    expect(Math.abs(hoursApart(hours, expectedHours)) * 3600).toBeLessThan(1)
  })
})

describe('beta angle', () => {
  // The closed form is an independent expression of the same
  // geometry, in the style of the two-way sub-solar-point check.
  it('agrees with the closed form at every inclination including 0 and 180 deg', () => {
    for (let day = 0; day < 365; day += 37) {
      const instant = { unixSeconds: SIMULATION_START_INSTANT.unixSeconds + day * SECONDS_PER_DAY }
      const environment = environmentAt(instant)
      const sun = environment.sunDirectionProjectInertial
      const sunRightAscension = Math.atan2(sun.y, sun.x)
      const sunDeclination = Math.asin(sun.z)
      for (const inclinationDeg of [0, 51.5, 90, 98.6, 180]) {
        for (const raanDeg of [0, 155, 300]) {
          const geometry = elements(inclinationDeg, degToRad(raanDeg))
          const closedForm = Math.asin(Math.max(-1, Math.min(1,
            Math.cos(sunDeclination) * Math.sin(geometry.inclinationRad) * Math.sin(geometry.raanRad - sunRightAscension)
            + Math.sin(sunDeclination) * Math.cos(geometry.inclinationRad))))
          expect(Math.abs(betaAngleRad(geometry, environment) - closedForm)).toBeLessThan(1e-12)
        }
      }
    }
  })

  it('uses the orbit normal, so it is defined where the node is not', () => {
    const equatorial = elements(0, 0)
    expect(orbitNormalProjectInertial(equatorial).z).toBe(1)
    const result = sample(equatorial)
    expect(result.node.kind).toBe('singular')
    expect(Number.isFinite(result.betaAngleRad)).toBe(true)
  })
})

describe('the Sun-synchronous preset', () => {
  const sso = createObjectFromPreset(presetById('sso'), { id: 's', name: 'S', colorHex: 1 }, SIMULATION_START_INSTANT)

  it('resolves the expected inclination and RAAN at the default start instant', () => {
    expect(radToDeg(sso.source.geometry.inclinationRad)).toBeCloseTo(98.60311, 4)
    expect(radToDeg(sso.source.geometry.raanRad)).toBeCloseTo(155.21657, 4)
    expect(radToDeg(environmentAt(SIMULATION_START_INSTANT).meanSunRightAscensionOfDateRad)).toBeCloseTo(358.03247, 4)
    expect(radToDeg(definedNode(sso.source.geometry).rightAscensionOfDateRad)).toBeCloseTo(155.53247, 4)
  })

  it('reads 10:30 at the descending node and 22:30 at the ascending node', () => {
    const node = definedNode(sso.source.geometry)
    expect(node.meanLocalTimeDescendingNodeHours).toBeCloseTo(10.5, 4)
    expect(node.meanLocalTimeAscendingNodeHours).toBeCloseTo(22.5, 4)
  })

  it('is created against the instant it is added, not against a stored RAAN', () => {
    const later = createObjectFromPreset(presetById('sso'), { id: 'l', name: 'L', colorHex: 2 }, MAX_SIMULATION_INSTANT)
    expect(later.source.geometry.raanRad).not.toBeCloseTo(sso.source.geometry.raanRad, 3)
    // ...but it still reads 10:30 there, which is the point.
    expect(definedNode(later.source.geometry, MAX_SIMULATION_INSTANT).meanLocalTimeDescendingNodeHours).toBeCloseTo(10.5, 4)
  })

  // The bound is not zero: the node's right ascension in
  // mean-of-date advances at the propagated J2000 rate plus general precession,
  // about 0.05 deg per year for this geometry, which is about 12 seconds of
  // local time per year. That residual is intended and is a
  // named line in the accuracy budget.
  it('holds its MLTAN to within 30 seconds over a simulated year', () => {
    const initial = definedNode(sso.source.geometry).meanLocalTimeAscendingNodeHours
    let peakSeconds = 0
    for (let day = 0; day <= 365; day += 1) {
      const instant = { unixSeconds: SIMULATION_START_INSTANT.unixSeconds + day * SECONDS_PER_DAY }
      const drifted = j2SecularElementsAt(sso.source.geometry, sso.source.phase, instant)
      const hours = definedNode(drifted.geometry, instant).meanLocalTimeAscendingNodeHours
      peakSeconds = Math.max(peakSeconds, Math.abs(hoursApart(hours, initial)) * 3600)
    }
    expect(peakSeconds).toBeLessThan(30)
  })

  // This is the test that justifies defining MLTAN against
  // the mean Sun rather than leaving it as an assertion.
  it('would move by more than 25 minutes if computed against the apparent Sun', () => {
    let minimum = Infinity
    let maximum = -Infinity
    for (let day = 0; day <= 365; day += 1) {
      const instant = { unixSeconds: SIMULATION_START_INSTANT.unixSeconds + day * SECONDS_PER_DAY }
      const environment = environmentAt(instant)
      const drifted = j2SecularElementsAt(sso.source.geometry, sso.source.phase, instant)
      const node = nodeOfDate(drifted.geometry, environment.orientation.precessionToMeanOfDate)
      if (node.kind !== 'defined') throw new Error('expected a defined node')
      const hours = meanLocalSolarTimeHours(node.rightAscensionRad, environment.sunEquatorialOfDate.rightAscensionRad)
      minimum = Math.min(minimum, hours)
      maximum = Math.max(maximum, hours)
    }
    expect((maximum - minimum) * 60).toBeGreaterThan(25)
  })

  // A Sun-synchronous orbit holds its local crossing time; its
  // lighting is not stable, because Earth's axial tilt moves the Sun in
  // declination underneath a plane whose local-time orientation is fixed.
  it('varies its beta angle by more than 8 deg over a simulated year', () => {
    let minimum = Infinity
    let maximum = -Infinity
    for (let day = 0; day <= 365; day += 1) {
      const instant = { unixSeconds: SIMULATION_START_INSTANT.unixSeconds + day * SECONDS_PER_DAY }
      const drifted = j2SecularElementsAt(sso.source.geometry, sso.source.phase, instant)
      const beta = radToDeg(betaAngleRad(drifted.geometry, environmentAt(instant)))
      minimum = Math.min(minimum, beta)
      maximum = Math.max(maximum, beta)
    }
    expect(maximum - minimum).toBeGreaterThan(8)
  })
})

// This is the test that proves the lesson, not just the
// arithmetic: a polar orbit's nodal rate is zero, so its local crossing time
// sweeps backwards at exactly the mean Sun's own rate.
describe('the polar contrast', () => {
  const polar = createObjectFromPreset(presetById('polar'), { id: 'p', name: 'P', colorHex: 1 }, SIMULATION_START_INSTANT)

  it('sweeps more than 10 hours of MLTAN over half a simulated year', () => {
    const hoursAt = (day: number) => {
      const instant = { unixSeconds: SIMULATION_START_INSTANT.unixSeconds + day * SECONDS_PER_DAY }
      const drifted = j2SecularElementsAt(polar.source.geometry, polar.source.phase, instant)
      return definedNode(drifted.geometry, instant).meanLocalTimeAscendingNodeHours
    }
    const start = hoursAt(0)
    let travel = 0
    let previous = start
    for (let day = 1; day <= 183; day += 1) {
      const hours = hoursAt(day)
      travel += hoursApart(hours, previous)
      previous = hours
    }
    expect(Math.abs(travel)).toBeGreaterThan(10)
    // The drift rate is the mean Sun's own rate with the opposite sign, because
    // the plane stands still while the Sun moves. The residual is the same node
    // precession as the stability test above.
    const driftDegPerDay = (travel / 183) * 15
    expect(Math.abs(driftDegPerDay + MEAN_SUN_RATE_DEG_PER_DAY)).toBeLessThan(1e-3)
    expect(Math.abs(radToDeg(j2SecularRates(polar.source.geometry).raanRadPerSecond) * SECONDS_PER_DAY)).toBeLessThan(1e-12)
  })
})

describe('mean-of-date node geometry matters', () => {
  it('differs from the J2000 shortcut by more than a minute at 30 deg inclination in 2050', () => {
    const environment = environmentAt(MAX_SIMULATION_INSTANT)
    const geometry = elements(30, degToRad(175))
    const correct = definedNode(geometry, MAX_SIMULATION_INSTANT).meanLocalTimeAscendingNodeHours
    const naive = meanLocalSolarTimeHours(geometry.raanRad, environment.meanSunRightAscensionOfDateRad)
    expect(Math.abs(correct - naive) * 60).toBeGreaterThan(1)
  })
})

// The conditioning-aware readout layer over real
// preset elements.
describe('conditioning of the presets', () => {
  it('gives the GEO preset a mean longitude only, with a singular node', () => {
    const geo = presetById('geo').geometry
    const readouts = angleReadoutsFor(geo, 1.2, j2SecularRates(geo))
    expect(readouts.map((readout) => readout.kind)).toEqual(['meanLongitude'])
    expect(sample(geo).node).toEqual({ kind: 'singular' })
  })

  // The two independent sources of a singular node. An orbit that is exactly
  // the J2000 equator is *not* the mean-of-date equator - precession tilts it
  // about 0.34 deg - so nodeOfDate does find a line of nodes. Its right
  // ascension is nevertheless produced entirely by the precession matrix and is
  // the same for every stored RAAN, so it carries no information about the
  // orbit and must not be reported. That is why the readout layer checks the
  // element singularity before asking nodeOfDate.
  it('reports the equatorial preset singular even though its transformed plane has a node', () => {
    const geo = presetById('geo').geometry
    const environment = environmentAt(SIMULATION_START_INSTANT)
    const transformed = nodeOfDate(geo, environment.orientation.precessionToMeanOfDate)
    expect(transformed.kind).toBe('defined')
    // The same node right ascension for two completely different stored RAANs:
    // the value is precession, not orbit geometry.
    const rotated = nodeOfDate({ ...geo, raanRad: 2.5 }, environment.orientation.precessionToMeanOfDate)
    expect(rotated).toEqual(transformed)
    expect(orbitSunGeometry(geo, environment).node).toEqual({ kind: 'singular' })
  })

  it('gives the SSO preset RAAN and argument of latitude, with a singular periapsis', () => {
    const sso = createObjectFromPreset(presetById('sso'), { id: 's', name: 'S', colorHex: 1 }, SIMULATION_START_INSTANT).source.geometry
    expect(angleReadoutsFor(sso, 1.2, j2SecularRates(sso)).map((readout) => readout.kind)).toEqual(['raan', 'argOfLatitude'])
    expect(classifyElements(sso).periapsis).toEqual({ kind: 'singular' })
    const result = sample(sso)
    expect(result.node.kind).toBe('defined')
    expect(Number.isFinite(result.betaAngleRad)).toBe(true)
  })

  it('restores the node readouts as GEO inclination is nudged past the threshold', () => {
    const geo = presetById('geo').geometry
    const at = (inclinationDeg: number) => ({ ...geo, inclinationRad: degToRad(inclinationDeg), raanRad: wrapRadians(0.5) })
    expect(sample(at(0.2)).node).toMatchObject({ kind: 'suppressed', thresholdRad: degToRad(0.5) })
    expect(angleReadoutsFor(at(0.2), 1.2, j2SecularRates(at(0.2))).map((readout) => readout.kind)).toEqual(['meanLongitude'])
    const restored = sample(at(1))
    expect(restored.node.kind).toBe('defined')
    expect(angleReadoutsFor(at(1), 1.2, j2SecularRates(at(1))).map((readout) => readout.kind)).toEqual(['raan', 'argOfLatitude'])
    expect(j2SecularRates(at(1)).raanRadPerSecond).toBeLessThan(0)
    expect(TAU).toBeGreaterThan(0)
  })
})
