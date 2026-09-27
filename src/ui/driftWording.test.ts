import { describe, expect, it } from 'vitest'
import { degToRad } from '../core/angles.ts'
import { angleReadoutsFor, classifyElements } from '../orbital/elementConditioning.ts'
import { j2SecularRates } from '../orbital/j2Secular.ts'
import type { OrbitGeometry } from '../orbital/geometry.ts'
import { conditioningNotes, lockStatusMessage, modelNote } from './driftWording.ts'

const notesFor = (inclinationDeg: number, eccentricity: number) => {
  const geometry: OrbitGeometry = {
    semiMajorAxisKm: 7178.137, eccentricity,
    inclinationRad: degToRad(inclinationDeg), raanRad: 1.1, argOfPeriapsisRad: 2.2,
  }
  const conditioning = classifyElements(geometry)
  return conditioningNotes(conditioning, angleReadoutsFor(geometry, 0.7, j2SecularRates(geometry), conditioning)).join(' ')
}

describe('singular versus ill-conditioned wording', () => {
  // These are different statements and the UI must
  // not use the first where the second is true (INV-6).
  it('says an equatorial orbit has no unique node, without calling 0.2 deg undefined', () => {
    expect(notesFor(0, 0.01)).toContain('An equatorial orbit has no unique ascending node')
    const suppressed = notesFor(0.2, 0.01)
    expect(suppressed).toContain('poorly conditioned')
    expect(suppressed).toContain('the node still exists')
    expect(suppressed).not.toContain('no unique ascending node')
  })

  it('says a circular orbit has no unique periapsis, without calling e = 5e-4 undefined', () => {
    expect(notesFor(51.5, 0)).toContain('A circular orbit has no unique periapsis')
    const suppressed = notesFor(51.5, 5e-4)
    expect(suppressed).toContain('not a physically identifiable point')
    expect(suppressed).toContain('it exists')
    expect(suppressed).not.toContain('no unique periapsis')
  })

  // The substituted quantity is named from what is actually shown, so a
  // circular equatorial orbit is told about its mean longitude and not about an
  // argument of latitude it is not being given.
  it.each([
    [51.5, 0, 'argument of latitude'],
    [0, 0.01, 'longitude of periapsis'],
    [0, 0, 'mean longitude'],
    [0.2, 5e-4, 'mean longitude'],
  ])('names the substituted quantity at i=%f e=%f as its %s', (inclinationDeg, eccentricity, expected) => {
    expect(notesFor(inclinationDeg, eccentricity)).toContain(`The meaningful quantity here is its ${expected}.`)
  })

  it('says nothing when both elements are reportable', () => {
    expect(notesFor(51.5, 0.01)).toBe('')
  })

  it('never describes an ill-conditioned orbit as undefined', () => {
    for (const text of [notesFor(0.2, 0.01), notesFor(51.5, 5e-4), notesFor(0.2, 5e-4), notesFor(179.9, 0.01)]) {
      expect(text.toLowerCase()).not.toContain('undefined')
      expect(text).not.toContain('Not applicable')
    }
  })
})

describe('per-object model wording', () => {
  it('stops claiming every orbit is two-body, and states the drift sign convention', () => {
    expect(modelNote('idealTwoBody')).toContain('The plane stays fixed in space')
    const drift = modelNote('j2Secular')
    expect(drift).toContain('mean elements')
    expect(drift).toContain('does not convert between them')
    expect(drift).toContain('westward regression')
    expect(drift).not.toContain('osculating radius')
  })
})

describe('lock messages', () => {
  it('explains each outcome, and says RAAN is left alone when the lock applies', () => {
    expect(lockStatusMessage({ kind: 'none' })).toBe('')
    const applied = lockStatusMessage({ kind: 'applied', inclinationRad: degToRad(98.6) })
    expect(applied).toContain('98.60°')
    expect(applied).toContain('RAAN is left alone')
    const bound = lockStatusMessage({ kind: 'unattainable', maximumSemiMajorAxisKm: 12352.5, maximumAltitudeKm: 5974.4 })
    expect(bound).toContain('12,353 km')
    expect(bound).toContain('The value you set is kept')
    expect(lockStatusMessage({ kind: 'releasedByInclinationEdit' })).toContain('released')
    expect(lockStatusMessage({ kind: 'releasedByPropagationChange' })).toContain('no nodal drift for it to hold')
    expect(lockStatusMessage({ kind: 'requiresJ2Drift' })).toContain('J2 drift model only')
  })
})
