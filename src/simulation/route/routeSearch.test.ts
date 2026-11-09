import { beforeAll, describe, expect, it, vi } from 'vitest'
import { degToRad, TAU } from '../../core/angles.ts'
import { EARTH_MU_KM3_S2, EARTH_RADIUS_KM } from '../../core/constants.ts'
import { addSeconds } from '../../core/time.ts'
import { addVec3, lengthVec3, subtractVec3, type Vec3 } from '../../core/vec3.ts'
import { j2SecularElementsAt, j2SecularRates } from '../../orbital/j2Secular.ts'
import { J2SecularPropagator } from '../../orbital/j2SecularPropagator.ts'
import { circularSpeed, hohmannTransfer, planeChangeDeltaV } from '../../orbital/maneuver.ts'
import { stateVectorEci } from '../../orbital/keplerian.ts'
import { propagateTwoBody } from '../../test-fixtures/exactTwoBody.ts'
import { directGrid, directGridPoints, nodeAlignmentSeconds, transferNodeRate, type RouteRequest } from './routeFamilies.ts'
import { shortlistRoutes } from './routeFront.ts'
import { conicWithinRouteLimits, ROUTE_MAX_APOGEE_RADIUS_KM, ROUTE_MIN_PERIGEE_RADIUS_KM, type Route, type RouteFront, type RouteSatellite } from './routeModel.ts'
import { searchRoutes, solveRoutes } from './routeSearch.ts'
import { goHighEstimate, stageKeys } from './routeStaged.ts'
import { stateOnRoute } from './routeState.ts'

// Whole searches, run many times over: in a full run they share the machine.
vi.setConfig({ testTimeout: 30_000 })

const START = { unixSeconds: 1_800_000_000 }
const HOUR = 3600
const DAY = 86_400
const YEAR = 365 * DAY
/** How closely a found route must meet its target. */
const ONE_KM = 1
const ONE_METRE_PER_SECOND_KM = 1e-3

interface Shape { readonly altitudeKm?: number; readonly inclinationDeg: number; readonly raanDeg: number; readonly anomalyDeg?: number; readonly eccentricity?: number; readonly argDeg?: number; readonly semiMajorAxisKm?: number }

function satellite(name: string, shape: Shape): RouteSatellite {
  return {
    name,
    geometry: {
      semiMajorAxisKm: shape.semiMajorAxisKm ?? EARTH_RADIUS_KM + (shape.altitudeKm ?? 0),
      eccentricity: shape.eccentricity ?? 0,
      inclinationRad: degToRad(shape.inclinationDeg),
      raanRad: degToRad(shape.raanDeg),
      argOfPeriapsisRad: degToRad(shape.argDeg ?? 0),
    },
    phase: { referenceInstant: START, meanAnomalyAtReferenceRad: degToRad(shape.anomalyDeg ?? 0) },
  }
}

function request(own: Shape, target: Shape, horizonSeconds: number): RouteRequest {
  return { own: satellite('own', own), target: satellite('target', target), startInstant: START, horizonSeconds }
}

/** A deliberately wide spread: low and high, polar and retrograde, eccentric. */
const SPREAD: readonly (readonly [string, RouteRequest])[] = [
  ['a small altitude change', request({ altitudeKm: 400, inclinationDeg: 51.6, raanDeg: 0 }, { altitudeKm: 600, inclinationDeg: 51.6, raanDeg: 0, anomalyDeg: 90 }, DAY)],
  ['two polar orbits', request({ altitudeKm: 400, inclinationDeg: 90, raanDeg: 30 }, { altitudeKm: 600, inclinationDeg: 90, raanDeg: 30, anomalyDeg: 200 }, DAY)],
  ['ISS-like to Tiangong-like', request({ altitudeKm: 415, inclinationDeg: 51.64, raanDeg: 0 }, { altitudeKm: 385, inclinationDeg: 41.47, raanDeg: 100, anomalyDeg: 40 }, DAY)],
  ['Hubble-like to ISS-like', request({ altitudeKm: 530, inclinationDeg: 28.47, raanDeg: 0 }, { altitudeKm: 415, inclinationDeg: 51.64, raanDeg: 60, anomalyDeg: 200 }, DAY)],
  ['one shell, 60° between nodes', request({ altitudeKm: 550, inclinationDeg: 53, raanDeg: 0 }, { altitudeKm: 550, inclinationDeg: 53, raanDeg: 60, anomalyDeg: 30 }, DAY)],
  ['low orbit to geostationary', request({ altitudeKm: 400, inclinationDeg: 51.6, raanDeg: 0 }, { altitudeKm: 35_786, inclinationDeg: 0.05, raanDeg: 40, anomalyDeg: 100 }, 3 * DAY)],
  ['a target going the other way', request({ altitudeKm: 500, inclinationDeg: 51.6, raanDeg: 0 }, { altitudeKm: 500, inclinationDeg: 128.4, raanDeg: 180, anomalyDeg: 40 }, DAY)],
  ['eccentric to geostationary', request({ semiMajorAxisKm: 26_560, eccentricity: 0.72, inclinationDeg: 63.4, raanDeg: 20, argDeg: 270, anomalyDeg: 10 }, { altitudeKm: 35_786, inclinationDeg: 0.05, raanDeg: 40, anomalyDeg: 100 }, 3 * DAY)],
  ['geostationary to low orbit', request({ altitudeKm: 35_786, inclinationDeg: 0.05, raanDeg: 40 }, { altitudeKm: 400, inclinationDeg: 28, raanDeg: 0, anomalyDeg: 100 }, 3 * DAY)],
  ['the same orbit, further along', request({ altitudeKm: 500, inclinationDeg: 45, raanDeg: 0 }, { altitudeKm: 500, inclinationDeg: 45, raanDeg: 0, anomalyDeg: 40 }, DAY)],
]

