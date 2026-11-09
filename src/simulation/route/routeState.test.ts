import { describe, expect, it } from 'vitest'
import { degToRad } from '../../core/angles.ts'
import { EARTH_RADIUS_KM } from '../../core/constants.ts'
import { addSeconds } from '../../core/time.ts'
import { lengthVec3, subtractVec3 } from '../../core/vec3.ts'
import { J2SecularPropagator } from '../../orbital/j2SecularPropagator.ts'
import type { OrbitalState } from '../../orbital/propagator.ts'
import { buildDirectRoute, transferNodeRate, type DirectCandidate, type RouteRequest } from './routeFamilies.ts'
import type { RouteSatellite } from './routeModel.ts'
import { stateOnRoute, targetStateOnRoute } from './routeState.ts'

const START = { unixSeconds: 1_800_000_000 }
const satellite = (altitudeKm: number, inclinationDeg: number, raanDeg: number, anomalyDeg: number): RouteSatellite => ({
  name: 'test',
  geometry: { semiMajorAxisKm: EARTH_RADIUS_KM + altitudeKm, eccentricity: 0, inclinationRad: degToRad(inclinationDeg), raanRad: degToRad(raanDeg), argOfPeriapsisRad: 0 },
  phase: { referenceInstant: START, meanAnomalyAtReferenceRad: degToRad(anomalyDeg) },
})
const REQUEST: RouteRequest = { own: satellite(400, 51.6, 10, 0), target: satellite(600, 51.6, 10, 100), startInstant: START, horizonSeconds: 86_400 }
const candidate = (departureSeconds: number, flightSeconds: number): DirectCandidate => ({
  family: 'direct', departureSeconds, flightSeconds, arrivalSeconds: departureSeconds + flightSeconds, deltaVKmPerSecond: 0, way: 'short', revolutions: 0, branch: 'single',
})
const distance = (a: OrbitalState, b: OrbitalState) => lengthVec3(subtractVec3(a.positionProjectInertialKm, b.positionProjectInertialKm))
const speedDifference = (a: OrbitalState, b: OrbitalState) => lengthVec3(subtractVec3(a.velocityProjectInertialKmPerSecond, b.velocityProjectInertialKmPerSecond))

function expectSameState(a: OrbitalState, b: OrbitalState): void {
  expect(distance(a, b)).toBeLessThan(1e-3)
  expect(speedDifference(a, b)).toBeLessThan(1e-6)
}

describe('stateOnRoute', () => {
  const route = buildDirectRoute(REQUEST, candidate(1200, 2400))
  const own = new J2SecularPropagator(REQUEST.own.geometry, REQUEST.own.phase)

  it('waits on the own orbit, secular J2 included, until the first burn', () => {
    expect(route.legs.map((leg) => leg.kind)).toEqual(['wait', 'transfer'])
    expectSameState(stateOnRoute(route, 0), own.stateAt(START))
    expectSameState(stateOnRoute(route, 600), own.stateAt(addSeconds(START, 600)))
  })

  it('is the state after a burn at the instant of the burn', () => {
    const [departure] = route.burns
    expectSameState(stateOnRoute(route, departure!.atSeconds), departure!.after)
    expect(speedDifference(stateOnRoute(route, departure!.atSeconds), departure!.before)).toBeCloseTo(departure!.sizeKmPerSecond, 9)
  })

  it('turns the transfer with the nodes of the orbits it joins', () => {
    const transfer = route.legs[1]!
    expect(transfer.kind === 'transfer' && transfer.nodeRateRadPerSecond).toBe(transferNodeRate(REQUEST))
  })

  it('reaches the state before the last burn on the transfer', () => {
    const arrival = route.burns[1]!
    const justBefore = stateOnRoute(route, arrival.atSeconds - 1e-6)
    expect(distance(justBefore, arrival.before)).toBeLessThan(1e-3)
    expect(speedDifference(justBefore, arrival.before)).toBeLessThan(1e-5)
  })

  it('from arrival on is the target, and stops there', () => {
    const atArrival = targetStateOnRoute(route, route.arrivalSeconds)
    expectSameState(stateOnRoute(route, route.arrivalSeconds), atArrival)
    expectSameState(stateOnRoute(route, route.arrivalSeconds + 5000), atArrival)
  })

  it('stays at the start before the route begins', () => {
    expectSameState(stateOnRoute(route, -5000), own.stateAt(START))
  })

  it('has no waiting leg for a route that departs at once', () => {
    const immediate = buildDirectRoute(REQUEST, candidate(0, 2400))
    expect(immediate.legs.map((leg) => leg.kind)).toEqual(['transfer'])
    expect(distance(stateOnRoute(immediate, 0), own.stateAt(START))).toBeLessThan(1e-3)
  })

  it('has every burn add up to the velocity it leaves', () => {
    for (const burn of route.burns) {
      expect(lengthVec3(subtractVec3(subtractVec3(burn.after.velocityProjectInertialKmPerSecond, burn.before.velocityProjectInertialKmPerSecond), burn.deltaVKmPerSecond))).toBeLessThan(1e-12)
      const { progradeKmPerSecond: p, normalKmPerSecond: n, outwardKmPerSecond: o } = burn.components
      expect(Math.hypot(p, n, o)).toBeCloseTo(burn.sizeKmPerSecond, 9)
    }
    expect(route.totalDeltaVKmPerSecond).toBeCloseTo(route.burns[0]!.sizeKmPerSecond + route.burns[1]!.sizeKmPerSecond, 12)
  })

  it('survives being sent to a Worker', () => {
    const copy = structuredClone(route)
    expectSameState(stateOnRoute(copy, 3000), stateOnRoute(route, 3000))
  })
})
