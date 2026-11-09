export interface FrontPoint {
  readonly deltaVKmPerSecond: number
  readonly arrivalSeconds: number
}

/** The points found so far of which none is both cheaper and sooner than another,
 *  soonest first, and therefore also dearest first. */
export class FrontArchive<Point extends FrontPoint> {
  private readonly kept: Point[] = []

  /** The lowest Δv of any point arriving by `arrivalSeconds`. */
  cheapestBy(arrivalSeconds: number): number {
    const index = this.lastArrivingBy(arrivalSeconds)
    return index < 0 ? Infinity : this.kept[index]!.deltaVKmPerSecond
  }

  /** Keeps a point unless another is at least as good on both counts, and drops
   *  those it beats. Says whether it was kept. */
  offer(point: Point): boolean {
    const before = this.lastArrivingBy(point.arrivalSeconds)
    if (before >= 0 && this.kept[before]!.deltaVKmPerSecond <= point.deltaVKmPerSecond) return false
    // A point arriving at the same instant for more is beaten too.
    const start = before >= 0 && this.kept[before]!.arrivalSeconds === point.arrivalSeconds ? before : before + 1
    let end = before + 1
    while (end < this.kept.length && this.kept[end]!.deltaVKmPerSecond >= point.deltaVKmPerSecond) end += 1
    this.kept.splice(start, end - start, point)
    return true
  }

  points(): readonly Point[] {
    return this.kept
  }

  private lastArrivingBy(arrivalSeconds: number): number {
    let low = 0
    let high = this.kept.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (this.kept[middle]!.arrivalSeconds <= arrivalSeconds) low = middle + 1
      else high = middle
    }
    return low - 1
  }
}

/** A front readable as a choice: moving along it each point saves at least
 *  `minimumSaving` of the previous one's Δv. Both ends are always kept. */
export function thinFront<Point extends FrontPoint>(points: readonly Point[], minimumSaving: number): Point[] {
  const thinned: Point[] = []
  points.forEach((point, index) => {
    const previous = thinned[thinned.length - 1]
    if (previous === undefined || index === points.length - 1 || point.deltaVKmPerSecond <= previous.deltaVKmPerSecond * (1 - minimumSaving)) thinned.push(point)
  })
  return thinned
}

/** The learner's limits on the routes shown, each off (null) or set. They only
 *  choose among the routes found: the search itself always looks as far ahead as
 *  it can. */
export interface RouteLimits {
  readonly timeSeconds: number | null
  readonly deltaVKmPerSecond: number | null
}

export const NO_LIMITS: RouteLimits = { timeSeconds: null, deltaVKmPerSecond: null }

/** What a route costs, as a shortlist weighs it. */
export interface RouteCost {
  readonly arrivalSeconds: number
  readonly totalDeltaVKmPerSecond: number
}

/** Whether a route arrives within the time limit and keeps within the fuel limit. */
export function routeWithinLimits(route: RouteCost, limits: RouteLimits): boolean {
  return (limits.timeSeconds === null || route.arrivalSeconds <= limits.timeSeconds)
    && (limits.deltaVKmPerSecond === null || route.totalDeltaVKmPerSecond <= limits.deltaVKmPerSecond)
}

/** How many routes a shortlist holds at most. */
export const ROUTE_SHORTLIST_SIZE = 9
/** Two routes are worth showing side by side only when one arrives this much later
 *  or costs this much less than the other. */
const CONSIDERABLE_TIME_RATIO = 1.25
const CONSIDERABLE_DELTA_V_RATIO = 1.08

export interface RouteShortlist<Point extends RouteCost> {
  /** Soonest first, and therefore dearest first. */
  readonly points: readonly Point[]
  /** False when no route found keeps within the limits: then the shortlist is
   *  drawn from all of them, and being out of reach is the lesson. */
  readonly withinLimits: boolean
}

/** A few routes to choose from: the fastest and the cheapest within the limits,
 *  and between them those where the time or the fuel changes considerably, spread
 *  as evenly as they go on logarithmic scales of both. */
export function shortlistRoutes<Point extends RouteCost>(points: readonly Point[], limits: RouteLimits, size = ROUTE_SHORTLIST_SIZE): RouteShortlist<Point> {
  const within = points.filter((point) => routeWithinLimits(point, limits))
  const pool = within.length > 0 ? within : points
  if (pool.length <= 2 || size <= 2) return { points: pool.length <= 2 ? pool : [pool[0]!, pool[pool.length - 1]!], withinLimits: within.length > 0 || points.length === 0 }
  const logTime = pool.map((point) => Math.log(Math.max(1, point.arrivalSeconds)))
  const logCost = pool.map((point) => Math.log(Math.max(1e-6, point.totalDeltaVKmPerSecond)))
  const timeSpan = Math.max(Math.log(CONSIDERABLE_TIME_RATIO), logTime[logTime.length - 1]! - logTime[0]!)
  const costSpan = Math.max(Math.log(CONSIDERABLE_DELTA_V_RATIO), logCost[0]! - logCost[logCost.length - 1]!)
  const considerable = (a: number, b: number) => Math.abs(logTime[a]! - logTime[b]!) >= Math.log(CONSIDERABLE_TIME_RATIO) || Math.abs(logCost[a]! - logCost[b]!) >= Math.log(CONSIDERABLE_DELTA_V_RATIO)
  const distance = (a: number, b: number) => Math.hypot((logTime[a]! - logTime[b]!) / timeSpan, (logCost[a]! - logCost[b]!) / costSpan)
  const chosen = [0, pool.length - 1]
  // Farthest first: each pick is the route most unlike every route picked so far.
  while (chosen.length < size) {
    let best = -1
    let bestDistance = 0
    for (let index = 1; index < pool.length - 1; index += 1) {
      if (chosen.includes(index) || !chosen.every((picked) => considerable(index, picked))) continue
      const nearest = Math.min(...chosen.map((picked) => distance(index, picked)))
      if (nearest > bestDistance) { best = index; bestDistance = nearest }
    }
    if (best < 0) break
    chosen.push(best)
  }
  return { points: chosen.sort((a, b) => a - b).map((index) => pool[index]!), withinLimits: within.length > 0 }
}
