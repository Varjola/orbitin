/** Deterministic catalogue enrichment.
 *
 * Pure rules over already-normalized source values and one initialized SGP4
 * analysis. No provider vocabulary, wall clock, locale, name or LLM reaches
 * these functions. These are Orbitin discovery rules, not
 * provider claims or legal definitions.
 *
 * Published numeric quantities are rounded (kilometres to 0.001 km, minutes to
 * 0.00001 min) and every classification is computed from those published
 * values, so each label can be reproduced from the numbers beside it. The SGP4
 * regime is the one exception: it is the initialized record's own propagation
 * method, not a threshold on the rounded period. */

export const CATALOGUE_ENRICHMENT_RULES_VERSION = 'orbit-classes/1'

export const LEO_MAX_APOGEE_KM = 2_000
export const GEO_REFERENCE_ALTITUDE_KM = 35_786
export const GEOSYNCHRONOUS_PERIOD_MINUTES = 1_436.068
export const GEOSYNCHRONOUS_PERIOD_TOLERANCE_FRACTION = 0.01
export const GEO_LIKE_MAX_ECCENTRICITY = 0.01
export const GEO_LIKE_MAX_EQUATOR_DISTANCE_DEG = 1
export const NEAR_POLAR_DISTANCE_DEG = 10
export const NEAR_EQUATOR_DISTANCE_DEG = 10
export const HIGH_ECCENTRICITY_MIN = 0.25

const KM_DECIMALS = 3
const MINUTE_DECIMALS = 5
const SECONDS_PER_DAY = 86_400

export type Sgp4Regime = 'near-earth' | 'deep-space'
export type AltitudeBand = 'low-earth' | 'medium-earth' | 'high-earth' | 'crossing-bands'
export type PrimaryOrbitClass = 'geosynchronous' | 'highly-elliptical' | AltitudeBand

/** Narrow result of one SGP4 initialization, produced by the orbital layer. */
export interface CatalogueOrbitAnalysis {
  readonly recoveredPeriodMinutes: number
  readonly semimajorAxisKm: number
  readonly perigeeAltitudeKm: number
  readonly apogeeAltitudeKm: number
  readonly regime: Sgp4Regime
}

export interface DerivedOrbitMetadata {
  readonly basis: 'sgp4-initialized-mean-elements'
  readonly recoveredPeriodMinutes: number
  readonly semimajorAxisKm: number
  readonly perigeeAltitudeKm: number
  readonly apogeeAltitudeKm: number
  readonly sgp4Regime: Sgp4Regime
  readonly altitudeBand: AltitudeBand
  readonly primaryOrbitClass: PrimaryOrbitClass
  readonly nearPolar: boolean
  readonly nearEquatorial: boolean
  readonly highEccentricity: boolean
  readonly nearGeosynchronous: boolean
  readonly geoLike: boolean
}

export interface DerivedCatalogueMetadata {
  readonly rulesVersion: string
  readonly orbit: DerivedOrbitMetadata
  readonly launchYear?: number
}

export interface CatalogueEnrichmentInput {
  /** The published OMM `ECCENTRICITY`. */
  readonly eccentricity: number
  /** The published OMM `INCLINATION`, in degrees. */
  readonly inclinationDeg: number
  /** Normalized source launch date, `YYYY-MM-DD`, when present. */
  readonly launchDate?: string
  readonly analysis: CatalogueOrbitAnalysis
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor) / factor
  return rounded === 0 ? 0 : rounded
}

const GEOSYNCHRONOUS_MIN_MINUTES = round(GEOSYNCHRONOUS_PERIOD_MINUTES * (1 - GEOSYNCHRONOUS_PERIOD_TOLERANCE_FRACTION), MINUTE_DECIMALS)
const GEOSYNCHRONOUS_MAX_MINUTES = round(GEOSYNCHRONOUS_PERIOD_MINUTES * (1 + GEOSYNCHRONOUS_PERIOD_TOLERANCE_FRACTION), MINUTE_DECIMALS)