const cheapest = (front: RouteFront): Route => {
  const route = front.routes[front.routes.length - 1]
  if (route === undefined) throw new Error('Expected a route')
  return route
}
const metres = (kmPerSecond: number) => kmPerSecond * 1000
/** A vector turned about the Earth's axis, as a transfer's frame turns it. */
function turned(v: Vec3, angleRad: number): Vec3 {
  return { x: Math.cos(angleRad) * v.x - Math.sin(angleRad) * v.y, y: Math.sin(angleRad) * v.x + Math.cos(angleRad) * v.y, z: v.z }
}

/** Replays a route leg by leg with a propagator that shares nothing with the
 *  route's: it starts on your satellite's orbit, each burn starts where the leg
 *  before it ends, and the last one leaves it matched with the target. */
function expectReplayed(route: Route): void {
  const own = new J2SecularPropagator(route.own.geometry, route.own.phase)
  const target = new J2SecularPropagator(route.target.geometry, route.target.phase)
  const first = route.burns[0]!
  const start = own.stateAt(addSeconds(route.startInstant, first.atSeconds))
  expect(lengthVec3(subtractVec3(first.before.positionProjectInertialKm, start.positionProjectInertialKm))).toBeLessThan(ONE_KM)
  expect(lengthVec3(subtractVec3(first.before.velocityProjectInertialKmPerSecond, start.velocityProjectInertialKmPerSecond))).toBeLessThan(ONE_METRE_PER_SECOND_KM)
  route.burns.forEach((burn, index) => {
    expect(lengthVec3(subtractVec3(addVec3(burn.before.velocityProjectInertialKmPerSecond, burn.deltaVKmPerSecond), burn.after.velocityProjectInertialKmPerSecond))).toBeLessThan(1e-9)
    const next = route.burns[index + 1]
    if (next === undefined) return
    const leg = route.legs.find((candidate) => candidate.fromSeconds === burn.atSeconds)
    if (leg === undefined) throw new Error('A burn before another must start a leg')
    expect(leg.toSeconds).toBe(next.atSeconds)
    if (leg.kind !== 'transfer') {
      // Parked to drift: J2 moves the orbit from the state the burn left.
      const drifting = new J2SecularPropagator(leg.geometry, leg.phase)
      const start = drifting.stateAt(addSeconds(route.startInstant, burn.atSeconds))
      expect(lengthVec3(subtractVec3(start.positionProjectInertialKm, burn.after.positionProjectInertialKm))).toBeLessThan(ONE_KM)
      expect(lengthVec3(subtractVec3(start.velocityProjectInertialKmPerSecond, burn.after.velocityProjectInertialKmPerSecond))).toBeLessThan(ONE_METRE_PER_SECOND_KM)
      const end = drifting.stateAt(addSeconds(route.startInstant, next.atSeconds))
      expect(lengthVec3(subtractVec3(end.positionProjectInertialKm, next.before.positionProjectInertialKm))).toBeLessThan(ONE_KM)
      return
    }
    const flight = next.atSeconds - burn.atSeconds
    const flown = propagateTwoBody(burn.after.positionProjectInertialKm, burn.after.velocityProjectInertialKmPerSecond, flight)
    const turn = leg.nodeRateRadPerSecond * flight
    expect(lengthVec3(subtractVec3(turned(flown.position, turn), next.before.positionProjectInertialKm))).toBeLessThan(ONE_KM)
    expect(lengthVec3(subtractVec3(turned(flown.velocity, turn), next.before.velocityProjectInertialKmPerSecond))).toBeLessThan(ONE_METRE_PER_SECOND_KM)
  })
  const last = route.burns[route.burns.length - 1]!
  expect(last.atSeconds).toBe(route.arrivalSeconds)
  const goal = target.stateAt(addSeconds(route.startInstant, route.arrivalSeconds))
  expect(lengthVec3(subtractVec3(last.after.positionProjectInertialKm, goal.positionProjectInertialKm))).toBeLessThan(ONE_KM)
  expect(lengthVec3(subtractVec3(last.after.velocityProjectInertialKmPerSecond, goal.velocityProjectInertialKmPerSecond))).toBeLessThan(ONE_METRE_PER_SECOND_KM)
}

