import { describe, expect, it, vi } from 'vitest'
import { lengthVec3, subtractVec3 } from '../../core/vec3.ts'
import { fineTunedRoute } from './routeFineTune.ts'
import type { Route, RouteFront } from './routeModel.ts'
import { solveRoutes } from './routeSearch.ts'
import { exampleSatellites, plannedRequest, routeExample, type RouteExampleId } from './routeSetup.ts'
import { stateOnRoute, targetStateOnRoute } from './routeState.ts'

vi.setConfig({ testTimeout: 30_000 })

const START = { unixSeconds: 1_800_000_000 }
const DAY = 86_400

/** The routes arriving within a time, searched only that far ahead to keep the test quick. */
function frontOf(exampleId: RouteExampleId, limitSeconds: number): RouteFront {
  const { own, target } = exampleSatellites(routeExample(exampleId), START)
  return solveRoutes({ ...plannedRequest(own, target, START).request, horizonSeconds: limitSeconds })
}

/** Every burn starts where the route was just before it, and it ends on the target. */
function expectFlown(route: Route): void {
  for (const burn of route.burns.slice(1)) {
    const before = stateOnRoute(route, burn.atSeconds - 1e-6)
    expect(lengthVec3(subtractVec3(before.positionProjectInertialKm, burn.before.positionProjectInertialKm))).toBeLessThan(1)
  }
  const there = targetStateOnRoute(route, route.arrivalSeconds)
  expect(lengthVec3(subtractVec3(stateOnRoute(route, route.arrivalSeconds - 1e-6).positionProjectInertialKm, there.positionProjectInertialKm))).toBeLessThan(1)
  expect(route.totalDeltaVKmPerSecond).toBeCloseTo(route.burns.reduce((sum, burn) => sum + burn.sizeKmPerSecond, 0), 12)
}

describe('fineTunedRoute', () => {
  it('saves a little on some routes of a front, never costing more nor arriving later', () => {
    const front = frontOf('altitude', DAY)
    let saved = 0
    for (const route of front.routes) {
      const tuned = fineTunedRoute(route)
      if (tuned === null) continue
      saved += 1
      expect(tuned.totalDeltaVKmPerSecond).toBeLessThan(route.totalDeltaVKmPerSecond)
      expect(tuned.arrivalSeconds).toBeLessThanOrEqual(route.arrivalSeconds)
      expect(tuned.family).toBe(route.family)
      expectFlown(tuned)
    }
    expect(saved).toBeGreaterThan(0)
  })

  it('keeps every burn before the final arc of a staged route', () => {
    const route = frontOf('driftPlanes', 150 * DAY).routes.at(-1)!
    expect(route.family).toBe('drift')
    const tuned = fineTunedRoute(route)
    if (tuned === null) return
    expect(tuned.burns.slice(0, -2)).toEqual(route.burns.slice(0, -2))
    expect(tuned.burns.map((burn) => burn.purpose)).toEqual(route.burns.map((burn) => burn.purpose))
    expectFlown(tuned)
  })

  it('leaves a route with no final arc alone', () => {
    const route = frontOf('altitude', DAY).routes.at(-1)!
    expect(fineTunedRoute({ ...route, legs: route.legs.slice(0, -1) })).toBeNull()
  })
})
