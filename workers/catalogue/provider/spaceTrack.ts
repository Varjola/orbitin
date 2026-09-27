import { CURATED_CATALOGUE } from '../../../src/data/curatedCatalogue.ts'
import { MAX_PROVIDER_OMM_RECORDS, parseOmmArrayJson } from '../../../src/data/omm.ts'
import { createSpaceTrackDialectSweepNormalizer, inspectSpaceTrackCuratedResponse, inspectSpaceTrackGpPage } from './spaceTrackSourceRecord.ts'
import {
  assertCuratedRequest, assertSweepPageRequest, ProviderFetchError,
  type CatalogueProvider, type GpCuratedRequest, type GpCuratedResult, type GpFetchRequest, type GpFetchResult, type GpSweepNormalizer, type GpSweepPage, type GpSweepPageRequest, type GpSweepProvider, type GpSweepProviderDescriptor,
} from './types.ts'

/** Space-Track.org GP provider.
 *
 * Behaviour verified against the current official Space-Track documentation and
 * the live API on 2026-09-10. Redistribution basis: USSPACECOM gives express
 * blanket approval for transfer and redistribution of basic SSA data accessed
 * via Space-Track.org, conditioned on appropriate citation, which every
 * published snapshot carries (see `ATTRIBUTION.md`). A deployment of this
 * producer must use its operator's own Space-Track account and follow the
 * Space-Track user agreement and API guidelines.
 *
 * Three query shapes exist. Each is three upstream requests per invocation:
 *
 *   POST /ajaxauth/login          -> session cookie
 *   GET  one GP query (below)
 *   GET  /ajaxauth/logout         -> best effort session disposal
 *
 * Selected ids, twice a day:
 *
 *   /basicspacedata/query/class/gp/NORAD_CAT_ID/<batched ids>/orderby/NORAD_CAT_ID%20asc/format/json
 *
 * Automatic catalogue, one bounded keyset page per hourly invocation. The
 * scheduler persists the cursor between pages and
 * never asks for more than one page in a run:
 *
 *   /basicspacedata/query/class/gp/decay_date/null-val/epoch/%3Enow-10/NORAD_CAT_ID/%3E<cursor>/orderby/norad_cat_id%20asc/limit/<limit>/format/json
 *
 * Curated supplement, once per sweep in the hour after its terminal
 * page, in place of a page request: the curated group members and featured
 * picks by id, up to `maxEpochAgeDays` old, so a curated member that has left
 * the ten-day window stays in the catalogue:
 *
 *   /basicspacedata/query/class/gp/NORAD_CAT_ID/<batched curated ids>/decay_date/null-val/epoch/%3Enow-<days>/orderby/norad_cat_id%20asc/format/json
 *
 * Space-Track's current API guidelines cap queries at fewer than 30 per minute
 * and 300 per hour and recommend retrieving GP no more than once per hour; one
 * GP query per hour meets that guidance directly. Space-Track explicitly asks
 * clients not to send many individual /class/gp/ requests. */
export const SPACE_TRACK_PROVIDER_ID = 'space-track'
export const SPACE_TRACK_ORIGIN = 'https://www.space-track.org'
export const SPACE_TRACK_LOGIN_PATH = '/ajaxauth/login'
export const SPACE_TRACK_LOGOUT_PATH = '/ajaxauth/logout'
export const SPACE_TRACK_GP_PATH = '/basicspacedata/query/class/gp'
/** The approved automatic-catalogue predicates. */
export const SPACE_TRACK_AUTOMATIC_GP_PREDICATES = '/decay_date/null-val/epoch/%3Enow-10'
const SESSION_COOKIE_NAME = 'chocolatechip'
const USER_AGENT = 'Orbitin/1.0 (scheduled educational catalogue ingestion; +https://orbitin.net)'
const MAX_LOGIN_BODY_BYTES = 8 * 1024
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
/** One batched query holds every selected object comfortably. The cap exists so
 *  a future catalogue revision cannot silently grow the request into something
 *  the provider would reasonably refuse. */
export const MAX_BATCHED_CATALOG_IDS = 500

