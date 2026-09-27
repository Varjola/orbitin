/// <reference types="vite/client" />
// The Worker typecheck includes src/data with no ambient types; this test reads
// the legacy fixture bytes through Vite's import.meta.glob.
import { describe, expect, it } from 'vitest'
import {
  automaticRecordMetadata, automaticSearchProjection, catalogueProfileMode, encodeAutomaticSearchProjection, indexEntryMatchesRecord, MalformedCatalogueProfileError,
} from './catalogueProfile.ts'
import { decodeCatalogueIndex, decodeCatalogueManifest, decodeCatalogueShard, stableJson, type CatalogueManifestV1 } from './catalogueSchema.ts'
import { buildAutomaticSnapshotFixture, type AutomaticSnapshotFixture } from './fixtures/automaticCatalogueSnapshot.ts'
import * as legacySchema from './fixtures/legacyCatalogueSchema.ts'

const legacyFiles = import.meta.glob('../../workers/catalogue/fixtures/legacy-snapshot/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const legacyPart = (name: string): any => JSON.parse(legacyFiles[`../../workers/catalogue/fixtures/legacy-snapshot/${name}`])

function legacyFixture(): AutomaticSnapshotFixture {
  const manifest = legacyPart('manifest.json')
  return { manifest, index: legacyPart('search-index.json'), shards: Array.from({ length: manifest.shardCount }, (_, shard) => legacyPart(`records-${shard}.json`)) }
}

const base = buildAutomaticSnapshotFixture()
const automatic = (): AutomaticSnapshotFixture => JSON.parse(JSON.stringify(base)) as AutomaticSnapshotFixture

function decodeAll(parts: AutomaticSnapshotFixture) {
  const manifest = decodeCatalogueManifest(parts.manifest)
  const index = decodeCatalogueIndex(parts.index, manifest)
  const shards = parts.shards.map((shard, position) => decodeCatalogueShard(shard, manifest, position))
  return { manifest, index, shards }
}

function recordOf(parts: AutomaticSnapshotFixture, id: string): any {
  const shard = parts.shards.find((candidate) => candidate.records[id] !== undefined)
  if (!shard) throw new Error(`fixture record ${id} is missing`)
  return shard.records[id]
}
const entryOf = (parts: AutomaticSnapshotFixture, id: string): any => parts.index.entries.find((entry: any) => entry.catalogId === id)

const FULL = '900001'
const MINIMAL = '900002'
const ECCENTRIC = '900003'

describe('legacy snapshot', () => {
  it('decodes in legacy mode with every new field absent and nothing manufactured', () => {
    const { manifest, index, shards } = decodeAll(legacyFixture())
    expect(catalogueProfileMode(manifest)).toBe('legacy')
    expect(manifest.catalogueProfile ?? manifest.sourceRun ?? manifest.automaticSummary).toBeUndefined()
    expect(index.catalogueProfile).toBeUndefined()
    expect(index.entries).toHaveLength(31)
    for (const entry of index.entries) {
      expect(automaticSearchProjection(entry)).toBeNull()
      const record = shards[entry.shard].records[entry.catalogId]
      expect(automaticRecordMetadata(record)).toBeNull()
      expect(indexEntryMatchesRecord(entry, record)).toBe(true)
    }
    expect(shards.every((shard) => shard.catalogueProfile === undefined)).toBe(true)
  })
})

describe('complete automatic snapshot', () => {
  it('decodes in automatic mode with source and derived projections kept apart', () => {
    const { manifest, index, shards } = decodeAll(automatic())
    expect(catalogueProfileMode(manifest)).toBe('automatic')
    expect(manifest.catalogueProfile).toEqual({ kind: 'automatic-catalogue', contractVersion: 1, normalizationRulesVersion: 'space-track-gp/1', enrichmentRulesVersion: 'orbit-classes/1' })
    expect(manifest.automaticSummary).toMatchObject({ receivedCount: 5, rejectedCount: 1, acceptedBeforeDeduplicationCount: 4, identicalDuplicateCount: 1, publishedCount: 3, rejectedByReason: { 'not-object': 1 } })

    const byId = new Map(index.entries.map((entry) => [entry.catalogId, entry]))
    expect(automaticSearchProjection(byId.get(FULL)!)).toEqual({
      source: { type: 'PAYLOAD', typeCategory: 'payload', countryOrSourceCode: 'ISS', launchDate: '1998-11-20' },
      derived: { primaryOrbitClass: 'low-earth', altitudeBand: 'low-earth', sgp4Regime: 'near-earth', nearPolar: false, nearEquatorial: false, highEccentricity: false, nearGeosynchronous: false, geoLike: false },
    })
    // Absent source data stays absent: no type, country or launch date appears.
    expect(automaticSearchProjection(byId.get(MINIMAL)!)).toMatchObject({ source: {}, derived: { primaryOrbitClass: 'geosynchronous', sgp4Regime: 'deep-space', nearGeosynchronous: true, geoLike: true, nearEquatorial: true } })
    expect(automaticSearchProjection(byId.get(ECCENTRIC)!)).toMatchObject({ source: { type: 'ROCKET BODY', typeCategory: 'rocket-body', launchDate: '1990-01-05' }, derived: { primaryOrbitClass: 'highly-elliptical', altitudeBand: 'crossing-bands', highEccentricity: true, sgp4Regime: 'deep-space' } })

    for (const entry of index.entries) {
      const record = shards[entry.shard].records[entry.catalogId]
      expect(indexEntryMatchesRecord(entry, record)).toBe(true)
      const metadata = automaticRecordMetadata(record)!
      expect(encodeAutomaticSearchProjection(metadata.source, metadata.derived)).toEqual({ src: entry.src, drv: entry.drv })
    }
    const minimal = shards[index.entries.find((entry) => entry.catalogId === MINIMAL)!.shard].records[MINIMAL]
    expect(minimal.source).toEqual({ object: {}, gp: {}, recordProvenance: { createdAtUtc: '2026-09-13T21:04:11Z' } })
    expect('launchYear' in minimal.derived!).toBe(false)
  })

  it('remains accepted by the pinned legacy decoder', () => {
    const parts = automatic()
    const manifest = legacySchema.decodeCatalogueManifest(parts.manifest)
    expect(legacySchema.decodeCatalogueIndex(parts.index, manifest).entries).toHaveLength(3)
    parts.shards.forEach((shard, position) => expect(Object.keys(legacySchema.decodeCatalogueShard(shard, manifest, position).records).length).toBeGreaterThan(0))
  })

  it('keeps run-level provenance in the manifest only', () => {
    const parts = automatic()
    const reloaded = decodeCatalogueManifest(JSON.parse(stableJson(decodeCatalogueManifest(parts.manifest))) as unknown)
    expect(reloaded.sourceRun).toEqual({
      providerId: 'space-track', sourceAuthority: 'USSPACECOM / 18th Space Defense Squadron', providerRecordClass: 'gp', wireFormat: 'omm-keyed-json',
      queryDescription: parts.manifest.sourceRun.queryDescription, retrievalStartedAtUtc: '2026-09-13T17:17:02.250Z', retrievedAtUtc: '2026-09-14T00:17:01.500Z', ommVersion: '3.0', originator: '18 SPCS', normalizationRulesVersion: 'space-track-gp/1',
    })
    for (const id of [FULL, MINIMAL, ECCENTRIC]) {
      const blocks = JSON.stringify({ source: recordOf(parts, id).source, derived: recordOf(parts, id).derived })
      for (const runKey of ['providerId', 'sourceAuthority', 'queryDescription', 'retrievalStartedAtUtc', 'retrievedAtUtc', 'ommVersion', 'originator', 'normalizationRulesVersion']) expect(blocks).not.toContain(runKey)
    }
  })
})

type Mutation = readonly [description: string, mutate: (parts: AutomaticSnapshotFixture) => void]

const legacyManifest = (parts: AutomaticSnapshotFixture) => { for (const key of ['catalogueProfile', 'sourceRun', 'automaticSummary']) delete parts.manifest[key] }
const legacyIndex = (parts: AutomaticSnapshotFixture) => { delete parts.index.catalogueProfile; for (const entry of parts.index.entries) { delete entry.src; delete entry.drv } }

const automaticMutations: readonly Mutation[] = [
  // Manifest marker and blocks.
  ['manifest without catalogueProfile', (p) => { delete p.manifest.catalogueProfile }],
  ['manifest without sourceRun', (p) => { delete p.manifest.sourceRun }],
  ['manifest without automaticSummary', (p) => { delete p.manifest.automaticSummary }],
  ['profile of another kind', (p) => { p.manifest.catalogueProfile.kind = 'curated-catalogue' }],
  ['unknown contract version', (p) => { p.manifest.catalogueProfile.contractVersion = 2 }],
  ['profile with an extra key', (p) => { p.manifest.catalogueProfile.note = 'x' }],
  ['malformed rules version', (p) => { p.manifest.catalogueProfile.enrichmentRulesVersion = 'orbit classes' }],
  ['source run and profile normalization versions disagree', (p) => { p.manifest.sourceRun.normalizationRulesVersion = 'space-track-gp/2' }],
  ['source run and provider retrieval times disagree', (p) => { p.manifest.sourceRun.retrievedAtUtc = '2026-09-14T00:17:02.000Z' }],
  ['source run without a retrieval start', (p) => { delete p.manifest.sourceRun.retrievalStartedAtUtc }],
  ['source run retrieval start after its completion', (p) => { p.manifest.sourceRun.retrievalStartedAtUtc = '2026-09-14T00:17:01.501Z' }],
  ['source run and provider ids disagree', (p) => { p.manifest.sourceRun.providerId = 'fixture' }],
  ['source run carries record-level provenance', (p) => { p.manifest.sourceRun.createdAtUtc = '2026-09-13T21:04:11Z' }],
  ['automatic manifest lists groups', (p) => { p.manifest.groups = [{ id: 'navigation', label: 'N', purpose: 'P', membership: 'static', selection: 'S', selectedCount: 1, receivedCount: 1, validCount: 1, rejectedCount: 0, fetchedAtUtc: '2026-09-14T00:17:01.500Z' }] }],
  ['summary published count disagrees with totals', (p) => { p.manifest.automaticSummary.publishedCount = 2; p.manifest.automaticSummary.identicalDuplicateCount = 2 }],
  ['summary counts do not add up', (p) => { p.manifest.automaticSummary.identicalDuplicateCount = 0 }],
  ['rejection reasons do not add up', (p) => { p.manifest.automaticSummary.rejectedByReason = { 'not-object': 2 } }],
  ['coverage exceeds the published count', (p) => { p.manifest.automaticSummary.optionalFieldCoverage['object.type'] = 4 }],
  ['summary key carries arbitrary text', (p) => { p.manifest.automaticSummary.optionalFieldErrors = { 'OBJECT NAME WITH SPACES': 1 } }],
  ['index descriptor count disagrees with the published count', (p) => { p.manifest.index.entryCount = 2 }],
  // Index marker and projections.
  ['index without catalogueProfile', (p) => { delete p.index.catalogueProfile }],
  ['index profile with a different enrichment version', (p) => { p.index.catalogueProfile.enrichmentRulesVersion = 'orbit-classes/2' }],
  ['entry without source projection', (p) => { delete entryOf(p, FULL).src }],
  ['entry without derived projection', (p) => { delete entryOf(p, FULL).drv }],
  ['entry with an unknown orbit class code', (p) => { entryOf(p, FULL).drv.o = 'sso' }],
  ['entry whose primary class ignores near-geosynchronous precedence', (p) => { entryOf(p, MINIMAL).drv.o = entryOf(p, MINIMAL).drv.b }],
  ['entry GEO-like without near-geosynchronous', (p) => { entryOf(p, FULL).drv.f = 16 }],
  ['entry with flag bits outside the contract', (p) => { entryOf(p, FULL).drv.f = 32 }],
  ['entry type category without source type', (p) => { delete entryOf(p, FULL).src.t }],
  ['entry source projection carries a run-level key', (p) => { entryOf(p, FULL).src.retrievedAtUtc = '2026-09-14T00:17:01.500Z' }],
  ['derived projection decoded as source', (p) => { entryOf(p, FULL).src = { ...entryOf(p, FULL).drv } }],
  ['source projection decoded as derived', (p) => { entryOf(p, FULL).drv = { ...entryOf(p, FULL).src } }],
  ['entry with a non-normalized launch date', (p) => { entryOf(p, FULL).src.l = '1998-11-20T00:00:00Z' }],
  ['automatic entry lists groups', (p) => { entryOf(p, FULL).groups = ['navigation'] }],
  // Shard marker and record blocks.
  ['shard without catalogueProfile', (p) => { delete p.shards[1].catalogueProfile }],
  ['shard profile with a different normalization version', (p) => { p.shards[0].catalogueProfile.normalizationRulesVersion = 'space-track-gp/9' }],
  ['record without source block', (p) => { delete recordOf(p, FULL).source }],
  ['record without derived block', (p) => { delete recordOf(p, ECCENTRIC).derived }],
  ['record derived rules version disagrees with the profile', (p) => { recordOf(p, FULL).derived.rulesVersion = 'orbit-classes/2' }],
  ['record carries an external enrichment block', (p) => { recordOf(p, FULL).external = { esa: { sourceId: 'discos' } } }],
  ['source and derived blocks swapped', (p) => { const record = recordOf(p, FULL); [record.source, record.derived] = [record.derived, record.source] }],
  ['source block carries run-level query description', (p) => { recordOf(p, FULL).source.queryDescription = 'GP' }],
  ['record repeats the uniform run originator', (p) => { recordOf(p, FULL).source.recordProvenance.originator = '18 SPCS' }],
  ['source designator disagrees with OBJECT_ID', (p) => { recordOf(p, FULL).source.internationalDesignator = '2026-901A' }],
  ['launch year disagrees with launch date', (p) => { recordOf(p, FULL).derived.launchYear = 1999 }],
  ['launch year without a launch date', (p) => { recordOf(p, MINIMAL).derived.launchYear = 2020 }],
  ['altitude band disagrees with published altitudes', (p) => { recordOf(p, FULL).derived.orbit.altitudeBand = 'medium-earth'; recordOf(p, FULL).derived.orbit.primaryOrbitClass = 'medium-earth' }],
  ['orbit block with an unexpected key', (p) => { recordOf(p, FULL).derived.orbit.inclinationDeg = 51.64 }],
  ['record provenance disagrees with the source run', (p) => { recordOf(p, FULL).provenance.providerRetrievedAtUtc = '2026-09-14T00:17:02.000Z' }],
  ['unknown object type category', (p) => { recordOf(p, FULL).source.object.typeCategory = 'station' }],
  ['empty record provenance block', (p) => { recordOf(p, MINIMAL).source.recordProvenance = {} }],
  ['source summary value that is not a number', (p) => { recordOf(p, FULL).source.gp.sourcePeriodMinutes = '92.953' }],
  // Mixed parts.
  ['automatic manifest with a legacy index', legacyIndex],
  ['legacy manifest with an automatic index', legacyManifest],
]

const legacyMutations: readonly Mutation[] = [
  ['legacy manifest with a source run only', (p) => { p.manifest.sourceRun = base.manifest.sourceRun }],
  ['legacy manifest with a summary only', (p) => { p.manifest.automaticSummary = base.manifest.automaticSummary }],
  ['legacy index with a catalogue profile', (p) => { p.index.catalogueProfile = base.index.catalogueProfile }],
  ['legacy index entry with a source projection', (p) => { p.index.entries[0].src = {} }],
  ['legacy index entry with a derived projection', (p) => { p.index.entries[0].drv = base.index.entries[0].drv }],
  ['legacy shard with a catalogue profile', (p) => { p.shards[7].catalogueProfile = base.shards[0].catalogueProfile }],
  ['legacy record with a source block', (p) => { p.shards[7].records['25544'].source = { object: {}, gp: {} } }],
  ['legacy record with a derived block', (p) => { p.shards[7].records['25544'].derived = recordOf(base, FULL).derived }],
  ['legacy record with an external block', (p) => { p.shards[7].records['25544'].external = {} }],
]

describe('malformed partial automatic data', () => {
  it.each(automaticMutations)('rejects %s', (_description, mutate) => {
    const parts = automatic()
    mutate(parts)
    expect(() => decodeAll(parts)).toThrow(MalformedCatalogueProfileError)
  })

  it.each(legacyMutations)('rejects %s', (_description, mutate) => {
    const parts = legacyFixture()
    mutate(parts)
    expect(() => decodeAll(parts)).toThrow(MalformedCatalogueProfileError)
  })

  it('reports why without echoing record content', () => {
    const parts = automatic()
    recordOf(parts, FULL).source.object.type = 'PAYLOAD'
    recordOf(parts, FULL).source.queryDescription = 'SECRET-LOOKING MARKER'
    expect(() => decodeAll(parts)).toThrow(/^Malformed automatic catalogue data: a record source block is missing or invalid\.$/)
  })

  it('detects an index entry that is valid alone but disagrees with its shard record', () => {
    const parts = automatic()
    entryOf(parts, FULL).src.c = 'US'
    const { index, shards } = decodeAll(parts)
    const entry = index.entries.find((candidate) => candidate.catalogId === FULL)!
    expect(indexEntryMatchesRecord(entry, shards[entry.shard].records[FULL])).toBe(false)
  })

  it('classifies a manifest by its marker, not by decoder tolerance', () => {
    const manifest: CatalogueManifestV1 = decodeCatalogueManifest(automatic().manifest)
    expect(catalogueProfileMode(manifest)).toBe('automatic')
    const legacy = automatic(); legacyManifest(legacy); legacy.manifest.groups = []
    expect(() => decodeCatalogueManifest(legacy.manifest)).not.toThrow()
    expect(catalogueProfileMode(decodeCatalogueManifest(legacy.manifest))).toBe('legacy')
  })
})
