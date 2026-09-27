import { parseOmmRecord } from '../data/omm.ts'
import type { OrbitalObject } from '../simulation/OrbitalObject.ts'
import { defaultGroundReachConstraint, defaultSensorDefinition } from '../simulation/sensorFootprint.ts'
import { OBJECT_COLORS } from '../state/objectActions.ts'

/** Deterministic N-object SGP4 scenes for scale measurement.
 *
 * Not a catalogue and not shipped: the Node bench, the tests and the dev-only
 * browser harness import it. Every object is a manual OMM record at the
 * default simulation epoch, so nothing here needs the catalogue or a network. */

export type SyntheticOrbitClass = 'leo' | 'meo' | 'geo' | 'heo'
export const SYNTHETIC_ORBIT_CLASSES: readonly SyntheticOrbitClass[] = ['leo', 'meo', 'geo', 'heo']
/** The orbit-class mix. The array order is also the tie-break order. */
export const SYNTHETIC_ORBIT_CLASS_SHARES: Readonly<Record<SyntheticOrbitClass, number>> = { leo: 0.6, meo: 0.25, geo: 0.1, heo: 0.05 }
export const SYNTHETIC_GNSS_PLANES = 6
export const SYNTHETIC_EPOCH = '2026-03-20T12:00:00Z'
const FIRST_CATALOG_ID = 990001

export interface SyntheticLayers {
  readonly orbitPath?: boolean
  readonly groundTrack?: boolean
  readonly groundTrackHistory?: boolean
  readonly sensorGeometry?: boolean
}

export interface SyntheticObject {
  readonly object: OrbitalObject
  readonly orbitClass: SyntheticOrbitClass
  /** GNSS-like plane index for MEO objects, else null. */
  readonly plane: number | null
}

/** Largest-remainder rounding: floors first, then the largest fractional
 *  remainders, ties in LEO, MEO, GEO, HEO order. */
export function syntheticClassCounts(count: number): Readonly<Record<SyntheticOrbitClass, number>> {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('A synthetic scene needs a non-negative integer size.')
  const exact = SYNTHETIC_ORBIT_CLASSES.map((orbitClass) => count * SYNTHETIC_ORBIT_CLASS_SHARES[orbitClass])
  const counts = exact.map(Math.floor)
  let remaining = count - counts.reduce((sum, value) => sum + value, 0)
  const order = SYNTHETIC_ORBIT_CLASSES.map((_, index) => index)
    // Remainders are compared at a fixed precision so 0.1 * 25 and similar
    // binary artefacts cannot reorder an exact tie.
    .sort((a, b) => Math.round((exact[b] - counts[b]) * 1e9) - Math.round((exact[a] - counts[a]) * 1e9) || a - b)
  for (const index of order) {
    if (remaining === 0) break
    counts[index] += 1
    remaining -= 1
  }
  return { leo: counts[0], meo: counts[1], geo: counts[2], heo: counts[3] }
}

/** `count` objects: LEO first, then MEO, GEO and HEO, each block in a fixed
 *  element pattern. Ids, names, catalogue ids and colours depend only on the
 *  object's position, so the same N always yields the same scene. */
export function createSyntheticScene(count: number, layers: SyntheticLayers = {}): SyntheticObject[] {
  const counts = syntheticClassCounts(count)
  const result: SyntheticObject[] = []
  for (const orbitClass of SYNTHETIC_ORBIT_CLASSES) {
    for (let classIndex = 0; classIndex < counts[orbitClass]; classIndex += 1) {
      const index = result.length
      const elements = elementsFor(orbitClass, classIndex)
      const catalogId = String(FIRST_CATALOG_ID + index)
      const name = `SYN ${orbitClass.toUpperCase()} ${String(classIndex + 1).padStart(3, '0')}`
      const parsed = parseOmmRecord({
        OBJECT_NAME: name, OBJECT_ID: `2026-${String(900 + index).padStart(3, '0')}A`, EPOCH: SYNTHETIC_EPOCH,
        MEAN_MOTION: elements.meanMotion, ECCENTRICITY: elements.eccentricity, INCLINATION: elements.inclination,
        RA_OF_ASC_NODE: elements.raan, ARG_OF_PERICENTER: elements.argOfPericenter, MEAN_ANOMALY: elements.meanAnomaly,
        EPHEMERIS_TYPE: 0, NORAD_CAT_ID: catalogId, BSTAR: 0, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
      }, { kind: 'manual' })
      if (!parsed.ok) throw new Error(`Synthetic object ${name} did not parse: ${parsed.errors.map((error) => error.message).join(' ')}`)
      const groundTrack = (layers.groundTrack ?? false) || (layers.groundTrackHistory ?? false)
      result.push({
        orbitClass,
        plane: orbitClass === 'meo' ? classIndex % SYNTHETIC_GNSS_PLANES : null,
        object: {
          id: `synthetic-${String(index + 1).padStart(3, '0')}`,
          name,
          source: { kind: 'omm', definition: parsed.definition },
          propagation: { kind: 'sgp4' },
          editingLock: { kind: 'none' },
          style: { colorHex: OBJECT_COLORS[index % OBJECT_COLORS.length], markerSizeRenderUnits: 0.02 },
          sensor: defaultSensorDefinition(),
          reachConstraint: defaultGroundReachConstraint(),
          display: {
            bodyVisible: true,
            orbitPathVisible: layers.orbitPath ?? true,
            groundTrackVisible: groundTrack,
            groundTrackHistoryRecording: layers.groundTrackHistory ?? false,
            sensorGeometryVisible: layers.sensorGeometry ?? false,
          },
          notes: 'Synthetic scale measurement object',
        },
      })
    }
  }
  return result
}

interface SyntheticElements {
  readonly meanMotion: number
  readonly eccentricity: number
  readonly inclination: number
  readonly raan: number
  readonly argOfPericenter: number
  readonly meanAnomaly: number
}

const LEO_INCLINATIONS = [28.5, 51.6, 53, 70, 86.4, 97.6] as const

function elementsFor(orbitClass: SyntheticOrbitClass, index: number): SyntheticElements {
  switch (orbitClass) {
    case 'leo': return {
      meanMotion: 14.8 + (index % 7) * 0.12, eccentricity: 0.0008 + (index % 5) * 0.0003,
      inclination: LEO_INCLINATIONS[index % LEO_INCLINATIONS.length],
      raan: (index * 37) % 360, argOfPericenter: (index * 53) % 360, meanAnomaly: (index * 97) % 360,
    }
    case 'meo': {
      // Round-robin over six GNSS-like planes; slots spread along each plane.
      const plane = index % SYNTHETIC_GNSS_PLANES
      const slot = Math.floor(index / SYNTHETIC_GNSS_PLANES)
      return { meanMotion: 2.0056, eccentricity: 0.005, inclination: 55, raan: plane * 60, argOfPericenter: 30, meanAnomaly: (slot * 72 + plane * 15) % 360 }
    }
    case 'geo': return { meanMotion: 1.0027, eccentricity: 0.0002, inclination: 0.05, raan: 0, argOfPericenter: 0, meanAnomaly: (index * 36 + 5) % 360 }
    case 'heo': return { meanMotion: 2.006, eccentricity: 0.72, inclination: 63.4, raan: (index * 72 + 10) % 360, argOfPericenter: 270, meanAnomaly: (index * 45) % 360 }
  }
}
