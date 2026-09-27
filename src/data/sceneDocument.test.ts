import { expect, it } from 'vitest'
import { decodeCatalogueManifest, decodeCatalogueShard } from './catalogueSchema.ts'
import { buildAutomaticSnapshotFixture } from './fixtures/automaticCatalogueSnapshot.ts'
import { parseOmmJson } from './omm.ts'
import { parseTle } from './tle.ts'
import { sceneObjectFromCatalogueRecord } from '../app/catalogueToScene.ts'
import { createInitialState } from '../state/initialState.ts'
import { PRODUCT_MODES, withScene, type AppState } from '../state/AppState.ts'
import type { OrbitalObject } from '../simulation/OrbitalObject.ts'
import { defaultGroundReachConstraint, defaultSensorDefinition } from '../simulation/sensorFootprint.ts'
import { decodeSceneDocument, DOCUMENT_MODES, encodeSceneDocument, sceneDocumentCatalogueIds, serializeSceneDocument, type SceneDocumentV1 } from './sceneDocument.ts'

const LINE1 = '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992'
const LINE2 = '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442'

function realPresentation(id: string, colorHex: number) {
  return {
    id, style: { colorHex, markerSizeRenderUnits: 0.02 }, sensor: defaultSensorDefinition(),
    reachConstraint: defaultGroundReachConstraint(),
    display: { bodyVisible: true, orbitPathVisible: true, groundTrackVisible: false, groundTrackHistoryRecording: false, sensorGeometryVisible: false },
  }
}

function richState(): AppState {
  let state = createInitialState(() => 0)
  const first = state.orbitLab.scene.objects[0]
  const second: OrbitalObject = { ...first, id: 'orbit-2', name: 'J2 locked', propagation: { kind: 'j2Secular' }, editingLock: { kind: 'sunSynchronous' } }
  state = withScene(state, 'orbitLab', { objects: [first, second], selection: { ids: ['orbit-2', 'orbit-1'], primaryId: 'orbit-1' } })

  const tle = parseTle(`0 Educational ISS\n${LINE1}\n${LINE2}`)
  if (!tle.ok) throw new Error('TLE fixture failed.')
  const tleObject: OrbitalObject = { ...realPresentation('tle-1', 0xff9900), name: 'Educational ISS', source: { kind: 'tle', definition: tle.definition }, propagation: { kind: 'sgp4' }, editingLock: { kind: 'none' } }
  const omm = parseOmmJson(JSON.stringify({ OBJECT_NAME: 'Manual OMM', OBJECT_ID: '2026-001A', EPOCH: '2026-03-20T12:00:00Z', MEAN_MOTION: 15, ECCENTRICITY: 0.001, INCLINATION: 51, RA_OF_ASC_NODE: 120, ARG_OF_PERICENTER: 40, MEAN_ANOMALY: 220, EPHEMERIS_TYPE: 0, NORAD_CAT_ID: '700001', BSTAR: 0, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0 }))
  if (!omm.ok) throw new Error('OMM fixture failed.')
  const ommObject: OrbitalObject = { ...realPresentation('omm-1', 0x00cc88), name: omm.definition.name, source: { kind: 'omm', definition: omm.definition }, propagation: { kind: 'sgp4' }, editingLock: { kind: 'none' } }
  const fixture = buildAutomaticSnapshotFixture()
  const manifest = decodeCatalogueManifest(fixture.manifest)
  const shard = fixture.shards.findIndex((candidate) => '900001' in candidate.records)
  const record = decodeCatalogueShard(fixture.shards[shard], manifest, shard).records['900001']
  const catalogue = sceneObjectFromCatalogueRecord(record, manifest, 0x7755ff)
  if (!catalogue.ok) throw new Error('Catalogue fixture failed.')
  state = withScene(state, 'realObjects', { objects: [tleObject, ommObject, catalogue.object], selection: { ids: ['catalogue-900001', 'tle-1'], primaryId: 'tle-1' } })
  return { ...state, activeMode: 'realObjects', simulation: { ...state.simulation, playing: true, reversed: true, speedMultiplier: 60 }, view: { groundTrackMapVisible: true, scaleMarkersWithZoom: false } }
}

const clone = (document: SceneDocumentV1): any => JSON.parse(JSON.stringify(document))

