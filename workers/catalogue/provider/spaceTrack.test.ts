import { expect, it } from 'vitest'
import { SpaceTrackProvider, readSpaceTrackCredentials } from './spaceTrack.ts'
import { ProviderFetchError } from './types.ts'

const CREDENTIALS = { identity: 'test-identity@example.invalid', password: 'test-password-not-real' }
const REQUEST = { catalogIds: ['25544', '100460'], nowUtc: '2026-09-10T00:17:00Z' }

/** One representative Space-Track GP JSON record.
 *
 * Every property of the dialect this project has to survive is present: numeric
 * fields as decimal strings, an epoch with no `Z` designator, `CENTER_NAME` in
 * upper case, the CCSDS header keywords, and extra fields the parser must
 * ignore. The values are synthetic. */
function wireRecord(catalogId: string, designator: string, name: string): Record<string, unknown> {
  return {
    CCSDS_OMM_VERS: '3.0',
    COMMENT: 'GENERATED VIA TEST FIXTURE',
    CREATION_DATE: '2026-09-10T00:00:00',
    ORIGINATOR: '18 SPCS',
    OBJECT_NAME: name,
    OBJECT_ID: designator,
    CENTER_NAME: 'EARTH',
    REF_FRAME: 'TEME',
    TIME_SYSTEM: 'UTC',
    MEAN_ELEMENT_THEORY: 'SGP4',
    EPOCH: '2026-09-09T22:41:08.689632',
    MEAN_MOTION: '15.49180977',
    ECCENTRICITY: '0.00016340',
    INCLINATION: '51.6446',
    RA_OF_ASC_NODE: '60.1099',
    ARG_OF_PERICENTER: '35.3131',
    MEAN_ANOMALY: '60.2620',
    EPHEMERIS_TYPE: '0',
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: catalogId,
    ELEMENT_SET_NO: '999',
    REV_AT_EPOCH: '47210',
    BSTAR: '0.00001654',
    MEAN_MOTION_DOT: '0.00000915',
    MEAN_MOTION_DDOT: '0',
    SEMIMAJOR_AXIS: '6795.456',
    PERIOD: '92.947',
    DECAY_DATE: null,
    OBJECT_TYPE: 'PAYLOAD',
  }
}

interface Call { readonly url: string; readonly init: RequestInit }

function transcript(handlers: Record<string, () => Response>): { calls: Call[]; fetchImpl: typeof globalThis.fetch } {
  const calls: Call[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, init })
    const handler = Object.entries(handlers).find(([fragment]) => url.includes(fragment))?.[1]
    if (!handler) throw new Error(`unexpected request ${url}`)
    return handler()
  }) as unknown as typeof globalThis.fetch
  return { calls, fetchImpl }
}

function loginSuccess(): Response {
  return new Response('""', { status: 200, headers: { 'set-cookie': 'chocolatechip=session-value; expires=Thu, 10-Sep-2026 02:17:00 GMT; Max-Age=7200; path=/; SameSite=Lax; HttpOnly' } })
}

function gpSuccess(): Response {
  const body = JSON.stringify([wireRecord('25544', '1998-067A', 'ISS (ZARYA)'), wireRecord('100460', '2026-194A', 'COSMOS 2619 [GLONASS-K1]')])
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
}

it('authenticates once, batches the whole selection into one query and disposes of the session', async () => {
  const { calls, fetchImpl } = transcript({ '/ajaxauth/login': loginSuccess, '/class/gp/': gpSuccess, '/ajaxauth/logout': () => new Response('', { status: 200 }) })
  const result = await new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl }).fetchCurrentGp(REQUEST)

  expect(calls.map((call) => new URL(call.url).pathname.split('/').slice(0, 3).join('/'))).toEqual(['/ajaxauth/login', '/basicspacedata/query', '/ajaxauth/logout'])
  expect(result.upstreamRequestCount).toBe(3)
  // One query for every selected object, not one query per object.
  expect(calls[1].url).toContain('/class/gp/NORAD_CAT_ID/25544,100460/')
  expect(calls[1].url).toContain('/format/json')
  expect((calls[1].init.headers as Record<string, string>).Cookie).toBe('chocolatechip=session-value')
  expect(result.definitions).toHaveLength(2)
  expect(result.providerId).toBe('space-track')
})

