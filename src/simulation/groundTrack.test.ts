import { expect, it, vi } from 'vitest'
import { degToRad, radToDeg } from '../core/angles.ts'
import { EARTH_FLATTENING, EARTH_MU_KM3_S2, EARTH_RADIUS_KM, MAX_APOAPSIS_RADIUS_KM, MIN_PERIAPSIS_RADIUS_KM } from '../core/constants.ts'
import { identityMat3 } from '../core/mat3.ts'
import type { EarthOrientation, EarthFixedVec3 } from '../core/referenceFrames.ts'
import { earthOrientationAt } from './earthOrientation.ts'
import { createPropagator, type PropagationModel } from './OrbitalObject.ts'
import { ORBIT_PRESETS, createObjectFromPreset, type OrbitPresetId } from './orbitPresets.ts'
import {
  GROUND_TRACK_SAMPLE_INTERVALS,
  geodeticLatitudeFromEarthFixed,
  groundTrackStepBetween,
  subSatellitePointFromEarthFixed,
  sampleGroundTrack,
  segmentGroundTrackSamples,
  nominalOrbitalPeriodSeconds,
  type GroundTrackSamplingOptions,
} from './groundTrack.ts'

const instant = { unixSeconds: 0 }
const identityOrientation: EarthOrientation = {
  instant,
  gmstRad: 0,
  precessionToMeanOfDate: identityMat3(),
  projectInertialToEarthFixed: identityMat3(),
  earthFixedToProjectInertial: identityMat3(),
}

function earthFixed(x: number, y: number, z = 0): EarthFixedVec3 { return { x, y, z } }
function stateAtLongitude(unixSeconds: number, offset = 0) {
  const longitude = offset + unixSeconds * 0.5
  return {
    positionProjectInertialKm: { x: Math.cos(longitude) * 7000, y: Math.sin(longitude) * 7000, z: 0 },
    velocityProjectInertialKmPerSecond: { x: 0, y: 0, z: 0 },
  }
}

it('projects Earth-fixed axes with north/east signs and honest poles', () => {
  expect(subSatellitePointFromEarthFixed(earthFixed(1, 0), instant)!.longitudeRad).toBeCloseTo(0, 14)
  expect(subSatellitePointFromEarthFixed(earthFixed(0, 1), instant)!.longitudeRad).toBeCloseTo(Math.PI / 2, 14)
  expect(subSatellitePointFromEarthFixed(earthFixed(0, -1), instant)!.longitudeRad).toBeCloseTo(-Math.PI / 2, 14)
  expect(subSatellitePointFromEarthFixed(earthFixed(0, 0, 1), instant)!.geocentricLatitudeRad).toBeCloseTo(Math.PI / 2, 14)
  expect(subSatellitePointFromEarthFixed(earthFixed(0, 0, 1), instant)!.longitudeRad).toBeNull()
  expect(subSatellitePointFromEarthFixed(earthFixed(0, 0, -1), instant)!.geocentricLatitudeRad).toBeCloseTo(-Math.PI / 2, 14)
  expect(subSatellitePointFromEarthFixed(earthFixed(0, 0, -1), instant)!.longitudeRad).toBeNull()
  expect(subSatellitePointFromEarthFixed(earthFixed(-1, 0), instant)!.longitudeRad).toBeCloseTo(-Math.PI, 14)
  expect(subSatellitePointFromEarthFixed(earthFixed(0, 0, 0), instant)).toBeNull()
  expect(subSatellitePointFromEarthFixed(earthFixed(Number.NaN, 0), instant)).toBeNull()
})


// WGS-84 geodetic latitude is additive: it is a second
// named coordinate representation of the same Earth-fixed position, added for
// the geographic 2D map, and it must not disturb the spherical 3D result.

/** Independent WGS-84 geodetic -> ECEF fixtures, computed from the standard
 *  forward formula rather than from the code under test. */
