export interface CountingFetchOptions { readonly honorAbort?: boolean }
export interface CountingFetch { readonly fetch: typeof fetch; readonly requests: string[]; gate(path: string): void; release(path: string): void }
export function createCountingFetch(payloads: Map<string, Uint8Array>, options: CountingFetchOptions = {}): CountingFetch {
  const requests: string[] = []; const gates = new Map<string, { readonly bytes: Uint8Array; readonly promise: Promise<void>; resolve: () => void }>()
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname
    requests.push(path); const bytes = payloads.get(path); if (!bytes) return new Response('not found', { status: 404 })
    const gate = gates.get(path)
    if (gate) {
      if (options.honorAbort && init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await Promise.race([gate.promise, new Promise<never>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))])
    }
    return new Response(bytes.slice().buffer, { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { fetch, requests, gate(path) { if (gates.has(path)) return; let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done }); const bytes = payloads.get(path); if (!bytes) throw new Error(`Cannot gate unknown path ${path}`); gates.set(path, { bytes, promise, resolve }) }, release(path) { gates.get(path)?.resolve(); gates.delete(path) } }
}
