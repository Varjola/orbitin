import { MAX_PROVIDER_OMM_RECORDS, parseOmmArrayJson } from '../../../src/data/omm.ts'
import { compareCatalogIds } from '../../../src/data/catalogueSourceRecord.ts'
import { CATALOGUE_DEFINITIONS, type CatalogueDefinition } from '../catalogues.ts'
import { createSpaceTrackDialectSweepNormalizer } from './spaceTrackSourceRecord.ts'
import {
  assertCuratedRequest, assertSweepPageRequest, ProviderFetchError,
  type CatalogueProvider, type GpCuratedRequest, type GpCuratedResult, type GpFetchRequest, type GpFetchResult, type GpSweepNormalizer, type GpSweepPage, type GpSweepPageRequest, type GpSweepProvider, type GpSweepProviderDescriptor,
} from './types.ts'

/** Deterministic offline provider for local development, tests and preview.
 *
 * This is the default everywhere except production. Running the application,
 * the scheduled handler or the test suite therefore never needs Space-Track
 * credentials and never produces upstream traffic.
 *
 * It synthesizes a plausible record for every defined catalogue member and then
 * feeds it through the same `parseOmmArrayJson` boundary the live provider uses,
 * emitting the same wire dialect Space-Track GP JSON uses: numeric fields as
 * decimal strings, an epoch with no `Z` designator, and the CCSDS header
 * keywords in upper case. That way ordinary local runs exercise the real
 * decoding path, and a regression in dialect handling fails in CI rather than
 * on the first live run.
 *
 * For the automatic keyset sweep it serves pages of the same records, or of a
 * larger synthetic catalogue when `sweepRecordCount` is given (scale and Worker
 * memory measurement).
 *
 * The orbital values are constructed, not observed. No provider data is copied
 * into this repository. */
export const FIXTURE_PROVIDER_ID = 'fixture'
const FIXTURE_EPOCH_UTC = '2026-03-20T12:00:00.123456'
/** Bound on the synthetic sweep catalogue: the 30-page sweep cap at 4,000
 *  records per page. */
export const MAX_FIXTURE_SWEEP_RECORDS = 120_000

interface OrbitArchetype {
  readonly meanMotion: number
  readonly eccentricity: number
  readonly inclination: number
  readonly bstar: number
}

/** One representative orbit per catalogue, so a fixture snapshot exercises the
 *  near-Earth, deep-space and high-eccentricity propagation paths the real
 *  catalogues contain. */
const ARCHETYPES: Readonly<Record<string, OrbitArchetype>> = {
  'space-stations': { meanMotion: 15.5, eccentricity: 0.0004, inclination: 51.6, bstar: 0.00023 },
  navigation: { meanMotion: 2.0056, eccentricity: 0.0121, inclination: 55.1, bstar: 0 },
  'earth-observation': { meanMotion: 14.57, eccentricity: 0.0012, inclination: 98.2, bstar: 0.000042 },
  'space-science': { meanMotion: 0.3782, eccentricity: 0.7431, inclination: 57.4, bstar: 0 },
}
const DEFAULT_ARCHETYPE: OrbitArchetype = { meanMotion: 14, eccentricity: 0.001, inclination: 45, bstar: 0 }
const ARCHETYPE_CYCLE = Object.values(ARCHETYPES)
const DESIGNATOR_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

export const FIXTURE_GP_SWEEP_DESCRIPTOR: GpSweepProviderDescriptor = {
  providerId: FIXTURE_PROVIDER_ID,
  providerName: 'Local fixture',
  providerHomepage: 'https://example.invalid/',
  sourceAuthority: 'Synthetic fixture data; not derived from any provider',
  queryDescription: 'Synthetic fixture catalogue retrieved as bounded pages in ascending catalogue id order',
  supplementDescription: '; plus synthetic curated members by catalogue id',
}
/** The fixture's curated query bound, equal to Space-Track's batched id bound. */
const MAX_FIXTURE_CURATED_IDS = 500

export interface FixtureProviderOptions {
  readonly definitions?: readonly CatalogueDefinition[]
  /** Serve a synthetic catalogue of this many records (ids 1..n) to the sweep
   *  instead of the defined catalogue members. */
  readonly sweepRecordCount?: number
}

interface SweepMember {
  readonly catalogId: string
  readonly designator: string
  readonly name: string
  readonly archetype: OrbitArchetype
  readonly position: number
}

export class FixtureProvider implements CatalogueProvider, GpSweepProvider {
  readonly id = FIXTURE_PROVIDER_ID
  readonly sweepDescriptor = FIXTURE_GP_SWEEP_DESCRIPTOR
  private readonly definitions: readonly CatalogueDefinition[]
  private readonly sweepRecordCount: number | undefined
  private sweepMembers: readonly SweepMember[] | null = null

  constructor(options: FixtureProviderOptions = {}) {
    this.definitions = options.definitions ?? CATALOGUE_DEFINITIONS
    if (options.sweepRecordCount !== undefined && (!Number.isSafeInteger(options.sweepRecordCount) || options.sweepRecordCount < 1 || options.sweepRecordCount > MAX_FIXTURE_SWEEP_RECORDS)) {
      throw new ProviderFetchError('configuration', 'The fixture sweep record count is outside its bound.')
    }
    this.sweepRecordCount = options.sweepRecordCount
  }