const WGS84_SURFACE_FIXTURES = [
  { latitudeDeg: 30, longitudeDeg: 0, km: earthFixed(5528.256639, 0, 3170.373735), geocentricDeg: 29.8336358 },
  { latitudeDeg: 45, longitudeDeg: 0, km: earthFixed(4517.590879, 0, 4487.348409), geocentricDeg: 44.8075768 },
  { latitudeDeg: 80, longitudeDeg: 0, km: earthFixed(1111.164871, 0, 6259.542961), geocentricDeg: 79.9339788 },
  { latitudeDeg: -45, longitudeDeg: 150, km: earthFixed(-3912.348465, 2258.795439, -4487.348409), geocentricDeg: -44.8075768 },
] as const

it('gives an equatorial position zero latitude in both definitions and keeps the longitude signs', () => {
  const east = subSatellitePointFromEarthFixed(earthFixed(7000, 0), instant)!
  const north = subSatellitePointFromEarthFixed(earthFixed(0, 7000), instant)!
  const west = subSatellitePointFromEarthFixed(earthFixed(0, -7000), instant)!
  for (const point of [east, north, west]) {
    expect(point.geocentricLatitudeRad).toBe(0)
    expect(point.geodeticLatitudeRad).toBe(0)
  }
  expect(east.longitudeRad).toBeCloseTo(0, 14)
  expect(north.longitudeRad).toBeCloseTo(Math.PI / 2, 14)
  expect(west.longitudeRad).toBeCloseTo(-Math.PI / 2, 14)
})

it('gives an exactly polar position +/-90 deg in both definitions and no longitude', () => {
  const north = subSatellitePointFromEarthFixed(earthFixed(0, 0, 7000), instant)!
  const south = subSatellitePointFromEarthFixed(earthFixed(0, 0, -7000), instant)!
  expect(north.geocentricLatitudeRad).toBe(Math.PI / 2)
  expect(north.geodeticLatitudeRad).toBe(Math.PI / 2)
  expect(north.longitudeRad).toBeNull()
  expect(south.geocentricLatitudeRad).toBe(-Math.PI / 2)
  expect(south.geodeticLatitudeRad).toBe(-Math.PI / 2)
  expect(south.longitudeRad).toBeNull()
})

it('recovers independent WGS-84 surface fixtures to better than a millidegree', () => {
  for (const fixture of WGS84_SURFACE_FIXTURES) {
    const point = subSatellitePointFromEarthFixed(fixture.km, instant)!
    expect(radToDeg(point.geodeticLatitudeRad)).toBeCloseTo(fixture.latitudeDeg, 6)
    expect(radToDeg(point.longitudeRad!)).toBeCloseTo(fixture.longitudeDeg, 6)
  }
})

it('recovers geodetic latitude at orbital altitude, not only on the ellipsoid surface', () => {
  // Generated from the same forward formula at 800 km, 20,200 km and 35,786 km,
  // so a method that happens to be right only at h = 0 fails here.
  const eccentricitySquared = EARTH_FLATTENING * (2 - EARTH_FLATTENING)
  for (const latitudeDeg of [-80, -45, -12.5, 12.5, 45, 80]) {
    for (const altitudeKm of [800, 20200, 35786]) {
      const latitude = degToRad(latitudeDeg)
      const primeVertical = EARTH_RADIUS_KM / Math.sqrt(1 - eccentricitySquared * Math.sin(latitude) ** 2)
      const horizontal = (primeVertical + altitudeKm) * Math.cos(latitude)
      const point = subSatellitePointFromEarthFixed(
        earthFixed(
          horizontal * Math.cos(degToRad(35)),
          horizontal * Math.sin(degToRad(35)),
          (primeVertical * (1 - eccentricitySquared) + altitudeKm) * Math.sin(latitude),
        ),
        instant,
      )!
      expect(radToDeg(point.geodeticLatitudeRad)).toBeCloseTo(latitudeDeg, 5)
      expect(radToDeg(point.longitudeRad!)).toBeCloseTo(35, 12)
    }
  }
})