export const SPACE_TRACK_GP_SWEEP_DESCRIPTOR: GpSweepProviderDescriptor = {
  providerId: SPACE_TRACK_PROVIDER_ID,
  providerName: 'Space-Track.org',
  providerHomepage: `${SPACE_TRACK_ORIGIN}/`,
  sourceAuthority: 'USSPACECOM / 18th Space Defense Squadron',
  queryDescription: 'Space-Track GP class: element sets with no decay date and an epoch within the last ten days, retrieved as one bounded page per hour in ascending catalogue id order',
  supplementDescription: `; plus curated Orbitin group members and featured objects by catalogue id with no decay date and an epoch within the last ${CURATED_CATALOGUE.maxSupplementEpochAgeDays} days`,
}

export interface SpaceTrackCredentials {
  readonly identity: string
  readonly password: string
}

export interface SpaceTrackProviderOptions {
  readonly credentials: SpaceTrackCredentials
  readonly fetchImpl?: typeof globalThis.fetch
  readonly origin?: string
}

/** Reads credentials from the Worker environment.
 *
 * Returns `null` rather than throwing when they are absent, so a deployment
 * that has not been given secrets yet fails as a configuration state without
 * ever producing upstream traffic. The values are handed straight to the
 * provider and never stored, logged or echoed anywhere else. */
export function readSpaceTrackCredentials(env: {
  readonly SPACETRACK_IDENTITY?: string
  readonly SPACETRACK_PASSWORD?: string
}): SpaceTrackCredentials | null {
  const identity = env.SPACETRACK_IDENTITY?.trim() ?? ''
  const password = env.SPACETRACK_PASSWORD ?? ''
  if (identity.length === 0 || password.length === 0) return null
  return { identity, password }
}

export class SpaceTrackProvider implements CatalogueProvider, GpSweepProvider {
  readonly id = SPACE_TRACK_PROVIDER_ID
  readonly sweepDescriptor = SPACE_TRACK_GP_SWEEP_DESCRIPTOR
  private readonly credentials: SpaceTrackCredentials
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly origin: string

  constructor(options: SpaceTrackProviderOptions) {
    this.credentials = options.credentials
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.origin = options.origin ?? SPACE_TRACK_ORIGIN
  }

  async fetchCurrentGp(request: GpFetchRequest): Promise<GpFetchResult> {
    if (request.catalogIds.length === 0) throw new ProviderFetchError('configuration', 'No catalogue identifiers were selected for ingestion.')
    if (request.catalogIds.length > MAX_BATCHED_CATALOG_IDS) throw new ProviderFetchError('configuration', 'The selected catalogue exceeds the batched query bound.')
    if (request.catalogIds.some((id) => !/^[1-9]\d{0,8}$/.test(id))) throw new ProviderFetchError('configuration', 'A selected catalogue identifier is not a canonical digit string.')

    // One batched request for the whole selection. `orderby` keeps the response
    // deterministic, which makes snapshot digests comparable between runs.
    const { bytes, upstreamRequestCount } = await this.withSession(request.signal, (session) => this.queryGp(session, `/NORAD_CAT_ID/${request.catalogIds.join(',')}/orderby/NORAD_CAT_ID%20asc/format/json`, request.signal))
    const parsed = parseOmmArrayJson(new TextDecoder().decode(bytes))
    if (!parsed.ok) throw new ProviderFetchError('data', 'The Space-Track GP response is not a bounded OMM array.')
    return {
      providerId: SPACE_TRACK_PROVIDER_ID,
      providerName: SPACE_TRACK_GP_SWEEP_DESCRIPTOR.providerName,
      providerHomepage: SPACE_TRACK_GP_SWEEP_DESCRIPTOR.providerHomepage,
      sourceAuthority: SPACE_TRACK_GP_SWEEP_DESCRIPTOR.sourceAuthority,
      retrievedAtUtc: request.nowUtc,
      upstreamRequestCount,
      receivedCount: parsed.definitions.length + parsed.rejectedRecordCount,
      rejectedCount: parsed.rejectedRecordCount,
      definitions: parsed.definitions,
    }
  }

