import { expect, it } from 'vitest'
import { decodeCatalogueManifest, decodeCatalogueShard } from '../data/catalogueSchema.ts'
import { catalogueImportProvenance } from '../data/catalogueImport.ts'
import { buildAutomaticSnapshotFixture, FIXTURE_SNAPSHOT_ID } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { parseOmmRecord } from '../data/omm.ts'
import { createSatelliteJsAdapter } from '../orbital/satelliteJsAdapter.ts'
import { EMPTY_SELECTION, type SceneState } from './AppState.ts'
import { removeObjects, selectOnly } from './sceneActions.ts'
import { createInitialState } from './initialState.ts'
import { encodeSceneDocument, decodeSceneDocument } from '../data/sceneDocument.ts'
import { withScene } from './AppState.ts'
import legacyStateText from './fixtures/legacy-app-state.json?raw'
import legacyManifestText from '../../workers/catalogue/fixtures/legacy-snapshot/manifest.json?raw'
import legacyShard7Text from '../../workers/catalogue/fixtures/legacy-snapshot/records-7.json?raw'

// No shipped feature persists application state yet. Saved state here means the
// JSON form of AppState. `legacy-app-state.json` was
// generated once from unmodified earlier code with a legacy catalogue import
// of 25544 from the committed legacy snapshot. Never regenerate it.
interface LegacyAppStateV0 { mode: string; objects: import('../simulation/OrbitalObject.ts').OrbitalObject[]; selectedObjectId: string | null }
const load = (text: string): LegacyAppStateV0 => JSON.parse(text) as LegacyAppStateV0
const save = (state: LegacyAppStateV0): string => JSON.stringify(state)
const scene = (legacy: LegacyAppStateV0): SceneState => ({ objects: legacy.objects, selection: legacy.selectedObjectId ? { ids: [legacy.selectedObjectId], primaryId: legacy.selectedObjectId } : EMPTY_SELECTION })

function legacyRecord25544() {
  const manifest = decodeCatalogueManifest(JSON.parse(legacyManifestText))
  return decodeCatalogueShard(JSON.parse(legacyShard7Text), manifest, 7).records['25544']
}

it('loads legacy serialized application state with its catalogue import and provenance intact', () => {
  const state = load(legacyStateText)
  const imported = state.objects.find((object) => object.id === 'omm-1')
  if (imported?.source.kind !== 'omm') throw new Error('The legacy state fixture must contain an OMM catalogue import.')

  const record = legacyRecord25544()
  const reparsed = parseOmmRecord(record, record.provenance)
  if (!reparsed.ok) throw new Error('The legacy baseline record must still parse.')
  expect(imported.source.definition).toEqual(reparsed.definition)
  expect(imported.source.definition.provenance).toEqual(record.provenance)
  expect(imported.source.definition.provenance).toMatchObject({ kind: 'catalogue', providerId: 'space-track', snapshotId: '20260913T121711Z-8f039dc45340', groups: ['space-stations'] })

  const epoch = imported.source.definition.meanElements.epoch
  expect(createSatelliteJsAdapter(imported.source.definition).temeStateAt(epoch)).toEqual(createSatelliteJsAdapter(reparsed.definition).temeStateAt(epoch))

  const edited = removeObjects(selectOnly(scene(state), 'demo-satellite'), ['omm-1'])
  expect(edited.objects.map((object) => object.id)).toEqual(['demo-satellite'])
})

it('keeps a catalogue import and its provenance unchanged across a save/load round trip', () => {
  const state = load(legacyStateText)
  const reloaded = load(save(state))
  expect(reloaded).toEqual(state)
  const before = state.objects.find((object) => object.id === 'omm-1')
  const after = reloaded.objects.find((object) => object.id === 'omm-1')
  if (before?.source.kind !== 'omm' || after?.source.kind !== 'omm') throw new Error('Expected the OMM catalogue import.')
  const epoch = before.source.definition.meanElements.epoch
  expect(createSatelliteJsAdapter(after.source.definition).temeStateAt(epoch)).toEqual(createSatelliteJsAdapter(before.source.definition).temeStateAt(epoch))
})