describe('routes across a wide spread of orbits', () => {
  const fronts = new Map<string, RouteFront>()
  beforeAll(() => { for (const [name, spread] of SPREAD) fronts.set(name, solveRoutes(spread)) }, 120_000)

  it.each(SPREAD)('%s: every route closes on the target, replayed independently', (name) => {
    const front = fronts.get(name)!
    expect(front.complete).toBe(true)
    expect(front.routes.length).toBeGreaterThan(0)
    for (const route of front.routes) expectReplayed(route)
  })

  it.each(SPREAD)('%s: stateOnRoute follows the same path', (name) => {
    const front = fronts.get(name)!
    for (const route of [front.routes[0]!, cheapest(front)]) {
      for (const leg of route.legs) {
        if (leg.kind !== 'transfer') continue
        const burn = route.burns.find((candidate) => candidate.atSeconds === leg.fromSeconds)!
        const flight = leg.toSeconds - leg.fromSeconds
        for (const share of [0.1, 0.5, 0.9]) {
          const flown = propagateTwoBody(burn.after.positionProjectInertialKm, burn.after.velocityProjectInertialKmPerSecond, share * flight)
          const state = stateOnRoute(route, leg.fromSeconds + share * flight)
          expect(lengthVec3(subtractVec3(state.positionProjectInertialKm, turned(flown.position, leg.nodeRateRadPerSecond * share * flight)))).toBeLessThan(ONE_KM)
        }
      }
    }
  })

  it.each(SPREAD)('%s: no transfer leaves the limits, and arrivals keep to the time limit', (name, spread) => {
    for (const route of fronts.get(name)!.routes) {
      expect(route.arrivalSeconds).toBeLessThanOrEqual(spread.horizonSeconds)
      for (const transfer of route.legs) {
        if (transfer.kind !== 'transfer') continue
        expect(transfer.geometry.semiMajorAxisKm * (1 - transfer.geometry.eccentricity)).toBeGreaterThanOrEqual(ROUTE_MIN_PERIGEE_RADIUS_KM - 1e-3)
        expect(transfer.geometry.semiMajorAxisKm * (1 + transfer.geometry.eccentricity)).toBeLessThanOrEqual(ROUTE_MAX_APOGEE_RADIUS_KM + 1e-3)
      }
    }
  })

  it.each(SPREAD)('%s: the front is soonest first, and each later route is cheaper', (name) => {
    const { routes } = fronts.get(name)!
    for (let index = 1; index < routes.length; index += 1) {
      expect(routes[index]!.arrivalSeconds).toBeGreaterThan(routes[index - 1]!.arrivalSeconds)
      expect(routes[index]!.totalDeltaVKmPerSecond).toBeLessThan(routes[index - 1]!.totalDeltaVKmPerSecond)
    }
  })
})

