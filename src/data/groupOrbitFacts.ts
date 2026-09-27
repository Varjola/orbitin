import { EARTH_MU_KM3_S2, EARTH_RADIUS_KM } from '../core/constants.ts'
import type { CatalogueRecordV1 } from './catalogueSchema.ts'

/** The live facts of a group's education page,
 *  computed from its members' published mean elements, so the page cannot
 *  drift from the data. Mean elements give nominal values: good for a
 *  summary, not a precise altitude. */
export interface GroupOrbitFacts {
  readonly memberCount: number
  readonly medianInclinationRad: number
  readonly medianPeriodSeconds: number
  /** Lowest perigee and highest apogee altitude over all members, from the
   *  mean semi-major axis and eccentricity above a spherical Earth. */
  readonly lowestPerigeeKm: number
  readonly highestApogeeKm: number
}

const SECONDS_PER_DAY = 86_400

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Null when no member record has usable elements. */
export function groupOrbitFacts(records: readonly Pick<CatalogueRecordV1, 'MEAN_MOTION' | 'ECCENTRICITY' | 'INCLINATION'>[]): GroupOrbitFacts | null {
  const usable = records.filter((record) => record.MEAN_MOTION > 0 && Number.isFinite(record.MEAN_MOTION) && record.ECCENTRICITY >= 0 && record.ECCENTRICITY < 1 && Number.isFinite(record.INCLINATION))
  if (usable.length === 0) return null
  const periods = usable.map((record) => SECONDS_PER_DAY / record.MEAN_MOTION)
  const radii = usable.map((record, index) => {
    const meanMotionRadPerSecond = (2 * Math.PI) / periods[index]
    const semiMajorAxisKm = Math.cbrt(EARTH_MU_KM3_S2 / (meanMotionRadPerSecond * meanMotionRadPerSecond))
    return { perigee: semiMajorAxisKm * (1 - record.ECCENTRICITY) - EARTH_RADIUS_KM, apogee: semiMajorAxisKm * (1 + record.ECCENTRICITY) - EARTH_RADIUS_KM }
  })
  return {
    memberCount: usable.length,
    medianInclinationRad: (median(usable.map((record) => record.INCLINATION)) * Math.PI) / 180,
    medianPeriodSeconds: median(periods),
    lowestPerigeeKm: Math.min(...radii.map((radius) => radius.perigee)),
    highestApogeeKm: Math.max(...radii.map((radius) => radius.apogee)),
  }
}
