import { describe, expect, it } from 'vitest'
import {
  ageSinceLaunch, CATALOGUE_ENRICHMENT_RULES_VERSION, deriveCatalogueMetadata, elementAgeSeconds,
  type CatalogueEnrichmentInput, type CatalogueOrbitAnalysis,
} from './catalogueEnrichment.ts'

const LEO: CatalogueOrbitAnalysis = { recoveredPeriodMinutes: 92.9, semimajorAxisKm: 6795, perigeeAltitudeKm: 415, apogeeAltitudeKm: 420, regime: 'near-earth' }
const GEO: CatalogueOrbitAnalysis = { recoveredPeriodMinutes: 1436.068, semimajorAxisKm: 42164, perigeeAltitudeKm: 35780, apogeeAltitudeKm: 35790, regime: 'deep-space' }

function derive(overrides: Partial<Omit<CatalogueEnrichmentInput, 'analysis'>> = {}, analysis: Partial<CatalogueOrbitAnalysis> = {}, base = LEO) {
  return deriveCatalogueMetadata({ eccentricity: 0.0005, inclinationDeg: 51.6, ...overrides, analysis: { ...base, ...analysis } })
}

describe('deterministic catalogue enrichment', () => {
  it('publishes the SGP4 analysis values, not provider summaries', () => {
    const derived = derive({}, { recoveredPeriodMinutes: 92.123456789, semimajorAxisKm: 6795.12345, perigeeAltitudeKm: 414.9996, apogeeAltitudeKm: 420.0004 })
    expect(derived.rulesVersion).toBe(CATALOGUE_ENRICHMENT_RULES_VERSION)
    expect(derived.orbit).toMatchObject({ basis: 'sgp4-initialized-mean-elements', recoveredPeriodMinutes: 92.12346, semimajorAxisKm: 6795.123, perigeeAltitudeKm: 415, apogeeAltitudeKm: 420, sgp4Regime: 'near-earth' })
  })

  it.each([
    ['LEO apogee just below', 400, 1999.999, 'low-earth'],
    ['LEO apogee equal', 400, 2000, 'low-earth'],
    ['LEO apogee just above', 400, 2000.001, 'crossing-bands'],
    ['MEO perigee equal', 2000, 20000, 'crossing-bands'],
    ['MEO perigee just above', 2000.001, 20000, 'medium-earth'],
    ['MEO apogee just below GEO', 20000, 35785.999, 'medium-earth'],
    ['MEO apogee equal GEO', 20000, 35786, 'crossing-bands'],
    ['high perigee just below', 35785.999, 36000, 'crossing-bands'],
    ['high perigee equal', 35786, 36000, 'high-earth'],
    ['high perigee just above', 35786.001, 36000, 'high-earth'],
  ])('altitude band: %s', (_label, perigeeAltitudeKm, apogeeAltitudeKm, band) => {
    expect(derive({}, { perigeeAltitudeKm, apogeeAltitudeKm }).orbit.altitudeBand).toBe(band)
  })

  it.each([[0, false], [0.2499999, false], [0.25, true], [0.2500001, true], [0.999, true]])('eccentricity %s is high: %s', (eccentricity, expected) => {
    expect(derive({ eccentricity }).orbit.highEccentricity).toBe(expected)
  })

  it.each([[79.999, false], [80, true], [90, true], [100, true], [100.001, false]])('inclination %s is near-polar: %s', (inclinationDeg, expected) => {
    expect(derive({ inclinationDeg }).orbit.nearPolar).toBe(expected)
  })

  it.each([[0, true], [10, true], [10.001, false], [169.999, false], [170, true], [180, true]])('inclination %s is near-equatorial: %s', (inclinationDeg, expected) => {
    expect(derive({ inclinationDeg }).orbit.nearEquatorial).toBe(expected)
  })

  it.each([
    ['period just below tolerance', 1421.70731, false],
    ['period at lower tolerance', 1421.70732, true],
    ['period at reference', 1436.068, true],
    ['period at upper tolerance', 1450.42868, true],
    ['period just above tolerance', 1450.42869, false],
  ])('near-geosynchronous: %s', (_label, recoveredPeriodMinutes, expected) => {
    expect(derive({ eccentricity: 0, inclinationDeg: 0 }, { recoveredPeriodMinutes }, GEO).orbit).toMatchObject({ nearGeosynchronous: expected, geoLike: expected })
  })

  it('tests GEO-like eccentricity and equator distance independently of period', () => {
    const geo = (eccentricity: number, inclinationDeg: number, recoveredPeriodMinutes = 1436.068) => derive({ eccentricity, inclinationDeg }, { recoveredPeriodMinutes }, GEO).orbit.geoLike
    expect([geo(0.01, 0), geo(0.0100001, 0)]).toEqual([true, false])
    expect([geo(0, 1), geo(0, 1.001), geo(0, 179), geo(0, 178.999)]).toEqual([true, false, true, false])
    expect(geo(0, 0, 1300)).toBe(false)
  })

  it('applies primary-class precedence explicitly', () => {
    expect(derive({ eccentricity: 0.3, inclinationDeg: 5 }, {}, GEO).orbit).toMatchObject({ primaryOrbitClass: 'geosynchronous', highEccentricity: true, geoLike: false })
    const molniya = derive({ eccentricity: 0.74, inclinationDeg: 63.4 }, { recoveredPeriodMinutes: 717.7, perigeeAltitudeKm: 600, apogeeAltitudeKm: 39700, regime: 'deep-space' })
    expect(molniya.orbit).toMatchObject({ primaryOrbitClass: 'highly-elliptical', altitudeBand: 'crossing-bands' })
    expect(derive().orbit.primaryOrbitClass).toBe('low-earth')
  })

  it('computes launch age at date-only precision against an explicit reference', () => {
    const at = (iso: string) => Date.parse(iso) / 1000
    expect(ageSinceLaunch('2026-09-13', at('2026-09-12T23:59:59Z'))).toEqual({ kind: 'not-yet-launched' })
    expect(ageSinceLaunch('2026-09-13', at('2026-09-13T00:00:00Z'))).toEqual({ kind: 'elapsed', approximateDays: 0 })
    expect(ageSinceLaunch('2026-09-13', at('2026-09-14T12:00:00Z'))).toEqual({ kind: 'elapsed', approximateDays: 1.5 })
    expect(elementAgeSeconds(at('2026-09-13T00:00:00Z'), at('2026-09-12T00:00:00Z'))).toBe(-86_400)
    expect(elementAgeSeconds(at('2026-09-12T00:00:00Z'), at('2026-09-13T00:00:00Z'))).toBe(86_400)
    expect(() => ageSinceLaunch('2026-02-30', 0)).toThrow()
  })

  it('publishes launch year only when a launch date exists', () => {
    expect(derive({ launchDate: '1998-11-20' }).launchYear).toBe(1998)
    expect('launchYear' in derive()).toBe(false)
  })

  it('gives byte-identical output across input key order and process timezone', () => {
    const input: CatalogueEnrichmentInput = { eccentricity: 0.0005, inclinationDeg: 97.4, launchDate: '2020-01-01', analysis: LEO }
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries({ ...input, analysis: Object.fromEntries(Object.entries(LEO).reverse()) }).reverse()))) as CatalogueEnrichmentInput
    const before = JSON.stringify(deriveCatalogueMetadata(input))
    // Vitest runs under Node; the browser tsconfig carries no Node types.
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
    const originalTimezone = env.TZ
    try {
      env.TZ = 'Pacific/Kiritimati'
      expect(JSON.stringify(deriveCatalogueMetadata(reordered))).toBe(before)
    } finally {
      if (originalTimezone === undefined) delete env.TZ
      else env.TZ = originalTimezone
    }
  })
})
