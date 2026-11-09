import { searchRoutes } from '../simulation/route/routeSearch.ts'
import { RouteSolverSession, type RouteSolverCommand } from './routeSolverSession.ts'

// Work waits behind the messages already here, as with setTimeout(0), without
// the browser's minimum delay for timeouts nested this deep.
const waiting: (() => void)[] = []
const channel = new MessageChannel()
channel.port1.onmessage = () => waiting.shift()?.()

// Runs in the learner's own browser, in the background: nothing is sent anywhere.
const session = new RouteSolverSession({
  search: searchRoutes,
  post: (reply) => postMessage(reply),
  defer: (work) => { waiting.push(work); channel.port2.postMessage(null) },
  nowMs: () => performance.now(),
})

addEventListener('message', (event: MessageEvent<RouteSolverCommand>) => session.handle(event.data))