it('round-trips every source kind with stable output and exact selection fidelity', () => {
  const state = richState()
  const encoded = encodeSceneDocument(state, { includeSimulation: true })
  expect(encoded.orbitLab.selectedIds).toEqual(['orbit-2', 'orbit-1'])
  expect(encoded.orbitLab.primaryId).toBe('orbit-1')
  expect(encoded.realObjects.objects.map((object) => object.kind)).toEqual(['tle', 'omm', 'catalogue'])
  expect(sceneDocumentCatalogueIds(encoded)).toEqual(['900001'])
  const serialized = serializeSceneDocument(encoded)
  const decoded = decodeSceneDocument(JSON.parse(serialized))
  expect(decoded).toEqual({ ok: true, document: encoded })
  expect(serializeSceneDocument(encodeSceneDocument(richState(), { includeSimulation: true }))).toBe(serialized)
  expect(serialized).not.toMatch(/"provenance"|"source"|"derived"|"automatic"|"groups"/)
  expect(encodeSceneDocument(state, { includeSimulation: false }).simulation).toBeNull()
  expect(DOCUMENT_MODES).toEqual(PRODUCT_MODES)
})

it('rejects unknown keys, invalid values and broken selection invariants with precise paths', () => {
  const base = encodeSceneDocument(richState(), { includeSimulation: true })
  const cases: Array<{ path: string; mutate(value: any): void }> = [
    { path: 'unexpected', mutate: (value) => { value.unexpected = true } },
    { path: 'format', mutate: (value) => { value.format = 'other.scene' } },
    { path: 'activeMode', mutate: (value) => { value.activeMode = 'other' } },
    { path: 'simulation.speedMultiplier', mutate: (value) => { value.simulation.speedMultiplier = 0 } },
    { path: 'view.groundTrackMapVisible', mutate: (value) => { value.view.groundTrackMapVisible = 'yes' } },
    { path: 'orbitLab.selectedIds', mutate: (value) => { value.orbitLab.selectedIds = ['orbit-1', 'orbit-1'] } },
    { path: 'orbitLab.selectedIds', mutate: (value) => { value.orbitLab.selectedIds = ['tle-1'] } },
    { path: 'orbitLab.primaryId', mutate: (value) => { value.orbitLab.primaryId = null } },
    { path: 'orbitLab.primaryId', mutate: (value) => { value.orbitLab.primaryId = 'missing' } },
    { path: 'orbitLab.objects[0].id', mutate: (value) => { value.orbitLab.objects[0].id = 'bad id' } },
    { path: 'orbitLab.objects[0].style.colorHex', mutate: (value) => { value.orbitLab.objects[0].style.colorHex = -1 } },
    { path: 'orbitLab.objects[0].geometry.eccentricity', mutate: (value) => { value.orbitLab.objects[0].geometry.eccentricity = 1 } },
    { path: 'orbitLab.objects[0].editingLock', mutate: (value) => { value.orbitLab.objects[0].editingLock = 'sunSynchronous'; value.orbitLab.objects[0].propagation = 'idealTwoBody' } },
    { path: 'realObjects.objects[0].line1', mutate: (value) => { value.realObjects.objects[0].line1 = 'short' } },
    { path: 'realObjects.objects[1].record.bad', mutate: (value) => { value.realObjects.objects[1].record.bad = true } },
    { path: 'realObjects.objects[2].catalogId', mutate: (value) => { value.realObjects.objects[2].catalogId = 'not-numeric' } },
    { path: 'realObjects.objects', mutate: (value) => { value.realObjects.objects[0].id = 'orbit-1' } },
  ]
  for (const row of cases) {
    const value = clone(base)
    row.mutate(value)
    const decoded = decodeSceneDocument(value)
    expect(decoded.ok, row.path).toBe(false)
    if (!decoded.ok) expect(decoded.errors.some((error) => error.path === row.path), JSON.stringify(decoded.errors)).toBe(true)
  }
})

it('handles unsupported versions and non-object input without throwing', () => {
  const version = clone(encodeSceneDocument(richState(), { includeSimulation: false }))
  version.version = 2
  const decoded = decodeSceneDocument(version)
  expect(decoded.ok).toBe(false)
  if (!decoded.ok) expect(decoded.errors.at(-1)?.message).toBe('Unsupported scene document version 2.')
  for (const value of [null, [], 'scene', {}]) expect(() => decodeSceneDocument(value)).not.toThrow()
})