describe('known answers', () => {
  const hohmann400to600 = hohmannTransfer(EARTH_RADIUS_KM + 400, EARTH_RADIUS_KM + 600).totalKmPerSecond

  it('between coplanar circular orbits is within 2 % of Hohmann, at any phase', () => {
    // Polar planes do not drift apart under J2, so they stay coplanar for as long
    // as the phase takes to come round. Nothing can beat Hohmann either.
    for (const anomalyDeg of [0, 90, 200, 300]) {
      const { totalDeltaVKmPerSecond: found } = cheapest(solveRoutes(request({ altitudeKm: 400, inclinationDeg: 90, raanDeg: 30 }, { altitudeKm: 600, inclinationDeg: 90, raanDeg: 30, anomalyDeg }, 2 * DAY)))
      expect(found).toBeLessThan(hohmann400to600 * 1.02)
      expect(found).toBeGreaterThan(hohmann400to600 * 0.99)
    }
  })

  it('is within 2 % of Hohmann on an inclined plane when the phase is right at the start', () => {
    // Here the planes drift apart under J2. Departing from where they cross, a
    // quarter of an orbit from the node, leaves no tilt for the arc to make.
    const targetRadius = EARTH_RADIUS_KM + 600
    const transferSeconds = hohmannTransfer(EARTH_RADIUS_KM + 400, targetRadius).transferSeconds
    const ahead = Math.PI - Math.sqrt(EARTH_MU_KM3_S2 / targetRadius ** 3) * transferSeconds
    const found = cheapest(solveRoutes(request({ altitudeKm: 400, inclinationDeg: 51.6, raanDeg: 0, anomalyDeg: 90 }, { altitudeKm: 600, inclinationDeg: 51.6, raanDeg: 0, anomalyDeg: 90 + (ahead * 180) / Math.PI }, 2 * HOUR)))
    expect(found.totalDeltaVKmPerSecond).toBeLessThan(hohmann400to600 * 1.02)
    expect(found.totalDeltaVKmPerSecond).toBeGreaterThan(hohmann400to600 * 0.99)
    expect(found.arrivalSeconds).toBeCloseTo(transferSeconds, -2)
  })

  it('keeps the costs it found when it was tuned', () => {
    // Not a claim of optimality, only a guard against the search getting worse.
    const cases: readonly (readonly [string, RouteRequest, number])[] = [
      ['one day, altitude only', request({ altitudeKm: 400, inclinationDeg: 51.6, raanDeg: 0 }, { altitudeKm: 600, inclinationDeg: 51.6, raanDeg: 0, anomalyDeg: 90 }, DAY), 113],
      ['Hubble to ISS', request({ altitudeKm: 530, inclinationDeg: 28.47, raanDeg: 0 }, { altitudeKm: 415, inclinationDeg: 51.64, raanDeg: 60, anomalyDeg: 200 }, DAY), 5660],
      ['low orbit to geostationary', request({ altitudeKm: 400, inclinationDeg: 51.6, raanDeg: 0 }, { altitudeKm: 35_786, inclinationDeg: 0.05, raanDeg: 40, anomalyDeg: 100 }, 3 * DAY), 4860],
    ]
    for (const [name, spread, tunedMetresPerSecond] of cases) {
      expect(metres(cheapest(solveRoutes(spread)).totalDeltaVKmPerSecond), name).toBeLessThanOrEqual(tunedMetresPerSecond)
    }
  })

  it('turning low on one shell costs what the turn itself costs, and never less', () => {
    // 47.1° between the planes at 550 km. They keep that angle under J2, so a lower
    // cost would be a false gift, from a transfer not turning with them, or from the
    // singular point where an arc's plane is undefined. Going high may cost less.
    const speed = circularSpeed(EARTH_RADIUS_KM + 550)
    const planeAngle = 2 * Math.asin(Math.sin(degToRad(53)) * Math.sin(degToRad(30)))
    const turn = planeChangeDeltaV(speed, planeAngle)
    const found = cheapest(solveRoutes(request({ altitudeKm: 550, inclinationDeg: 53, raanDeg: 0 }, { altitudeKm: 550, inclinationDeg: 53, raanDeg: 60, anomalyDeg: 30 }, DAY), ['direct', 'turnAtNode']))
    expect(found.totalDeltaVKmPerSecond).toBeGreaterThan(turn * 0.999)
    expect(found.totalDeltaVKmPerSecond).toBeLessThan(turn * 1.02)
  })

  it('turning low, reaches a target going the other way at more than the orbital speed', () => {
    const found = cheapest(solveRoutes(request({ altitudeKm: 500, inclinationDeg: 51.6, raanDeg: 0 }, { altitudeKm: 500, inclinationDeg: 128.4, raanDeg: 180, anomalyDeg: 40 }, DAY), ['direct', 'turnAtNode']))
    expect(found.totalDeltaVKmPerSecond).toBeGreaterThan(circularSpeed(EARTH_RADIUS_KM + 500))
  })

  it('moves along one orbit for little, and less the longer it may take', () => {
    // Moving by an angle in N revolutions needs a period different by angle / N, so
    // 2 v (angle / 2π) / (3 N) in total. 40° in one day, about 15 orbits, is 40 m/s.
    const along = (horizonSeconds: number) => metres(cheapest(solveRoutes(request({ altitudeKm: 500, inclinationDeg: 45, raanDeg: 0 }, { altitudeKm: 500, inclinationDeg: 45, raanDeg: 0, anomalyDeg: 40 }, horizonSeconds))).totalDeltaVKmPerSecond)
    expect(along(DAY)).toBeLessThan(50)
    expect(along(7 * DAY)).toBeLessThan(along(DAY) / 3)
  })

  it('needs almost nothing when already on the target', () => {
    const shape = { altitudeKm: 500, inclinationDeg: 45, raanDeg: 0, anomalyDeg: 40 }
    expect(metres(cheapest(solveRoutes(request(shape, shape, 2 * HOUR))).totalDeltaVKmPerSecond)).toBeLessThan(15)
  })
})

