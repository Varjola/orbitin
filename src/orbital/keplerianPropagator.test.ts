import { describe, expect, it } from 'vitest'
import { DEFAULT_GEOMETRY, deriveOrbitValues } from './geometry.ts'
import { currentTrueAnomaly, KeplerianPropagator, phaseFromTrueAnomaly, reanchorPhase } from './keplerianPropagator.ts'

describe('KeplerianPropagator', () => {
  it('propagates from an absolute reference instant', () => {
    const geometry = { ...DEFAULT_GEOMETRY, semiMajorAxisKm: 10000, eccentricity: 0.5 }
    const phase = phaseFromTrueAnomaly(geometry.eccentricity, 0, { unixSeconds: 100 })
    const propagator = new KeplerianPropagator(geometry, phase)
    const period = deriveOrbitValues(geometry).periodSeconds
    const first = propagator.stateAt({ unixSeconds: 100 }).positionProjectInertialKm
    const afterPeriod = propagator.stateAt({ unixSeconds: 100 + period }).positionProjectInertialKm
    expect(afterPeriod.x).toBeCloseTo(first.x, 7)
    expect(afterPeriod.y).toBeCloseTo(first.y, 7)
    expect(afterPeriod.z).toBeCloseTo(first.z, 7)
    expect(propagator.stateAt({ unixSeconds: 100 + period / 2 }).positionProjectInertialKm.x).toBeCloseTo(-15000, 5)
  })

  it('reanchors phase without changing the mean anomaly', () => {
    const geometry = { ...DEFAULT_GEOMETRY, eccentricity: 0.4 }
    const phase = phaseFromTrueAnomaly(geometry.eccentricity, 1.2, { unixSeconds: 0 })
    const at = { unixSeconds: 800 }
    const oldPropagator = new KeplerianPropagator(geometry, phase)
    const anchored = reanchorPhase(geometry, phase, at)
    expect(anchored.meanAnomalyAtReferenceRad).toBeCloseTo(oldPropagator.meanAnomalyAt(at), 12)
    expect(new KeplerianPropagator(geometry, anchored).meanAnomalyAt(at)).toBeCloseTo(oldPropagator.meanAnomalyAt(at), 12)
    expect(currentTrueAnomaly(geometry, anchored, at)).toBeCloseTo(oldPropagator.trueAnomalyAt(at), 12)
  })
})