it('round-trips an object imported from a complete automatic snapshot with run-level and record-level source provenance intact', () => {
  const fixture = buildAutomaticSnapshotFixture()
  const manifest = decodeCatalogueManifest(fixture.manifest)
  const shard = fixture.shards.findIndex((candidate) => '900001' in candidate.records)
  const record = decodeCatalogueShard(fixture.shards[shard], manifest, shard).records['900001']
  // The shard record does not repeat run-level provenance; import combines it.
  expect(JSON.stringify(record.source)).not.toContain('USSPACECOM')

  const provenance = catalogueImportProvenance(record, manifest)
  expect(provenance).toEqual({
    ...record.provenance,
    automatic: {
      sourceAuthority: 'USSPACECOM / 18th Space Defense Squadron', providerRecordClass: 'gp', retrievalStartedAtUtc: '2026-09-13T17:17:02.250Z',
      ommVersion: '3.0', originator: '18 SPCS', recordCreatedAtUtc: '2026-09-13T21:04:11Z',
      normalizationRulesVersion: 'space-track-gp/1', enrichmentRulesVersion: 'orbit-classes/1',
    },
  })
  expect(provenance).toMatchObject({ kind: 'catalogue', providerId: 'space-track', groups: [], snapshotId: FIXTURE_SNAPSHOT_ID, providerRetrievedAtUtc: '2026-09-14T00:17:01.500Z' })
  const parsed = parseOmmRecord(record, provenance)
  if (!parsed.ok) throw new Error('The automatic record must parse.')

  const base = load(legacyStateText)
  const state: LegacyAppStateV0 = { ...base, objects: base.objects.map((object) => (object.id === 'omm-1' ? { ...object, name: parsed.definition.name, source: { kind: 'omm', definition: parsed.definition } } : object)) }
  const reloaded = load(save(state))
  expect(reloaded).toEqual(state)
  const after = reloaded.objects.find((object) => object.id === 'omm-1')
  if (after?.source.kind !== 'omm') throw new Error('Expected the automatic catalogue import.')
  expect(after.source.definition.provenance).toEqual(provenance)
  const epoch = parsed.definition.meanElements.epoch
  expect(createSatelliteJsAdapter(after.source.definition).temeStateAt(epoch)).toEqual(createSatelliteJsAdapter(parsed.definition).temeStateAt(epoch))
})

it('imports a legacy record with exactly its v1 provenance', () => {
  const manifest = decodeCatalogueManifest(JSON.parse(legacyManifestText))
  const record = legacyRecord25544()
  expect(catalogueImportProvenance(record, manifest)).toEqual(record.provenance)
})

it('encodes the legacy fixture into the scene document contract without leaking provenance', () => {
  const legacy = load(legacyStateText)
  const orbit = legacy.objects.find((object) => object.id === 'demo-satellite')
  const real = legacy.objects.find((object) => object.id === 'omm-1')
  if (!orbit || !real) throw new Error('The legacy state fixture must contain both expected objects.')
  const base = createInitialState()
  const state = withScene(withScene(base, 'orbitLab', { objects: [orbit], selection: { ids: [orbit.id], primaryId: orbit.id } }), 'realObjects', { objects: [real], selection: { ids: [real.id], primaryId: real.id } })
  const document = encodeSceneDocument(state, { includeSimulation: false })
  expect(document.realObjects.objects[0]).toMatchObject({ kind: 'catalogue', id: 'omm-1', catalogId: '25544', savedSnapshotId: '20260913T121711Z-8f039dc45340' })
  expect(document.orbitLab.selectedIds).toEqual(['demo-satellite'])
  expect(document.orbitLab.primaryId).toBe('demo-satellite')
  expect(JSON.stringify(document)).not.toMatch(/provenance|source|automatic|groups/)
  expect(decodeSceneDocument(JSON.parse(JSON.stringify(document))).ok).toBe(true)
})
