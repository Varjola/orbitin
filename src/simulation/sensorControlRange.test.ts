import { describe, expect, it } from 'vitest'
import { degToRad, radToDeg } from '../core/angles.ts'
import {
  EARTH_RADIUS_KM, SENSOR_ANGLE_SLIDER_STEPS, SENSOR_DEFAULT_FIELD_OF_VIEW_HALF_ANGLE_RAD,
  SENSOR_DEFAULT_OFF_NADIR_STEERING_RAD, SIMULATION_START_INSTANT,
} from '../core/constants.ts'
import { subSatellitePointFromEarthFixed } from './groundTrack.ts'
import type { GroundReachConstraint, IdealizedSensorDefinition, OrbitSource } from './OrbitalObject.ts'
import { ORBIT_PRESETS, createObjectFromPreset } from './orbitPresets.ts'
import {
  createInstantaneousSensorGeometry, defaultSensorDefinition, horizonOffNadirAngleForRadius,
  offNadirLimitForElevation, sphericalCapAreaKm2, surfaceAngularRadiusForOffNadir,
} from './sensorFootprint.ts'
import {
  angleForSliderPosition, fieldOfViewForSliderPosition, fieldOfViewSliderScale, sensorControlRadiusKm,
  sliderPositionForAngle, sliderPositionForSteeringLimit, steeringLimitForSliderPosition, steeringSliderScale,
} from './sensorControlRange.ts'

const GEO_RADIUS_KM = 42164.17
const MEO_RADIUS_KM = 26560
const LEO_RADIUS_KM = EARTH_RADIUS_KM + 500
const EARTH_AREA_KM2 = 4 * Math.PI * EARTH_RADIUS_KM ** 2

function keplerian(semiMajorAxisKm: number, eccentricity = 0): OrbitSource {
  return {
    kind: 'keplerian',
    geometry: { semiMajorAxisKm, eccentricity, inclinationRad: 0, raanRad: 0, argOfPeriapsisRad: 0 },
    phase: { referenceInstant: { ...SIMULATION_START_INSTANT }, meanAnomalyAtReferenceRad: 0 },
  }
}

function geometryAt(radiusKm: number, sensor: IdealizedSensorDefinition, reachConstraint?: GroundReachConstraint) {
  const positionEarthFixedKm = { x: radiusKm, y: 0, z: 0 }
  const centre = subSatellitePointFromEarthFixed(positionEarthFixedKm, SIMULATION_START_INSTANT)!
  const result = createInstantaneousSensorGeometry({ instant: SIMULATION_START_INSTANT, positionEarthFixedKm, centre, sensor, reachConstraint })
  if (result.kind !== 'valid') throw new Error(result.message)
  return result.geometry
}

function coverage(radiusKm: number, angleRad: number, elevationRad = 0): number {
  return surfaceAngularRadiusForOffNadir(radiusKm, angleRad, elevationRad)!.angularRadiusRad
}

describe('one authored sensor across orbits', () => {
  it('gives every preset the same physical sensor regardless of altitude', () => {
    for (const preset of ORBIT_PRESETS) {
      const { sensor } = createObjectFromPreset(preset, { id: preset.id, name: preset.id, colorHex: 0 }, SIMULATION_START_INSTANT)
      expect(sensor).toEqual(defaultSensorDefinition())
      expect(sensor.fieldOfViewHalfAngleRad).toBe(SENSOR_DEFAULT_FIELD_OF_VIEW_HALF_ANGLE_RAD)
      expect(sensor.maxOffNadirSteeringRad).toBe(SENSOR_DEFAULT_OFF_NADIR_STEERING_RAD)
    }
    expect(radToDeg(SENSOR_DEFAULT_FIELD_OF_VIEW_HALF_ANGLE_RAD)).toBeCloseTo(5, 12)
    expect(radToDeg(SENSOR_DEFAULT_OFF_NADIR_STEERING_RAD)).toBeCloseTo(3, 12)
  })

  it('turns the same 5 deg sensor into very different footprints at LEO, MEO and GEO', () => {
    const sensor = defaultSensorDefinition()
    const [leo, meo, geo] = [LEO_RADIUS_KM, MEO_RADIUS_KM, GEO_RADIUS_KM].map((radiusKm) => geometryAt(radiusKm, sensor))
    for (const geometry of [leo, meo, geo]) {
      // The authored angles pass through unchanged; nothing is re-derived per orbit.
      expect(geometry.fieldOfViewHalfAngleRad).toBe(sensor.fieldOfViewHalfAngleRad)
      expect(geometry.maxOffNadirSteeringRad).toBe(sensor.maxOffNadirSteeringRad)
      expect(geometry.footprint.limitedBy).toBe('sensor')
      expect(geometry.fieldOfRegard.limitedBy).toBe('sensor')
      expect(geometry.fieldOfRegard.angularRadiusRad).toBeGreaterThan(geometry.footprint.angularRadiusRad)
    }
    expect(leo.footprint.surfaceRadiusKm).toBeGreaterThan(40)
    expect(leo.footprint.surfaceRadiusKm).toBeLessThan(50)
    expect(meo.footprint.surfaceRadiusKm).toBeGreaterThan(1780)
    expect(meo.footprint.surfaceRadiusKm).toBeLessThan(1840)
    expect(geo.footprint.surfaceRadiusKm).toBeGreaterThan(3330)
    expect(geo.footprint.surfaceRadiusKm).toBeLessThan(3390)
    expect(geo.footprint.areaKm2 / leo.footprint.areaKm2).toBeGreaterThan(5000)
    expect(geo.footprint.slantRangeKm).toBeGreaterThan(leo.footprint.slantRangeKm)
    expect(geo.footprint.edgeElevationRad).toBeLessThan(leo.footprint.edgeElevationRad)
  })

  it('lets the elliptical preset show honest horizon saturation near apoapsis', () => {
    const sensor = defaultSensorDefinition()
    const apoapsis = geometryAt(46284, sensor)
    expect(apoapsis.footprint.limitedBy).toBe('sensor')
    expect(apoapsis.fieldOfRegard.limitedBy).toBe('horizon')
    expect(apoapsis.maxOffNadirSteeringRad).toBe(sensor.maxOffNadirSteeringRad)
  })
})

