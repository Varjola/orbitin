import { decodeCatalogueManifest, decodeCatalogueShard } from '../data/catalogueSchema.ts'
import { buildAutomaticSnapshotFixture } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { parseOmmJson } from '../data/omm.ts'
import { SCENE_DOCUMENT_FORMAT, type CatalogueObjectRefV1, type KeplerianObjectV1, type ManualOmmObjectV1, type ManualTleObjectV1, type ObjectPresentationV1, type RealObjectV1, type SceneDocumentV1 } from '../data/sceneDocument.ts'
import { parseTle } from '../data/tle.ts'
import { sceneObjectFromCatalogueRecord } from '../app/catalogueToScene.ts'
import { ORBIT_PRESETS, createObjectFromPreset } from '../simulation/orbitPresets.ts'
import type { OrbitalObject } from '../simulation/OrbitalObject.ts'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { withScene, type AppState } from '../state/AppState.ts'
import { createInitialState } from '../state/initialState.ts'

/** Test scenes: realistic shared scenes built from application
 *  state, and worst-case documents at the link text bounds. Test-only. */

export const TLE_LINE1 = '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992'
export const TLE_LINE2 = '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442'
const DISPLAY_OFF = { bodyVisible: true, orbitPathVisible: true, groundTrackVisible: false, groundTrackHistoryRecording: false, sensorGeometryVisible: false }

/** Non-default marker, sensor and reach values: every presentation f64 is written. */
export function customized<T extends OrbitalObject>(object: T): T {
  return { ...object, style: { ...object.style, markerSizeRenderUnits: 0.031 }, sensor: { fieldOfViewHalfAngleRad: 0.2, maxOffNadirSteeringRad: 0.1 }, reachConstraint: { minimumGroundElevationRad: 0.05 }, display: { ...object.display, groundTrackHistoryRecording: true, groundTrackVisible: true } }
}

/** An Orbit Lab scene: the default orbit, a customized SSO preset and an orbit without notes. */
export function orbitLabState(): AppState {
  const base = createInitialState(() => 0.25)
  const first = base.orbitLab.scene.objects[0]
  const sso = customized(createObjectFromPreset(ORBIT_PRESETS.find((preset) => preset.id === 'sso')!, { id: 'orbit-7', name: 'Sun-synchronous Ω', colorHex: 0xac86f7 }, SIMULATION_START_INSTANT))
  if (first.source.kind !== 'keplerian') throw new Error('Expected a Keplerian default orbit.')
  const plain: OrbitalObject = { ...first, id: 'lab-custom', name: 'No notes', notes: undefined, source: { ...first.source, geometry: { ...first.source.geometry, eccentricity: 0.1234567890123 } } }
  return withScene(base, 'orbitLab', { objects: [first, sso, plain], selection: { ids: ['orbit-7', 'lab-custom'], primaryId: 'lab-custom' } })
}

/** A Real Objects scene with every kind: two catalogue records, a named and
 *  an unnamed TLE, and a manual OMM with and without optional fields. */
export function realObjectsState(): AppState {
  const fixture = buildAutomaticSnapshotFixture()
  const manifest = decodeCatalogueManifest(fixture.manifest)
  const records = fixture.shards.flatMap((shard, index) => Object.values(decodeCatalogueShard(shard, manifest, index).records))
  const catalogue = records.slice(0, 2).map((record, index) => {
    const built = sceneObjectFromCatalogueRecord(record, manifest, 0x3366ff + index)
    if (!built.ok) throw new Error('Catalogue fixture failed.')
    return built.object
  })
  const presentation = (id: string, colorHex: number) => ({ id, style: { colorHex, markerSizeRenderUnits: 0.02 }, sensor: { fieldOfViewHalfAngleRad: 5 * Math.PI / 180, maxOffNadirSteeringRad: 3 * Math.PI / 180 }, reachConstraint: { minimumGroundElevationRad: 0 }, display: DISPLAY_OFF, propagation: { kind: 'sgp4' as const }, editingLock: { kind: 'none' as const } })
  const named = parseTle(`0 Educational ISS <b>\n${TLE_LINE1}\n${TLE_LINE2}`)
  const unnamed = parseTle(`${TLE_LINE1}\n${TLE_LINE2}`)
  const full = parseOmmJson(JSON.stringify({ OBJECT_NAME: 'Manual OMM', OBJECT_ID: '2026-001A', CLASSIFICATION_TYPE: 'U', EPOCH: '2026-03-20T12:00:00.123456Z', MEAN_MOTION: 15.2, ECCENTRICITY: 0.001, INCLINATION: 51, RA_OF_ASC_NODE: 120, ARG_OF_PERICENTER: 40, MEAN_ANOMALY: 220, EPHEMERIS_TYPE: 0, NORAD_CAT_ID: '700001', BSTAR: 0.0001, MEAN_MOTION_DOT: 0.00001, MEAN_MOTION_DDOT: 0, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 12345 }))
  const minimal = parseOmmJson(JSON.stringify({ OBJECT_NAME: 'Minimal OMM', EPOCH: '2026-03-21T00:00:00Z', MEAN_MOTION: 2.005, ECCENTRICITY: 0.01, INCLINATION: 55, RA_OF_ASC_NODE: 10, ARG_OF_PERICENTER: 20, MEAN_ANOMALY: 30, EPHEMERIS_TYPE: 0, NORAD_CAT_ID: '700002', BSTAR: 0, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0 }))
  if (!named.ok || !unnamed.ok || !full.ok || !minimal.ok) throw new Error('Manual fixture failed.')
  const objects: OrbitalObject[] = [
    customized(catalogue[0]), catalogue[1],
    { ...presentation('tle-4', 0xff9900), name: 'Educational ISS <b>', source: { kind: 'tle', definition: named.definition } },
    { ...presentation('tle-9', 0xff5500), name: 'NORAD 25544', source: { kind: 'tle', definition: unnamed.definition } },
    customized({ ...presentation('omm-2', 0x00cc88), name: full.definition.name, source: { kind: 'omm', definition: full.definition } }),
    { ...presentation('omm-3', 0x00aa66), name: minimal.definition.name, source: { kind: 'omm', definition: minimal.definition } },
  ]
  const state = withScene(createInitialState(() => 0.5), 'realObjects', { objects, selection: { ids: [objects[4].id, objects[0].id], primaryId: objects[0].id } })
  return { ...state, activeMode: 'realObjects', view: { scaleMarkersWithZoom: false, groundTrackMapVisible: true } }
}

