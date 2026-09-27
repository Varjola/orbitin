import { intlTag, type DisplayLocale } from './locale.ts'

/** Unit words and symbols a formatter writes around numbers. They belong to
 *  the message catalogue so a correction is a
 *  resource edit; the formatter only places them. */
export interface UnitWords {
  readonly degreesPerDay: string
  readonly hour: string
  readonly minute: string
  readonly second: string
  /** Between a duration number and its unit: `1h` or `1 h`. */
  readonly durationGap: string
  readonly north: string
  readonly south: string
  readonly east: string
  readonly west: string
  /** Between the degree sign and a cardinal letter: `12.3°N` or `12,3° P`. */
  readonly cardinalGap: string
  /** Between hours and minutes of a clock time: `10:30` or `10.30`. */
  readonly clockSeparator: string
}

export interface PluralForms {
  readonly one: string
  readonly other: string
  readonly zero?: string
  readonly two?: string
  readonly few?: string
  readonly many?: string
}

/** Locale-bound number, unit, duration, list and plural formatting. One
 *  instance per locale, with its `Intl` objects built once, so per-frame
 *  readouts allocate no formatter. */
export interface LocaleFormat {
  readonly locale: DisplayLocale
  /** Grouped decimal with exactly `decimals` fraction digits. */
  number(value: number, decimals?: number): string
  /** Truncated whole number, grouped. */
  integer(value: number): string
  /** A decimal with as many fraction digits as it has, such as a threshold. */
  exact(value: number): string
  /** `+1.25`, `−3.2`, or no sign when it rounds to zero, then `suffix`. */
  signed(value: number, decimals: number, suffix?: string): string
  percent(fraction: number, decimals?: number): string
  km(value: number, decimals?: number): string
  km2(value: number): string
  degrees(rad: number, decimals: number): string
  signedDegrees(rad: number, decimals: number): string
  degreesPerDay(radPerSecond: number): string
  latitude(rad: number, decimals: number): string
  longitude(rad: number, decimals: number): string
  /** The cardinal letter of a signed angle, or '' at zero after rounding. */
  hemisphere(value: number, axis: 'latitude' | 'longitude', decimals: number): string
  duration(seconds: number): string
  solarTime(hours: number): string
  speedMultiplier(value: number): string
  list(items: readonly string[]): string
  plural(count: number, forms: PluralForms): string
}

const DEGREES_PER_RADIAN = 180 / Math.PI
const MISSING = '—'
const SECONDS_PER_DAY = 86_400

export function createFormatter(locale: DisplayLocale, units: UnitWords): LocaleFormat {
  const tag = intlTag(locale)
  const numberFormats = new Map<number, Intl.NumberFormat>()
  const percentFormats = new Map<number, Intl.NumberFormat>()
  const exactFormat = new Intl.NumberFormat(tag, { maximumFractionDigits: 20 })
  const plurals = new Intl.PluralRules(tag)
  const lists = new Intl.ListFormat(tag, { style: 'long', type: 'conjunction' })
  const numberFormat = (decimals: number): Intl.NumberFormat => {
    let format = numberFormats.get(decimals)
    if (!format) { format = new Intl.NumberFormat(tag, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); numberFormats.set(decimals, format) }
    return format
  }
  // Rounding to zero never leaves a sign behind (`-0.0`).
  const clean = (value: number, decimals: number): number => { const rounded = Number(value.toFixed(decimals)); return rounded === 0 ? 0 : value }
  // A value that is not a finite number is shown as missing, never as NaN.
  const number = (value: number, decimals = 0): string => Number.isFinite(value) ? numberFormat(decimals).format(clean(value, decimals)) : MISSING
  const signed = (value: number, decimals: number, suffix = ''): string => {
    if (!Number.isFinite(value)) return MISSING
    const rounded = Number(value.toFixed(decimals))
    const sign = rounded === 0 ? '' : rounded > 0 ? '+' : '−'
    return `${sign}${number(Math.abs(rounded), decimals)}${suffix}`
  }
  const hemisphere = (value: number, axis: 'latitude' | 'longitude', decimals: number): string => {
    if (Number(Math.abs(value).toFixed(decimals)) === 0) return ''
    if (axis === 'latitude') return value < 0 ? units.south : units.north
    return value < 0 ? units.west : units.east
  }
  const cardinal = (rad: number, axis: 'latitude' | 'longitude', decimals: number): string => {
    const degrees = rad * DEGREES_PER_RADIAN
    const letter = hemisphere(degrees, axis, decimals)
    return `${number(Math.abs(degrees), decimals)}°${letter ? `${units.cardinalGap}${letter}` : ''}`
  }
  const unit = (value: number, word: string): string => `${value}${units.durationGap}${word}`
  return {
    locale,
    number,
    integer: (value) => number(Math.trunc(value), 0),
    exact: (value) => exactFormat.format(value),
    signed,
    percent: (fraction, decimals = 0) => {
      let format = percentFormats.get(decimals)
      if (!Number.isFinite(fraction)) return MISSING
      if (!format) { format = new Intl.NumberFormat(tag, { style: 'percent', minimumFractionDigits: decimals, maximumFractionDigits: decimals }); percentFormats.set(decimals, format) }
      return format.format(clean(fraction, decimals + 2))
    },
    km: (value, decimals = 0) => `${number(value, decimals)} km`,
    km2: (value) => `${number(value)} km²`,
    degrees: (rad, decimals) => `${number(rad * DEGREES_PER_RADIAN, decimals)}°`,
    signedDegrees: (rad, decimals) => signed(rad * DEGREES_PER_RADIAN, decimals, '°'),
    degreesPerDay: (radPerSecond) => signed(radPerSecond * DEGREES_PER_RADIAN * SECONDS_PER_DAY, 2, units.degreesPerDay),
    latitude: (rad, decimals) => cardinal(rad, 'latitude', decimals),
    longitude: (rad, decimals) => cardinal(rad, 'longitude', decimals),
    hemisphere,
    duration: (seconds) => {
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      return hours > 0 ? `${unit(hours, units.hour)} ${unit(minutes, units.minute)}` : `${unit(minutes, units.minute)} ${unit(Math.floor(seconds % 60), units.second)}`
    },
    solarTime: (hours) => {
      const total = Math.round(((hours % 24) + 24) % 24 * 60) % (24 * 60)
      return `${String(Math.floor(total / 60)).padStart(2, '0')}${units.clockSeparator}${String(total % 60).padStart(2, '0')}`
    },
    speedMultiplier: (value) => `${number(value, value < 10 ? 1 : 0)}×`,
    list: (items) => lists.format(items),
    plural: (count, forms) => forms[plurals.select(count) as keyof PluralForms] ?? forms.other,
  }
}
