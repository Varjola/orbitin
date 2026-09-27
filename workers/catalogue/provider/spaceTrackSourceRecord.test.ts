import { describe, expect, it } from 'vitest'
import { createSpaceTrackDialectSweepNormalizer, normalizeSpaceTrackGpRecords, SPACE_TRACK_NORMALIZATION_RULES_VERSION } from './spaceTrackSourceRecord.ts'
import { FixtureProvider } from './fixture.ts'
import { SPACE_TRACK_GP_SWEEP_DESCRIPTOR } from './spaceTrack.ts'

const CONTEXT = {
  providerId: 'space-track',
  sourceAuthority: 'USSPACECOM / 18th Space Defense Squadron',
  queryDescription: 'GP class; decay date null; epoch newer than 10 days; ordered by catalogue id',
  retrievalStartedAtUtc: '2026-09-13T07:58:51.000Z',
  retrievedAtUtc: '2026-09-13T14:58:54.460Z',
}

/** Synthetic Space-Track GP JSON record carrying every documented key. */
function wire(catalogId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    CCSDS_OMM_VERS: '3.0', COMMENT: 'GENERATED VIA SPACE-TRACK.ORG API', CREATION_DATE: '2026-09-13T06:26:37', ORIGINATOR: '18 SPCS',
    OBJECT_NAME: ` TEST OBJECT ${catalogId} `, OBJECT_ID: '2020-001A', CENTER_NAME: 'EARTH', REF_FRAME: 'TEME', TIME_SYSTEM: 'UTC', MEAN_ELEMENT_THEORY: 'SGP4',
    EPOCH: '2026-09-12T22:41:08.689632', MEAN_MOTION: '15.49180977', ECCENTRICITY: '0.00016340', INCLINATION: '51.6446', RA_OF_ASC_NODE: '60.1099',
    ARG_OF_PERICENTER: '35.3131', MEAN_ANOMALY: '60.2620', EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: catalogId,
    ELEMENT_SET_NO: '999', REV_AT_EPOCH: '47210', BSTAR: '0.00001654', MEAN_MOTION_DOT: '0.00000915', MEAN_MOTION_DDOT: '0',
    SEMIMAJOR_AXIS: '6795.456', PERIOD: '92.953', APOAPSIS: '418.432', PERIAPSIS: '416.211', OBJECT_TYPE: 'PAYLOAD', RCS_SIZE: 'LARGE',
    COUNTRY_CODE: 'ISS', LAUNCH_DATE: '1998-11-20', SITE: 'TTMTR', DECAY_DATE: null, FILE: '5012345', GP_ID: '312345678',
    TLE_LINE0: '0 TLE LINE ZERO MARKER', TLE_LINE1: '1 TLE LINE ONE MARKER', TLE_LINE2: '2 TLE LINE TWO MARKER',
    ...overrides,
  }
}

function ok(result: ReturnType<typeof normalizeSpaceTrackGpRecords>) {
  if (!result.ok) throw new Error(`expected success, got ${result.failure}`)
  return result
}

