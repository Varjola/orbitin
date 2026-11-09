import type { RouteRequest } from '../simulation/route/routeFamilies.ts'
import type { RouteFront } from '../simulation/route/routeModel.ts'
import type { RouteSearchProgress } from '../simulation/route/routeSearch.ts'

/** Messages to the route solver's Worker. Everything is plain data. */
export type RouteSolverCommand =
  | { readonly kind: 'plan'; readonly id: number; readonly request: RouteRequest }
  | { readonly kind: 'cancel'; readonly id: number }

export type RouteSolverReply =
  | { readonly kind: 'progress'; readonly id: number; readonly fraction: number; readonly front: RouteFront | null }
  | { readonly kind: 'done'; readonly id: number; readonly front: RouteFront }
  | { readonly kind: 'failed'; readonly id: number }

/** How the session reaches its surroundings, so tests can run it without a Worker. */
export interface RouteSolverSessionPorts {
  readonly search: (request: RouteRequest) => Generator<RouteSearchProgress, RouteFront, void>
  readonly post: (reply: RouteSolverReply) => void
  /** Runs work later, giving incoming messages their turn first. */
  readonly defer: (work: () => void) => void
  readonly nowMs: () => number
}

/** How long one piece of searching holds the Worker before reading its messages.
 *  Cancelling therefore takes about this long at worst, plus one piece of work. */
export const ROUTE_SOLVER_SLICE_MS = 30

/** What the Worker does, apart from being a Worker: one search at a time, in
 *  slices. A new plan replaces the search in progress, and a search that has been
 *  replaced or cancelled is simply never resumed. */
export class RouteSolverSession {
  private readonly ports: RouteSolverSessionPorts
  private current: { readonly id: number; readonly search: Generator<RouteSearchProgress, RouteFront, void> } | null = null
  /** A slice is waiting to run. There is never more than one. */
  private scheduled = false

  constructor(ports: RouteSolverSessionPorts) {
    this.ports = ports
  }

  handle(command: RouteSolverCommand): void {
    switch (command.kind) {
      case 'plan':
        this.begin(command.id, command.request)
        return
      case 'cancel':
        if (this.current?.id === command.id) this.current = null
        return
    }
  }

  private begin(id: number, request: RouteRequest): void {
    this.current = { id, search: this.ports.search(request) }
    this.schedule()
  }

  /** A slice already waiting, for a search running or one just cancelled, runs
   *  whatever search is current by then. */
  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    this.ports.defer(() => {
      this.scheduled = false
      this.slice()
    })
  }

  private slice(): void {
    const current = this.current
    if (current === null) return
    const until = this.ports.nowMs() + ROUTE_SOLVER_SLICE_MS
    let fraction = 0
    let front: RouteFront | null = null
    try {
      do {
        const step = current.search.next()
        if (step.done === true) {
          this.current = null
          this.ports.post({ kind: 'done', id: current.id, front: step.value })
          return
        }
        fraction = step.value.fraction
        front = step.value.front ?? front
      } while (this.ports.nowMs() < until)
    } catch {
      this.current = null
      this.ports.post({ kind: 'failed', id: current.id })
      return
    }
    this.ports.post({ kind: 'progress', id: current.id, fraction, front })
    this.schedule()
  }
}
