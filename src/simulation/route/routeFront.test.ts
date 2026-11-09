import { describe, expect, it } from 'vitest'
import { FrontArchive, NO_LIMITS, routeWithinLimits, shortlistRoutes, thinFront, type FrontPoint } from './routeFront.ts'
import type { Route } from './routeModel.ts'

const point = (arrivalSeconds: number, deltaVKmPerSecond: number): FrontPoint => ({ arrivalSeconds, deltaVKmPerSecond })
const route = (arrivalSeconds: number, totalDeltaVKmPerSecond: number) => ({ arrivalSeconds, totalDeltaVKmPerSecond }) as Route

describe('FrontArchive', () => {
  it('keeps a point only if nothing is at least as good on both counts', () => {
    const archive = new FrontArchive<FrontPoint>()
    expect(archive.offer(point(100, 5))).toBe(true)
    expect(archive.offer(point(200, 5)), 'later and no cheaper').toBe(false)
    expect(archive.offer(point(100, 5)), 'the same point').toBe(false)
    expect(archive.offer(point(200, 4))).toBe(true)
    expect(archive.offer(point(50, 9))).toBe(true)
    expect(archive.points()).toEqual([point(50, 9), point(100, 5), point(200, 4)])
  })

  it('drops the points a new one beats, and no others', () => {
    const archive = new FrontArchive<FrontPoint>()
    for (const kept of [point(50, 9), point(100, 5), point(200, 4), point(300, 3), point(400, 1)]) archive.offer(kept)
    expect(archive.offer(point(90, 3.5))).toBe(true)
    expect(archive.points()).toEqual([point(50, 9), point(90, 3.5), point(300, 3), point(400, 1)])
  })

  it('replaces a dearer point arriving at the same instant', () => {
    const archive = new FrontArchive<FrontPoint>()
    archive.offer(point(50, 9))
    archive.offer(point(100, 5))
    archive.offer(point(200, 2))
    expect(archive.offer(point(100, 4))).toBe(true)
    expect(archive.points()).toEqual([point(50, 9), point(100, 4), point(200, 2)])
  })

  it('reports the lowest cost arriving by an instant', () => {
    const archive = new FrontArchive<FrontPoint>()
    archive.offer(point(100, 5))
    archive.offer(point(200, 4))
    expect(archive.cheapestBy(99)).toBe(Infinity)
    expect(archive.cheapestBy(100)).toBe(5)
    expect(archive.cheapestBy(199)).toBe(5)
    expect(archive.cheapestBy(1000)).toBe(4)
  })

  it('agrees with checking every pair', () => {
    let seed = 20261107
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const points = Array.from({ length: 2000 }, () => point(random() * 1000, random() * 1000))
    const archive = new FrontArchive<FrontPoint>()
    for (const candidate of points) archive.offer(candidate)
    const expected = points
      .filter((a) => !points.some((b) => b !== a && b.arrivalSeconds <= a.arrivalSeconds && b.deltaVKmPerSecond <= a.deltaVKmPerSecond))
      .sort((a, b) => a.arrivalSeconds - b.arrivalSeconds)
    expect(archive.points()).toEqual(expected)
  })
})

describe('thinFront', () => {
  it('keeps both ends, and each step saves at least the minimum', () => {
    const points = Array.from({ length: 500 }, (_, index) => point(index, 10 * 0.999 ** index))
    const thinned = thinFront(points, 0.05)
    expect(thinned[0]).toBe(points[0])
    expect(thinned[thinned.length - 1]).toBe(points[points.length - 1])
    expect(thinned.length).toBeLessThan(15)
    for (let index = 1; index < thinned.length - 1; index += 1) {
      expect(thinned[index]!.deltaVKmPerSecond).toBeLessThanOrEqual(thinned[index - 1]!.deltaVKmPerSecond * 0.95)
    }
  })

  it('leaves an empty or a single-point front as it is', () => {
    expect(thinFront([], 0.05)).toEqual([])
    expect(thinFront([point(1, 1)], 0.05)).toEqual([point(1, 1)])
  })
})

