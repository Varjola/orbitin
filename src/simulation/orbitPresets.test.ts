import { describe, expect, it } from 'vitest'
import { ORBIT_PRESETS, createObjectFromPreset, resolvePresetGeometry } from './orbitPresets.ts'
import { constrainGeometry, deriveOrbitValues, validateGeometry } from '../orbital/geometry.ts'
import { currentTrueAnomaly } from '../orbital/keplerianPropagator.ts'
import { geometryControlDefinitions } from '../ui/controlDefinitions.ts'
import { radToDeg } from '../core/angles.ts'

describe('orbit examples', () => {
  it('fits all physical and editor bounds without clamping', () => {
    for (const preset of ORBIT_PRESETS) {
      expect(() => validateGeometry(resolvePresetGeometry(preset, { unixSeconds: 12345 }))).not.toThrow()
      // Every preset but the Sun-synchronous one is ideal two-body and unlocked
      // (INV-7).
      expect(preset.propagation.kind).toBe(preset.id === 'sso' ? 'j2Secular' : 'idealTwoBody')
      expect(preset.editingLock.kind).toBe(preset.id === 'sso' ? 'sunSynchronous' : 'none')
      for (const definition of geometryControlDefinitions) {
        const raw = resolvePresetGeometry(preset, { unixSeconds: 12345 })[definition.field]
        const value = definition.unit === 'deg' ? radToDeg(raw) : raw
        expect(value).toBeGreaterThanOrEqual(definition.min)
        expect(value).toBeLessThanOrEqual(definition.max)
        expect(constrainGeometry(resolvePresetGeometry(preset, { unixSeconds: 12345 }), definition.field).constraint.kind).toBe('none')
      }
    }
    expect(deriveOrbitValues(ORBIT_PRESETS[0].geometry).periapsisAltitudeKm).toBeCloseTo(500)
    expect(deriveOrbitValues(ORBIT_PRESETS[3].geometry).periapsisAltitudeKm).toBeCloseTo(800)
    const elliptical = deriveOrbitValues(ORBIT_PRESETS[4].geometry)
    expect(elliptical.periapsisRadiusKm).toBeCloseTo(6916)
    expect(elliptical.apoapsisRadiusKm).toBeCloseTo(46284)
    expect(deriveOrbitValues(ORBIT_PRESETS[2].geometry).periodSeconds).toBeCloseTo(86164.1, -1)
  })
  it('anchors additions at their declared anomaly at the current instant and clones nested data', () => {
    const instant = { unixSeconds: 12345 }
    for (const preset of ORBIT_PRESETS) {
      const a = createObjectFromPreset(preset, { id: 'a', name: 'A', colorHex: 1 }, instant)
      const b = createObjectFromPreset(preset, { id: 'b', name: 'B', colorHex: 2 }, instant)
      expect(currentTrueAnomaly(a.source.geometry, a.source.phase, instant)).toBeCloseTo(preset.initialTrueAnomalyRad)
      a.source.geometry.eccentricity = 0.3
      a.source.phase.referenceInstant.unixSeconds = 0
      a.display.bodyVisible = false
      // A Sun-synchronous preset solves its inclination and RAAN at the instant
      // it is added, so the resolver - not the stored table entry - is what a
      // created object must match.
      expect(b.source.geometry).toEqual(resolvePresetGeometry(preset, instant))
      expect(b.source.phase.referenceInstant).toEqual(instant)
      expect(b.display.bodyVisible).toBe(true)
    }
  })
})