describe('time buys fuel', () => {
  const pair = (horizonSeconds: number) => request({ altitudeKm: 400, inclinationDeg: 51.6, raanDeg: 0 }, { altitudeKm: 600, inclinationDeg: 51.6, raanDeg: 0, anomalyDeg: 90 }, horizonSeconds)

  it('a day costs a small part of what six hours cost', () => {
    const sixHours = cheapest(solveRoutes(pair(6 * HOUR))).totalDeltaVKmPerSecond
    const oneDay = cheapest(solveRoutes(pair(DAY))).totalDeltaVKmPerSecond
    expect(oneDay).toBeLessThan(sixHours / 10)
  })

  it('finds the planes lining up by themselves months from now', () => {
    // The lower orbit's node runs faster, so this gap closes in about two months.
    const closing = (horizonSeconds: number) => request({ altitudeKm: 400, inclinationDeg: 51.6, raanDeg: 30 }, { altitudeKm: 600, inclinationDeg: 51.6, raanDeg: 0, anomalyDeg: 90 }, horizonSeconds)
    const oneDay = cheapest(solveRoutes(closing(DAY)))
    const fourMonths = cheapest(solveRoutes(closing(120 * DAY)))
    expect(metres(oneDay.totalDeltaVKmPerSecond)).toBeGreaterThan(3000)
    expect(metres(fourMonths.totalDeltaVKmPerSecond)).toBeLessThan(120)
    expect(fourMonths.arrivalSeconds).toBeGreaterThan(30 * DAY)
  })

  it('puts the phase right when the planes of two orbits of one period line up', () => {
    // A target going the other way on one plane: the nodes run in opposite directions,
    // and after about 19 days the planes are as close as they get, 76.8° apart. Their
    // phase has not changed, so only a long flight can make use of that.
    const opposite = (horizonSeconds: number) => request({ altitudeKm: 500, inclinationDeg: 51.6, raanDeg: 0 }, { altitudeKm: 500, inclinationDeg: 128.4, raanDeg: 180, anomalyDeg: 40 }, horizonSeconds)
    const turn = metres(planeChangeDeltaV(circularSpeed(EARTH_RADIUS_KM + 500), degToRad(76.8)))
    const found = cheapest(solveRoutes(opposite(30 * DAY), ['direct']))
    expect(metres(found.totalDeltaVKmPerSecond)).toBeGreaterThan(turn * 0.99)
    expect(metres(found.totalDeltaVKmPerSecond)).toBeLessThan(turn * 1.02)
    expect(found.arrivalSeconds).toBeGreaterThan(15 * DAY)
    expect(found.arrivalSeconds).toBeLessThan(25 * DAY)
  })

  it('tries long flights only where the periods are alike, also where the planes line up', () => {
    const alike = request({ altitudeKm: 500, inclinationDeg: 51.6, raanDeg: 0 }, { altitudeKm: 500, inclinationDeg: 128.4, raanDeg: 180 }, 30 * DAY)
    const [alignment] = nodeAlignmentSeconds(alike)
    expect(directGrid(alike).phasingDepartures.some((departure) => Math.abs(departure - alignment!) < HOUR)).toBe(true)
    const unlike = request({ altitudeKm: 400, inclinationDeg: 51.6, raanDeg: 0 }, { altitudeKm: 35_786, inclinationDeg: 0.05, raanDeg: 40 }, 30 * DAY)
    expect(directGrid(unlike).phasingDepartures).toEqual([])
  })

  it('offers the fastest within a fuel limit and the cheapest within a time limit from one front', () => {
    const { routes } = solveRoutes(pair(DAY))
    const withinFuel = shortlistRoutes(routes, { timeSeconds: null, deltaVKmPerSecond: 1 })
    expect(withinFuel.withinLimits).toBe(true)
    const fastest = withinFuel.points[0]!
    expect(fastest.totalDeltaVKmPerSecond).toBeLessThanOrEqual(1)
    const previous = routes[routes.indexOf(fastest) - 1]
    expect(previous === undefined || previous.totalDeltaVKmPerSecond > 1).toBe(true)
    expect(shortlistRoutes(routes, { timeSeconds: DAY, deltaVKmPerSecond: null }).points.at(-1)).toBe(routes[routes.length - 1])
  })
})

