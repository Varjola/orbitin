import { expect, it } from 'vitest'
import { radToDeg, wrapRadiansSigned } from '../core/angles.ts'
import { MAX_SIMULATION_INSTANT, MIN_SIMULATION_INSTANT, SIMULATION_START_INSTANT } from '../core/constants.ts'
import { SECONDS_PER_DAY } from '../core/julianDate.ts'
import { MEAN_SUN_RATE_DEG_PER_DAY, MEAN_SUN_RATE_RAD_PER_SECOND, meanSunAt } from './meanSun.ts'
import { apparentSunFromMeanSun, sunPositionOfDate } from './sun.ts'
import { environmentAt } from './environment.ts'
import environmentSource from './environment.ts?raw'

// The mean Sun carries no annual term by construction, so the
// 1e-12 bound is a round-off bound on the arithmetic and not a modelling bound.
it('advances uniformly, with no annual term', () => {
  for (const days of [1, 100, 10000]) {
    const a = meanSunAt(SIMULATION_START_INSTANT)
    const b = meanSunAt({ unixSeconds: SIMULATION_START_INSTANT.unixSeconds + days * SECONDS_PER_DAY })
    const advanceDeg = radToDeg(wrapRadiansSigned(b.rightAscensionMeanOfDateRad - a.rightAscensionMeanOfDateRad))
    const expectedDeg = ((MEAN_SUN_RATE_DEG_PER_DAY * days) % 360 + 540) % 360 - 180
    expect(Math.abs(advanceDeg - expectedDeg) / days).toBeLessThan(1e-12)
  }
})

it('states the rate in both units and defines right ascension as the mean longitude', () => {
  expect(MEAN_SUN_RATE_RAD_PER_SECOND).toBeCloseTo(1.9910639e-7, 14)
  for (const instant of [MIN_SIMULATION_INSTANT, SIMULATION_START_INSTANT, MAX_SIMULATION_INSTANT]) {
    const meanSun = meanSunAt(instant)
    expect(meanSun.longitudeDeg).toBeGreaterThanOrEqual(0)
    expect(meanSun.longitudeDeg).toBeLessThan(360)
    expect(radToDeg(meanSun.rightAscensionMeanOfDateRad)).toBeCloseTo(meanSun.longitudeDeg, 12)
    expect(environmentAt(instant).meanSunRightAscensionOfDateRad).toBe(meanSun.rightAscensionMeanOfDateRad)
  }
})

// Captured from the pre-refactor sun.ts before the mean
// longitude was moved into meanSun.ts. The refactor moves that expression
// rather than rewriting it, so equality here is bit-exact rather than
// approximate. A failure means the algorithm changed and must be revisited,
// not that the tolerance should be loosened.
it.each([
  [-631152000, 0.1737511828333695, -0.9034838145531844, -0.3918258839132916, -1.3808034541491652, -0.4026153275019862],
  [946728000, 0.1800850589222479, -0.9024841739541122, -0.39126932836006234, -1.3738395259454395, -0.4020104795780503],
  [1774008000, 0.9999981363160464, -0.0017713761534506338, -0.0007678482644554137, -0.0017713776020095245, -0.000767848339908166],
  [1782043200, -0.002471717860531868, 0.9175054417203354, 0.39771554536425907, 1.5734902747201713, 0.40902565340444025],
  [2524608000, 0.18641158229379073, -0.9014470216147406, -0.39069679958842596, -1.3668790881974406, -0.40138843469618335],
])('reproduces the pre-refactor apparent Sun bit for bit at %i', (unixSeconds, x, y, z, ra, dec) => {
  const sun = sunPositionOfDate({ unixSeconds })
  expect(Object.is(sun.directionMeanOfDate.x, x)).toBe(true)
  expect(Object.is(sun.directionMeanOfDate.y, y)).toBe(true)
  expect(Object.is(sun.directionMeanOfDate.z, z)).toBe(true)
  expect(Object.is(sun.rightAscensionRad, ra)).toBe(true)
  expect(Object.is(sun.declinationRad, dec)).toBe(true)
  // The wrapper and the mean-Sun entry point are the same computation.
  expect(apparentSunFromMeanSun({ unixSeconds }, meanSunAt({ unixSeconds }))).toEqual(sun)
})

// The equation of time is the physical difference the whole
// MLTAN design rests on. Computed from the two independent modules.
it('produces an equation of time in the expected band, with four sign changes across 2026', () => {
  let previousSign = 0
  let signChanges = 0
  let minimumMinutes = Infinity
  let maximumMinutes = -Infinity
  for (let day = 0; day < 365; day += 1) {
    const instant = { unixSeconds: Date.UTC(2026, 0, 1) / 1000 + day * SECONDS_PER_DAY }
    const meanSun = meanSunAt(instant)
    const apparent = apparentSunFromMeanSun(instant, meanSun)
    const minutes = radToDeg(wrapRadiansSigned(meanSun.rightAscensionMeanOfDateRad - apparent.rightAscensionRad)) * 4
    minimumMinutes = Math.min(minimumMinutes, minutes)
    maximumMinutes = Math.max(maximumMinutes, minutes)
    const sign = Math.sign(minutes)
    if (previousSign !== 0 && sign !== 0 && sign !== previousSign) signChanges += 1
    if (sign !== 0) previousSign = sign
  }
  expect(minimumMinutes).toBeGreaterThan(-14.5)
  expect(maximumMinutes).toBeLessThan(16.8)
  expect(minimumMinutes).toBeLessThan(-13)
  expect(maximumMinutes).toBeGreaterThan(15)
  expect(signChanges).toBe(4)
})

// Checked at source level: environmentAt holds one mean Sun
// and hands it to the apparent Sun, rather than evaluating either twice.
it('evaluates the mean Sun exactly once per environment derivation', () => {
  const source = environmentSource
  expect(source.match(/meanSunAt\(/g)).toHaveLength(1)
  expect(source).toContain('apparentSunFromMeanSun(')
  expect(source).not.toContain('sunPositionOfDate(')
})