  /** Exactly one GP query: the page of records after the cursor. */
  async fetchGpPage(request: GpSweepPageRequest): Promise<GpSweepPage> {
    assertSweepPageRequest(request, MAX_PROVIDER_OMM_RECORDS)
    const suffix = `${SPACE_TRACK_AUTOMATIC_GP_PREDICATES}/NORAD_CAT_ID/%3E${request.afterCatalogId}/orderby/norad_cat_id%20asc/limit/${request.limit}/format/json`
    const { bytes, upstreamRequestCount } = await this.withSession(request.signal, (session) => this.queryGp(session, suffix, request.signal))
    const inspection = inspectSpaceTrackGpPage(new TextDecoder().decode(bytes), request.afterCatalogId, request.limit)
    if (!inspection.ok) throw new ProviderFetchError('data', `The Space-Track GP page failed its structural check (${inspection.reason}).`, 200)
    return {
      retrievedAtUtc: request.nowUtc,
      upstreamRequestCount,
      recordCount: inspection.records.length,
      firstCatalogId: inspection.firstCatalogId,
      lastCatalogId: inspection.lastCatalogId,
      body: new Uint8Array(bytes),
    }
  }

  /** Exactly one GP query: the curated ids, not decayed, within the age. */
  async fetchCuratedGp(request: GpCuratedRequest): Promise<GpCuratedResult> {
    assertCuratedRequest(request, MAX_BATCHED_CATALOG_IDS)
    const suffix = `/NORAD_CAT_ID/${request.catalogIds.join(',')}/decay_date/null-val/epoch/%3Enow-${request.maxEpochAgeDays}/orderby/norad_cat_id%20asc/format/json`
    const { bytes, upstreamRequestCount } = await this.withSession(request.signal, (session) => this.queryGp(session, suffix, request.signal))
    const inspection = inspectSpaceTrackCuratedResponse(new TextDecoder().decode(bytes), new Set(request.catalogIds))
    if (!inspection.ok) throw new ProviderFetchError('data', `The Space-Track curated GP response failed its structural check (${inspection.reason}).`, 200)
    return { retrievedAtUtc: request.nowUtc, upstreamRequestCount, recordCount: inspection.records.length, body: new Uint8Array(bytes) }
  }

  createSweepNormalizer(): GpSweepNormalizer {
    return createSpaceTrackDialectSweepNormalizer(SPACE_TRACK_GP_SWEEP_DESCRIPTOR)
  }

  /** Login, one query, logout. The count includes the logout issued in
   *  `finally`, because it is sent whether or not the query succeeded. */
  private async withSession<T>(signal: AbortSignal | undefined, query: (session: string) => Promise<T>): Promise<{ readonly bytes: T; readonly upstreamRequestCount: number }> {
    let session: string | null = null
    try {
      session = await this.login(signal)
      return { bytes: await query(session), upstreamRequestCount: 3 }
    } finally {
      // Session disposal is hygiene, not correctness. Space-Track issues a
      // two-hour cookie, so a failed logout can never accumulate sessions; it
      // must therefore never turn a successful ingestion into a failed one.
      if (session) await this.logout(session)
    }
  }

  /** Exchanges credentials for a session cookie.
   *
   * A rejected login is answered with HTTP 200 and a JSON body naming a `Login`
   * state, so status alone is not evidence of success. This requires both an
   * absent failure body and a session cookie, and treats anything it does not
   * recognize as a failure. */
  private async login(signal: AbortSignal | undefined): Promise<string> {
    const body = new URLSearchParams({ identity: this.credentials.identity, password: this.credentials.password })
    const response = await this.send(`${this.origin}${SPACE_TRACK_LOGIN_PATH}`, {
      method: 'POST',
      redirect: 'manual',
      signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': USER_AGENT },
      body,
    })
    if (response.status !== 200) throw classify(response.status, 'The Space-Track authentication request was refused.')
    const text = new TextDecoder().decode(await readBoundedBytes(response, MAX_LOGIN_BODY_BYTES, 'The Space-Track authentication response could not be read.'))
    if (text.trim().length > 0 && /"Login"\s*:/.test(text)) throw new ProviderFetchError('authentication', 'Space-Track rejected the configured credentials.', 200)
    const cookie = sessionCookie(response)
    if (!cookie) throw new ProviderFetchError('authentication', 'Space-Track returned no session for the configured credentials.', 200)
    return cookie
  }

