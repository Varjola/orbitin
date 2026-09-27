import { describe, expect, it } from 'vitest'
import { degToRad, radToDeg } from '../core/angles.ts'
import { EARTH_RADIUS_KM, SIMULATION_START_INSTANT } from '../core/constants.ts'
import { SECONDS_PER_DAY } from '../core/julianDate.ts'
import { j2SecularRates } from '../orbital/j2Secular.ts'
import { maximumSunSynchronousSemiMajorAxisKm, solveSunSynchronousInclination } from '../orbital/sunSynchronous.ts'
import { createPropagator, type KeplerianOrbitalObject, type KeplerianPropagationModel } from './OrbitalObject.ts'
import { applyGeometryEdit, reanchorSource, setSunSynchronousLock, switchPropagation } from './propagationTransitions.ts'

const baseObject = (propagation: KeplerianPropagationModel, overrides: Partial<KeplerianOrbitalObject> = {}): KeplerianOrbitalObject => ({
  id: 'a', name: 'A',
  source: {
    kind: 'keplerian',
    geometry: { semiMajorAxisKm: 7178.137, eccentricity: 0.01, inclinationRad: degToRad(98.6), raanRad: degToRad(155), argOfPeriapsisRad: degToRad(40) },
    phase: { referenceInstant: { ...SIMULATION_START_INSTANT }, meanAnomalyAtReferenceRad: 0.9 },
  },
  propagation, editingLock: { kind: 'none' },
  style: { colorHex: 1, markerSizeRenderUnits: 0.02 },
  sensor: { fieldOfViewHalfAngleRad: degToRad(10), maxOffNadirSteeringRad: degToRad(20) },
  reachConstraint: { minimumGroundElevationRad: 0 },
  display: { bodyVisible: true, orbitPathVisible: true, groundTrackVisible: false, groundTrackHistoryRecording: false, sensorGeometryVisible: false },
  ...overrides,
})

const after = (days: number) => ({ unixSeconds: SIMULATION_START_INSTANT.unixSeconds + days * SECONDS_PER_DAY })
const angleBounds = { min: 0, max: Math.PI * 2 }

describe('propagation continuity', () => {
  // Bit-identical, not approximate.
  it.each([
    ['two-body to J2', { kind: 'idealTwoBody' } as const, { kind: 'j2Secular' } as const],
    ['J2 to two-body', { kind: 'j2Secular' } as const, { kind: 'idealTwoBody' } as const],
  ])('preserves position, velocity and all six elements when switching %s', (_name, from, to) => {
    const object = baseObject(from)
    const transitionInstant = after(200)
    const before = createPropagator(object.source, object.propagation).stateAt(transitionInstant)
    const switched = switchPropagation(object, to, transitionInstant).object
    expect(switched.propagation).toEqual(to)
    const afterState = createPropagator(switched.source, switched.propagation).stateAt(transitionInstant)
    expect(afterState).toEqual(before)
    // The full element set at t*, including the three drifting angles.
    const driftedBefore = reanchorSource(object.source, object.propagation, transitionInstant)
    expect(switched.source.geometry).toEqual(driftedBefore.geometry)
    expect(switched.source.phase.meanAnomalyAtReferenceRad).toBe(driftedBefore.phase.meanAnomalyAtReferenceRad)
  })

  // Both re-anchors are zero-elapsed-time operations at the same instant, and
  // a zero-elapsed-time re-anchor is exact, so exactness holds twice.
  it('round-trips A to B to A at the same instant, bit for bit', () => {
    const object = baseObject({ kind: 'idealTwoBody' })
    const instant = after(200)
    const there = switchPropagation(object, { kind: 'j2Secular' }, instant).object
    const back = switchPropagation(there, { kind: 'idealTwoBody' }, instant).object
    expect(createPropagator(back.source, back.propagation).stateAt(instant))
      .toEqual(createPropagator(object.source, object.propagation).stateAt(instant))
    expect(back.source.geometry).toEqual(there.source.geometry)
  })

  // The derivative does change, so the switch is not a no-op.
  it('changes the angle rates at the transition instant', () => {
    const object = baseObject({ kind: 'idealTwoBody' })
    const instant = after(200)
    const switched = switchPropagation(object, { kind: 'j2Secular' }, instant).object
    const oneSecondLater = { unixSeconds: instant.unixSeconds + 1 }
    const rates = j2SecularRates(switched.source.geometry)
    const drifted = reanchorSource(switched.source, switched.propagation, oneSecondLater)
    expect(drifted.geometry.raanRad - switched.source.geometry.raanRad).toBeCloseTo(rates.raanRadPerSecond, 15)
    // Two-body propagation moves neither plane angle at all.
    const stillTwoBody = reanchorSource(object.source, object.propagation, oneSecondLater)
    expect(stillTwoBody.geometry.raanRad).toBe(object.source.geometry.raanRad)
  })

  it('never lets the editing lock touch propagation', () => {
    const unlocked = baseObject({ kind: 'j2Secular' })
    const locked = baseObject({ kind: 'j2Secular' }, { editingLock: { kind: 'sunSynchronous' } })
    for (const days of [0, 1, 200, 3650]) {
      expect(createPropagator(locked.source, locked.propagation).stateAt(after(days)))
        .toEqual(createPropagator(unlocked.source, unlocked.propagation).stateAt(after(days)))
    }
    const released = setSunSynchronousLock(locked, false, after(10))
    expect(released.object.source).toBe(locked.source)
    expect(released.object.propagation).toBe(locked.propagation)
    expect(released.object.editingLock).toEqual({ kind: 'none' })
  })
})

