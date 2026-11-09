import { describe, expect, it } from 'vitest'
import { degToRad } from '../../core/angles.ts'
import { EARTH_RADIUS_KM } from '../../core/constants.ts'
import { addVec3, dotVec3, lengthVec3, subtractVec3, type Vec3 } from '../../core/vec3.ts'
import { buildDirectRoute, type RouteRequest } from './routeFamilies.ts'
import type { RouteSatellite } from './routeModel.ts'
import { burnStage, burnVectors, burnViewDirection, cameraDirection, currentOrbit, driftViewShown, followTooFast, legAt, lineOfNodes, normalOf, orbitNormal, orbitRing, recentPath, ringOf, routeInstant, routeProfile, routeViewDirection, satelliteTrail, triangleIsThin } from './routeDrawing.ts'
import { buildAutomaticTimeline } from './routeTimeline.ts'
import { satelliteState } from './routeState.ts'
import { INITIAL_PLAYBACK, shownRate } from './routePlayback.ts'
import { deriveOrbitValues } from '../../orbital/geometry.ts'
import { stateOnRoute, targetStateOnRoute } from './routeState.ts'

const START = { unixSeconds: 1_800_000_000 }
const satellite = (altitudeKm: number, inclinationDeg: number, raanDeg: number, anomalyDeg: number): RouteSatellite => ({
  name: 'test',
  geometry: { semiMajorAxisKm: EARTH_RADIUS_KM + altitudeKm, eccentricity: 0, inclinationRad: degToRad(inclinationDeg), raanRad: degToRad(raanDeg), argOfPeriapsisRad: 0 },
  phase: { referenceInstant: START, meanAnomalyAtReferenceRad: degToRad(anomalyDeg) },
})
const REQUEST: RouteRequest = { own: satellite(400, 51.6, 10, 0), target: satellite(600, 53, 14, 100), startInstant: START, horizonSeconds: 86_400 }
const ROUTE = buildDirectRoute(REQUEST, { family: 'direct', departureSeconds: 1200, flightSeconds: 2400, arrivalSeconds: 3600, deltaVKmPerSecond: 0, way: 'short', revolutions: 0, branch: 'single' })
const close = (a: Vec3, b: Vec3, within: number) => expect(lengthVec3(subtractVec3(a, b))).toBeLessThan(within)