it('normalizes the Space-Track wire dialect into the application model', async () => {
  const { fetchImpl } = transcript({ '/ajaxauth/login': loginSuccess, '/class/gp/': gpSuccess, '/ajaxauth/logout': () => new Response('', { status: 200 }) })
  const result = await new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl }).fetchCurrentGp(REQUEST)
  const [iss, glonass] = result.definitions

  expect(iss.name).toBe('ISS (ZARYA)')
  expect(iss.internationalDesignator).toBe('1998-067A')
  expect(iss.meanElements.catalogId).toBe('25544')
  // The epoch carries no `Z` on the wire and is still read as UTC.
  expect(new Date(iss.meanElements.epoch.unixSeconds * 1000).toISOString()).toBe('2026-09-09T22:41:08.689Z')
  expect(iss.meanElements.eccentricity).toBeCloseTo(0.0001634, 10)
  expect(iss.meanElements.inclinationRad).toBeCloseTo(51.6446 * Math.PI / 180, 12)
  // A catalogue identifier past the legacy five-digit limit survives intact.
  expect(glonass.meanElements.catalogId).toBe('100460')
})

it('treats a refused login as an authentication failure and never continues to the query', async () => {
  const { calls, fetchImpl } = transcript({ '/ajaxauth/login': () => new Response('{"Login":"Failed"}', { status: 200 }) })
  await expect(new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl }).fetchCurrentGp(REQUEST))
    .rejects.toMatchObject({ kind: 'authentication' })
  expect(calls).toHaveLength(1)
})

it('treats a login with no session cookie as a failure rather than assuming success', async () => {
  const { fetchImpl } = transcript({ '/ajaxauth/login': () => new Response('', { status: 200 }) })
  await expect(new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl }).fetchCurrentGp(REQUEST))
    .rejects.toMatchObject({ kind: 'authentication' })
})

it('classifies provider responses into ingestion policy classes', async () => {
  const cases: readonly [number, string][] = [[401, 'authentication'], [403, 'authentication'], [429, 'rate-limit'], [500, 'transient'], [302, 'configuration'], [404, 'configuration']]
  for (const [status, kind] of cases) {
    const { fetchImpl } = transcript({ '/ajaxauth/login': loginSuccess, '/class/gp/': () => new Response('', { status }), '/ajaxauth/logout': () => new Response('', { status: 200 }) })
    await expect(new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl }).fetchCurrentGp(REQUEST), `HTTP ${status}`).rejects.toMatchObject({ kind })
  }
})

it('rejects a successful response that is not bounded JSON', async () => {
  const { fetchImpl } = transcript({ '/ajaxauth/login': loginSuccess, '/class/gp/': () => new Response('<html>maintenance</html>', { status: 200, headers: { 'content-type': 'text/html' } }), '/ajaxauth/logout': () => new Response('', { status: 200 }) })
  await expect(new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl }).fetchCurrentGp(REQUEST)).rejects.toMatchObject({ kind: 'data' })
})

it('classifies a response body cut off by the run timeout as transient, not as untrusted data', async () => {
  const controller = new AbortController()
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/ajaxauth/login')) return loginSuccess()
    if (url.includes('/ajaxauth/logout')) return new Response('', { status: 200 })
    controller.abort()
    return { status: 200, headers: new Headers({ 'content-type': 'application/json' }), arrayBuffer: async () => { throw new DOMException('aborted', 'AbortError') } } as unknown as Response
  }) as unknown as typeof globalThis.fetch
  await expect(new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl }).fetchGpPage({ afterCatalogId: '0', limit: 10, nowUtc: '2026-09-14T00:17:00Z', signal: controller.signal }))
    .rejects.toMatchObject({ kind: 'transient' })
})

it('disposes of the session even when the query fails, and never fails a run because logout failed', async () => {
  const seen: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    seen.push(url)
    if (url.includes('/ajaxauth/login')) return loginSuccess()
    if (url.includes('/class/gp/')) return new Response('', { status: 503 })
    throw new Error('logout transport failure')
  }) as unknown as typeof globalThis.fetch
  await expect(new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl }).fetchCurrentGp(REQUEST)).rejects.toMatchObject({ kind: 'transient' })
  expect(seen.some((url) => url.includes('/ajaxauth/logout'))).toBe(true)
})

it('never puts credentials or session material into an error that could be logged', async () => {
  const { fetchImpl } = transcript({ '/ajaxauth/login': () => new Response('{"Login":"Failed"}', { status: 200 }) })
  const error = await new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl }).fetchCurrentGp(REQUEST).catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(ProviderFetchError)
  const rendered = `${(error as Error).message} ${(error as Error).stack ?? ''} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`
  expect(rendered).not.toContain(CREDENTIALS.password)
  expect(rendered).not.toContain(CREDENTIALS.identity)
  expect(rendered).not.toContain('chocolatechip')
})

