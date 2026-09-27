import { describe, expect, it } from 'vitest'
import { degToRad, TAU } from '../core/angles.ts'
import { MAX_SIMULATION_INSTANT, MIN_SIMULATION_INSTANT, SIMULATION_START_INSTANT } from '../core/constants.ts'
import { SECONDS_PER_DAY } from '../core/julianDate.ts'
import { j2SecularRates } from './j2Secular.ts'
import { J2SecularPropagator } from './j2SecularPropagator.ts'
import { KeplerianPropagator } from './keplerianPropagator.ts'
import { stateVectorEci } from './keplerian.ts'
import { solveEccentricAnomaly, trueFromEccentricAnomaly } from './kepler.ts'
import type { OrbitGeometry } from './geometry.ts'

const geometry: OrbitGeometry = {
  semiMajorAxisKm: 7178.137, eccentricity: 0.01, inclinationRad: degToRad(98.6031),
  raanRad: degToRad(155.2), argOfPeriapsisRad: degToRad(40),
}
const phase = { referenceInstant: { ...SIMULATION_START_INSTANT }, meanAnomalyAtReferenceRad: 0.9 }

describe('secular J2 propagator', () => {
  // Exact rather than approximate for three reasons: the same stateVectorEci
  // and Kepler chain is called with literally the same doubles,
  // secondsBetween(t*, t*) is exactly 0 so x + rate * 0 is exactly x, and
  // wrapRadians is idempotent on [0, TAU).
  it('returns the stored elements and the two-body state bit for bit at its own epoch', () => {
    const propagator = new J2SecularPropagator(geometry, phase)
    expect(propagator.elementsAt(phase.referenceInstant).geometry).toEqual(geometry)
    expect(propagator.meanAnomalyAt(phase.referenceInstant)).toBe(0.9)
    const keplerian = new KeplerianPropagator(geometry, phase)
    expect(propagator.stateAt(phase.referenceInstant)).toEqual(keplerian.stateAt(phase.referenceInstant))
  })

  // The expected advance is written out here rather than
  // obtained by calling the implementation a second time.
  it('advances each angle by its own rate over a simulated day', () => {
    const rates = j2SecularRates(geometry)
    const instant = { unixSeconds: phase.referenceInstant.unixSeconds + SECONDS_PER_DAY }
    const drifted = new J2SecularPropagator(geometry, phase).elementsAt(instant)
    const wrap = (x: number) => ((x % TAU) + TAU) % TAU
    expect(drifted.geometry.raanRad).toBeCloseTo(wrap(geometry.raanRad + rates.raanRadPerSecond * SECONDS_PER_DAY), 12)
    expect(drifted.geometry.argOfPeriapsisRad).toBeCloseTo(wrap(geometry.argOfPeriapsisRad + rates.argOfPeriapsisRadPerSecond * SECONDS_PER_DAY), 12)
    expect(drifted.meanAnomalyRad).toBeCloseTo(wrap(0.9 + rates.meanAnomalyRadPerSecond * SECONDS_PER_DAY), 12)
  })

  it('is time symmetric: re-anchoring forward then back recovers the original angles', () => {
    const forward = { unixSeconds: phase.referenceInstant.unixSeconds + 200 * SECONDS_PER_DAY }
    const propagator = new J2SecularPropagator(geometry, phase)
    const at200 = propagator.elementsAt(forward)
    const backwards = new J2SecularPropagator(at200.geometry, {
      referenceInstant: forward, meanAnomalyAtReferenceRad: at200.meanAnomalyRad,
    }).elementsAt(phase.referenceInstant)
    expect(Math.abs(backwards.geometry.raanRad - geometry.raanRad)).toBeLessThan(1e-12)
    expect(Math.abs(backwards.geometry.argOfPeriapsisRad - geometry.argOfPeriapsisRad)).toBeLessThan(1e-12)
    expect(Math.abs(backwards.meanAnomalyRad - phase.meanAnomalyAtReferenceRad)).toBeLessThan(1e-12)
  })

  it('places its own state on its own drifted elements', () => {
    const propagator = new J2SecularPropagator(geometry, phase)
    for (const days of [0, 1, 200, 3650]) {
      const instant = { unixSeconds: phase.referenceInstant.unixSeconds + days * SECONDS_PER_DAY }
      const drifted = propagator.elementsAt(instant)
      const trueAnomalyRad = trueFromEccentricAnomaly(solveEccentricAnomaly(drifted.meanAnomalyRad, geometry.eccentricity), geometry.eccentricity)
      expect(propagator.stateAt(instant)).toEqual(stateVectorEci(drifted.geometry, trueAnomalyRad))
    }
  })

  // KeplerianPropagator is not modified and is used unchanged, so this is
  // exact by construction and is what keeps the GEO station-keeping test
  // meaningful.
  it('leaves KeplerianPropagator as the sole two-body path, bit-identical across the range', () => {
    const keplerian = new KeplerianPropagator(geometry, phase)
    for (const instant of [MIN_SIMULATION_INSTANT, SIMULATION_START_INSTANT, MAX_SIMULATION_INSTANT, { unixSeconds: 0 }]) {
      const state = keplerian.stateAt(instant)
      expect(state).toEqual(new KeplerianPropagator(geometry, phase).stateAt(instant))
      // The J2 propagator genuinely differs away from the epoch: this is not a
      // no-op wrapper.
      if (instant !== SIMULATION_START_INSTANT) {
        expect(new J2SecularPropagator(geometry, phase).stateAt(instant)).not.toEqual(state)
      }
    }
  })
})
