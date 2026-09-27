import { describe, expect, it } from 'vitest'
import { EARTH_RADIUS_KM, SIMULATION_START_INSTANT } from '../core/constants.ts'
import type { EarthFixedVec3 } from '../core/referenceFrames.ts'
import { dotVec3, lengthVec3, subtractVec3 } from '../core/vec3.ts'
import { subSatellitePointFromEarthFixed } from './groundTrack.ts'
import type { IdealizedSensorDefinition } from './OrbitalObject.ts'
import {
  buildSensorBoundary,
  createInstantaneousSensorGeometry,
  defaultGroundReachConstraint,
  defaultSensorDefinition,
  horizonOffNadirAngleForRadius,
  maxCoverageAngleForElevation,
  offNadirForCoverageAngle,
  offNadirLimitForElevation,
  sphericalCapAreaKm2,
  surfaceAngularRadiusForOffNadir,
} from './sensorFootprint.ts'

const instant = { ...SIMULATION_START_INSTANT }
const sensor: IdealizedSensorDefinition = { fieldOfViewHalfAngleRad: 20 * Math.PI / 180, maxOffNadirSteeringRad: 20 * Math.PI / 180 }

function geometryAt(positionEarthFixedKm: EarthFixedVec3, definition: Partial<IdealizedSensorDefinition> = {}, minimumGroundElevationRad?: number) {
  const centre = subSatellitePointFromEarthFixed(positionEarthFixedKm, instant)
  if (!centre) throw new Error('fixture centre is invalid')
  const result = createInstantaneousSensorGeometry({
    instant, positionEarthFixedKm, centre, sensor: { ...sensor, ...definition },
    reachConstraint: minimumGroundElevationRad === undefined ? undefined : { minimumGroundElevationRad },
  })
  if (result.kind !== 'valid') throw new Error(result.message)
  return result.geometry
}

describe('instantaneous spherical sensor geometry', () => {
  it('matches the fixed LEO reference for angular radius and area', () => {
    const geometry = geometryAt({ x: EARTH_RADIUS_KM + 500, y: 0, z: 0 })
    expect(geometry.footprint.angularRadiusRad * 180 / Math.PI).toBeCloseTo(1.643605362, 8)
    expect(geometry.footprint.areaKm2).toBeCloseTo(105161.704, 0)
  })

  it('clips GEO to the visible horizon without changing authored angles', () => {
    const geometry = geometryAt({ x: 42164.17, y: 0, z: 0 }, { fieldOfViewHalfAngleRad: 10 * Math.PI / 180, maxOffNadirSteeringRad: 0 })
    expect(geometry.footprint.limitedBy).toBe('horizon')
    expect(geometry.footprint.angularRadiusRad * 180 / Math.PI).toBeCloseTo(81.299518774, 8)
    expect(geometry.fieldOfViewHalfAngleRad).toBeCloseTo(10 * Math.PI / 180)
  })

  it('reuses coincident caps for zero steering and keeps authored FOR steering separate', () => {
    const zero = geometryAt({ x: EARTH_RADIUS_KM + 700, y: 123, z: 456 }, { fieldOfViewHalfAngleRad: 5 * Math.PI / 180, maxOffNadirSteeringRad: 0 })
    expect(zero.fieldOfRegard).toBe(zero.footprint)
    const wide = geometryAt({ x: EARTH_RADIUS_KM + 700, y: 123, z: 456 })
    expect(wide.fieldOfRegard.angularRadiusRad).toBeGreaterThan(wide.footprint.angularRadiusRad)
    expect(wide.fieldOfRegard.areaKm2).toBeGreaterThan(wide.footprint.areaKm2)
  })

  it('handles zero-area caps as finite empty boundaries', () => {
    const geometry = geometryAt({ x: EARTH_RADIUS_KM + 500, y: 0, z: 0 }, { fieldOfViewHalfAngleRad: 0, maxOffNadirSteeringRad: 0 })
    expect(geometry.footprint.boundary).toEqual([])
    expect(geometry.footprint.areaKm2).toBe(0)
    expect(sphericalCapAreaKm2(1e-12)).toBeGreaterThanOrEqual(0)
  })

  it('constructs finite pole-safe ordered boundary samples on the sphere', () => {
    const centre = { x: 0, y: 0, z: 1 }
    const boundary = buildSensorBoundary(centre, 0.2, 16)
    expect(boundary).toHaveLength(17)
    for (const point of boundary) {
      expect(lengthVec3(point.positionEarthFixedKm)).toBeCloseTo(EARTH_RADIUS_KM, 10)
      expect(Number.isFinite(point.geodeticLatitudeRad)).toBe(true)
    }
  })

  it('places every unsaturated boundary ray at the authored limiting angle', () => {
    const position = { x: EARTH_RADIUS_KM + 500, y: 700, z: 300 }
    const geometry = geometryAt(position)
    const boresight = geometry.boresightDirectionEarthFixed
    for (const point of geometry.footprint.boundary.slice(0, -1)) {
      const ray = subtractVec3(point.positionEarthFixedKm, geometry.spacecraftPositionEarthFixedKm)
      expect(Math.acos(dotVec3(boresight, { x: ray.x / lengthVec3(ray), y: ray.y / lengthVec3(ray), z: ray.z / lengthVec3(ray) })))
        .toBeCloseTo(geometry.fieldOfViewHalfAngleRad, 8)
    }
  })

  it('uses the complementary horizon angles', () => {
    const horizon = horizonOffNadirAngleForRadius(EARTH_RADIUS_KM + 500)!
    expect(horizon + Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + 500))).toBeCloseTo(Math.PI / 2, 14)
  })
})