describe('the Sun-synchronous lock', () => {
  it('re-anchors, writes the solved inclination and leaves RAAN unchanged', () => {
    const object = baseObject({ kind: 'j2Secular' })
    const instant = after(200)
    const driftedRaan = reanchorSource(object.source, object.propagation, instant).geometry.raanRad
    const result = setSunSynchronousLock(object, true, instant)
    expect(result.object.editingLock).toEqual({ kind: 'sunSynchronous' })
    expect(result.status.kind).toBe('applied')
    const solution = solveSunSynchronousInclination(object.source.geometry.semiMajorAxisKm, object.source.geometry.eccentricity)
    expect(solution.kind).toBe('solved')
    if (solution.kind === 'solved') expect(result.object.source.geometry.inclinationRad).toBe(solution.inclinationRad)
    // RAAN is the learner's design choice for local crossing time and is never
    // rewritten; it only carries the drift accumulated up to the re-anchor.
    expect(result.object.source.geometry.raanRad).toBe(driftedRaan)
    // The resulting nodal rate is the Sun-synchronous one.
    expect(radToDeg(j2SecularRates(result.object.source.geometry).raanRadPerSecond) * SECONDS_PER_DAY).toBeCloseTo(0.98565, 4)
  })

  it('changes nothing and reports the bound when no solution exists', () => {
    const bound = maximumSunSynchronousSemiMajorAxisKm(0)
    const object = baseObject({ kind: 'j2Secular' })
    object.source.geometry = { ...object.source.geometry, semiMajorAxisKm: bound + 1000, eccentricity: 0 }
    const result = setSunSynchronousLock(object, true, after(1))
    expect(result.object).toBe(object)
    expect(result.object.editingLock).toEqual({ kind: 'none' })
    expect(result.status).toMatchObject({ kind: 'unattainable' })
    if (result.status.kind === 'unattainable') {
      expect(result.status.maximumSemiMajorAxisKm).toBeCloseTo(bound, 6)
      expect(result.status.maximumAltitudeKm).toBeCloseTo(bound - EARTH_RADIUS_KM, 6)
    }
  })

  it('is refused, not silently applied, under ideal two-body propagation', () => {
    const object = baseObject({ kind: 'idealTwoBody' })
    const result = setSunSynchronousLock(object, true, after(1))
    expect(result.object).toBe(object)
    expect(result.status).toEqual({ kind: 'requiresJ2Drift' })
  })

  it('releases when propagation leaves J2 drift, with a reason', () => {
    const locked = baseObject({ kind: 'j2Secular' }, { editingLock: { kind: 'sunSynchronous' } })
    const result = switchPropagation(locked, { kind: 'idealTwoBody' }, after(5))
    expect(result.object.editingLock).toEqual({ kind: 'none' })
    expect(result.status).toEqual({ kind: 'releasedByPropagationChange' })
  })
})

describe('edits while locked', () => {
  const locked = baseObject({ kind: 'j2Secular' }, { editingLock: { kind: 'sunSynchronous' } })
  const instant = after(200)

  // The edit table, row by row.
  it.each([
    ['semiMajorAxisKm', 7278.137, { min: 6678, max: 50000 }],
    ['eccentricity', 0.02, { min: 0, max: 0.8 }],
  ] as const)('re-solves inclination when %s is edited', (field, value, bounds) => {
    const result = applyGeometryEdit(locked, field, value, bounds, instant)
    expect(result.object.editingLock).toEqual({ kind: 'sunSynchronous' })
    expect(result.object.source.geometry[field]).toBe(value)
    expect(radToDeg(j2SecularRates(result.object.source.geometry).raanRadPerSecond) * SECONDS_PER_DAY).toBeCloseTo(0.98565, 4)
  })

  it('keeps the edited semi-major axis and releases the lock past the bound', () => {
    const bound = maximumSunSynchronousSemiMajorAxisKm(locked.source.geometry.eccentricity)
    const result = applyGeometryEdit(locked, 'semiMajorAxisKm', bound + 500, { min: 6678, max: 50000 }, instant)
    expect(result.object.source.geometry.semiMajorAxisKm).toBe(bound + 500)
    expect(result.object.source.geometry.inclinationRad).toBe(
      reanchorSource(locked.source, locked.propagation, instant).geometry.inclinationRad)
    expect(result.object.editingLock).toEqual({ kind: 'none' })
    expect(result.status.kind).toBe('unattainable')
  })

  it('releases the lock and respects an inclination edit', () => {
    const result = applyGeometryEdit(locked, 'inclinationRad', degToRad(90), { min: 0, max: Math.PI }, instant)
    expect(result.object.source.geometry.inclinationRad).toBe(degToRad(90))
    expect(result.object.editingLock).toEqual({ kind: 'none' })
    expect(result.status).toEqual({ kind: 'releasedByInclinationEdit' })
  })

  it.each(['raanRad', 'argOfPeriapsisRad'] as const)('applies a %s edit without touching the lock', (field) => {
    const result = applyGeometryEdit(locked, field, 1.23, angleBounds, instant)
    expect(result.object.source.geometry[field]).toBe(1.23)
    expect(result.object.editingLock).toEqual({ kind: 'sunSynchronous' })
    expect(result.status).toEqual({ kind: 'none' })
  })

  it('re-anchors before every edit so the drawn orbit does not jump', () => {
    const unlocked = baseObject({ kind: 'j2Secular' })
    const drifted = reanchorSource(unlocked.source, unlocked.propagation, instant)
    const result = applyGeometryEdit(unlocked, 'raanRad', 1.23, angleBounds, instant)
    expect(result.object.source.phase.referenceInstant).toEqual(instant)
    expect(result.object.source.phase.meanAnomalyAtReferenceRad).toBe(drifted.phase.meanAnomalyAtReferenceRad)
    expect(result.object.source.geometry.argOfPeriapsisRad).toBe(drifted.geometry.argOfPeriapsisRad)
  })
})
