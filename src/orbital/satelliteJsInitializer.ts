import { julianDayFromUnixSeconds, SECONDS_PER_DAY } from '../core/julianDate.ts'
import type { Sgp4MeanElements } from '../data/sgp4MeanElements.ts'
import { SatRecError, sgp4init, type SatRec, type SatRecInit } from '../vendor/satellite-js-scalar.ts'

/** Initialise the scalar satellite.js record from the source-neutral contract.
 * This is intentionally the same improved-mode `sgp4init` path used by the
 * library's TLE and OMM helpers, without manufacturing either source format. */
export function satrecFromMeanElements(elements: Sgp4MeanElements): SatRec {
  const epochDate = new Date(elements.epoch.unixSeconds * 1000)
  const year = epochDate.getUTCFullYear()
  const yearStart = Date.UTC(year, 0, 1) / 1000
  const epochdays = 1 + (elements.epoch.unixSeconds - yearStart) / SECONDS_PER_DAY
  const satrecInit: SatRecInit = {
    error: SatRecError.None,
    satnum: elements.catalogId,
    epochyr: year % 100,
    epochdays,
    ndot: elements.meanMotionFirstDerivativeRadPerMinuteSquared,
    nddot: elements.meanMotionSecondDerivativeRadPerMinuteCubed,
    bstar: elements.bstarPerEarthRadius,
    inclo: elements.inclinationRad,
    nodeo: elements.raanRad,
    ecco: elements.eccentricity,
    argpo: elements.argumentOfPerigeeRad,
    mo: elements.meanAnomalyRad,
    no: elements.meanMotionRadPerMinute,
    jdsatepoch: julianDayFromUnixSeconds(elements.epoch.unixSeconds),
  }
  sgp4init(satrecInit, {
    opsmode: 'i',
    satn: elements.catalogId,
    epoch: satrecInit.jdsatepoch - 2433281.5,
    xbstar: elements.bstarPerEarthRadius,
    xecco: elements.eccentricity,
    xargpo: elements.argumentOfPerigeeRad,
    xinclo: elements.inclinationRad,
    xmo: elements.meanAnomalyRad,
    xno: elements.meanMotionRadPerMinute,
    xnodeo: elements.raanRad,
  })
  return satrecInit
}