describe('route drawing', () => {
  it('draws a whole orbit as a closed ring through the satellite’s path', () => {
    const ring = orbitRing(ROUTE.target, START)
    close(ring[0]!, ring.at(-1)!, 1e-6)
    for (const point of ring) expect(lengthVec3(point)).toBeCloseTo(EARTH_RADIUS_KM + 600, 6)
    const normal = orbitNormal(ROUTE.target, START)
    expect(Math.abs(dotVec3(normal, targetStateOnRoute(ROUTE, 0).positionProjectInertialKm))).toBeLessThan(1e-6)
  })

  it('ends a trail where the satellite is, and has none at the start', () => {
    expect(recentPath(ROUTE, 0, 'own')).toEqual([])
    close(recentPath(ROUTE, 3000, 'own').at(-1)!, stateOnRoute(ROUTE, 3000).positionProjectInertialKm, 1e-9)
    close(recentPath(ROUTE, 3000, 'target').at(-1)!, targetStateOnRoute(ROUTE, 3000).positionProjectInertialKm, 1e-9)
  })

  it('finds the line of nodes in both planes, and none for one plane', () => {
    const node = lineOfNodes(ROUTE, routeInstant(ROUTE, 0))!
    expect(Math.abs(dotVec3(node, orbitNormal(ROUTE.own, START)))).toBeLessThan(1e-9)
    expect(Math.abs(dotVec3(node, orbitNormal(ROUTE.target, START)))).toBeLessThan(1e-9)
    expect(lineOfNodes({ ...ROUTE, target: ROUTE.own }, START)).toBeNull()
  })

  it('looks from above both planes, tilted towards where they cross', () => {
    const direction = routeViewDirection(ROUTE, START)
    expect(lengthVec3(direction)).toBeCloseTo(1, 12)
    expect(dotVec3(direction, orbitNormal(ROUTE.own, START))).toBeGreaterThan(0.6)
    expect(dotVec3(direction, orbitNormal(ROUTE.target, START))).toBeGreaterThan(0.6)
    expect(routeViewDirection({ ...ROUTE, target: ROUTE.own }, START)).toEqual(orbitNormal(ROUTE.own, START))
  })

  it('grows the thrust arrow first, then turns the velocity, then holds both', () => {
    expect(burnStage(0)).toEqual({ grown: 0, turned: 0 })
    expect(burnStage(0.3)).toEqual({ grown: 1, turned: 0 })
    expect(burnStage(0.5).turned).toBeGreaterThan(0)
    expect(burnStage(0.8)).toEqual({ grown: 1, turned: 1 })
    expect(burnStage(1)).toEqual({ grown: 1, turned: 1 })
  })

  it('gives a burn’s parts that add up to it, and a velocity that turns from before to after', () => {
    for (const burn of ROUTE.burns) {
      const vectors = burnVectors(burn, burnStage(1))
      close(addVec3(addVec3(vectors.parts.prograde, vectors.parts.normal), vectors.parts.outward), burn.deltaVKmPerSecond, 1e-12)
      close(vectors.current, burn.after.velocityProjectInertialKmPerSecond, 1e-12)
      close(burnVectors(burn, burnStage(0)).current, burn.before.velocityProjectInertialKmPerSecond, 1e-12)
    }
  })

  it('lays the velocities side by side, away from Earth, when a burn hardly turns them', () => {
    const vectors = burnVectors(ROUTE.burns[0]!, burnStage(1))
    expect(lengthVec3(vectors.side)).toBeCloseTo(1, 12)
    expect(dotVec3(vectors.side, vectors.before)).toBeCloseTo(0, 9)
    expect(dotVec3(vectors.side, vectors.position)).toBeGreaterThan(0)
    // A 6° turn keeps its triangle; a speed-up straight along the velocity does not.
    expect(triangleIsThin({ before: { x: 7.6, y: 0, z: 0 }, after: { x: 7.6, y: 0.8, z: 0 } })).toBe(false)
    expect(triangleIsThin({ before: { x: 7.6, y: 0, z: 0 }, after: { x: 9.6, y: 0, z: 0 } })).toBe(true)
  })
})

describe('the drift view', () => {
  it('knows which leg and orbit the satellite is on, and the target’s from arrival', () => {
    expect(legAt(ROUTE, 600)!.kind).toBe('wait')
    expect(legAt(ROUTE, 2000)!.kind).toBe('transfer')
    expect(legAt(ROUTE, 3600)).toBeNull()
    const onTransfer = currentOrbit(ROUTE, 2000)
    expect(onTransfer.semiMajorAxisKm).toBeCloseTo(ROUTE.legs[1]!.geometry.semiMajorAxisKm, 9)
    // The orbit drawn passes through where the satellite is.
    const here = stateOnRoute(ROUTE, 2000).positionProjectInertialKm
    expect(Math.abs(dotVec3(normalOf(onTransfer), here))).toBeLessThan(1e-3)
    expect(Math.min(...ringOf(onTransfer).map((point) => lengthVec3(subtractVec3(point, here))))).toBeLessThan(250)
    expect(currentOrbit(ROUTE, 5000).semiMajorAxisKm).toBeCloseTo(EARTH_RADIUS_KM + 600, 9)
  })

  it('draws orbits instead of dots once an orbit passes in under a second, and keeps them a little below', () => {
    const period = deriveOrbitValues(ROUTE.own.geometry).periodSeconds
    expect(driftViewShown(ROUTE, 600, 0, true)).toBe(false)
    expect(driftViewShown(ROUTE, 600, 2 * period, false)).toBe(true)
    expect(driftViewShown(ROUTE, 600, 0.8 * period, false)).toBe(false)
    expect(driftViewShown(ROUTE, 600, 0.8 * period, true)).toBe(true)
    expect(driftViewShown(ROUTE, 600, 0.5 * period, true)).toBe(false)
  })

  it('gives up following your satellite once an orbit passes in under eight seconds, and keeps off a little below', () => {
    const period = deriveOrbitValues(ROUTE.own.geometry).periodSeconds
    expect(followTooFast(ROUTE, 600, 0, true)).toBe(false)
    expect(followTooFast(ROUTE, 600, period / 4, false)).toBe(true)
    expect(followTooFast(ROUTE, 600, period / 10, false)).toBe(false)
    expect(followTooFast(ROUTE, 600, period / 10, true)).toBe(true)
    expect(followTooFast(ROUTE, 600, period / 20, true)).toBe(false)
  })

  it('reads the rate on screen from the speed, and none while a burn holds', () => {
    const moving = { seconds: 10, burnIndex: null, burnProgress: 0, rate: 120 }
    expect(shownRate(INITIAL_PLAYBACK, moving)).toBe(120)
    expect(shownRate({ ...INITIAL_PLAYBACK, speed: { kind: 'timeline', factor: 4 } }, moving)).toBe(480)
    expect(shownRate({ ...INITIAL_PLAYBACK, speed: { kind: 'constant', rate: 1e5 } }, moving)).toBe(1e5)
    expect(shownRate(INITIAL_PLAYBACK, { ...moving, burnIndex: 0, rate: 0 })).toBe(0)
  })
})