it('places geodetic latitude further from the equator than geocentric, and equal at the equator and poles', () => {
  for (const fixture of WGS84_SURFACE_FIXTURES) {
    const point = subSatellitePointFromEarthFixed(fixture.km, instant)!
    expect(radToDeg(point.geocentricLatitudeRad)).toBeCloseTo(fixture.geocentricDeg, 5)
    // The ellipsoid normal tilts away from the radius toward the equator, so
    // |geodetic| > |geocentric| everywhere strictly between equator and pole.
    expect(Math.abs(point.geodeticLatitudeRad)).toBeGreaterThan(Math.abs(point.geocentricLatitudeRad))
    expect(Math.sign(point.geodeticLatitudeRad)).toBe(Math.sign(point.geocentricLatitudeRad))
  }
  // The maximum separation is about 0.19 deg near 45 deg.
  const midLatitude = subSatellitePointFromEarthFixed(WGS84_SURFACE_FIXTURES[1].km, instant)!
  expect(radToDeg(midLatitude.geodeticLatitudeRad - midLatitude.geocentricLatitudeRad)).toBeCloseTo(0.1924, 3)
  const equator = subSatellitePointFromEarthFixed(earthFixed(7000, 100), instant)!
  expect(equator.geodeticLatitudeRad).toBe(equator.geocentricLatitudeRad)
  const pole = subSatellitePointFromEarthFixed(earthFixed(0, 0, 7000), instant)!
  expect(pole.geodeticLatitudeRad).toBe(pole.geocentricLatitudeRad)
})

it('leaves the existing unit direction and geocentric latitude untouched by the geodetic addition', () => {
  for (const fixture of WGS84_SURFACE_FIXTURES) {
    const point = subSatellitePointFromEarthFixed(fixture.km, instant)!
    const length = Math.hypot(fixture.km.x, fixture.km.y, fixture.km.z)
    expect(point.directionEarthFixed).toEqual({ x: fixture.km.x / length, y: fixture.km.y / length, z: fixture.km.z / length })
    expect(point.geocentricLatitudeRad).toBe(Math.atan2(point.directionEarthFixed.z, Math.hypot(point.directionEarthFixed.x, point.directionEarthFixed.y)))
  }
})

it('returns no point at all rather than a partial one for degenerate positions', () => {
  for (const position of [earthFixed(0, 0, 0), earthFixed(Number.NaN, 1, 1), earthFixed(1, Number.POSITIVE_INFINITY, 1), earthFixed(1, 1, Number.NaN)]) {
    expect(subSatellitePointFromEarthFixed(position, instant)).toBeNull()
  }
  expect(geodeticLatitudeFromEarthFixed(earthFixed(Number.NaN, 0, 1))).toBeNaN()
  // Every supported orbital radius stays inside the physical latitude interval.
  for (const position of [earthFixed(MIN_PERIAPSIS_RADIUS_KM, 0, 0), earthFixed(0, 0, MAX_APOAPSIS_RADIUS_KM), earthFixed(1, 1, MAX_APOAPSIS_RADIUS_KM)]) {
    const latitude = geodeticLatitudeFromEarthFixed(position)
    expect(Number.isFinite(latitude)).toBe(true)
    expect(Math.abs(latitude)).toBeLessThanOrEqual(Math.PI / 2)
  }
})

it('interpolates both latitudes at the seam and rebuilds the direction from the geocentric value only', () => {
  const previous = subSatellitePointFromEarthFixed(earthFixed(-6900, -700, 1500), { unixSeconds: 0 })!
  const next = subSatellitePointFromEarthFixed(earthFixed(-6900, 700, 1900), { unixSeconds: 10 })!
  const step = groundTrackStepBetween(previous, next)
  expect(step.kind).toBe('seamSplit')
  if (step.kind !== 'seamSplit') return
  for (const seam of [step.closing, step.opening]) {
    const low = Math.min(previous.geodeticLatitudeRad, next.geodeticLatitudeRad)
    const high = Math.max(previous.geodeticLatitudeRad, next.geodeticLatitudeRad)
    expect(seam.geodeticLatitudeRad).toBeGreaterThan(low)
    expect(seam.geodeticLatitudeRad).toBeLessThan(high)
    // The seam carries an ellipsoid latitude, so it stays outside the
    // geocentric one exactly as a propagated sample does.
    expect(Math.abs(seam.geodeticLatitudeRad)).toBeGreaterThan(Math.abs(seam.geocentricLatitudeRad))
    // The direction is reconstructed from the geocentric latitude alone.
    expect(seam.directionEarthFixed.z).toBeCloseTo(Math.sin(seam.geocentricLatitudeRad), 15)
    expect(Math.hypot(seam.directionEarthFixed.x, seam.directionEarthFixed.y, seam.directionEarthFixed.z)).toBeCloseTo(1, 14)
  }
  expect(step.closing.geodeticLatitudeRad).toBe(step.opening.geodeticLatitudeRad)
  expect(Math.abs(step.closing.longitudeRad!)).toBe(Math.PI)
  expect(step.closing.longitudeRad).toBe(-step.opening.longitudeRad!)
})