describe('ground reach constraint', () => {
  const geoPosition = { x: 42164.17, y: 0, z: 0 }
  const wideOpen = { fieldOfViewHalfAngleRad: 30 * Math.PI / 180, maxOffNadirSteeringRad: 0 }
  const degrees = (value: number) => value * Math.PI / 180

  it('keeps the constraint out of the sensor definition', () => {
    expect(Object.keys(defaultSensorDefinition()).sort()).toEqual(['fieldOfViewHalfAngleRad', 'maxOffNadirSteeringRad'])
    expect(defaultGroundReachConstraint()).toEqual({ minimumGroundElevationRad: 0 })
    const constrained = geometryAt(geoPosition, wideOpen, degrees(10))
    // The constraint limits the surface result; it never rewrites the sensor.
    expect(constrained.fieldOfViewHalfAngleRad).toBe(wideOpen.fieldOfViewHalfAngleRad)
    expect(constrained.maxOffNadirSteeringRad).toBe(wideOpen.maxOffNadirSteeringRad)
    expect(constrained.minimumGroundElevationRad).toBe(degrees(10))
  })

  it('reproduces pure horizon geometry at zero elevation', () => {
    const omitted = geometryAt(geoPosition, wideOpen)
    const zero = geometryAt(geoPosition, wideOpen, 0)
    expect(zero).toEqual(omitted)
    expect(zero.footprint.limitedBy).toBe('horizon')
    expect(zero.elevationOffNadirAngleRad).toBe(zero.horizonOffNadirAngleRad)
    const leoNarrow = { x: EARTH_RADIUS_KM + 500, y: 0, z: 0 }
    expect(geometryAt(leoNarrow, {}, 0)).toEqual(geometryAt(leoNarrow))
  })

  it('clips a GEO footprint to a minimum ground elevation instead of the geometric limb', () => {
    const masked = geometryAt(geoPosition, wideOpen, degrees(5))
    expect(masked.footprint.limitedBy).toBe('elevation')
    expect(masked.footprint.angularRadiusRad * 180 / Math.PI).toBeCloseTo(76.3329, 4)
    // The clip is exact: the boundary sits at the constraint, not near it.
    expect(masked.footprint.edgeElevationRad * 180 / Math.PI).toBeCloseTo(5, 10)
    const horizonOnly = geometryAt(geoPosition, wideOpen, 0)
    expect(horizonOnly.footprint.angularRadiusRad * 180 / Math.PI).toBeCloseTo(81.2995, 4)
    expect(horizonOnly.footprint.areaKm2 / masked.footprint.areaKm2).toBeGreaterThan(1.1)
  })

  it('reduces the reachable surface steadily as the minimum elevation rises', () => {
    const areas = [0, 5, 10, 15, 20].map((value) => geometryAt(geoPosition, wideOpen, degrees(value)).footprint.areaKm2)
    for (let index = 1; index < areas.length; index += 1) expect(areas[index]).toBeLessThan(areas[index - 1])
    // A narrow sensor well inside the limit is unaffected by a modest constraint.
    const narrow = { fieldOfViewHalfAngleRad: degrees(5), maxOffNadirSteeringRad: 0 }
    expect(geometryAt(geoPosition, narrow, degrees(10)).footprint.areaKm2).toBe(geometryAt(geoPosition, narrow, 0).footprint.areaKm2)
  })

  it('reports the elevation of an unsaturated boundary rather than only that it is unsaturated', () => {
    const geometry = geometryAt({ x: EARTH_RADIUS_KM + 800, y: 0, z: 0 }, { fieldOfViewHalfAngleRad: 60 * Math.PI / 180, maxOffNadirSteeringRad: 0 }, degrees(5))
    expect(geometry.footprint.limitedBy).toBe('sensor')
    const expected = 90 - Math.asin(((EARTH_RADIUS_KM + 800) / EARTH_RADIUS_KM) * Math.sin(60 * Math.PI / 180)) * 180 / Math.PI
    expect(geometry.footprint.edgeElevationRad * 180 / Math.PI).toBeCloseTo(expected, 10)
  })

  it('measures the slant range and reachable latitude of each cap', () => {
    const radiusKm = EARTH_RADIUS_KM + 800
    const geometry = geometryAt({ x: 0, y: 0, z: radiusKm }, { fieldOfViewHalfAngleRad: 30 * Math.PI / 180, maxOffNadirSteeringRad: 10 * Math.PI / 180 }, 0)
    const cap = geometry.footprint
    // Law of cosines against the sine-rule slant distance the boundary implies.
    expect(cap.slantRangeKm).toBeCloseTo(EARTH_RADIUS_KM * Math.sin(cap.angularRadiusRad) / Math.sin(cap.offNadirAngleRad), 6)
    // Centred on the north pole, so the cap reaches the pole and stops there.
    expect(cap.maxGeocentricLatitudeRad).toBeCloseTo(Math.PI / 2, 12)
    expect(geometry.fieldOfRegard.slantRangeKm).toBeGreaterThan(cap.slantRangeKm)
  })

  it('treats the horizon as the zero-elevation case of the same limit', () => {
    const radiusKm = EARTH_RADIUS_KM + 500
    expect(offNadirLimitForElevation(radiusKm, 0)).toBeCloseTo(horizonOffNadirAngleForRadius(radiusKm)!, 14)
    expect(maxCoverageAngleForElevation(radiusKm, 0)).toBeCloseTo(Math.acos(EARTH_RADIUS_KM / radiusKm), 12)
  })

  it('inverts the cap solution exactly over the whole visible range', () => {
    const radiusKm = 42164.17
    for (const coverageDeg of [0.25, 5, 30, 60, 76.3, 81.2]) {
      const coverageRad = coverageDeg * Math.PI / 180
      const offNadir = offNadirForCoverageAngle(radiusKm, coverageRad)!
      expect(surfaceAngularRadiusForOffNadir(radiusKm, offNadir, 0)!.angularRadiusRad).toBeCloseTo(coverageRad, 12)
    }
  })

  it('rejects a minimum elevation outside the authored range', () => {
    const centre = subSatellitePointFromEarthFixed(geoPosition, instant)!
    const result = createInstantaneousSensorGeometry({
      instant, positionEarthFixedKm: geoPosition, centre, sensor: wideOpen,
      reachConstraint: { minimumGroundElevationRad: 45 * Math.PI / 180 },
    })
    expect(result.kind).toBe('invalid')
    expect(result.kind === 'invalid' && result.reason).toBe('invalidReachConstraint')
  })
})