describe('camera views', () => {
  const scene = (own: RouteSatellite, target: RouteSatellite) => ({ ownNormal: orbitNormal(own, START), targetNormal: orbitNormal(target, START), own: satelliteState(own, START) })
  const tilted = scene(REQUEST.own, satellite(600, 80, 70, 0))

  it('leaves the free view to the learner', () => {
    expect(cameraDirection('free', tilted)).toBeNull()
  })

  it('looks face-on down your orbit’s normal', () => {
    close(cameraDirection('faceOn', tilted)!, tilted.ownNormal, 1e-12)
  })

  it('looks along where the planes cross, a little above them', () => {
    const along = cameraDirection('edgeOn', tilted)!
    expect(lengthVec3(along)).toBeCloseTo(1, 12)
    const node = lineOfNodes({ own: REQUEST.own, target: satellite(600, 80, 70, 0) }, START)!
    expect(Math.abs(dotVec3(along, node))).toBeCloseTo(Math.cos(degToRad(8)), 9)
    // One plane: along its line through the equator instead.
    const flat = cameraDirection('edgeOn', scene(REQUEST.own, REQUEST.own))!
    expect(Math.abs(dotVec3(flat, orbitNormal(REQUEST.own, START)))).toBeCloseTo(Math.sin(degToRad(8)), 9)
  })

  it('follows your satellite from above and behind it', () => {
    const from = cameraDirection('follow', tilted)!
    const out = tilted.own.positionProjectInertialKm
    expect(dotVec3(from, out)).toBeGreaterThan(0)
    expect(dotVec3(from, tilted.ownNormal)).toBeGreaterThan(0)
    expect(dotVec3(from, tilted.own.velocityProjectInertialKmPerSecond)).toBeLessThan(0)
  })

  it('looks at a burn from well above its plane', () => {
    const burn = ROUTE.burns[0]!
    const from = burnViewDirection(burn)
    expect(lengthVec3(from)).toBeCloseTo(1, 12)
    expect(dotVec3(from, normalOf(currentOrbit(ROUTE, burn.atSeconds - 1)))).toBeGreaterThan(0.75)
  })
})

describe('the playback strip', () => {
  it('samples height and the angle between the planes along the route', () => {
    const timeline = buildAutomaticTimeline(ROUTE)
    const profile = routeProfile(ROUTE, timeline, 40)
    expect(profile.altitudeKm).toHaveLength(41)
    expect(profile.altitudeKm[0]).toBeCloseTo(400, 0)
    expect(profile.altitudeKm.at(-1)).toBeCloseTo(600, 0)
    expect(profile.lowestKm).toBeLessThanOrEqual(400.5)
    expect(profile.highestKm).toBeGreaterThanOrEqual(599.5)
    // Before the departure your plane is your own; after arrival it is the target's.
    expect(profile.planeAngleRad[0]).toBeCloseTo(Math.acos(dotVec3(orbitNormal(REQUEST.own, START), orbitNormal(REQUEST.target, START))), 6)
    expect(profile.planeAngleRad.at(-1)).toBeCloseTo(0, 6)
    expect(profile.widestRad).toBeGreaterThan(0)
  })
})

describe('the live scene', () => {
  it('trails a satellite along the path it has just flown, ending where it is', () => {
    const trail = satelliteTrail(REQUEST.own, START)
    close(trail.at(-1)!, satelliteState(REQUEST.own, START).positionProjectInertialKm, 1e-6)
    for (const point of trail) expect(lengthVec3(point)).toBeCloseTo(EARTH_RADIUS_KM + 400, 3)
  })
})