it('samples two explicit periods, reuses the injected centre and uses each sample orientation', () => {
  const stateAt = vi.fn((sampleInstant: { unixSeconds: number }) => stateAtLongitude(sampleInstant.unixSeconds))
  const orientationAt = vi.fn((sampleInstant: { unixSeconds: number }) => ({ ...identityOrientation, instant: { ...sampleInstant } }))
  const currentState = stateAtLongitude(0)
  const options: GroundTrackSamplingOptions = {
    centreInstant: instant,
    nominalPeriodSeconds: 100,
    currentState,
    currentOrientation: identityOrientation,
    stateAt,
    earthOrientationAt: orientationAt,
  }
  const result = sampleGroundTrack(options)!
  expect(stateAt).toHaveBeenCalledTimes(GROUND_TRACK_SAMPLE_INTERVALS * 2)
  expect(stateAt.mock.calls.some(([sampleInstant]) => sampleInstant.unixSeconds === 0)).toBe(false)
  expect(orientationAt).toHaveBeenCalledTimes(GROUND_TRACK_SAMPLE_INTERVALS * 2)
  expect(result.trailing.at(-1)!.points.at(-1)).toBe(result.current)
  expect(result.leading[0].points[0]).toBe(result.current)
  expect(result.trailing[0].points[0].instant.unixSeconds).toBe(-100)
  expect(result.leading.at(-1)!.points.at(-1)!.instant.unixSeconds).toBe(100)
  expect(result.trailing.flatMap((segment) => segment.points).every((point, index, points) => index === 0 || point.instant.unixSeconds >= points[index - 1].instant.unixSeconds)).toBe(true)
})

it('splits antimeridian crossings with paired seam endpoints and preserves failure gaps', () => {
  const options: GroundTrackSamplingOptions = {
    centreInstant: instant,
    nominalPeriodSeconds: 4,
    currentState: stateAtLongitude(0, Math.PI - 0.1),
    currentOrientation: identityOrientation,
    stateAt: (sampleInstant) => sampleInstant.unixSeconds === -1 ? null : stateAtLongitude(sampleInstant.unixSeconds, Math.PI - 0.1),
    earthOrientationAt: (sampleInstant) => ({ ...identityOrientation, instant: { ...sampleInstant } }),
    intervalsPerPeriod: 4,
  }
  const result = sampleGroundTrack(options)!
  expect(result.failedSampleCount).toBe(1)
  expect(result.trailing.length).toBeGreaterThan(0)
  const points = [...result.trailing, ...result.leading].flatMap((segment) => segment.points)
  expect(points.some((point) => point.longitudeRad === Math.PI || point.longitudeRad === -Math.PI)).toBe(true)
  for (const segment of [...result.trailing, ...result.leading]) {
    for (let index = 1; index < segment.points.length; index += 1) {
      const a = segment.points[index - 1].longitudeRad
      const b = segment.points[index].longitudeRad
      if (a !== null && b !== null) expect(Math.abs(b - a)).toBeLessThanOrEqual(Math.PI)
    }
  }
})

it('is finite at supported orbital scale and keeps direction unit length', () => {
  const radius = Math.sqrt(EARTH_MU_KM3_S2 / (10000 / EARTH_RADIUS_KM))
  const point = subSatellitePointFromEarthFixed(earthFixed(radius, radius * 0.3, radius * 0.4), instant)!
  expect(Math.hypot(point.directionEarthFixed.x, point.directionEarthFixed.y, point.directionEarthFixed.z)).toBeCloseTo(1, 14)
  expect(point.geocentricLatitudeRad).toBeCloseTo(Math.atan2(0.4, Math.hypot(1, 0.3)), 14)
  expect(degToRad(90)).toBeCloseTo(Math.PI / 2, 14)
  expect(earthOrientationAt(instant).earthFixedToProjectInertial).toHaveLength(9)
})


