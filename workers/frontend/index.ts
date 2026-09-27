import { serveCatalogueRequest } from '../shared/serve.ts'
import type { AnalyticsEngineDatasetLike, R2ReadableBucketLike, WorkerAssets, WorkerExecutionContext } from '../shared/types.ts'
import { browserFamily, MAX_EVENT_BODY_BYTES, parseUsageBatch } from './usageEventSchema.ts'

/** Environment of the orbitin and orbitin-dev frontend Workers. It carries no
 * catalogue provider variables and no secrets by design: these Workers serve
 * published catalogue data and never ingest it. `USAGE_EVENTS` is optional: a
 * deployment without the Analytics Engine binding accepts events and stores
 * nothing. */
export interface FrontendWorkerEnv {
  readonly ASSETS: WorkerAssets
  readonly CATALOGUE_BUCKET: R2ReadableBucketLike
  readonly USAGE_EVENTS?: AnalyticsEngineDatasetLike
}

const USAGE_EVENTS_PATH = '/events/v1'

export default {
  async fetch(request: Request, env: FrontendWorkerEnv, context: WorkerExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/catalog/')) return serveCatalogueRequest(request, env.CATALOGUE_BUCKET, context)
    if (url.pathname === USAGE_EVENTS_PATH) return receiveUsageEvents(request, env)
    return env.ASSETS.fetch(request)
  },
}

/** The anonymous usage and error event sink: write-only, no read path, no
 * per-visitor state. Each allowlisted event becomes one Analytics Engine data
 * point with the request's country and a coarse browser family; the IP
 * address, the User-Agent string and the request body are not stored. */
async function receiveUsageEvents(request: Request, env: FrontendWorkerEnv): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } })
  const origin = request.headers.get('Origin')
  if (origin !== null && origin !== new URL(request.url).origin) return noContent(403)
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (declared > MAX_EVENT_BODY_BYTES) return noContent(413)
  const body = await readLimited(request, MAX_EVENT_BODY_BYTES)
  if (body === null) return noContent(413)
  const events = parseUsageBatch(body)
  if (events === null) return noContent(400)
  const dataset = env.USAGE_EVENTS
  if (dataset) {
    const country = (request as Request & { readonly cf?: { readonly country?: unknown } }).cf?.country
    const context = [typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : 'XX', browserFamily(request.headers.get('User-Agent'))]
    // Fixed positions for queries: blob1 type, blob2 country, blob3 browser
    // family, then the event's properties in allowlist order.
    for (const event of events) dataset.writeDataPoint({ indexes: [event.type], blobs: [event.type, ...context, ...event.values], doubles: [1] })
  }
  return noContent(204)
}

function noContent(status: number): Response {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** The body as text, or null once it exceeds `limit` bytes. */
async function readLimited(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) { await reader.cancel(); return null }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(joined)
}
