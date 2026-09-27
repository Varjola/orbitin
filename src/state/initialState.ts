import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { DEFAULT_GEOMETRY } from '../orbital/geometry.ts'
import { phaseFromTrueAnomaly } from '../orbital/keplerianPropagator.ts'
import type { SimulationInstant } from '../core/time.ts'
import type { AppState } from './AppState.ts'
import { DEFAULT_LOOK } from './viewActions.ts'
import type { KeplerianOrbitalObject } from '../simulation/OrbitalObject.ts'
import { defaultGroundReachConstraint, defaultSensorDefinition } from '../simulation/sensorFootprint.ts'
import { text } from '../i18n/index.ts'
import { DEFAULT_ORBIT_NOTE } from './canonicalNotes.ts'

/** A new Orbit Lab object's generated name, in the active language. From
 *  then on the name is learner data and is kept as typed. */
export function createRandomOrbitName(existingNames: Iterable<string> = [], random: () => number = Math.random): string {
  const words = text().names
  const pick = <T>(items: readonly T[]): T => {
    const sample = random()
    const index = Number.isFinite(sample) ? Math.min(items.length - 1, Math.max(0, Math.floor(sample * items.length))) : 0
    return items[index]
  }
  const base = words.compose(pick(words.first), pick(words.second))
  const names = new Set(existingNames)
  if (!names.has(base)) return base
  let suffix = 2
  while (names.has(`${base} ${suffix}`)) suffix += 1
  return `${base} ${suffix}`
}

export function createInitialState(random: () => number = Math.random): AppState {
  const emptyScene = () => ({ objects: [] as const, selection: { ids: [] as const, primaryId: null } as const })
  const initialOrbit = createDefaultOrbitLabObject('orbit-1', 0xffc857, SIMULATION_START_INSTANT, createRandomOrbitName([], random))
  return { activeMode: 'orbitLab', orbitLab: { scene: { objects: [initialOrbit], selection: { ids: [initialOrbit.id], primaryId: initialOrbit.id } }, authoring: { drawerTab: 'edit', lastConstraint: { kind: 'none' } } }, realObjects: { scene: emptyScene() }, simulation: { playing: true, reversed: false, speedMultiplier: 60, currentInstant: { ...SIMULATION_START_INSTANT } }, view: { scaleMarkersWithZoom: true, groundTrackMapVisible: false }, look: { ...DEFAULT_LOOK } }
}
export function createDefaultOrbitLabObject(id: string, colorHex: number, atInstant: SimulationInstant, name = text().names.defaultOrbit): KeplerianOrbitalObject {
  return { id, name, source: { kind: 'keplerian', geometry: { ...DEFAULT_GEOMETRY }, phase: phaseFromTrueAnomaly(DEFAULT_GEOMETRY.eccentricity, 0, atInstant) }, propagation: { kind: 'idealTwoBody' }, editingLock: { kind: 'none' }, style: { colorHex, markerSizeRenderUnits: 0.02 }, sensor: defaultSensorDefinition(), reachConstraint: defaultGroundReachConstraint(), display: { orbitPathVisible: true, bodyVisible: true, groundTrackVisible: false, groundTrackHistoryRecording: false, sensorGeometryVisible: false }, notes: DEFAULT_ORBIT_NOTE }
}
