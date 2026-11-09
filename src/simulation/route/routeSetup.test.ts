import { describe, expect, it, vi } from 'vitest'
import { lengthVec3, subtractVec3 } from '../../core/vec3.ts'
import { exampleSatellites, plannedRequest, ROUTE_EXAMPLES, ROUTE_MAX_HORIZON_SECONDS, routeExample } from './routeSetup.ts'
import { solveRoutes } from './routeSearch.ts'
import { stateOnRoute, targetStateOnRoute } from './routeState.ts'

// Whole searches, run many times over: in a full run they share the machine.
vi.setConfig({ testTimeout: 30_000 })

const START = { unixSeconds: 1_800_000_000 }
const DAY = 86_400

describe('the built-in examples', () => {
  /** What each one is there to show: the cheapest route arriving within a time,
   *  as a range around what it finds. */
  const LESSONS = {
    // A Hohmann transfer is 3351 m/s.
    lowAndMedium: { withinSeconds: 2 * DAY, metresPerSecond: [3300, 3700] },
    altitude: { withinSeconds: DAY, metresPerSecond: [100, 130] },
    oneShell: { withinSeconds: DAY, metresPerSecond: [5800, 6000] },
    driftPlanes: { withinSeconds: 150 * DAY, metresPerSecond: [215, 240] },
    waitForPlanes: { withinSeconds: 120 * DAY, metresPerSecond: [100, 130] },
    lowToGeo: { withinSeconds: 3 * DAY, metresPerSecond: [4500, 5000] },
    retrograde: { withinSeconds: DAY, metresPerSecond: [7000, 7600] },
  } as const

  for (const example of ROUTE_EXAMPLES) {
    it(`${example.id} finds a route that shows its lesson and reaches the target`, () => {
      const { own, target } = exampleSatellites(example, START)
      const { request, limitedToSeconds } = plannedRequest(own, target, START)
      expect(limitedToSeconds).toBeNull()
      const lesson = LESSONS[example.id]
      // Searched only as far as the lesson needs, to keep the test quick.
      const route = solveRoutes({ ...request, horizonSeconds: lesson.withinSeconds }).routes.at(-1)
      if (route === undefined) throw new Error('Expected a route')
      const [low, high] = lesson.metresPerSecond
      expect(route.totalDeltaVKmPerSecond * 1000).toBeGreaterThan(low)
      expect(route.totalDeltaVKmPerSecond * 1000).toBeLessThan(high)
      const justBefore = stateOnRoute(route, route.arrivalSeconds - 1e-6)
      const there = targetStateOnRoute(route, route.arrivalSeconds)
      expect(lengthVec3(subtractVec3(justBefore.positionProjectInertialKm, there.positionProjectInertialKm))).toBeLessThan(1)
    })
  }

  it('gives one example the same route whenever it is planned', () => {
    const example = routeExample('altitude')
    const at = (start: { readonly unixSeconds: number }) => {
      const { own, target } = exampleSatellites(example, start)
      const { routes } = solveRoutes({ ...plannedRequest(own, target, start).request, horizonSeconds: DAY })
      return routes.at(-1)!.totalDeltaVKmPerSecond
    }
    expect(at(START)).toBeCloseTo(at({ unixSeconds: START.unixSeconds + 12_345_678 }), 9)
  })

  it('refuses an unknown example', () => {
    expect(() => routeExample('nowhere' as never)).toThrow()
  })
})

describe('plannedRequest', () => {
  const { own, target } = exampleSatellites(routeExample('altitude'), START)

  it('searches a year ahead, whatever the limits', () => {
    const { request, limitedToSeconds } = plannedRequest(own, target, START)
    expect(request.horizonSeconds).toBe(ROUTE_MAX_HORIZON_SECONDS)
    expect(limitedToSeconds).toBeNull()
  })

  it('stops at the end of the clock’s range, and says so', () => {
    const late = { unixSeconds: Date.UTC(2050, 0, 1) / 1000 - 1000 }
    const { request, limitedToSeconds } = plannedRequest(own, target, late)
    expect(request.horizonSeconds).toBe(1000)
    expect(limitedToSeconds).toBe(1000)
  })
})
