import type { R2ReadableBucketLike, WorkerExecutionContext } from './types.ts'

const ROOT = '/catalog/v1/'
const SNAPSHOT = /^\/catalog\/v1\/snapshots\/(\d{8}T\d{6}Z-[0-9a-f]{12})\/(manifest|search-index|records-(\d+))\.json$/

export async function serveCatalogueRequest(request: Request, bucket: R2ReadableBucketLike, context: WorkerExecutionContext): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return jsonResponse({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' })
  const url = new URL(request.url)
  const key = publicKey(url.pathname)
  if (!key) return jsonResponse({ error: 'not_found' }, 404)
  // The cache key is the path alone: a query string cannot split the cache
  // or force extra bucket reads.
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: 'GET' })
  const cache = (globalThis as typeof globalThis & { caches?: { default: Cache } }).caches?.default
  if (cache) {
    const cached = await cache.match(cacheKey)
    if (cached) return request.method === 'HEAD' ? new Response(null, { status: cached.status, statusText: cached.statusText, headers: cached.headers }) : cached
  }
  const object = await bucket.get(key)
  if (!object?.body) return jsonResponse({ error: 'catalogue_unavailable' }, 503)
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': key === 'catalog/v1/current.json' ? 'public, max-age=60' : 'public, max-age=31536000, immutable' })
  const etag = object.httpEtag ?? object.etag
  if (etag) headers.set('ETag', etag)
  if (etag && request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers })
  // A HEAD response has no body, so it is never cached for later GETs.
  if (request.method === 'HEAD') { await object.body.cancel().catch(() => {}); return new Response(null, { status: 200, headers }) }
  const response = new Response(object.body, { status: 200, headers })
  if (cache) context.waitUntil(cache['put'](cacheKey, response.clone()))
  return response
}

function publicKey(pathname: string): string | null {
  if (pathname === `${ROOT}current.json`) return 'catalog/v1/current.json'
  const match = SNAPSHOT.exec(pathname)
  if (!match) return null
  if (match[2] === 'records-' + match[3] && String(Number(match[3])) !== match[3]) return null
  if (match[2] === 'records-' + match[3] && Number(match[3]) > 255) return null
  return `catalog/v1/snapshots/${match[1]}/${match[2]}.json`
}

function jsonResponse(value: unknown, status: number, extra: Record<string, string> = {}): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra })
  return new Response(JSON.stringify(value), { status, headers })
}
