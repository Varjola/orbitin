import { degToRad, TAU } from '../core/angles.ts'
import type { SimulationInstant } from '../core/time.ts'
import type { OrbitGeometry } from '../orbital/geometry.ts'
import { phaseFromTrueAnomaly } from '../orbital/keplerianPropagator.ts'
import { raanForNodeRightAscensionOfDate } from '../orbital/nodeOfDate.ts'
import { solveSunSynchronousInclination } from '../orbital/sunSynchronous.ts'
import { earthOrientationAt } from './earthOrientation.ts'
import { meanSunAt } from './meanSun.ts'
import type { KeplerianOrbitalObject, OrbitEditingLock } from './OrbitalObject.ts'
import { defaultGroundReachConstraint, defaultSensorDefinition } from './sensorFootprint.ts'

export type OrbitPresetId = 'leo' | 'meo' | 'geo' | 'polar' | 'elliptical' | 'sso'

/** A preset whose inclination and RAAN are *solved* at creation rather than
 *  stored. Inclination comes from the Sun-synchronous condition at the preset's
 *  own a and e; RAAN comes from the target local mean solar time at the instant
 *  the object is created, so the same preset created on a different date
 *  produces a different RAAN. That is correct: 10:30 local mean solar time is a
 *  different inertial direction on a different date. */
export interface SunSynchronousSpecification {
  /** Mean local solar time of the **descending** node, in hours. Earth-
   *  observation missions are documented this way. */
  readonly meanLocalTimeDescendingNodeHours: number
}

/** A preset's name and description are interface text.
 *  `canonicalNote` is the English literal stored as the object's note, equal
 *  to its `SHARED_NOTES_V1` entry, so links keep encoding it by index. */
export interface OrbitPreset {
  readonly id: OrbitPresetId
  readonly canonicalNote: string
  readonly geometry: Readonly<OrbitGeometry>
  readonly initialTrueAnomalyRad: number
  readonly propagation: { kind: 'idealTwoBody' } | { kind: 'j2Secular' }
  readonly editingLock: OrbitEditingLock
  readonly sunSynchronous?: SunSynchronousSpecification
}

function preset(id: OrbitPresetId, canonicalNote: string, a: number, e: number, i: number, raan: number, arg: number, anomaly: number): OrbitPreset {
  return { id, canonicalNote, geometry: { semiMajorAxisKm: a, eccentricity: e,
    inclinationRad: degToRad(i), raanRad: degToRad(raan), argOfPeriapsisRad: degToRad(arg) }, initialTrueAnomalyRad: degToRad(anomaly),
    propagation: { kind: 'idealTwoBody' }, editingLock: { kind: 'none' } }
}

export const ORBIT_PRESETS: readonly OrbitPreset[] = [
  preset('leo', 'Low Earth orbit: a circular path 500 km above Earth, inclined 51.5° to the equator.', 6878.137, 0, 51.5, 0, 0, 0),
  preset('meo', 'Medium Earth orbit: a higher circular path with a longer period than LEO, typical of navigation orbit scales.', 26560, 0, 55, 45, 0, 90),
  preset('geo', 'A circular equatorial orbit with a sidereal-day period: about 23 h 56 min. It follows Earth’s rotation and stays over nearly the same longitude.', 42164.17, 0, 0, 0, 0, 180),
  preset('polar', 'A circular orbit 800 km above Earth whose plane crosses both poles. Run it against the Sun-synchronous example, which sits at the same altitude and only 8.6° more inclination: with J2 drift on, this plane sweeps through every local solar time over a year while that one holds its crossing time.', 7178.137, 0, 90, 90, 0, 45),
  preset('elliptical', 'A stretched orbit with geocentric periapsis and apoapsis radii of 6,916 km and 46,284 km. The body moves fastest near periapsis. Its 63.5° inclination is the critical inclination, where J2 apsidal drift vanishes and the periapsis stays put.', 26600, 0.74, 63.5, 135, 270, 0),
  {
    id: 'sso',
    canonicalNote: 'A circular orbit 800 km above Earth whose plane drifts eastward at the same rate the mean Sun does, so it crosses the equator southbound at 10:30 and northbound at 22:30 local mean solar time. Its inclination is solved from its altitude rather than quoted, and its RAAN is solved from that crossing time at the moment you add it — so adding it on a different date gives a different RAAN.',
    geometry: { semiMajorAxisKm: 7178.137, eccentricity: 0, inclinationRad: 0, raanRad: 0, argOfPeriapsisRad: 0 },
    initialTrueAnomalyRad: 0,
    propagation: { kind: 'j2Secular' },
    editingLock: { kind: 'sunSynchronous' },
    sunSynchronous: { meanLocalTimeDescendingNodeHours: 10.5 },
  },
]

/** Resolves a Sun-synchronous preset's inclination and RAAN at `atInstant`,
 *  using the same `nodeOfDate` geometry the MLTAN readout uses, so preset
 *  creation and the readout cannot silently disagree. */
export function resolvePresetGeometry(preset: OrbitPreset, atInstant: SimulationInstant): OrbitGeometry {
  const geometry = { ...preset.geometry }
  if (!preset.sunSynchronous) return geometry
  const solution = solveSunSynchronousInclination(geometry.semiMajorAxisKm, geometry.eccentricity)
  if (solution.kind !== 'solved') throw new Error(`Preset ${preset.id} has no Sun-synchronous solution at its own semi-major axis`)
  geometry.inclinationRad = solution.inclinationRad
  // MLTAN = MLTDN + 12 h, and MLTAN = 12 + (RAAN_mod - RA_meanSun) / 15 deg/h.
  const meanLocalTimeAscendingNodeHours = (preset.sunSynchronous.meanLocalTimeDescendingNodeHours + 12) % 24
  const targetRightAscensionOfDateRad =
    meanSunAt(atInstant).rightAscensionMeanOfDateRad + ((meanLocalTimeAscendingNodeHours - 12) / 24) * TAU
  geometry.raanRad = raanForNodeRightAscensionOfDate(
    geometry.inclinationRad, targetRightAscensionOfDateRad, earthOrientationAt(atInstant).precessionToMeanOfDate)
  return geometry
}

export function createObjectFromPreset(preset: OrbitPreset, identity: { id: string; name: string; colorHex: number }, atInstant: SimulationInstant): KeplerianOrbitalObject {
  const geometry = resolvePresetGeometry(preset, atInstant)
  return { id: identity.id, name: identity.name,
    source: { kind: 'keplerian', geometry, phase: phaseFromTrueAnomaly(geometry.eccentricity, preset.initialTrueAnomalyRad, atInstant) },
    propagation: { ...preset.propagation }, editingLock: { ...preset.editingLock },
    style: { colorHex: identity.colorHex, markerSizeRenderUnits: 0.02 },
    // One hypothetical sensor for every example, so LEO and GEO compare the
    // same instrument rather than two orbit-tuned ones.
    sensor: defaultSensorDefinition(),
    reachConstraint: defaultGroundReachConstraint(),
    // Conceptual examples are the first ground-track lesson, so their Earth-
    // fixed view is discoverable as soon as they are added.
    display: { bodyVisible: true, orbitPathVisible: true, groundTrackVisible: true, groundTrackHistoryRecording: false, sensorGeometryVisible: true }, notes: preset.canonicalNote }
}
