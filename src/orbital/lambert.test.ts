import { describe, expect, it } from 'vitest'
import { degToRad, TAU } from '../core/angles.ts'
import { EARTH_MU_KM3_S2, EARTH_RADIUS_KM } from '../core/constants.ts'
import type { ProjectInertialVec3 } from '../core/referenceFrames.ts'
import { crossVec3, dotVec3, lengthVec3, scaleVec3, subtractVec3 } from '../core/vec3.ts'
import { lambertArcDeltaV, lambertArcs, type LambertArc, type LambertWay } from './lambert.ts'
import { propagateTwoBody } from '../test-fixtures/exactTwoBody.ts'
import { hohmannTransfer } from './maneuver.ts'

const ONE_METRE_KM = 1e-3
const ONE_MM_PER_SECOND_KM = 1e-6
const LEO_RADIUS_KM = EARTH_RADIUS_KM + 400

function circularSpeed(radiusKm: number): number { return Math.sqrt(EARTH_MU_KM3_S2 / radiusKm) }
function circularPeriod(radiusKm: number): number { return TAU * Math.sqrt(radiusKm ** 3 / EARTH_MU_KM3_S2) }

/** A point `angle` round the orbit in the x-y plane tilted about x by `tilt`. */
function pointOn(radiusKm: number, angleRad: number, tiltRad = 0): ProjectInertialVec3 {
  return { x: radiusKm * Math.cos(angleRad), y: radiusKm * Math.sin(angleRad) * Math.cos(tiltRad), z: radiusKm * Math.sin(angleRad) * Math.sin(tiltRad) }
}

function expectArrives(from: ProjectInertialVec3, to: ProjectInertialVec3, seconds: number, arc: LambertArc): void {
  const flown = propagateTwoBody(from, arc.departureVelocityKmPerSecond, seconds)
  expect(lengthVec3(subtractVec3(flown.position, to)), `missed by, ${arc.revolutions} revolutions, ${arc.branch}`).toBeLessThan(ONE_METRE_KM)
  expect(lengthVec3(subtractVec3(flown.velocity, arc.arrivalVelocityKmPerSecond))).toBeLessThan(ONE_MM_PER_SECOND_KM)
}

/** The angle an arc turns through, added up along the way. */
function sweptAngle(from: ProjectInertialVec3, seconds: number, arc: LambertArc): number {
  const steps = 4000
  let previous = from
  let swept = 0
  for (let step = 1; step <= steps; step += 1) {
    const next = propagateTwoBody(from, arc.departureVelocityKmPerSecond, (seconds * step) / steps).position
    swept += Math.atan2(lengthVec3(crossVec3(previous, next)), dotVec3(previous, next))
    previous = next
  }
  return swept
}

function seeded(seed: number): () => number {
  let state = seed
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32 }
}

