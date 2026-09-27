import { describe, expect, it } from 'vitest'
import { degToRad, radToDeg, TAU } from '../core/angles.ts'
import { EARTH_J2, EARTH_MU_KM3_S2, EARTH_RADIUS_KM } from '../core/constants.ts'
import { SECONDS_PER_DAY } from '../core/julianDate.ts'
import { greenwichMeanSiderealTime } from '../simulation/earthOrientation.ts'
import { j2SecularElementsAt, j2SecularFactor, j2SecularRates, twoBodyRates } from './j2Secular.ts'
import { meanMotion, type OrbitGeometry } from './geometry.ts'

const circular = (a: number, e: number, inclinationDeg: number): OrbitGeometry =>
  ({ semiMajorAxisKm: a, eccentricity: e, inclinationRad: degToRad(inclinationDeg), raanRad: 0, argOfPeriapsisRad: 0 })
const degPerDay = (radPerSecond: number) => radToDeg(radPerSecond) * SECONDS_PER_DAY

describe('secular J2 rates', () => {
  // Reference table. The tolerance is set by the choice of J2 constant, not
  // by the arithmetic.
  it.each([
    ['ISS-like LEO', 6778, 0, 51.6, -5.00268, 3.74154],
    ['SSO at 500 km', 6878.137, 0, 97.4018, 0.98565, -3.50803],
    ['SSO at 800 km', 7178.137, 0, 98.6031, 0.98565, -2.92591],
    ['Polar at 800 km', 7178.137, 0, 90, 0, -3.29452],
    ['Highly elliptical at 63.5 deg', 26600, 0.74, 63.5, -0.14664, -0.00075],
    ['Highly elliptical at 45 deg', 26600, 0.74, 45, -0.23239, 0.24649],
  ])('reproduces %s', (_name, a, e, i, nodal, apsidal) => {
    const rates = j2SecularRates(circular(a, e, i))
    expect(degPerDay(rates.raanRadPerSecond)).toBeCloseTo(nodal, 3)
    expect(degPerDay(rates.argOfPeriapsisRadPerSecond)).toBeCloseTo(apsidal, 3)
  })

  // Two separate bounds, because they measure different
  // things. At the *exact* critical inclination acos(1/sqrt(5)) the factor
  // 5 cos^2 i - 1 is a machine zero against k, so 1e-20 rad/s holds. At the
  // *tabulated* 63.4349488 deg the residue is set by the truncation of
  // that printed value - about 2.3e-8 deg, which the factor's slope of -4
  // turns into roughly 1.6e-9 - and reaches 1.3e-15 rad/s at LEO, where k is
  // largest. Asserting 1e-15 there would be asserting to more digits than the
  // tabulated inclination carries.
  it.each([Math.acos(1 / Math.sqrt(5)), Math.PI - Math.acos(1 / Math.sqrt(5))])(
    'has machine-zero apsidal drift at the exact critical inclination %f rad', (inclinationRad) => {
      for (const [a, e] of [[6778, 0], [26600, 0.74], [42164.17, 0.2]] as const) {
        const geometry = { ...circular(a, e, 0), inclinationRad }
        expect(Math.abs(j2SecularRates(geometry).argOfPeriapsisRadPerSecond)).toBeLessThan(1e-20)
      }
    })
  it.each([63.4349488, 116.5650512])('has vanishing apsidal drift at the tabulated critical inclination %f deg', (inclinationDeg) => {
    for (const [a, e] of [[6778, 0], [26600, 0.74], [42164.17, 0.2]] as const) {
      expect(Math.abs(j2SecularRates(circular(a, e, inclinationDeg)).argOfPeriapsisRadPerSecond)).toBeLessThan(2e-15)
    }
    expect(radToDeg(Math.acos(1 / Math.sqrt(5)))).toBeCloseTo(63.4349488, 6)
  })

  // Math.cos(PI / 2) is about 6.1e-17, so this is not bit-exact.
  it('has vanishing nodal drift at 90 deg, negative below and positive above', () => {
    expect(Math.abs(j2SecularRates(circular(7178.137, 0, 90)).raanRadPerSecond)).toBeLessThan(1e-20)
    expect(j2SecularRates(circular(7178.137, 0, 51.6)).raanRadPerSecond).toBeLessThan(0)
    expect(j2SecularRates(circular(7178.137, 0, 98.6)).raanRadPerSecond).toBeGreaterThan(0)
  })

  // The comparison arithmetic is written out here rather than
  // taken from the implementation.
  it('scales with eccentricity through the semi-latus rectum', () => {
    const a = 26600
    for (const e of [0, 0.2, 0.74]) {
      const geometry = circular(a, e, 45)
      const p = a * (1 - e * e)
      const n = Math.sqrt(EARTH_MU_KM3_S2 / a ** 3)
      const k = 1.5 * n * EARTH_J2 * (EARTH_RADIUS_KM / p) ** 2
      expect(j2SecularFactor(geometry)).toBeCloseTo(k, 20)
      const rates = j2SecularRates(geometry)
      const cosine = Math.cos(degToRad(45))
      expect(rates.raanRadPerSecond / (-k * cosine)).toBeCloseTo(1, 12)
      expect(rates.meanAnomalyRadPerSecond / (n + (k / 2) * Math.sqrt(1 - e * e) * (3 * cosine * cosine - 1))).toBeCloseTo(1, 12)
    }
    // The k ratio between a circular and an e = 0.74 orbit of the same a is
    // (1 - e^2)^-2 exactly.
    expect(j2SecularFactor(circular(a, 0.74, 45)) / j2SecularFactor(circular(a, 0, 45)))
      .toBeCloseTo((1 - 0.74 ** 2) ** -2, 12)
  })

  // The equatorial mean-longitude rate is compared against an
  // independently derived closed form, not against the sum the implementation
  // produces.
  it('produces the closed-form mean longitude rate at the equator', () => {
    const a = 42164.17
    const geometry = circular(a, 0, 0)
    const rates = j2SecularRates(geometry)
    const sum = rates.raanRadPerSecond + rates.argOfPeriapsisRadPerSecond + rates.meanAnomalyRadPerSecond
    const closedForm = meanMotion(geometry) * (1 + 3 * EARTH_J2 * (EARTH_RADIUS_KM / a) ** 2)
    expect(sum / closedForm).toBeCloseTo(1, 15)
    // Against the project's own Earth rotation rate, from GMST over one day.
    const start = { unixSeconds: 0 }
    const day = { unixSeconds: SECONDS_PER_DAY }
    const gmstRateRadPerSecond = ((greenwichMeanSiderealTime(day) - greenwichMeanSiderealTime(start) + TAU) % TAU + TAU) / SECONDS_PER_DAY
    expect(degPerDay(sum) - degPerDay(gmstRateRadPerSecond)).toBeCloseTo(0.026823, 4)
  })

  // No osculating quantity is asserted: none is modelled.
  it('puts the J2-synchronous mean semi-major axis about 2.09 km above the two-body value', () => {
    const start = { unixSeconds: 0 }
    const day = { unixSeconds: SECONDS_PER_DAY }
    const earthRate = ((greenwichMeanSiderealTime(day) - greenwichMeanSiderealTime(start) + TAU) % TAU + TAU) / SECONDS_PER_DAY
    let low = 42000
    let high = 42300
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const middle = (low + high) / 2
      const geometry = circular(middle, 0, 0)
      const rates = j2SecularRates(geometry)
      if (rates.raanRadPerSecond + rates.argOfPeriapsisRadPerSecond + rates.meanAnomalyRadPerSecond > earthRate) low = middle
      else high = middle
    }
    expect(low).toBeCloseTo(42166.26, 1)
    expect(low - 42164.17).toBeCloseTo(2.09, 1)
  })
})