it('refuses to build a request from a selection it cannot trust', async () => {
  const { calls, fetchImpl } = transcript({ '/ajaxauth/login': loginSuccess })
  const provider = new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl })
  await expect(provider.fetchCurrentGp({ ...REQUEST, catalogIds: [] })).rejects.toMatchObject({ kind: 'configuration' })
  await expect(provider.fetchCurrentGp({ ...REQUEST, catalogIds: ['25544/../../admin'] })).rejects.toMatchObject({ kind: 'configuration' })
  expect(calls).toHaveLength(0)
})

function gpPage(ids: readonly string[]): () => Response {
  return () => new Response(JSON.stringify(ids.map((id) => wireRecord(id, '2020-001A', `OBJECT ${id}`))), { status: 200, headers: { 'content-type': 'application/json' } })
}

it('requests exactly one bounded keyset page with the approved predicates in a session', async () => {
  const { calls, fetchImpl } = transcript({ '/ajaxauth/login': loginSuccess, '/class/gp/': gpPage(['4001', '4002', '100460']), '/ajaxauth/logout': () => new Response('', { status: 200 }) })
  const page = await new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl }).fetchGpPage({ afterCatalogId: '4000', limit: 4000, nowUtc: '2026-09-14T00:17:00Z' })

  expect(calls.map((call) => new URL(call.url).pathname.split('/').slice(0, 3).join('/'))).toEqual(['/ajaxauth/login', '/basicspacedata/query', '/ajaxauth/logout'])
  expect(calls[1].url).toBe('https://www.space-track.org/basicspacedata/query/class/gp/decay_date/null-val/epoch/%3Enow-10/NORAD_CAT_ID/%3E4000/orderby/norad_cat_id%20asc/limit/4000/format/json')
  expect(page).toMatchObject({ upstreamRequestCount: 3, recordCount: 3, firstCatalogId: '4001', lastCatalogId: '100460', retrievedAtUtc: '2026-09-14T00:17:00Z' })
  expect(JSON.parse(new TextDecoder().decode(page.body))).toHaveLength(3)
})

it('refuses a page that breaks the keyset contract as untrusted data', async () => {
  const cases: readonly [string, () => Response][] = [
    ['not after the cursor', gpPage(['4000', '4001'])],
    ['not ascending', gpPage(['4002', '4001'])],
    ['over the limit', gpPage(['4001', '4002', '4003'])],
    ['not an array', () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })],
  ]
  for (const [description, handler] of cases) {
    const { fetchImpl } = transcript({ '/ajaxauth/login': loginSuccess, '/class/gp/': handler, '/ajaxauth/logout': () => new Response('', { status: 200 }) })
    await expect(new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl }).fetchGpPage({ afterCatalogId: '4000', limit: 2, nowUtc: '2026-09-14T00:17:00Z' }), description).rejects.toMatchObject({ kind: 'data' })
  }
})

it('refuses an untrusted cursor or limit before any request', async () => {
  const { calls, fetchImpl } = transcript({ '/ajaxauth/login': loginSuccess })
  const provider = new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl })
  for (const request of [{ afterCatalogId: '10/../admin', limit: 10 }, { afterCatalogId: '010', limit: 10 }, { afterCatalogId: '0', limit: 0 }, { afterCatalogId: '0', limit: 20_001 }]) {
    await expect(provider.fetchGpPage({ ...request, nowUtc: '2026-09-14T00:17:00Z' })).rejects.toMatchObject({ kind: 'configuration' })
  }
  expect(calls).toHaveLength(0)
})

it('reads credentials only when both halves are present', () => {
  expect(readSpaceTrackCredentials({})).toBeNull()
  expect(readSpaceTrackCredentials({ SPACETRACK_IDENTITY: 'user' })).toBeNull()
  expect(readSpaceTrackCredentials({ SPACETRACK_IDENTITY: '  ', SPACETRACK_PASSWORD: 'secret' })).toBeNull()
  expect(readSpaceTrackCredentials({ SPACETRACK_IDENTITY: ' user ', SPACETRACK_PASSWORD: 'secret' })).toEqual({ identity: 'user', password: 'secret' })
})

// The curated supplement query.

const CURATED = { catalogIds: ['5', '25544', '60423', '100460'], maxEpochAgeDays: 30, nowUtc: '2026-09-27T01:17:00Z' }