describe('Space-Track GP normalization', () => {
  it('maps every allowlisted field and emits run-level provenance once', () => {
    const { batch, report } = ok(normalizeSpaceTrackGpRecords([wire('25544', { OBJECT_ID: '1998-067A' })], CONTEXT))
    expect(batch.run).toEqual({
      providerId: 'space-track', sourceAuthority: CONTEXT.sourceAuthority, providerRecordClass: 'gp', wireFormat: 'omm-keyed-json',
      queryDescription: CONTEXT.queryDescription, retrievalStartedAtUtc: CONTEXT.retrievalStartedAtUtc, retrievedAtUtc: CONTEXT.retrievedAtUtc, ommVersion: '3.0', originator: '18 SPCS',
      normalizationRulesVersion: SPACE_TRACK_NORMALIZATION_RULES_VERSION,
    })
    const [record] = batch.records
    expect(record.identity).toEqual({ catalogId: '25544', internationalDesignator: '1998-067A', providerName: 'TEST OBJECT 25544', classification: 'U' })
    expect(record.object).toEqual({ type: 'PAYLOAD', typeCategory: 'payload', countryOrSourceCode: 'ISS', launchDate: '1998-11-20', launchSiteCode: 'TTMTR', rcsSizeCategory: 'LARGE' })
    expect(record.gp).toMatchObject({ sourceSemimajorAxisKm: 6795.456, sourcePeriodMinutes: 92.953, sourceApogeeAltitudeKm: 418.432, sourcePerigeeAltitudeKm: 416.211 })
    expect(record.gp.definition.meanElements.catalogId).toBe('25544')
    // Only genuinely record-specific provenance stays on the record.
    expect(record.recordProvenance).toEqual({ createdAtUtc: '2026-09-13T06:26:37Z' })
    expect(report).toMatchObject({ receivedCount: 1, publishedCount: 1, rejectedCount: 0, identicalDuplicateCount: 0 })
  })

  it('normalizes numeric strings, numbers, bare epochs, dates and nulls deterministically', () => {
    const asStrings = ok(normalizeSpaceTrackGpRecords([wire('100')], CONTEXT)).batch
    const asNumbers = ok(normalizeSpaceTrackGpRecords([wire('100', { MEAN_MOTION: 15.49180977, ECCENTRICITY: 0.0001634, INCLINATION: 51.6446, SEMIMAJOR_AXIS: 6795.456, NORAD_CAT_ID: 100, EPOCH: '2026-09-12T22:41:08.689632Z' })], CONTEXT)).batch
    expect(JSON.stringify(asNumbers)).toBe(JSON.stringify(asStrings))
    const nulls = ok(normalizeSpaceTrackGpRecords([wire('100', { COUNTRY_CODE: null, LAUNCH_DATE: null, SITE: null, RCS_SIZE: null, APOAPSIS: '' })], CONTEXT)).batch.records[0]
    expect(nulls.object).toEqual({ type: 'PAYLOAD', typeCategory: 'payload' })
    expect('sourceApogeeAltitudeKm' in nulls.gp).toBe(false)
    expect(JSON.stringify(nulls)).not.toMatch(/null|""|undefined/)
  })

  it('keeps missing optional fields absent and rejects missing required GP fields', () => {
    const minimal = wire('200')
    for (const key of ['OBJECT_ID', 'OBJECT_TYPE', 'COUNTRY_CODE', 'LAUNCH_DATE', 'SITE', 'DECAY_DATE', 'RCS_SIZE', 'SEMIMAJOR_AXIS', 'PERIOD', 'APOAPSIS', 'PERIAPSIS', 'CREATION_DATE', 'ORIGINATOR', 'CCSDS_OMM_VERS', 'CLASSIFICATION_TYPE']) delete minimal[key]
    const { batch } = ok(normalizeSpaceTrackGpRecords([minimal], CONTEXT))
    expect(batch.records[0].identity).toEqual({ catalogId: '200', providerName: 'TEST OBJECT 200' })
    expect(batch.records[0].object).toEqual({})
    expect(batch.records[0].recordProvenance).toBeUndefined()
    expect('ommVersion' in batch.run || 'originator' in batch.run).toBe(false)

    const missingEpoch = wire('201'); delete missingEpoch.EPOCH
    const result = ok(normalizeSpaceTrackGpRecords([missingEpoch, wire('202', { MEAN_MOTION: 'fast' }), wire('203', { OBJECT_NAME: '   ' }), 'text'], CONTEXT))
    expect(result.batch.records).toHaveLength(0)
    expect(result.report.rejectedByReason).toEqual({ 'blank-name': 1, 'not-object': 1, 'omm-missing': 1, 'omm-number': 1 })
  })

  it('preserves unknown codes and omits malformed optional values without rejecting the record', () => {
    const { batch, report } = ok(normalizeSpaceTrackGpRecords([wire('300', { OBJECT_TYPE: 'NEW CATEGORY', COUNTRY_CODE: 'ZZZZ', SITE: 'NEWSITE', RCS_SIZE: 'HUGE', LAUNCH_DATE: '2026-13-01', OBJECT_ID: 'NOT-A-COSPAR', PERIOD: 'n/a', CREATION_DATE: 'yesterday' })], CONTEXT))
    const [record] = batch.records
    expect(record.object).toEqual({ type: 'NEW CATEGORY', typeCategory: 'unknown', countryOrSourceCode: 'ZZZZ', launchSiteCode: 'NEWSITE', rcsSizeCategory: 'HUGE' })
    expect(record.identity.internationalDesignator).toBeUndefined()
    // The OMM definition keeps the provider value it has always published.
    expect(record.gp.definition.internationalDesignator).toBe('NOT-A-COSPAR')
    expect('sourcePeriodMinutes' in record.gp).toBe(false)
    expect(record.recordProvenance).toBeUndefined()
    expect(report.optionalFieldErrors).toEqual({ CREATION_DATE: 1, LAUNCH_DATE: 1, OBJECT_ID: 1, PERIOD: 1 })
  })

  it('maps provider object types to a search category, keeping unrecognized codes as unknown', () => {
    const types = ['PAYLOAD', 'ROCKET BODY', 'DEBRIS', 'UNKNOWN', 'TBA', 'constructor', 'payload']
    const { batch } = ok(normalizeSpaceTrackGpRecords(types.map((type, position) => wire(String(position + 1), { OBJECT_TYPE: type })), CONTEXT))
    expect(batch.records.map((record) => [record.object.type, record.object.typeCategory])).toEqual([
      ['PAYLOAD', 'payload'], ['ROCKET BODY', 'rocket-body'], ['DEBRIS', 'debris'], ['UNKNOWN', 'unknown'], ['TBA', 'unknown'], ['constructor', 'unknown'], ['payload', 'unknown'],
    ])
  })

  it('never lets unread or unknown provider keys into the domain', () => {
    const { batch } = ok(normalizeSpaceTrackGpRecords([wire('400', { FUTURE_FIELD: 'LEAK-MARKER-FUTURE' })], CONTEXT))
    const text = JSON.stringify(batch)
    for (const marker of ['LEAK-MARKER-FUTURE', 'TLE LINE', 'GENERATED VIA', '5012345', '312345678', 'FUTURE_FIELD', 'NORAD_CAT_ID', 'OBJECT_TYPE']) expect(text).not.toContain(marker)
  })

  it('is independent of provider record order and raw key order', () => {
    const records = [wire('5'), wire('100460', { OBJECT_ID: '2024-001B' }), wire('25544', { OBJECT_ID: '1998-067A' }), wire('99', { OBJECT_ID: '1970-001A' })]
    const reversedKeys = records.map((record) => Object.fromEntries(Object.entries(record).reverse())).reverse()
    const a = ok(normalizeSpaceTrackGpRecords(records, CONTEXT))
    const b = ok(normalizeSpaceTrackGpRecords(reversedKeys, CONTEXT))
    expect(JSON.stringify(b.batch)).toBe(JSON.stringify(a.batch))
    expect(a.batch.records.map((record) => record.identity.catalogId)).toEqual(['5', '99', '25544', '100460'])
  })

  it('deduplicates identical records, refuses conflicting ones and surfaces shared designators', () => {
    const shared = ok(normalizeSpaceTrackGpRecords([wire('10', { OBJECT_ID: '2001-001A' }), wire('10', { OBJECT_ID: '2001-001A' }), wire('11', { OBJECT_ID: '2001-001A' }), wire('12', { OBJECT_ID: '2002-002A' })], CONTEXT))
    expect(shared.batch.records.map((record) => record.identity.catalogId)).toEqual(['10', '11', '12'])
    expect(shared.report.identicalDuplicateCount).toBe(1)
    expect(shared.report.sharedInternationalDesignators).toEqual({ designatorCount: 1, catalogIds: ['10', '11'] })

    const conflict = normalizeSpaceTrackGpRecords([wire('10'), wire('10', { CREATION_DATE: '2026-09-13T07:00:00' }), wire('20')], CONTEXT)
    expect(conflict).toMatchObject({ ok: false, failure: 'conflicting-duplicate-catalog-id', catalogIds: ['10'], report: { publishedCount: 0 } })
    expect('batch' in conflict).toBe(false)
  })

  it('refuses a run with more than one OMM version and keeps a varying originator per record', () => {
    expect(normalizeSpaceTrackGpRecords([wire('1'), wire('2', { CCSDS_OMM_VERS: '2.0' })], CONTEXT)).toMatchObject({ ok: false, failure: 'mixed-omm-version' })
    expect(normalizeSpaceTrackGpRecords([wire('1'), wire('2', { CCSDS_OMM_VERS: null })], CONTEXT)).toMatchObject({ ok: false, failure: 'mixed-omm-version' })

    const { batch } = ok(normalizeSpaceTrackGpRecords([wire('1'), wire('2', { ORIGINATOR: 'OTHER' })], CONTEXT))
    expect('originator' in batch.run).toBe(false)
    expect(batch.records.map((record) => record.recordProvenance?.originator)).toEqual(['18 SPCS', 'OTHER'])
  })
})