describe('routeWithinLimits', () => {
  it('keeps to each limit that is set, and to none that is off', () => {
    expect(routeWithinLimits(route(400, 2), NO_LIMITS)).toBe(true)
    expect(routeWithinLimits(route(400, 2), { timeSeconds: 400, deltaVKmPerSecond: null })).toBe(true)
    expect(routeWithinLimits(route(400, 2), { timeSeconds: 399, deltaVKmPerSecond: null })).toBe(false)
    expect(routeWithinLimits(route(400, 2), { timeSeconds: null, deltaVKmPerSecond: 2 })).toBe(true)
    expect(routeWithinLimits(route(400, 2), { timeSeconds: null, deltaVKmPerSecond: 1.9 })).toBe(false)
    expect(routeWithinLimits(route(400, 2), { timeSeconds: 500, deltaVKmPerSecond: 1.9 })).toBe(false)
  })
})

describe('shortlistRoutes', () => {
  /** A front from a minute to a year, from 30 km/s down to 100 m/s, densest in the middle. */
  const front = Array.from({ length: 120 }, (_, index) => {
    const share = index / 119
    const bunched = share < 0.5 ? 0.5 * (2 * share) ** 2 : 1 - 0.5 * (2 - 2 * share) ** 2
    return route(60 * (365 * 1440) ** bunched, 30 * (0.1 / 30) ** share)
  })

  it('offers the fastest and the cheapest, and at most nine, soonest first', () => {
    const { points, withinLimits } = shortlistRoutes(front, NO_LIMITS)
    expect(withinLimits).toBe(true)
    expect(points[0]).toBe(front[0])
    expect(points.at(-1)).toBe(front.at(-1))
    expect(points.length).toBe(9)
    for (let index = 1; index < points.length; index += 1) expect(points[index]!.arrivalSeconds).toBeGreaterThan(points[index - 1]!.arrivalSeconds)
  })

  it('only offers routes that differ considerably in time or in fuel', () => {
    const { points } = shortlistRoutes(front, NO_LIMITS)
    for (let a = 0; a < points.length; a += 1) {
      for (let b = a + 1; b < points.length; b += 1) {
        const later = points[b]!.arrivalSeconds / points[a]!.arrivalSeconds
        const cheaper = points[a]!.totalDeltaVKmPerSecond / points[b]!.totalDeltaVKmPerSecond
        expect(later >= 1.25 || cheaper >= 1.08).toBe(true)
      }
    }
  })

  it('offers fewer when the front has few considerably different routes', () => {
    const near = [route(1000, 2), route(1010, 1.99), route(1020, 1.98), route(1030, 1.97), route(4000, 1)]
    expect(shortlistRoutes(near, NO_LIMITS).points).toEqual([near[0], near[4]])
  })

  it('keeps to the limits, and says when no route does', () => {
    const limited = shortlistRoutes(front, { timeSeconds: 86_400, deltaVKmPerSecond: 5 })
    expect(limited.withinLimits).toBe(true)
    for (const point of limited.points) expect(routeWithinLimits(point, { timeSeconds: 86_400, deltaVKmPerSecond: 5 })).toBe(true)
    const impossible = shortlistRoutes(front, { timeSeconds: 120, deltaVKmPerSecond: 0.2 })
    expect(impossible.withinLimits).toBe(false)
    expect(impossible.points[0]).toBe(front[0])
    expect(impossible.points.at(-1)).toBe(front.at(-1))
  })

  it('has nothing to offer from an empty front, and offers one or two routes as they are', () => {
    expect(shortlistRoutes([], NO_LIMITS)).toEqual({ points: [], withinLimits: true })
    expect(shortlistRoutes([route(100, 1)], NO_LIMITS).points).toEqual([route(100, 1)])
  })
})