it('requests the curated ids in one batched query with the decay and age predicates in a session', async () => {
  const { calls, fetchImpl } = transcript({ '/ajaxauth/login': loginSuccess, '/class/gp/': gpPage(['5', '60423']), '/ajaxauth/logout': () => new Response('', { status: 200 }) })
  const result = await new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl }).fetchCuratedGp(CURATED)

  expect(calls.map((call) => new URL(call.url).pathname.split('/').slice(0, 3).join('/'))).toEqual(['/ajaxauth/login', '/basicspacedata/query', '/ajaxauth/logout'])
  expect(calls[1].url).toBe('https://www.space-track.org/basicspacedata/query/class/gp/NORAD_CAT_ID/5,25544,60423,100460/decay_date/null-val/epoch/%3Enow-30/orderby/norad_cat_id%20asc/format/json')
  expect(result).toMatchObject({ upstreamRequestCount: 3, recordCount: 2, retrievedAtUtc: CURATED.nowUtc })
  expect(JSON.parse(new TextDecoder().decode(result.body))).toHaveLength(2)
})

it('accepts an empty curated answer: every member may be in the sweep, decayed or too old', async () => {
  const { fetchImpl } = transcript({ '/ajaxauth/login': loginSuccess, '/class/gp/': gpPage([]), '/ajaxauth/logout': () => new Response('', { status: 200 }) })
  await expect(new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl }).fetchCuratedGp(CURATED)).resolves.toMatchObject({ recordCount: 0 })
})

it('refuses a curated answer that is not the requested ids in ascending order as untrusted data', async () => {
  const cases: readonly [string, () => Response][] = [
    ['an unrequested id', gpPage(['5', '6'])],
    ['not ascending', gpPage(['60423', '5'])],
    ['a repeated id', gpPage(['5', '5'])],
    ['over the requested count', gpPage(['5', '25544', '60423', '100460', '100460'])],
    ['not an array', () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['an unreadable id', () => new Response('[{"NORAD_CAT_ID":"x"}]', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['oversized', () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(9 * 1024 * 1024) } })],
    ['not JSON content', () => new Response('[]', { status: 200, headers: { 'content-type': 'text/html' } })],
  ]
  for (const [description, handler] of cases) {
    const { fetchImpl } = transcript({ '/ajaxauth/login': loginSuccess, '/class/gp/': handler, '/ajaxauth/logout': () => new Response('', { status: 200 }) })
    await expect(new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl }).fetchCuratedGp(CURATED), description).rejects.toMatchObject({ kind: 'data' })
  }
})

it('classifies curated query failures like a page', async () => {
  for (const [status, kind] of [[401, 'authentication'], [403, 'authentication'], [429, 'rate-limit'], [404, 'configuration'], [302, 'configuration'], [503, 'transient']] as const) {
    const { fetchImpl } = transcript({ '/ajaxauth/login': loginSuccess, '/class/gp/': () => new Response('', { status }), '/ajaxauth/logout': () => new Response('', { status: 200 }) })
    await expect(new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl }).fetchCuratedGp(CURATED)).rejects.toMatchObject({ kind, status })
  }
})

it('refuses an untrusted curated list or age before any request', async () => {
  const { calls, fetchImpl } = transcript({ '/ajaxauth/login': loginSuccess })
  const provider = new SpaceTrackProvider({ credentials: CREDENTIALS, fetchImpl })
  const tooMany = Array.from({ length: 501 }, (_, position) => String(position + 1))
  for (const request of [
    { catalogIds: [], maxEpochAgeDays: 30 },
    { catalogIds: tooMany, maxEpochAgeDays: 30 },
    { catalogIds: ['5', '25544/../admin'], maxEpochAgeDays: 30 },
    { catalogIds: ['05'], maxEpochAgeDays: 30 },
    { catalogIds: ['25544', '5'], maxEpochAgeDays: 30 },
    { catalogIds: ['5', '5'], maxEpochAgeDays: 30 },
    { catalogIds: ['5'], maxEpochAgeDays: 10 },
    { catalogIds: ['5'], maxEpochAgeDays: 61 },
    { catalogIds: ['5'], maxEpochAgeDays: 30.5 },
  ]) {
    await expect(provider.fetchCuratedGp({ ...request, nowUtc: CURATED.nowUtc })).rejects.toMatchObject({ kind: 'configuration' })
  }
  expect(calls).toHaveLength(0)
})
