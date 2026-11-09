import { describe, expect, it } from 'vitest'
import { degToRad } from '../../core/angles.ts'
import { addSeconds } from '../../core/time.ts'
import { crossVec3, dotVec3, lengthVec3, normalizeVec3, subtractVec3 } from '../../core/vec3.ts'
import { FEATURED_PICKS } from '../../data/featuredPicks.ts'
import { parseOmmRecord } from '../../data/omm.ts'
import { J2SecularPropagator } from '../../orbital/j2SecularPropagator.ts'
import { analyzeSgp4ForCatalogue } from '../../orbital/sgp4CatalogueAnalysis.ts'
import { Sgp4Propagator } from '../../orbital/sgp4Propagator.ts'
import { ROUTE_EXAMPLES } from './routeSetup.ts'
import { catalogueSatellite, isRealPairId, ROUTE_REAL_PAIRS, ROUTE_TRY_THESE, routeRealPair, type RouteSatelliteResult } from './routeSources.ts'

const START = { unixSeconds: Date.UTC(2026, 10, 7, 12) / 1000 }

function elements(fields: { meanMotion: number; eccentricity: number; inclinationDeg: number; raanDeg: number; argOfPerigeeDeg?: number; meanAnomalyDeg?: number; bstar?: number }) {
  const parsed = parseOmmRecord({
    OBJECT_NAME: 'TEST OBJECT', NORAD_CAT_ID: '99001', EPOCH: '2026-11-05T12:00:00.000000', EPHEMERIS_TYPE: '0',
    MEAN_MOTION: String(fields.meanMotion), ECCENTRICITY: String(fields.eccentricity), INCLINATION: String(fields.inclinationDeg), RA_OF_ASC_NODE: String(fields.raanDeg),
    ARG_OF_PERICENTER: String(fields.argOfPerigeeDeg ?? 60), MEAN_ANOMALY: String(fields.meanAnomalyDeg ?? 10), BSTAR: String(fields.bstar ?? 0), MEAN_MOTION_DOT: '0', MEAN_MOTION_DDOT: '0',
  })
  if (!parsed.ok) throw new Error(parsed.errors.map((error) => error.message).join(' '))
  return parsed.definition.meanElements
}

/** Kinds of orbit the catalogue holds, in round numbers. */
const KINDS = {
  stationLike: elements({ meanMotion: 15.5, eccentricity: 0.0004, inclinationDeg: 51.6, raanDeg: 40 }),
  sunSynchronous: elements({ meanMotion: 14.57, eccentricity: 0.0001, inclinationDeg: 98.2, raanDeg: 330, argOfPerigeeDeg: 90 }),
  geostationary: elements({ meanMotion: 1.00272, eccentricity: 0.0002, inclinationDeg: 0.05, raanDeg: 70, argOfPerigeeDeg: 0 }),
  molniya: elements({ meanMotion: 2.00562, eccentricity: 0.676, inclinationDeg: 63.5, raanDeg: 250, argOfPerigeeDeg: 270 }),
} as const

function satelliteOf(result: RouteSatelliteResult) {
  if (!result.ok) throw new Error(`Refused: ${result.refusal}`)
  return result.satellite
}

describe('catalogueSatellite', () => {
  for (const [kind, source] of Object.entries(KINDS)) {
    it(`starts a ${kind} object where SGP4 shows it, in SGP4's plane`, () => {
      const satellite = satelliteOf(catalogueSatellite('x', source, START))
      const model = new J2SecularPropagator(satellite.geometry, satellite.phase).stateAt(START)
      const shown = new Sgp4Propagator(source).stateAt(START)
      // Mean and osculating radius differ by SGP4's short-period terms: a few km.
      expect(lengthVec3(subtractVec3(model.positionProjectInertialKm, shown.positionProjectInertialKm))).toBeLessThan(10)
      const planeOf = (state: typeof shown) => normalizeVec3(crossVec3(state.positionProjectInertialKm, state.velocityProjectInertialKmPerSecond))
      expect(Math.acos(Math.min(1, dotVec3(planeOf(model), planeOf(shown))))).toBeLessThan(degToRad(0.01))
    })
  }

  it('takes size from SGP4’s averaged elements, so it keeps pace with SGP4 for days', () => {
    const satellite = satelliteOf(catalogueSatellite('x', KINDS.stationLike, START))
    expect(satellite.geometry.semiMajorAxisKm).toBeCloseTo(analyzeSgp4ForCatalogue(KINDS.stationLike).semimajorAxisKm, 0)
    const model = new J2SecularPropagator(satellite.geometry, satellite.phase)
    const sgp4 = new Sgp4Propagator(KINDS.stationLike)
    for (const hours of [1, 6, 24, 72]) {
      const at = addSeconds(START, hours * 3600)
      // An osculating start drifts about 100 km an orbit; this stays within the short-period terms.
      expect(lengthVec3(subtractVec3(model.stateAt(at).positionProjectInertialKm, sgp4.stateAt(at).positionProjectInertialKm))).toBeLessThan(30)
    }
  })

  it('refuses an orbit outside the model’s limits, and one SGP4 cannot propagate', () => {
    expect(catalogueSatellite('x', elements({ meanMotion: 16.4, eccentricity: 0.0004, inclinationDeg: 51.6, raanDeg: 0 }), START)).toEqual({ ok: false, refusal: 'tooLow' })
    expect(catalogueSatellite('x', elements({ meanMotion: 0.2, eccentricity: 0.0004, inclinationDeg: 5, raanDeg: 0 }), START)).toEqual({ ok: false, refusal: 'tooHigh' })
    // Heavy drag over two days takes it down.
    expect(catalogueSatellite('x', elements({ meanMotion: 16.2, eccentricity: 0.001, inclinationDeg: 51.6, raanDeg: 0, bstar: 0.05 }), START)).toEqual({ ok: false, refusal: 'noElements' })
  })
})

describe('Try these', () => {
  it('offers every example and real pair once', () => {
    const ids = [...ROUTE_EXAMPLES.map((example) => example.id), ...ROUTE_REAL_PAIRS.map((pair) => pair.id)]
    expect([...ROUTE_TRY_THESE].sort()).toEqual([...ids].sort())
    expect(ROUTE_TRY_THESE.filter(isRealPairId)).toEqual(['hubbleToIss', 'issToTiangong'])
  })

  it('names real pairs by the featured picks’ catalogue ids', () => {
    const id = (pick: string) => FEATURED_PICKS.find((candidate) => candidate.id === pick)!.catalogId
    expect(routeRealPair('hubbleToIss')).toMatchObject({ ownCatalogId: id('hubble'), targetCatalogId: id('iss') })
    expect(routeRealPair('issToTiangong')).toMatchObject({ ownCatalogId: id('iss'), targetCatalogId: id('tiangong') })
    expect(() => routeRealPair('nowhere' as never)).toThrow()
  })
})