// A polar sample ends one segment and starts the
// next at the same Cartesian point; the sample after it must not start a third.
it('shares the physical pole between segments without inventing a longitude', () => {
  const polar = (x: number, seconds: number) => subSatellitePointFromEarthFixed(earthFixed(x, 0, 1), { unixSeconds: seconds })
  const segments = segmentGroundTrackSamples([
    polar(1, 0), polar(0.1, 1), polar(0, 2), polar(-0.1, 3), polar(-1, 4),
  ])
  expect(segments).toHaveLength(2)
  expect(segments[0].points.map((point) => point.instant.unixSeconds)).toEqual([0, 1, 2])
  expect(segments[1].points.map((point) => point.instant.unixSeconds)).toEqual([2, 3, 4])
  const [incoming, outgoing] = [segments[0].points.at(-1)!, segments[1].points[0]]
  expect(incoming.longitudeRad).toBeNull()
  expect(outgoing.longitudeRad).toBeNull()
  expect(outgoing.directionEarthFixed).toEqual(incoming.directionEarthFixed)
  expect(incoming.geocentricLatitudeRad).toBeCloseTo(Math.PI / 2, 14)
  // Two consecutive polar samples stay in one anchored segment rather than
  // emitting a degenerate pair of coincident points.
  expect(segmentGroundTrackSamples([polar(1, 0), polar(0, 1), polar(0, 2), polar(-1, 3)])).toHaveLength(2)
  // A sequence that neither fails nor crosses the seam remains one segment.
  expect(segmentGroundTrackSamples([polar(1, 0), polar(0.5, 1), polar(0.2, 2)])).toHaveLength(1)
})

// These tests use the shipped presets and propagators so the
// educational claims in the Orbit Examples lesson stay under test.
const PRESET_CENTRE = { unixSeconds: 1789000000 }

function presetWindow(id: OrbitPresetId, propagation?: PropagationModel) {
  const preset = ORBIT_PRESETS.find((candidate) => candidate.id === id)!
  const object = createObjectFromPreset(preset, { id, name: id, colorHex: 0 }, PRESET_CENTRE)
  const propagator = createPropagator(object.source, propagation ?? object.propagation)
  const nominalPeriodSeconds = nominalOrbitalPeriodSeconds(object.source)!
  const window = sampleGroundTrack({
    centreInstant: PRESET_CENTRE, nominalPeriodSeconds,
    currentState: propagator.stateAt(PRESET_CENTRE), currentOrientation: earthOrientationAt(PRESET_CENTRE),
    stateAt: (sampleInstant) => propagator.stateAt(sampleInstant), earthOrientationAt,
  })!
  const points = [...window.trailing, ...window.leading].flatMap((segment) => segment.points)
  const defined = points.filter((point) => point.longitudeRad !== null)
  return {
    object, window, nominalPeriodSeconds,
    maxAbsLatitudeDeg: Math.max(...points.map((point) => Math.abs(radToDeg(point.geocentricLatitudeRad)))),
    minLongitudeDeg: Math.min(...defined.map((point) => radToDeg(point.longitudeRad!))),
    maxLongitudeDeg: Math.max(...defined.map((point) => radToDeg(point.longitudeRad!))),
  }
}

it('keeps an equatorial orbit on the equator up to the frame-registration budget', () => {
  // Exactly zero is a property of the projection, which owns no frame error.
  expect(subSatellitePointFromEarthFixed(earthFixed(7000, 3000, 0), instant)!.geocentricLatitudeRad).toBe(0)
  // The GEO preset is equatorial in ProjectInertial, while geocentric latitude
  // is measured against the Earth-fixed pole of date. The residual is
  // frame-registration error, not a ground-track error, so this asserts a
  // bound rather than an exact zero.
  expect(presetWindow('geo').maxAbsLatitudeDeg).toBeLessThan(0.2)
})

it('holds the ideal GEO preset near one Earth-fixed longitude over a sidereal orbit', () => {
  const geo = presetWindow('geo')
  expect(geo.nominalPeriodSeconds).toBeCloseTo(86164, -1)
  expect(geo.maxLongitudeDeg - geo.minLongitudeDeg).toBeLessThan(0.01)
})