  async fetchCurrentGp(request: GpFetchRequest): Promise<GpFetchResult> {
    const selected = new Set(request.catalogIds)
    const wire: unknown[] = []
    for (const definition of this.definitions) {
      const archetype = ARCHETYPES[definition.id] ?? DEFAULT_ARCHETYPE
      definition.members.forEach((member, position) => {
        if (!selected.has(member.catalogId)) return
        wire.push(fixtureRecord(member.catalogId, member.designator, member.name, archetype, position))
      })
    }
    const parsed = parseOmmArrayJson(JSON.stringify(wire))
    if (!parsed.ok) throw new ProviderFetchError('data', 'The fixture provider produced records the OMM boundary rejected.')
    return {
      providerId: FIXTURE_PROVIDER_ID,
      providerName: FIXTURE_GP_SWEEP_DESCRIPTOR.providerName,
      providerHomepage: FIXTURE_GP_SWEEP_DESCRIPTOR.providerHomepage,
      sourceAuthority: FIXTURE_GP_SWEEP_DESCRIPTOR.sourceAuthority,
      retrievedAtUtc: request.nowUtc,
      upstreamRequestCount: 0,
      receivedCount: parsed.definitions.length + parsed.rejectedRecordCount,
      rejectedCount: parsed.rejectedRecordCount,
      definitions: parsed.definitions,
    }
  }

  async fetchGpPage(request: GpSweepPageRequest): Promise<GpSweepPage> {
    assertSweepPageRequest(request, MAX_PROVIDER_OMM_RECORDS)
    const page = this.members().filter((member) => compareCatalogIds(member.catalogId, request.afterCatalogId) > 0).slice(0, request.limit)
    const wire = page.map((member) => fixtureRecord(member.catalogId, member.designator, member.name, member.archetype, member.position))
    return {
      retrievedAtUtc: request.nowUtc,
      upstreamRequestCount: 0,
      recordCount: page.length,
      firstCatalogId: page[0]?.catalogId ?? null,
      lastCatalogId: page.at(-1)?.catalogId ?? null,
      body: new TextEncoder().encode(JSON.stringify(wire)),
    }
  }

  /** A synthetic record for every requested id, so offline runs exercise
   *  both a curated id the sweep lacks and one it already holds. */
  async fetchCuratedGp(request: GpCuratedRequest): Promise<GpCuratedResult> {
    assertCuratedRequest(request, MAX_FIXTURE_CURATED_IDS)
    const wire = request.catalogIds.map((catalogId, position) => fixtureRecord(catalogId, `${2000 + (position % 26)}-${String((position % 999) + 1).padStart(3, '0')}Z`, `FIXTURE CURATED ${catalogId}`, ARCHETYPE_CYCLE[position % ARCHETYPE_CYCLE.length], position))
    return { retrievedAtUtc: request.nowUtc, upstreamRequestCount: 0, recordCount: wire.length, body: new TextEncoder().encode(JSON.stringify(wire)) }
  }

  createSweepNormalizer(): GpSweepNormalizer {
    return createSpaceTrackDialectSweepNormalizer(FIXTURE_GP_SWEEP_DESCRIPTOR)
  }

  private members(): readonly SweepMember[] {
    if (this.sweepMembers) return this.sweepMembers
    const members: SweepMember[] = []
    if (this.sweepRecordCount !== undefined) {
      for (let position = 0; position < this.sweepRecordCount; position += 1) {
        const designator = `${2000 + (position % 26)}-${String((position % 999) + 1).padStart(3, '0')}${DESIGNATOR_LETTERS[Math.floor(position / 999) % DESIGNATOR_LETTERS.length]}`
        members.push({ catalogId: String(position + 1), designator, name: `FIXTURE OBJECT ${position + 1}`, archetype: ARCHETYPE_CYCLE[position % ARCHETYPE_CYCLE.length], position })
      }
    } else {
      const seen = new Set<string>()
      for (const definition of this.definitions) {
        const archetype = ARCHETYPES[definition.id] ?? DEFAULT_ARCHETYPE
        definition.members.forEach((member, position) => {
          if (seen.has(member.catalogId)) return
          seen.add(member.catalogId)
          members.push({ catalogId: member.catalogId, designator: member.designator, name: member.name, archetype, position })
        })
      }
      members.sort((a, b) => compareCatalogIds(a.catalogId, b.catalogId))
    }
    this.sweepMembers = members
    return members
  }
}

/** Spreads members of one catalogue around their shared orbit so that a fixture
 *  snapshot has distinguishable objects rather than a stack of identical ones. */
function fixtureRecord(catalogId: string, designator: string, name: string, archetype: OrbitArchetype, position: number): Record<string, unknown> {
  const spread = position * 37
  return {
    CCSDS_OMM_VERS: '3.0',
    COMMENT: 'SYNTHETIC FIXTURE RECORD - NOT PROVIDER DATA',
    ORIGINATOR: 'ORBITIN FIXTURE',
    OBJECT_NAME: name,
    OBJECT_ID: designator,
    CENTER_NAME: 'EARTH',
    REF_FRAME: 'TEME',
    TIME_SYSTEM: 'UTC',
    MEAN_ELEMENT_THEORY: 'SGP4',
    EPOCH: FIXTURE_EPOCH_UTC,
    MEAN_MOTION: archetype.meanMotion.toFixed(8),
    ECCENTRICITY: archetype.eccentricity.toFixed(7),
    INCLINATION: archetype.inclination.toFixed(4),
    RA_OF_ASC_NODE: (spread % 360).toFixed(4),
    ARG_OF_PERICENTER: ((spread * 3) % 360).toFixed(4),
    MEAN_ANOMALY: ((spread * 7) % 360).toFixed(4),
    EPHEMERIS_TYPE: '0',
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: catalogId,
    ELEMENT_SET_NO: '999',
    REV_AT_EPOCH: String(1000 + position),
    BSTAR: archetype.bstar.toExponential(5),
    MEAN_MOTION_DOT: '0',
    MEAN_MOTION_DDOT: '0',
    DECAY_DATE: null,
  }
}