describe('turning at the node and going high', () => {
  it('turns at the node for within 2 % of what turning the velocity costs', () => {
    // Both reach the node together, so the turn is all there is to do.
    const found = cheapest(solveRoutes(request({ altitudeKm: 500, inclinationDeg: 51.6, raanDeg: 0, anomalyDeg: -10 }, { altitudeKm: 500, inclinationDeg: 56.6, raanDeg: 0, anomalyDeg: -10 }, 2 * HOUR), ['turnAtNode']))
    const turn = planeChangeDeltaV(circularSpeed(EARTH_RADIUS_KM + 500), degToRad(5))
    expect(found.family).toBe('turnAtNode')
    expect(found.burns.map((burn) => burn.purpose)).toEqual(['turn', 'approach', 'arrive'])
    expect(found.totalDeltaVKmPerSecond).toBeGreaterThan(turn * 0.999)
    expect(found.totalDeltaVKmPerSecond).toBeLessThan(turn * 1.02)
    expect(found.burns[0]!.sizeKmPerSecond).toBeCloseTo(turn, 3)
    expectReplayed(found)
  })

  it('splits a turn between the two ends of a climb, for less than two burns can', () => {
    const pair = request({ altitudeKm: 400, inclinationDeg: 51.6, raanDeg: 0 }, { altitudeKm: 600, inclinationDeg: 52.6, raanDeg: 0, anomalyDeg: 90 }, DAY)
    const found = cheapest(solveRoutes(pair))
    expect(found.family).toBe('turnAtNode')
    expect(found.totalDeltaVKmPerSecond).toBeLessThan(cheapest(solveRoutes(pair, ['direct'])).totalDeltaVKmPerSecond * 0.97)
    const [climb] = found.burns
    expect(climb!.components.progradeKmPerSecond).toBeGreaterThan(0.04)
    expect(Math.abs(climb!.components.normalKmPerSecond)).toBeGreaterThan(0.005)
    expectReplayed(found)
  })

  const planes = (lowDeg: number, highDeg: number) => request({ altitudeKm: 550, inclinationDeg: lowDeg, raanDeg: 0 }, { altitudeKm: 550, inclinationDeg: highDeg, raanDeg: 0, anomalyDeg: 100 }, 3 * DAY)

  it('goes high to turn 60° for less than turning the velocity low', () => {
    const found = cheapest(solveRoutes(planes(20, 80)))
    expect(found.family).toBe('goHigh')
    expect(found.burns.map((burn) => burn.purpose)).toEqual(['climb', 'turnHigh', 'approach', 'arrive'])
    expect(found.totalDeltaVKmPerSecond).toBeLessThan(0.9 * planeChangeDeltaV(circularSpeed(EARTH_RADIUS_KM + 550), degToRad(60)))
    // The turn far out is small beside the climb and the way back.
    expect(found.burns[1]!.sizeKmPerSecond).toBeLessThan(found.burns[0]!.sizeKmPerSecond / 2)
    expectReplayed(found)
  })

  it('does not go high to turn 10°, where turning low is far cheaper', () => {
    const spread = planes(45, 55)
    const found = cheapest(solveRoutes(spread))
    expect(found.family).not.toBe('goHigh')
    expect(stageKeys(spread).some((key) => key.family === 'goHigh')).toBe(false)
    const radius = EARTH_RADIUS_KM + 550
    expect(goHighEstimate(radius, radius, ROUTE_MAX_APOGEE_RADIUS_KM, degToRad(10))).toBeGreaterThan(2 * found.totalDeltaVKmPerSecond)
  })

  it('goes far out to turn round for a target going the other way, for less than the orbital speed', () => {
    const found = cheapest(solveRoutes(request({ altitudeKm: 500, inclinationDeg: 51.6, raanDeg: 0 }, { altitudeKm: 500, inclinationDeg: 128.4, raanDeg: 180, anomalyDeg: 40 }, DAY)))
    expect(found.family).toBe('goHigh')
    expect(found.totalDeltaVKmPerSecond).toBeLessThan(circularSpeed(EARTH_RADIUS_KM + 500))
    expectReplayed(found)
  })

  it('drifts between two planes of one shell in about 124 days for about 224 m/s', () => {
    // 60° between the nodes at 550 km, the target's behind.
    // Parking 200 km lower turns your plane faster, until the gap is gone.
    const found = cheapest(solveRoutes(request({ altitudeKm: 550, inclinationDeg: 53, raanDeg: 60 }, { altitudeKm: 550, inclinationDeg: 53, raanDeg: 0, anomalyDeg: 30 }, 150 * DAY)))
    expect(found.family).toBe('drift')
    expect(found.burns.map((burn) => burn.purpose)).toEqual(['toDrift', 'drift', 'approach', 'arrive'])
    expect(metres(found.totalDeltaVKmPerSecond)).toBeGreaterThan(215)
    expect(metres(found.totalDeltaVKmPerSecond)).toBeLessThan(240)
    expect(found.arrivalSeconds / DAY).toBeGreaterThan(115)
    expect(found.arrivalSeconds / DAY).toBeLessThan(135)
    const drift = found.legs.find((leg) => leg.kind === 'drift')!
    expect(drift.geometry.semiMajorAxisKm - EARTH_RADIUS_KM).toBeGreaterThan(300)
    expect(drift.geometry.semiMajorAxisKm - EARTH_RADIUS_KM).toBeLessThan(400)
    expect((drift.toSeconds - drift.fromSeconds) / DAY).toBeGreaterThan(100)
    expectReplayed(found)
  })

  it('drifts the other way round by climbing, when the target’s node is ahead', () => {
    const found = cheapest(solveRoutes(request({ altitudeKm: 550, inclinationDeg: 53, raanDeg: 0 }, { altitudeKm: 550, inclinationDeg: 53, raanDeg: 60, anomalyDeg: 30 }, 150 * DAY), ['drift']))
    expect(found.legs.find((leg) => leg.kind === 'drift')!.geometry.semiMajorAxisKm - EARTH_RADIUS_KM).toBeGreaterThan(550)
    expect(metres(found.totalDeltaVKmPerSecond)).toBeLessThan(300)
    expectReplayed(found)
  })

  it('has no drift to offer where J2 cannot turn the planes, or no time for it', () => {
    const drifts = (spread: RouteRequest) => stageKeys(spread).filter((key) => key.family === 'drift')
    // A polar plane does not turn at any height, and an equatorial one has no node.
    expect(drifts(request({ altitudeKm: 550, inclinationDeg: 90, raanDeg: 60 }, { altitudeKm: 550, inclinationDeg: 90, raanDeg: 0 }, 150 * DAY))).toEqual([])
    expect(drifts(request({ altitudeKm: 550, inclinationDeg: 0, raanDeg: 0 }, { altitudeKm: 550, inclinationDeg: 53, raanDeg: 0 }, 150 * DAY))).toEqual([])
    expect(drifts(request({ altitudeKm: 550, inclinationDeg: 53, raanDeg: 60 }, { altitudeKm: 550, inclinationDeg: 53, raanDeg: 0 }, 4 * DAY))).toEqual([])
  })

  it('has no node to turn at between planes that are one', () => {
    expect(stageKeys(request({ altitudeKm: 400, inclinationDeg: 90, raanDeg: 30 }, { altitudeKm: 600, inclinationDeg: 90, raanDeg: 30, anomalyDeg: 90 }, DAY))).toEqual([])
  })
})