describe('secular element advance', () => {
  const geometry = circular(7178.137, 0.001, 98.6031)
  const phase = { referenceInstant: { unixSeconds: 1774008000 }, meanAnomalyAtReferenceRad: 0.4 }

  it('returns the stored elements untouched at the reference instant', () => {
    const drifted = j2SecularElementsAt(geometry, phase, phase.referenceInstant)
    expect(drifted.geometry).toEqual(geometry)
    expect(drifted.meanAnomalyRad).toBe(0.4)
    expect(drifted.unwrappedMeanAnomalyRad).toBe(0.4)
  })

  // At the element level, the expected advance is written out
  // here rather than obtained by calling the implementation twice.
  it('advances each angle by its rate times the elapsed time', () => {
    const rates = j2SecularRates(geometry)
    const instant = { unixSeconds: phase.referenceInstant.unixSeconds + SECONDS_PER_DAY }
    const drifted = j2SecularElementsAt(geometry, phase, instant)
    const wrap = (x: number) => ((x % TAU) + TAU) % TAU
    expect(drifted.geometry.raanRad).toBeCloseTo(wrap(geometry.raanRad + rates.raanRadPerSecond * SECONDS_PER_DAY), 12)
    expect(drifted.geometry.argOfPeriapsisRad).toBeCloseTo(wrap(geometry.argOfPeriapsisRad + rates.argOfPeriapsisRadPerSecond * SECONDS_PER_DAY), 12)
    expect(drifted.meanAnomalyRad).toBeCloseTo(wrap(0.4 + rates.meanAnomalyRadPerSecond * SECONDS_PER_DAY), 12)
    expect(drifted.unwrappedMeanAnomalyRad).toBeCloseTo(0.4 + rates.meanAnomalyRadPerSecond * SECONDS_PER_DAY, 8)
    // a, e and i never change under this model; that is what makes rendering by
    // orientation possible.
    expect(drifted.geometry.semiMajorAxisKm).toBe(geometry.semiMajorAxisKm)
    expect(drifted.geometry.eccentricity).toBe(geometry.eccentricity)
    expect(drifted.geometry.inclinationRad).toBe(geometry.inclinationRad)
  })

  it('supplies the exact two-body rates for objects with no perturbation model', () => {
    const rates = twoBodyRates(geometry)
    expect(rates.raanRadPerSecond).toBe(0)
    expect(rates.argOfPeriapsisRadPerSecond).toBe(0)
    expect(rates.meanAnomalyRadPerSecond).toBe(meanMotion(geometry))
  })
})