  private async queryGp(session: string, suffix: string, signal: AbortSignal | undefined): Promise<ArrayBuffer> {
    const response = await this.send(`${this.origin}${SPACE_TRACK_GP_PATH}${suffix}`, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: { Accept: 'application/json', Cookie: `${SESSION_COOKIE_NAME}=${session}`, 'User-Agent': USER_AGENT },
    })
    if (response.status !== 200) throw classify(response.status, 'The Space-Track GP query was refused.')
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('application/json') && !contentType.includes('+json')) throw new ProviderFetchError('data', 'The Space-Track GP response has an unexpected content type.', 200)
    const declaredLength = response.headers.get('content-length')
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) throw new ProviderFetchError('data', 'The Space-Track GP response is too large.', 200)
    return readBoundedBytes(response, MAX_RESPONSE_BYTES, 'The Space-Track GP response could not be read.', signal)
  }

  private async logout(session: string): Promise<void> {
    try {
      await this.fetchImpl(`${this.origin}${SPACE_TRACK_LOGOUT_PATH}`, {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'application/json', Cookie: `${SESSION_COOKIE_NAME}=${session}`, 'User-Agent': USER_AGENT },
      })
    } catch {
      // Deliberately swallowed. See withSession.
    }
  }

  /** Wraps `fetch` so a transport failure becomes a classified provider error
   *  rather than an arbitrary object that might carry request details. */
  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init)
    } catch {
      throw new ProviderFetchError('transient', 'A Space-Track request could not be completed.')
    }
  }
}

/** Extracts the session cookie value without retaining the whole header.
 *
 * Workers may expose either the multi-value accessor or one combined header
 * depending on compatibility date, so both are handled. */
function sessionCookie(response: Response): string | null {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const candidates = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : splitCookies(headers.get('set-cookie'))
  for (const candidate of candidates) {
    const match = new RegExp(`(?:^|,\\s*)${SESSION_COOKIE_NAME}=([^;,\\s]+)`).exec(candidate)
    if (match) return match[1]
  }
  return null
}

function splitCookies(value: string | null): string[] {
  return value ? [value] : []
}

async function readBoundedBytes(response: Response, maxBytes: number, failureMessage: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  let bytes: ArrayBuffer
  try {
    bytes = await response.arrayBuffer()
  } catch {
    // A body cut off by the run timeout is an outage, not untrusted content.
    if (signal?.aborted) throw new ProviderFetchError('transient', 'A Space-Track response timed out.')
    throw new ProviderFetchError('data', failureMessage)
  }
  if (bytes.byteLength > maxBytes) throw new ProviderFetchError('data', 'A Space-Track response exceeded the configured size bound.')
  return bytes
}

/** Maps Space-Track's HTTP surface onto the ingestion policy classes.
 *
 * A redirect or a not-found on one of the three constant endpoints means this
 * deployment is pointed somewhere that no longer exists, which a schedule
 * cannot repair; 401/403 mean the session or account was refused; 429 is the
 * documented protection response; everything else is treated as transient. */
function classify(status: number, message: string): ProviderFetchError {
  if (status >= 300 && status < 400) return new ProviderFetchError('configuration', 'A Space-Track endpoint returned a redirect; the configured endpoint is wrong.', status)
  if (status === 404) return new ProviderFetchError('configuration', 'A Space-Track endpoint returned not found; the configured endpoint is wrong.', status)
  if (status === 401 || status === 403) return new ProviderFetchError('authentication', 'Space-Track refused the authenticated session.', status)
  if (status === 429) return new ProviderFetchError('rate-limit', 'Space-Track rate limited this client.', status)
  return new ProviderFetchError('transient', message, status)
}