describe('lambertArcs', () => {
  it('recovers the circular orbit through two points on it', () => {
    const period = circularPeriod(LEO_RADIUS_KM)
    const speed = circularSpeed(LEO_RADIUS_KM)
    for (const [angleDeg, way] of [[60, 'short'], [150, 'short'], [240, 'long'], [330, 'long']] as const) {
      const to = pointOn(LEO_RADIUS_KM, degToRad(angleDeg), degToRad(51.6))
      const [arc] = lambertArcs(pointOn(LEO_RADIUS_KM, 0, degToRad(51.6)), to, (period * angleDeg) / 360, way, 0)
      const expected = scaleVec3({ x: 0, y: Math.cos(degToRad(51.6)), z: Math.sin(degToRad(51.6)) }, speed)
      expect(lengthVec3(subtractVec3(arc.departureVelocityKmPerSecond, expected))).toBeLessThan(1e-7)
    }
  })

  it('finds the same circle with whole revolutions, on one of the two branches', () => {
    const period = circularPeriod(LEO_RADIUS_KM)
    const speed = circularSpeed(LEO_RADIUS_KM)
    const from = pointOn(LEO_RADIUS_KM, 0)
    const to = pointOn(LEO_RADIUS_KM, degToRad(60))
    const arcs = lambertArcs(from, to, period * (2 + 60 / 360), 'short', 2)
    expect(arcs.map((arc) => [arc.revolutions, arc.branch])).toEqual([[0, 'single'], [1, 'left'], [1, 'right'], [2, 'left'], [2, 'right']])
    const twice = arcs.filter((arc) => arc.revolutions === 2)
    const closest = Math.min(...twice.map((arc) => lengthVec3(subtractVec3(arc.departureVelocityKmPerSecond, { x: 0, y: speed, z: 0 }))))
    expect(closest).toBeLessThan(1e-6)
  })

  it('arrives within 1 m on every arc, flying the revolutions it reports', () => {
    const from = pointOn(LEO_RADIUS_KM, 0)
    const to = pointOn(8000, degToRad(70), degToRad(30))
    const seconds = circularPeriod(8000) * 3.4
    for (const way of ['short', 'long'] as const) {
      const arcs = lambertArcs(from, to, seconds, way, 3)
      expect(arcs.length).toBeGreaterThanOrEqual(5)
      for (const arc of arcs) {
        expectArrives(from, to, seconds, arc)
        const swept = sweptAngle(from, seconds, arc)
        // The transfer angle itself is about 72° short, or the rest of a turn long.
        expect(Math.floor(swept / TAU)).toBe(arc.revolutions)
        expect((swept % TAU) < Math.PI).toBe(way === 'short')
      }
    }
  })

  it('runs short and long in opposite senses about the plane', () => {
    const from = pointOn(LEO_RADIUS_KM, 0)
    const to = pointOn(LEO_RADIUS_KM, degToRad(60), degToRad(40))
    const seconds = circularPeriod(LEO_RADIUS_KM) * 0.7
    const momentum = (way: LambertWay) => crossVec3(from, lambertArcs(from, to, seconds, way, 0)[0].departureVelocityKmPerSecond)
    expect(dotVec3(momentum('short'), crossVec3(from, to))).toBeGreaterThan(0)
    expect(dotVec3(momentum('long'), crossVec3(from, to))).toBeLessThan(0)
  })

  it('reaches a polar and a retrograde plane either way, needing no reference direction', () => {
    for (const tiltDeg of [90, 98, 150, 180]) {
      const from = pointOn(LEO_RADIUS_KM, degToRad(20), degToRad(tiltDeg))
      const to = pointOn(9000, degToRad(130), degToRad(tiltDeg))
      for (const way of ['short', 'long'] as const) {
        const [arc] = lambertArcs(from, to, 3000, way, 0)
        expectArrives(from, to, 3000, arc)
      }
    }
  })

  it('stays accurate through the parabolic region, on both sides of x = 1', () => {
    const from = pointOn(LEO_RADIUS_KM, 0, degToRad(20))
    const to = pointOn(12_000, degToRad(100), degToRad(20))
    const chord = lengthVec3(subtractVec3(to, from))
    const s = (LEO_RADIUS_KM + 12_000 + chord) / 2
    const parabolic = (Math.sqrt(2) / 3) * (s ** 1.5 - (s - chord) ** 1.5) / Math.sqrt(EARTH_MU_KM3_S2)
    // Ratios chosen to land in each of the three time forms.
    for (const ratio of [0.5, 0.8, 0.92, 0.985, 0.999, 1, 1.001, 1.015, 1.1, 1.3, 3]) {
      const seconds = parabolic * ratio
      const [arc] = lambertArcs(from, to, seconds, 'short', 0)
      expectArrives(from, to, seconds, arc)
    }
  })

  it('flies a hyperbola when the time is short', () => {
    const from = pointOn(LEO_RADIUS_KM, 0)
    const to = pointOn(LEO_RADIUS_KM, degToRad(60))
    const [arc] = lambertArcs(from, to, 200, 'short', 0)
    expectArrives(from, to, 200, arc)
    const speed = lengthVec3(arc.departureVelocityKmPerSecond)
    expect(speed * speed / 2 - EARTH_MU_KM3_S2 / LEO_RADIUS_KM).toBeGreaterThan(0)
  })

  it('stays accurate for points almost together and almost opposite', () => {
    const from = pointOn(LEO_RADIUS_KM, 0, degToRad(51.6))
    for (const angleDeg of [1e-3, 0.1, 179.9, 179.999]) {
      const to = pointOn(LEO_RADIUS_KM + 50, degToRad(angleDeg), degToRad(51.6))
      const seconds = (circularPeriod(LEO_RADIUS_KM) * angleDeg) / 360 + 30
      const [arc] = lambertArcs(from, to, seconds, 'short', 0)
      expectArrives(from, to, seconds, arc)
    }
  })

  it('has no arc for points in a line with the Earth', () => {
    const from = pointOn(LEO_RADIUS_KM, 0)
    expect(lambertArcs(from, scaleVec3(from, 1.2), 3000, 'short', 2)).toEqual([])
    expect(lambertArcs(from, scaleVec3(from, -1), 3000, 'long', 2)).toEqual([])
  })

  it('offers only the revolutions the time allows', () => {
    const from = pointOn(LEO_RADIUS_KM, 0)
    const to = pointOn(LEO_RADIUS_KM, degToRad(90))
    const arcs = (periods: number) => lambertArcs(from, to, circularPeriod(LEO_RADIUS_KM) * periods, 'short', 5)
    expect(arcs(0.5).map((arc) => arc.revolutions)).toEqual([0])
    expect(Math.max(...arcs(1.5).map((arc) => arc.revolutions))).toBe(1)
    expect(Math.max(...arcs(3.5).map((arc) => arc.revolutions))).toBe(3)
    expect(lambertArcs(from, to, circularPeriod(LEO_RADIUS_KM) * 3.5, 'short', 1).every((arc) => arc.revolutions <= 1)).toBe(true)
  })

  it('can skip the arcs with few revolutions, and still arrives after hundreds', () => {
    const from = pointOn(LEO_RADIUS_KM, 0)
    const to = pointOn(LEO_RADIUS_KM + 30, degToRad(40), degToRad(1))
    for (const periods of [15.2, 60.7, 240.4]) {
      const seconds = circularPeriod(LEO_RADIUS_KM) * periods
      const near = Math.floor(periods)
      for (const way of ['short', 'long'] as const) {
        const arcs = lambertArcs(from, to, seconds, way, near + 1, near - 1)
        expect(arcs.length).toBeGreaterThan(0)
        for (const arc of arcs) {
          expect(arc.revolutions).toBeGreaterThanOrEqual(near - 1)
          expectArrives(from, to, seconds, arc)
        }
      }
    }
  })

  it('refuses a revolution count that is not a whole number', () => {
    const from = pointOn(LEO_RADIUS_KM, 0)
    const to = pointOn(LEO_RADIUS_KM, 1)
    expect(() => lambertArcs(from, to, 3000, 'short', 2, -1)).toThrow('Revolutions')
    expect(() => lambertArcs(from, to, 3000, 'short', 2, 0.5)).toThrow('Revolutions')
  })

  it('reproduces the Hohmann transfer between coplanar circles', () => {
    const toRadius = EARTH_RADIUS_KM + 600
    const hohmann = hohmannTransfer(LEO_RADIUS_KM, toRadius)
    const from = pointOn(LEO_RADIUS_KM, 0)
    const to = pointOn(toRadius, degToRad(179.99))
    const [arc] = lambertArcs(from, to, hohmann.transferSeconds, 'short', 0)
    const costs = lambertArcDeltaV(arc, { x: 0, y: circularSpeed(LEO_RADIUS_KM), z: 0 }, scaleVec3(pointOn(1, degToRad(269.99)), circularSpeed(toRadius)))
    expect(costs.departureKmPerSecond + costs.arrivalKmPerSecond).toBeCloseTo(hohmann.totalKmPerSecond, 3)
  })

  it('arrives within 1 m across a seeded spread of geometry', () => {
    const random = seeded(32)
    let flown = 0
    for (let index = 0; index < 150; index += 1) {
      const from = pointOn(EARTH_RADIUS_KM + 200 + random() * 40_000, random() * TAU, random() * Math.PI)
      const to = pointOn(EARTH_RADIUS_KM + 200 + random() * 40_000, random() * TAU, random() * Math.PI)
      const seconds = 300 + random() * 60_000
      for (const way of ['short', 'long'] as const) {
        for (const arc of lambertArcs(from, to, seconds, way, 2)) {
          expectArrives(from, to, seconds, arc)
          flown += 1
        }
      }
    }
    expect(flown).toBeGreaterThan(150)
  })

  it('refuses inputs that are programming errors', () => {
    const from = pointOn(LEO_RADIUS_KM, 0)
    const to = pointOn(LEO_RADIUS_KM, 1)
    expect(() => lambertArcs(from, to, 0, 'short', 0)).toThrow('flight time')
    expect(() => lambertArcs(from, to, Number.NaN, 'short', 0)).toThrow('flight time')
    expect(() => lambertArcs(from, to, 100, 'short', -1)).toThrow('Revolutions')
    expect(() => lambertArcs({ x: 0, y: 0, z: 0 }, to, 100, 'short', 0)).toThrow('centre')
  })
})