describe('geometry-aware angle slider', () => {
  it('ends the GEO half-angle travel at the horizon instead of at 80 deg', () => {
    const scale = fieldOfViewSliderScale(GEO_RADIUS_KM, 0)
    expect(scale.endAngleRad).toBe(horizonOffNadirAngleForRadius(GEO_RADIUS_KM))
    expect(radToDeg(scale.endAngleRad)).toBeCloseTo(8.7, 1)
    expect(fieldOfViewForSliderPosition(scale, SENSOR_ANGLE_SLIDER_STEPS)).toBe(scale.endAngleRad)
    // Every notch before the last still widens the footprint, so no travel is inert.
    const lastInside = angleForSliderPosition(scale, SENSOR_ANGLE_SLIDER_STEPS - 1)
    expect(surfaceAngularRadiusForOffNadir(GEO_RADIUS_KM, lastInside, 0)!.limitedBy).toBe('sensor')
    // An active reach constraint narrows the useful range the same way.
    expect(fieldOfViewSliderScale(GEO_RADIUS_KM, degToRad(10)).endAngleRad).toBe(offNadirLimitForElevation(GEO_RADIUS_KM, degToRad(10)))
    expect(fieldOfViewSliderScale(LEO_RADIUS_KM, 0).endAngleRad).toBe(horizonOffNadirAngleForRadius(LEO_RADIUS_KM))
  })

  it('keeps useful resolution at the GEO limb and near nadir at LEO', () => {
    const geo = fieldOfViewSliderScale(GEO_RADIUS_KM, 0)
    let worstAreaStep = 0
    let previousArea = sphericalCapAreaKm2(coverage(GEO_RADIUS_KM, angleForSliderPosition(geo, 0)))
    for (let position = 1; position <= geo.steps; position += 1) {
      const area = sphericalCapAreaKm2(coverage(GEO_RADIUS_KM, angleForSliderPosition(geo, position)))
      worstAreaStep = Math.max(worstAreaStep, (area - previousArea) / EARTH_AREA_KM2)
      previousArea = area
    }
    // A fixed 0.5 deg notch moved up to 8.1 percent of Earth near the GEO limb.
    expect(worstAreaStep).toBeLessThan(0.002)
    const leo = fieldOfViewSliderScale(LEO_RADIUS_KM, 0)
    let worstAngleStep = 0
    for (let position = 1; angleForSliderPosition(leo, position) < degToRad(10); position += 1) {
      worstAngleStep = Math.max(worstAngleStep, angleForSliderPosition(leo, position) - angleForSliderPosition(leo, position - 1))
    }
    // Coverage-only pacing spent 0.28 deg per notch here.
    expect(radToDeg(worstAngleStep)).toBeLessThan(0.15)
  })

  it('round-trips positions and angles within one notch', () => {
    for (const [radiusKm, elevationDeg] of [[LEO_RADIUS_KM, 0], [GEO_RADIUS_KM, 0], [GEO_RADIUS_KM, 10], [6916, 5]] as const) {
      const scale = fieldOfViewSliderScale(radiusKm, degToRad(elevationDeg))
      for (const position of [0, 1, 2, 57, 500, 998, 999, SENSOR_ANGLE_SLIDER_STEPS]) {
        expect(sliderPositionForAngle(scale, angleForSliderPosition(scale, position))).toBe(position)
      }
      for (const degrees of [0.5, 3, 5, 8.25]) {
        const angle = degToRad(degrees)
        const position = sliderPositionForAngle(scale, angle)
        expect(angle).toBeGreaterThanOrEqual(angleForSliderPosition(scale, position - 1))
        expect(angle).toBeLessThanOrEqual(angleForSliderPosition(scale, position + 1))
      }
    }
  })

  it('pins an authored angle past the useful limit without changing it', () => {
    const scale = fieldOfViewSliderScale(GEO_RADIUS_KM, 0)
    const authored = { fieldOfViewHalfAngleRad: degToRad(12), maxOffNadirSteeringRad: 0 }
    expect(sliderPositionForAngle(scale, authored.fieldOfViewHalfAngleRad)).toBe(SENSOR_ANGLE_SLIDER_STEPS)
    const geometry = geometryAt(GEO_RADIUS_KM, authored)
    expect(geometry.fieldOfViewHalfAngleRad).toBe(authored.fieldOfViewHalfAngleRad)
    expect(geometry.footprint.limitedBy).toBe('horizon')
    // Widening further adds no surface: the limb is the limb.
    expect(geometryAt(GEO_RADIUS_KM, { ...authored, fieldOfViewHalfAngleRad: degToRad(30) }).footprint.areaKm2).toBe(geometry.footprint.areaKm2)
    expect(geometryAt(GEO_RADIUS_KM, { ...authored, fieldOfViewHalfAngleRad: scale.endAngleRad }).footprint.areaKm2).toBe(geometry.footprint.areaKm2)
  })

  it('spends the steering travel between the half-angle and the limit', () => {
    const fieldOfViewHalfAngleRad = degToRad(5)
    const scale = steeringSliderScale(GEO_RADIUS_KM, 0, fieldOfViewHalfAngleRad)
    expect(steeringLimitForSliderPosition(scale, 0)).toBe(0)
    expect(steeringLimitForSliderPosition(scale, SENSOR_ANGLE_SLIDER_STEPS)).toBeCloseTo(horizonOffNadirAngleForRadius(GEO_RADIUS_KM)! - fieldOfViewHalfAngleRad, 12)
    expect(sliderPositionForSteeringLimit(scale, degToRad(3))).toBeGreaterThan(0)
    expect(sliderPositionForSteeringLimit(scale, degToRad(20))).toBe(SENSOR_ANGLE_SLIDER_STEPS)
    const steered = geometryAt(GEO_RADIUS_KM, { fieldOfViewHalfAngleRad, maxOffNadirSteeringRad: degToRad(20) })
    expect(steered.maxOffNadirSteeringRad).toBe(degToRad(20))
    expect(steered.footprint.limitedBy).toBe('sensor')
    expect(steered.fieldOfRegard.limitedBy).toBe('horizon')
    // A half-angle already past the limb leaves steering nothing to widen.
    const saturated = steeringSliderScale(GEO_RADIUS_KM, 0, degToRad(10))
    expect(saturated.endAngleRad).toBe(saturated.startAngleRad)
    expect(sliderPositionForSteeringLimit(saturated, degToRad(3))).toBe(0)
    expect(steeringLimitForSliderPosition(saturated, 500)).toBe(0)
  })

  it('scales an eccentric orbit from periapsis so nothing the orbit can reach is unreachable', () => {
    const elliptical = keplerian(26600, 0.74)
    // Periapsis, not apoapsis: an apoapsis-scaled control would end this orbit's
    // travel at 7.9 deg off nadir, a pinprick at its 538 km periapsis.
    expect(sensorControlRadiusKm(elliptical)).toBeCloseTo(6916, 0)
    expect(radToDeg(fieldOfViewSliderScale(sensorControlRadiusKm(elliptical), 0).endAngleRad)).toBeGreaterThan(60)
  })

  it('estimates the control radius from SGP4 mean motion without claiming an osculating element', () => {
    const geoMeanMotion = (2 * Math.PI) / (86164.0905 / 60)
    const source: OrbitSource = {
      kind: 'omm',
      definition: { meanElements: { meanMotionRadPerMinute: geoMeanMotion, eccentricity: 0 } },
    } as unknown as OrbitSource
    expect(sensorControlRadiusKm(source)).toBeCloseTo(GEO_RADIUS_KM, -1)
  })
})
