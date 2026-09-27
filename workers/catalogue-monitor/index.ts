import { checkProducerSilence, recordProducerEvents, type MonitorWorkerEnv, type ProducerTraceItem } from './monitor.ts'
import type { WorkerExecutionContext } from '../shared/types.ts'

/** orbitin-catalogue-monitor entry point. It exports
 *  only the handlers: the Workers runtime refuses any other named export of an
 *  entry module, so everything else lives in `monitor.ts`. */
export default {
  async fetch(): Promise<Response> {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  },
  async tail(events: readonly ProducerTraceItem[], env: MonitorWorkerEnv, context: WorkerExecutionContext): Promise<void> {
    context.waitUntil(recordProducerEvents(env, events, new Date().toISOString()))
  },
  async scheduled(_event: unknown, env: MonitorWorkerEnv, context: WorkerExecutionContext): Promise<void> {
    context.waitUntil(checkProducerSilence(env, new Date().toISOString()))
  },
}