describe('the frame a transfer flies in', () => {
  const rate = (shape: Shape) => j2SecularRates(satellite('', shape).geometry).raanRadPerSecond

  it('turns as an orbit does when joining that orbit to itself', () => {
    const shape = { altitudeKm: 500, inclinationDeg: 45, raanDeg: 0 }
    expect(transferNodeRate(request(shape, shape, DAY))).toBeCloseTo(rate(shape), 15)
    const eccentric = { semiMajorAxisKm: 26_560, eccentricity: 0.72, inclinationDeg: 63.4, raanDeg: 20, argDeg: 270 }
    expect(transferNodeRate(request(eccentric, eccentric, DAY))).toBeCloseTo(rate(eccentric), 15)
  })

  it('turns between the rates of two similar orbits', () => {
    const low = { altitudeKm: 400, inclinationDeg: 51.6, raanDeg: 0 }
    const high = { altitudeKm: 600, inclinationDeg: 51.6, raanDeg: 0 }
    const found = transferNodeRate(request(low, high, DAY))
    expect(found).toBeLessThan(rate(high))
    expect(found).toBeGreaterThan(rate(low))
  })

  it('turns far slower than a low orbit on the way to a far one', () => {
    const found = transferNodeRate(request({ altitudeKm: 400, inclinationDeg: 28, raanDeg: 0 }, { altitudeKm: 35_786, inclinationDeg: 28, raanDeg: 0 }, DAY))
    expect(Math.abs(found)).toBeLessThan(Math.abs(rate({ altitudeKm: 400, inclinationDeg: 28, raanDeg: 0 })) / 10)
  })

  it('does not turn for a pair of opposite inclinations', () => {
    expect(Math.abs(transferNodeRate(request({ altitudeKm: 500, inclinationDeg: 51.6, raanDeg: 0 }, { altitudeKm: 500, inclinationDeg: 128.4, raanDeg: 180 }, DAY)))).toBeLessThan(1e-20)
  })
})

describe('where Direct looks', () => {
  const closing = (horizonSeconds: number) => request({ altitudeKm: 400, inclinationDeg: 51.6, raanDeg: 30 }, { altitudeKm: 600, inclinationDeg: 51.6, raanDeg: 0, anomalyDeg: 90 }, horizonSeconds)

  it('finds the instants the nodes line up', () => {
    const spread = closing(3 * YEAR)
    const instants = nodeAlignmentSeconds(spread)
    expect(instants.length).toBeGreaterThan(0)
    for (const seconds of instants) {
      const instant = addSeconds(START, seconds)
      const own = j2SecularElementsAt(spread.own.geometry, spread.own.phase, instant).geometry.raanRad
      const target = j2SecularElementsAt(spread.target.geometry, spread.target.phase, instant).geometry.raanRad
      const gap = Math.abs(own - target)
      expect(Math.min(gap, TAU - gap)).toBeLessThan(1e-6)
    }
  })

  it('has no such instants for an equatorial orbit or within too short a time', () => {
    expect(nodeAlignmentSeconds(request({ altitudeKm: 400, inclinationDeg: 0, raanDeg: 30 }, { altitudeKm: 600, inclinationDeg: 51.6, raanDeg: 0 }, YEAR))).toEqual([])
    expect(nodeAlignmentSeconds(closing(DAY))).toEqual([])
  })

  it('spends about the same effort on a year as on weeks, and keeps within the limit', () => {
    const points = (horizonSeconds: number) => directGridPoints(directGrid(closing(horizonSeconds)), horizonSeconds)
    expect(points(YEAR)).toBeLessThan(3 * points(14 * DAY))
    expect(2 * points(YEAR), 'two ways per point').toBeLessThan(1_000_000)
  })

  it('keeps its departure spans in order, apart, and within the time limit', () => {
    for (const horizonSeconds of [HOUR, DAY, 30 * DAY, YEAR]) {
      const { spans } = directGrid(closing(horizonSeconds))
      expect(spans.length).toBeGreaterThan(0)
      spans.forEach((span, index) => {
        expect(span.fromSeconds).toBeLessThan(span.toSeconds)
        expect(span.toSeconds).toBeLessThanOrEqual(horizonSeconds)
        if (index > 0) expect(span.fromSeconds).toBeGreaterThanOrEqual(spans[index - 1]!.toSeconds)
      })
    }
  })

  it('looks at the instant the planes line up', () => {
    const spread = closing(YEAR)
    const { spans } = directGrid(spread)
    for (const alignment of nodeAlignmentSeconds(spread)) {
      expect(spans.some((span) => span.fromSeconds <= alignment && alignment <= span.toSeconds)).toBe(true)
    }
  })
})

