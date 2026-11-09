import { describe, expect, it } from 'vitest'
import type { RouteRequest } from '../simulation/route/routeFamilies.ts'
import type { RouteFront } from '../simulation/route/routeModel.ts'
import type { RouteSearchProgress } from '../simulation/route/routeSearch.ts'
import { ROUTE_SOLVER_SLICE_MS, RouteSolverSession, type RouteSolverReply } from './routeSolverSession.ts'

const REQUEST = { horizonSeconds: 1 } as RouteRequest
const front = (label: number, complete = true): RouteFront => ({ routes: [{ arrivalSeconds: label } as never], complete })

/** A session whose clock moves `stepMs` each time it is read, with deferred work
 *  run by hand so that messages can arrive between slices. */
function harness(search: (request: RouteRequest) => Generator<RouteSearchProgress, RouteFront, void>, stepMs = ROUTE_SOLVER_SLICE_MS) {
  const replies: RouteSolverReply[] = []
  const waiting: (() => void)[] = []
  let now = 0
  const session = new RouteSolverSession({
    search,
    post: (reply) => replies.push(reply),
    defer: (work) => waiting.push(work),
    nowMs: () => (now += stepMs),
  })
  const runNext = () => waiting.shift()?.()
  const runAll = () => { while (waiting.length > 0) runNext() }
  return { session, replies, waiting, runNext, runAll }
}

function* steps(label: number, count: number): Generator<RouteSearchProgress, RouteFront, void> {
  for (let index = 1; index <= count; index += 1) yield { fraction: index / (count + 1), front: null }
  return front(label)
}

describe('RouteSolverSession', () => {
  it('reports progress and then the front', () => {
    const { session, replies, runAll } = harness(() => steps(7, 2))
    session.handle({ kind: 'plan', id: 1, request: REQUEST })
    expect(replies).toEqual([])
    runAll()
    expect(replies.map((reply) => reply.kind)).toEqual(['progress', 'progress', 'done'])
    expect(replies[2]).toEqual({ kind: 'done', id: 1, front: front(7) })
  })

  it('gives way between slices rather than running to the end at once', () => {
    const { session, replies, waiting, runNext } = harness(() => steps(7, 3))
    session.handle({ kind: 'plan', id: 1, request: REQUEST })
    runNext()
    expect(replies).toHaveLength(1)
    expect(waiting).toHaveLength(1)
  })

  it('works through many steps in one slice when they are quick', () => {
    const { session, replies, runAll } = harness(() => steps(7, 3), 0.001)
    session.handle({ kind: 'plan', id: 1, request: REQUEST })
    runAll()
    expect(replies.map((reply) => reply.kind)).toEqual(['done'])
  })

  it('passes on a front found within a slice even if later steps have none', () => {
    function* search(): Generator<RouteSearchProgress, RouteFront, void> {
      yield { fraction: 0.2, front: front(1, false) }
      yield { fraction: 0.4, front: null }
      yield { fraction: 0.6, front: null }
      return front(2)
    }
    let now = 0
    const replies: RouteSolverReply[] = []
    const waiting: (() => void)[] = []
    const session = new RouteSolverSession({ search, post: (reply) => replies.push(reply), defer: (work) => waiting.push(work), nowMs: () => (now += ROUTE_SOLVER_SLICE_MS / 2.5) })
    session.handle({ kind: 'plan', id: 1, request: REQUEST })
    waiting.shift()!()
    expect(replies[0]).toEqual({ kind: 'progress', id: 1, fraction: 0.6, front: front(1, false) })
  })

  it('stops when cancelled, and says nothing more about that search', () => {
    const { session, replies, runNext, runAll } = harness(() => steps(7, 5))
    session.handle({ kind: 'plan', id: 1, request: REQUEST })
    runNext()
    const said = replies.length
    session.handle({ kind: 'cancel', id: 1 })
    runAll()
    expect(replies).toHaveLength(said)
  })

  it('ignores cancelling a search that is no longer the current one', () => {
    const { session, replies, runAll } = harness(() => steps(7, 1))
    session.handle({ kind: 'plan', id: 2, request: REQUEST })
    session.handle({ kind: 'cancel', id: 1 })
    runAll()
    expect(replies.at(-1)).toEqual({ kind: 'done', id: 2, front: front(7) })
  })

  it('replaces the search in progress with a new plan', () => {
    let label = 0
    const { session, replies, runNext, runAll } = harness(() => steps(label += 1, 2))
    session.handle({ kind: 'plan', id: 1, request: REQUEST })
    runNext()
    session.handle({ kind: 'plan', id: 2, request: REQUEST })
    runAll()
    expect(replies.filter((reply) => reply.kind === 'done')).toEqual([{ kind: 'done', id: 2, front: front(2) }])
    expect(replies.at(-1)?.id).toBe(2)
    expect(replies.filter((reply) => reply.id === 1).map((reply) => reply.kind)).toEqual(['progress'])
  })

  it('starts only one line of slices however quickly plans arrive', () => {
    const { session, waiting } = harness(() => steps(1, 2))
    session.handle({ kind: 'plan', id: 1, request: REQUEST })
    session.handle({ kind: 'plan', id: 2, request: REQUEST })
    expect(waiting).toHaveLength(1)
  })

  it('keeps one line of slices when a plan follows a cancel before the waiting slice runs', () => {
    let label = 0
    const { session, replies, waiting, runNext, runAll } = harness(() => steps(label += 1, 3))
    session.handle({ kind: 'plan', id: 1, request: REQUEST })
    runNext()
    session.handle({ kind: 'cancel', id: 1 })
    session.handle({ kind: 'plan', id: 2, request: REQUEST })
    expect(waiting).toHaveLength(1)
    runAll()
    expect(replies.filter((reply) => reply.kind === 'done')).toEqual([{ kind: 'done', id: 2, front: front(2) }])
  })

  it('reports a search that fails, and can search again', () => {
    let attempts = 0
    function* search(): Generator<RouteSearchProgress, RouteFront, void> {
      attempts += 1
      if (attempts === 1) throw new Error('no')
      return front(3)
    }
    const { session, replies, runAll } = harness(search)
    session.handle({ kind: 'plan', id: 1, request: REQUEST })
    runAll()
    expect(replies).toEqual([{ kind: 'failed', id: 1 }])
    session.handle({ kind: 'plan', id: 2, request: REQUEST })
    runAll()
    expect(replies.at(-1)).toEqual({ kind: 'done', id: 2, front: front(3) })
  })
})
