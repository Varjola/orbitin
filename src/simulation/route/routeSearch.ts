import { buildDirectRoute, searchDirect, type DirectCandidate, type RouteRequest } from './routeFamilies.ts'
import { FrontArchive, thinFront } from './routeFront.ts'
import type { Route, RouteFamily, RouteFront } from './routeModel.ts'
import { buildStagedRoute, searchStaged, type StagedCandidate, type StagedFamily } from './routeStaged.ts'

/** Moving along a shown front each route saves at least this much Δv. */
const FRONT_MINIMUM_SAVING = 0.01
/** The share of the reported progress Direct takes; the staged families the rest. */
const DIRECT_SHARE = 0.6

export const ROUTE_FAMILIES: readonly RouteFamily[] = ['direct', 'turnAtNode', 'goHigh', 'drift']

export type RouteCandidate = DirectCandidate | StagedCandidate

export interface RouteSearchProgress {
  /** From 0 to 1. */
  readonly fraction: number
  /** The front so far, whenever there is a new one worth showing. */
  readonly front: RouteFront | null
}

function buildRoute(request: RouteRequest, candidate: RouteCandidate): Route {
  switch (candidate.family) {
    case 'direct': return buildDirectRoute(request, candidate)
    case 'turnAtNode':
    case 'goHigh':
    case 'drift': return buildStagedRoute(request, candidate)
  }
}

function frontOf(request: RouteRequest, archive: FrontArchive<RouteCandidate>, complete: boolean): RouteFront {
  return { routes: thinFront(archive.points(), FRONT_MINIMUM_SAVING).map((candidate) => buildRoute(request, candidate)), complete }
}

/** Searches for routes, returning the front. Pure and deterministic: the same
 *  request always gives the same routes. It yields between short pieces of work,
 *  so a caller stops it by no longer asking for the next one. Tests may search
 *  fewer families. */
export function* searchRoutes(request: RouteRequest, families: readonly RouteFamily[] = ROUTE_FAMILIES): Generator<RouteSearchProgress, RouteFront, void> {
  const archive = new FrontArchive<RouteCandidate>()
  const staged = families.filter((family): family is StagedFamily => family !== 'direct')
  const directShare = !families.includes('direct') ? 0 : staged.length === 0 ? 1 : DIRECT_SHARE
  if (families.includes('direct')) {
    for (const progress of searchDirect(request, archive)) {
      yield { fraction: directShare * progress.fraction, front: progress.firstFrontReady ? frontOf(request, archive, false) : null }
    }
  }
  if (staged.length > 0) {
    let shown = archive.points().length > 0
    for (const progress of searchStaged(request, archive, staged)) {
      // Without Direct, the first front is the first stage's.
      const first = !shown && archive.points().length > 0
      shown ||= first
      yield { fraction: directShare + (1 - directShare) * progress.fraction, front: first ? frontOf(request, archive, false) : null }
    }
  }
  return frontOf(request, archive, true)
}

/** Runs a search to its end without giving way, for tests and small callers. */
export function solveRoutes(request: RouteRequest, families?: readonly RouteFamily[]): RouteFront {
  const search = searchRoutes(request, families)
  for (;;) {
    const step = search.next()
    if (step.done === true) return step.value
  }
}
