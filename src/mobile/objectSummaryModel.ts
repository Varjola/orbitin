import { EARTH_MU_KM3_S2, EARTH_RADIUS_KM } from '../core/constants.ts'
import type { OrbitalObject } from '../simulation/OrbitalObject.ts'
import { format, text } from '../i18n/index.ts'
import type { ReadoutValues } from '../ui/uiTypes.ts'

/** What the object chip and the object card show, from
 *  the object and the frame's own readouts. Pure: no DOM. */

export interface CardDetail { readonly label: string; readonly value: string }

export interface ObjectCardModel {
  readonly id: string
  readonly name: string
  readonly color: string
  /** "Orbit Lab orbit" or "Real object". */
  readonly source: string
  /** Only Orbit Lab orbits open the Shape strip. */
  readonly editable: boolean
  readonly altitude: string
  readonly speed: string
  readonly period: string
  readonly layers: { readonly orbit: boolean; readonly groundTrack: boolean }
  /** Rows of the expanded card. */
  readonly details: readonly CardDetail[]
  /** One line when the element set is old enough for the existing caution. */
  readonly ageWarning: string
  /** The elevation above the learner's horizon, when known. */
  readonly horizon: string
}

const MISSING = '—'
const SECONDS_PER_DAY = 86_400
/** The existing element-age caution starts after three days (`sgp4ElementAgeWarning`). */
const AGE_CAUTION_DAYS = 3

export function colorCss(colorHex: number): string {
  return `#${(colorHex >>> 0 & 0xffffff).toString(16).padStart(6, '0')}`
}

/** The chip's one live value. */
export function altitudeText(values: ReadoutValues | null): string {
  return values && Number.isFinite(values.currentAltitudeKm) ? format().km(values.currentAltitudeKm) : MISSING
}

function periodSeconds(object: OrbitalObject, values: ReadoutValues | null): number | null {
  if (object.source.kind === 'keplerian') return values?.derived?.periodSeconds ?? null
  return object.source.definition.meanElements.nominalPeriodSeconds
}

/** The card model. `citation` is the provider citation of the loaded
 *  catalogue, shown for catalogue objects. */
export function objectCardModel(object: OrbitalObject, values: ReadoutValues | null, nowUnixSeconds: number, citation: string | null = null): ObjectCardModel {
  const t = text().mobile.card
  const f = format()
  const period = periodSeconds(object, values)
  const details: CardDetail[] = []
  const point = values?.subSatellitePoint
  if (point) details.push({ label: t.position, value: `${f.latitude(point.geocentricLatitudeRad, 1)}, ${point.longitudeRad === null ? text().inspector.longitudeUndefined : f.longitude(point.longitudeRad, 1)}` })
  let ageWarning = ''
  if (object.source.kind === 'keplerian') {
    const derived = values?.derived
    if (derived) {
      details.push({ label: t.lowest, value: f.km(derived.periapsisAltitudeKm) })
      details.push({ label: t.highest, value: f.km(derived.apoapsisAltitudeKm) })
    }
    details.push({ label: t.inclination, value: f.degrees(object.source.geometry.inclinationRad, 1) })
  } else {
    const definition = object.source.definition
    details.push({ label: t.norad, value: definition.meanElements.catalogId })
    if (definition.internationalDesignator) details.push({ label: t.designator, value: definition.internationalDesignator })
    details.push({ label: t.epoch, value: new Date(definition.meanElements.epoch.unixSeconds * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' })
    const days = Math.abs(nowUnixSeconds - definition.meanElements.epoch.unixSeconds) / SECONDS_PER_DAY
    if (days > AGE_CAUTION_DAYS) ageWarning = t.age(f.integer(days))
    if (citation && object.source.kind === 'omm' && object.source.definition.provenance.kind === 'catalogue') details.push({ label: '', value: citation })
  }
  const elevation = values?.observerElevationRad
  const horizon = elevation === undefined || elevation === null || !Number.isFinite(elevation) ? ''
    : elevation >= 0 ? text().mobile.myPlace.above(f.degrees(elevation, 0)) : text().mobile.myPlace.below
  return {
    id: object.id,
    name: object.name,
    color: colorCss(object.style.colorHex),
    source: object.source.kind === 'keplerian' ? t.sourceLab : t.sourceReal,
    editable: object.source.kind === 'keplerian',
    altitude: altitudeText(values),
    speed: values && Number.isFinite(values.currentSpeedKmPerSecond) ? t.speedValue(f.number(values.currentSpeedKmPerSecond, 2)) : MISSING,
    period: period !== null && Number.isFinite(period) && period > 0 ? f.duration(period) : MISSING,
    layers: { orbit: object.display.orbitPathVisible, groundTrack: object.display.groundTrackVisible },
    details,
    ageWarning,
    horizon,
  }
}

/** The mean altitude of an orbit (semi-major axis less Earth's radius). For a
 *  real object the semi-major axis comes from its nominal period. */
export function meanAltitudeKm(object: OrbitalObject): number {
  if (object.source.kind === 'keplerian') return object.source.geometry.semiMajorAxisKm - EARTH_RADIUS_KM
  const period = object.source.definition.meanElements.nominalPeriodSeconds
  return Math.cbrt(EARTH_MU_KM3_S2 * (period / (2 * Math.PI)) ** 2) - EARTH_RADIUS_KM
}

/** The list row's one short line: the orbit's altitude, the same for every
 *  row whether or not it is selected. */
export function objectRowLine(object: OrbitalObject): string {
  const altitude = meanAltitudeKm(object)
  return Number.isFinite(altitude) ? format().km(altitude) : MISSING
}