describe('the search as a process', () => {
  const spread = request({ altitudeKm: 415, inclinationDeg: 51.64, raanDeg: 0 }, { altitudeKm: 385, inclinationDeg: 41.47, raanDeg: 100, anomalyDeg: 40 }, 2 * DAY)

  it('gives the same routes for the same request', () => {
    expect(solveRoutes(spread)).toEqual(solveRoutes(spread))
  })

  it('reports rising progress in many small steps, and a first front before the end', () => {
    const search = searchRoutes(spread)
    let last = 0
    let steps = 0
    let firstFront: RouteFront | null = null
    for (let step = search.next(); step.done !== true; step = search.next()) {
      steps += 1
      expect(step.value.fraction).toBeGreaterThanOrEqual(last)
      expect(step.value.fraction).toBeLessThanOrEqual(1)
      last = step.value.fraction
      if (step.value.front !== null) firstFront ??= step.value.front
    }
    expect(steps).toBeGreaterThan(20)
    expect(last).toBeCloseTo(1, 9)
    expect(firstFront!.complete).toBe(false)
    expect(firstFront!.routes.length).toBeGreaterThan(0)
  })

  it('stops when no longer asked to continue', () => {
    const search = searchRoutes(spread)
    const first = search.next()
    expect(first.done).toBe(false)
    expect(search.return(undefined as never).done).toBe(true)
    expect(search.next().done).toBe(true)
  })

  it('finds nothing where nothing can arrive, and says so with an empty front', () => {
    const front = solveRoutes(request({ altitudeKm: 400, inclinationDeg: 51.6, raanDeg: 0 }, { altitudeKm: 35_786, inclinationDeg: 0.05, raanDeg: 40, anomalyDeg: 100 }, 10 * 60))
    expect(front).toEqual({ routes: [], complete: true })
    expect(shortlistRoutes(front.routes, { timeSeconds: 600, deltaVKmPerSecond: null }).points).toEqual([])
  })

  it('refuses a time limit that is not a positive, finite number', () => {
    for (const horizonSeconds of [0, -1, Infinity, Number.NaN]) {
      expect(() => solveRoutes({ ...spread, horizonSeconds })).toThrow('time limit')
    }
  })
})

describe('conicWithinRouteLimits', () => {
  const atAltitude = (altitudeKm: number) => stateVectorEci({ semiMajorAxisKm: EARTH_RADIUS_KM + altitudeKm, eccentricity: 0, inclinationRad: 0.5, raanRad: 0.1, argOfPeriapsisRad: 0 }, 1)
  const scaled = (altitudeKm: number, factor: number) => {
    const state = atAltitude(altitudeKm)
    const v = state.velocityProjectInertialKmPerSecond
    return { position: state.positionProjectInertialKm, velocity: { x: v.x * factor, y: v.y * factor, z: v.z * factor } }
  }
  const within = (altitudeKm: number, factor: number) => { const { position, velocity } = scaled(altitudeKm, factor); return conicWithinRouteLimits(position, velocity) }

  it('accepts ordinary orbits and those exactly at the floor', () => {
    expect(within(400, 1)).toBe(true)
    expect(within(200, 1)).toBe(true)
  })

  it('refuses an orbit dipping below the floor', () => {
    expect(within(199, 1)).toBe(false)
    expect(within(400, 0.98)).toBe(false)
  })

  it('refuses going further out than the limit, and leaving altogether', () => {
    expect(within(400, 1.37), 'apogee under 100 000 km').toBe(true)
    expect(within(400, 1.38), 'apogee over 100 000 km').toBe(false)
    expect(within(400, 1.5), 'beyond escape').toBe(false)
  })
})
