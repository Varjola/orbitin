/** The fictitious mean Sun: the body local *mean* solar time is defined against.
 *
 * Local mean solar time, and therefore MLTAN, MLTDN and the Sun-synchronous
 * condition, are defined against a Sun that moves uniformly along the equator,
 * not against the physical Sun. The two differ by the equation of time, up to
 * about 16.5 minutes of time, which is half an hour peak to peak across a year
 * on a readout displayed to the minute.
 *
 * This module owns that definition. `sun.ts` - the replaceable physical model -
 * consumes it rather than the other way round, so replacing the apparent-Sun
 * ephemeris cannot silently redefine what "Sun-synchronous" means.
 */
import { degToRad, wrapDegrees } from '../core/angles.ts'
import { daysSinceJ2000, SECONDS_PER_DAY } from '../core/julianDate.ts'
import type { SimulationInstant } from '../core/time.ts'

/** Mean longitude rate of the Sun, referred to the mean equinox of date.
 *  USNO, Approximate Solar Coordinates, https://aa.usno.navy.mil/faq/sun_approx
 *  This is the tropical-year rate, 360 deg / 365.2421897 d. */
export const MEAN_SUN_RATE_DEG_PER_DAY = 0.98564736
/** 1.9910639e-7 rad/s. The Sun-synchronous target nodal rate. */
export const MEAN_SUN_RATE_RAD_PER_SECOND = degToRad(MEAN_SUN_RATE_DEG_PER_DAY) / SECONDS_PER_DAY

export interface MeanSunPosition {
  /** Mean longitude, degrees, wrapped to [0, 360). */
  readonly longitudeDeg: number
  /** Right ascension of the fictitious mean Sun, mean equator and equinox of
   *  date. Equal by definition to the Sun's mean longitude. */
  readonly rightAscensionMeanOfDateRad: number
}

/** The mean Sun's mean longitude is the first line of the USNO apparent-Sun
 *  algorithm. That expression lives here now; `sun.ts` receives the result. */
export function meanSunAt(instant: SimulationInstant): MeanSunPosition {
  const longitudeDeg = wrapDegrees(280.459 + MEAN_SUN_RATE_DEG_PER_DAY * daysSinceJ2000(instant))
  return { longitudeDeg, rightAscensionMeanOfDateRad: degToRad(longitudeDeg) }
}