it('reaches both polar regions and sweeps longitude as Earth rotates beneath the plane', () => {
  const polar = presetWindow('polar')
  const northernmost = [...polar.window.leading, ...polar.window.trailing]
    .flatMap((segment) => segment.points).map((point) => radToDeg(point.geocentricLatitudeRad))
  expect(Math.max(...northernmost)).toBeGreaterThan(89)
  expect(Math.min(...northernmost)).toBeLessThan(-89)
  // One nominal period on each side is a little over 200 minutes of rotation.
  expect(polar.maxLongitudeDeg - polar.minLongitudeDeg).toBeGreaterThan(10)
})

it('bounds the retrograde Sun-synchronous preset at 180 deg minus its inclination', () => {
  const sso = presetWindow('sso')
  const inclinationDeg = radToDeg(sso.object.source.geometry.inclinationRad)
  expect(inclinationDeg).toBeGreaterThan(90)
  // The misconception this catches is a track reaching the numerical
  // inclination; a retrograde plane reaches 180 deg - i north and south.
  expect(sso.maxAbsLatitudeDeg).toBeLessThanOrEqual(180 - inclinationDeg)
  expect(sso.maxAbsLatitudeDeg).toBeGreaterThan(180 - inclinationDeg - 0.5)
})

it('differs materially from reusing the centre Earth orientation for the whole window', () => {
  const preset = ORBIT_PRESETS.find((candidate) => candidate.id === 'leo')!
  const object = createObjectFromPreset(preset, { id: 'leo', name: 'leo', colorHex: 0 }, PRESET_CENTRE)
  const propagator = createPropagator(object.source, object.propagation)
  const shared = {
    centreInstant: PRESET_CENTRE, nominalPeriodSeconds: nominalOrbitalPeriodSeconds(object.source)!,
    currentState: propagator.stateAt(PRESET_CENTRE), currentOrientation: earthOrientationAt(PRESET_CENTRE),
    stateAt: (sampleInstant: { unixSeconds: number }) => propagator.stateAt(sampleInstant),
  }
  const rotating = sampleGroundTrack({ ...shared, earthOrientationAt })!
  const frozen = sampleGroundTrack({ ...shared, earthOrientationAt: () => earthOrientationAt(PRESET_CENTRE) })!
  const endLongitude = (result: typeof rotating) => radToDeg(result.leading.at(-1)!.points.at(-1)!.longitudeRad!)
  // One LEO period is about 23 deg of Earth rotation, far above sampling noise.
  expect(Math.abs(endLongitude(rotating) - endLongitude(frozen))).toBeGreaterThan(20)
})

it('consumes two-body and J2 propagators for the same geometry without special cases', () => {
  const days = { unixSeconds: PRESET_CENTRE.unixSeconds + 30 * 86400 }
  const preset = ORBIT_PRESETS.find((candidate) => candidate.id === 'sso')!
  const object = createObjectFromPreset(preset, { id: 'sso', name: 'sso', colorHex: 0 }, PRESET_CENTRE)
  const nominalPeriodSeconds = nominalOrbitalPeriodSeconds(object.source)!
  const windowFor = (propagation: PropagationModel) => {
    const propagator = createPropagator(object.source, propagation)
    return sampleGroundTrack({
      centreInstant: days, nominalPeriodSeconds,
      currentState: propagator.stateAt(days), currentOrientation: earthOrientationAt(days),
      stateAt: (sampleInstant) => propagator.stateAt(sampleInstant), earthOrientationAt,
    })!
  }
  const twoBody = windowFor({ kind: 'idealTwoBody' })
  const j2 = windowFor({ kind: 'j2Secular' })
  expect(j2.nominalPeriodSeconds).toBe(twoBody.nominalPeriodSeconds)
  // Thirty days of nodal regression separates the two planes, and the sampler
  // reaches that only through each propagator's own stateAt.
  const currentLongitude = (result: typeof j2) => radToDeg(result.current.longitudeRad!)
  expect(Math.abs(currentLongitude(j2) - currentLongitude(twoBody))).toBeGreaterThan(1)
})