describe('curated supplement normalization', () => {
  const RETRIEVAL = { retrievalStartedAtUtc: CONTEXT.retrievalStartedAtUtc, retrievedAtUtc: CONTEXT.retrievedAtUtc }
  const encode = (records: readonly Record<string, unknown>[]) => new TextEncoder().encode(JSON.stringify(records))
  const sweepPage = encode([wire('100'), wire('200'), wire('300')])

  it('keeps the sweep record for a curated id the sweep holds, fills the rest and ignores ids that are not curated', () => {
    const normalizer = createSpaceTrackDialectSweepNormalizer(SPACE_TRACK_GP_SWEEP_DESCRIPTOR)
    normalizer.addPage(sweepPage, '0', 10)
    const contribution = normalizer.addSupplement(encode([wire('200', { OBJECT_NAME: 'SUPPLEMENT 200' }), wire('250'), wire('400'), wire('500', { MEAN_MOTION: 'fast' })]), new Set(['200', '250', '500']))
    expect(contribution).toEqual({ added: 2, alreadyInSweep: 1, notCurated: 1 })
    const result = normalizer.finish({ ...RETRIEVAL, supplemented: true })
    if (!result.ok) throw new Error(result.failure)
    expect(result.batch.records.map((record) => record.identity.catalogId)).toEqual(['100', '200', '250', '300'])
    expect(result.batch.records[1].identity.providerName).toBe('TEST OBJECT 200')
    // The sweep's own id is neither a duplicate nor a conflict; a malformed
    // supplement record is an ordinary counted rejection.
    expect(result.report).toMatchObject({ receivedCount: 5, publishedCount: 4, identicalDuplicateCount: 0, rejectedCount: 1, rejectedByReason: { 'omm-number': 1 } })
    expect(result.batch.run.queryDescription).toBe(SPACE_TRACK_GP_SWEEP_DESCRIPTOR.queryDescription + SPACE_TRACK_GP_SWEEP_DESCRIPTOR.supplementDescription)
  })

  it('describes the run exactly as before the curated supplement when it is not supplemented', () => {
    const normalizer = createSpaceTrackDialectSweepNormalizer(SPACE_TRACK_GP_SWEEP_DESCRIPTOR)
    normalizer.addPage(sweepPage, '0', 10)
    const result = normalizer.finish({ ...RETRIEVAL, supplemented: false })
    expect(result.ok && result.batch.run.queryDescription).toBe(SPACE_TRACK_GP_SWEEP_DESCRIPTOR.queryDescription)
  })

  it('refuses a structurally broken supplement and a second or out-of-order call', () => {
    for (const body of ['{}', JSON.stringify([wire('300'), wire('200')]), JSON.stringify([{ NORAD_CAT_ID: 'x' }])]) {
      const normalizer = createSpaceTrackDialectSweepNormalizer(SPACE_TRACK_GP_SWEEP_DESCRIPTOR)
      normalizer.addPage(sweepPage, '0', 10)
      expect(() => normalizer.addSupplement(new TextEncoder().encode(body), new Set(['200', '300'])), body).toThrow('structural check')
    }
    const normalizer = createSpaceTrackDialectSweepNormalizer(SPACE_TRACK_GP_SWEEP_DESCRIPTOR)
    normalizer.addSupplement(encode([]), new Set(['1']))
    expect(() => normalizer.addSupplement(encode([]), new Set(['1']))).toThrow('already added')
    expect(() => normalizer.addPage(sweepPage, '0', 10)).toThrow('cannot follow')
  })

  it('lets a supplement record break whole-run normalization like any record, for the sweep to fall back', () => {
    const normalizer = createSpaceTrackDialectSweepNormalizer(SPACE_TRACK_GP_SWEEP_DESCRIPTOR)
    normalizer.addPage(sweepPage, '0', 10)
    normalizer.addSupplement(encode([wire('250', { CCSDS_OMM_VERS: '2.0' })]), new Set(['250']))
    expect(normalizer.finish({ ...RETRIEVAL, supplemented: true })).toMatchObject({ ok: false, failure: 'mixed-omm-version' })
  })

  it('has the fixture provider answer the same shape: one synthetic record per requested id, no upstream traffic', async () => {
    const result = await new FixtureProvider().fetchCuratedGp({ catalogIds: ['5', '25544', '100460'], maxEpochAgeDays: 30, nowUtc: '2026-09-27T01:17:00Z' })
    expect(result).toMatchObject({ upstreamRequestCount: 0, recordCount: 3 })
    const normalizer = new FixtureProvider({ sweepRecordCount: 10 }).createSweepNormalizer()
    normalizer.addPage(encode((JSON.parse(new TextDecoder().decode((await new FixtureProvider({ sweepRecordCount: 10 }).fetchGpPage({ afterCatalogId: '0', limit: 20, nowUtc: '2026-09-27T01:17:00Z' })).body)))), '0', 20)
    expect(normalizer.addSupplement(result.body, new Set(['5', '25544', '100460']))).toEqual({ added: 2, alreadyInSweep: 1, notCurated: 0 })
    await expect(new FixtureProvider().fetchCuratedGp({ catalogIds: [], maxEpochAgeDays: 30, nowUtc: '2026-09-27T01:17:00Z' })).rejects.toMatchObject({ kind: 'configuration' })
  })
})