function launchDateParts(value: string): { year: number; unixSeconds: number } {
  const date = new Date(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('launchDate must be a YYYY-MM-DD calendar date.')
  return { year: Number(value.slice(0, 4)), unixSeconds: date.getTime() / 1000 }
}

export function altitudeBandFor(perigeeAltitudeKm: number, apogeeAltitudeKm: number): AltitudeBand {
  if (apogeeAltitudeKm <= LEO_MAX_APOGEE_KM) return 'low-earth'
  if (perigeeAltitudeKm > LEO_MAX_APOGEE_KM && apogeeAltitudeKm < GEO_REFERENCE_ALTITUDE_KM) return 'medium-earth'
  if (perigeeAltitudeKm >= GEO_REFERENCE_ALTITUDE_KM) return 'high-earth'
  return 'crossing-bands'
}

/** Single compact label precedence. */
export function primaryOrbitClassFor(nearGeosynchronous: boolean, highEccentricity: boolean, altitudeBand: AltitudeBand): PrimaryOrbitClass {
  return nearGeosynchronous ? 'geosynchronous' : highEccentricity ? 'highly-elliptical' : altitudeBand
}

export function deriveCatalogueMetadata(input: CatalogueEnrichmentInput): DerivedCatalogueMetadata {
  const { analysis } = input
  const numbers = [input.eccentricity, input.inclinationDeg, analysis.recoveredPeriodMinutes, analysis.semimajorAxisKm, analysis.perigeeAltitudeKm, analysis.apogeeAltitudeKm]
  if (!numbers.every(Number.isFinite)) throw new Error('Enrichment inputs must be finite.')
  if (input.eccentricity < 0 || input.eccentricity >= 1 || input.inclinationDeg < 0 || input.inclinationDeg > 180) throw new Error('Enrichment inputs are outside the validated OMM ranges.')

  const recoveredPeriodMinutes = round(analysis.recoveredPeriodMinutes, MINUTE_DECIMALS)
  const perigeeAltitudeKm = round(analysis.perigeeAltitudeKm, KM_DECIMALS)
  const apogeeAltitudeKm = round(analysis.apogeeAltitudeKm, KM_DECIMALS)
  const equatorDistanceDeg = Math.min(input.inclinationDeg, 180 - input.inclinationDeg)

  const nearPolar = Math.abs(input.inclinationDeg - 90) <= NEAR_POLAR_DISTANCE_DEG
  const nearEquatorial = equatorDistanceDeg <= NEAR_EQUATOR_DISTANCE_DEG
  const highEccentricity = input.eccentricity >= HIGH_ECCENTRICITY_MIN
  const nearGeosynchronous = recoveredPeriodMinutes >= GEOSYNCHRONOUS_MIN_MINUTES && recoveredPeriodMinutes <= GEOSYNCHRONOUS_MAX_MINUTES
  const geoLike = nearGeosynchronous && input.eccentricity <= GEO_LIKE_MAX_ECCENTRICITY && equatorDistanceDeg <= GEO_LIKE_MAX_EQUATOR_DISTANCE_DEG
  const altitudeBand = altitudeBandFor(perigeeAltitudeKm, apogeeAltitudeKm)
  const primaryOrbitClass = primaryOrbitClassFor(nearGeosynchronous, highEccentricity, altitudeBand)

  const orbit: DerivedOrbitMetadata = {
    basis: 'sgp4-initialized-mean-elements',
    recoveredPeriodMinutes,
    semimajorAxisKm: round(analysis.semimajorAxisKm, KM_DECIMALS),
    perigeeAltitudeKm,
    apogeeAltitudeKm,
    sgp4Regime: analysis.regime,
    altitudeBand,
    primaryOrbitClass,
    nearPolar,
    nearEquatorial,
    highEccentricity,
    nearGeosynchronous,
    geoLike,
  }
  const derived: DerivedCatalogueMetadata = { rulesVersion: CATALOGUE_ENRICHMENT_RULES_VERSION, orbit }
  return input.launchDate === undefined ? derived : { ...derived, launchYear: launchDateParts(input.launchDate).year }
}

export type LaunchAge = { readonly kind: 'not-yet-launched' } | { readonly kind: 'elapsed'; readonly approximateDays: number }

/** Elapsed UTC days from a date-only launch date read at 00:00 UTC. The source
 *  precision is one day, so presentation must call the value approximate.
 *  Not snapshot-stable: never store the result in a published snapshot. */
export function ageSinceLaunch(launchDate: string, referenceUnixSeconds: number): LaunchAge {
  if (!Number.isFinite(referenceUnixSeconds)) throw new Error('The reference instant must be finite.')
  const elapsed = (referenceUnixSeconds - launchDateParts(launchDate).unixSeconds) / SECONDS_PER_DAY
  return elapsed < 0 ? { kind: 'not-yet-launched' } : { kind: 'elapsed', approximateDays: elapsed }
}

/** Signed element age in seconds: positive when the epoch precedes the
 *  reference, negative for a future epoch. Distinct from catalogue freshness. */
export function elementAgeSeconds(epochUnixSeconds: number, referenceUnixSeconds: number): number {
  if (!Number.isFinite(epochUnixSeconds) || !Number.isFinite(referenceUnixSeconds)) throw new Error('Element age inputs must be finite.')
  return referenceUnixSeconds - epochUnixSeconds
}