// ------------------------------------------------------ worst-case documents

/** 80 UTF-16 units of a 3-byte UTF-8 character: the most bytes a linkable name can take. */
export const WORST_NAME = '€'.repeat(80)
const WORST_ASCII = 'Z'.repeat(32)

function worstPresentation(id: string): ObjectPresentationV1 {
  return { id, style: { colorHex: 0xffffff, markerSizeRenderUnits: 0.049 }, sensor: { fieldOfViewHalfAngleRad: 1.1, maxOffNadirSteeringRad: 1.2 }, reachConstraint: { minimumGroundElevationRad: 0.3 }, display: { orbitPathVisible: true, bodyVisible: true, groundTrackVisible: true, groundTrackHistoryRecording: true, sensorGeometryVisible: true } }
}
export function worstOrbit(index: number): KeplerianObjectV1 {
  return { ...worstPresentation(`orbit-${index + 1}`), kind: 'keplerian', name: WORST_NAME, notes: 'Ideal two-body Keplerian demonstration', geometry: { semiMajorAxisKm: 7000.123456789, eccentricity: 0.123456789, inclinationRad: 1.23456789, raanRad: 2.3456789, argOfPeriapsisRad: 3.456789 }, phase: { referenceUnixSeconds: 1774008000.123, meanAnomalyAtReferenceRad: 0.987654321 }, propagation: 'j2Secular', editingLock: 'sunSynchronous' }
}
export function worstCatalogue(index: number): CatalogueObjectRefV1 {
  const catalogId = String(999_999_999 - index)
  return { ...worstPresentation(`catalogue-${catalogId}`), kind: 'catalogue', catalogId, savedSnapshotId: `20260925T120000Z-${index.toString(16).padStart(12, 'f')}`, savedEpochUnixSeconds: 1774008000.123456 }
}
export function worstTle(index: number): ManualTleObjectV1 {
  return { ...worstPresentation(`tle-${index + 1}`), kind: 'tle', name: WORST_NAME, line1: TLE_LINE1, line2: TLE_LINE2 }
}
export function worstOmm(index: number): ManualOmmObjectV1 {
  return { ...worstPresentation(`omm-${index + 1}`), kind: 'omm', record: { OBJECT_NAME: WORST_NAME, OBJECT_ID: WORST_ASCII, CLASSIFICATION_TYPE: WORST_ASCII, EPOCH: WORST_ASCII, MEAN_MOTION: 15.123456789, ECCENTRICITY: 0.000123456789, INCLINATION: 51.123456789, RA_OF_ASC_NODE: 120.123456789, ARG_OF_PERICENTER: 40.123456789, MEAN_ANOMALY: 220.123456789, EPHEMERIS_TYPE: 0xffff_ffff, NORAD_CAT_ID: WORST_ASCII, BSTAR: 0.000123456789, MEAN_MOTION_DOT: 0.0000123456789, MEAN_MOTION_DDOT: 1.23456789e-12, ELEMENT_SET_NO: 0xffff_fffe, REV_AT_EPOCH: 0xffff_fffe, CENTER_NAME: 'Earth', REF_FRAME: 'TEME', TIME_SYSTEM: 'UTC', MEAN_ELEMENT_THEORY: 'SGP4' } }
}

/** A shared document with every object selected and the last one primary. */
export function sharedDocument(mode: 'orbitLab' | 'realObjects', objects: readonly (KeplerianObjectV1 | RealObjectV1)[]): SceneDocumentV1 {
  const scene = { objects, selectedIds: objects.map((object) => object.id), primaryId: objects.at(-1)?.id ?? null }
  const empty = { objects: [], selectedIds: [], primaryId: null }
  return {
    format: SCENE_DOCUMENT_FORMAT, version: 1, activeMode: mode, simulation: null, view: { groundTrackMapVisible: true, scaleMarkersWithZoom: true },
    orbitLab: mode === 'orbitLab' ? scene as SceneDocumentV1['orbitLab'] : empty,
    realObjects: mode === 'realObjects' ? scene as SceneDocumentV1['realObjects'] : empty,
  }
}
