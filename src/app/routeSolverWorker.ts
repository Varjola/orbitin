import type { RouteSolverCommand, RouteSolverReply } from './routeSolverSession.ts'

export interface RouteSolverPort {
  post(command: RouteSolverCommand): void
  dispose(): void
}

export interface RouteSolverListener {
  reply(reply: RouteSolverReply): void
  /** The Worker could not start or stopped working. */
  failure(): void
}

export type RouteSolverFactory = (listener: RouteSolverListener) => RouteSolverPort

/** Starts the Worker. It throws where the browser has no Workers. */
export const createRouteSolverWorker: RouteSolverFactory = (listener) => {
  const worker = new Worker(new URL('./routeSolver.worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (event: MessageEvent<RouteSolverReply>) => listener.reply(event.data))
  worker.addEventListener('error', () => listener.failure())
  worker.addEventListener('messageerror', () => listener.failure())
  return { post: (command) => worker.postMessage(command), dispose: () => worker.terminate() }
}
