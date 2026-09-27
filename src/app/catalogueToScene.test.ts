import { expect, it } from 'vitest'
import { decodeCatalogueManifest, decodeCatalogueShard, type CatalogueManifestV1, type CatalogueRecordV1 } from '../data/catalogueSchema.ts'
import { buildAutomaticSnapshotFixture } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { catalogueImportProvenance } from '../data/catalogueImport.ts'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { createDefaultOrbitLabObject } from '../state/initialState.ts'
import { OBJECT_COLORS } from '../state/objectActions.ts'
import type { SceneState } from '../state/AppState.ts'
import { buildCatalogueAdditionPreview, catalogueIdOfSceneObject, nextObjectColors, planCatalogueAddition, sceneObjectFromCatalogueRecord } from './catalogueToScene.ts'
import legacyManifestText from '../../workers/catalogue/fixtures/legacy-snapshot/manifest.json?raw'
import legacyShard7Text from '../../workers/catalogue/fixtures/legacy-snapshot/records-7.json?raw'
import { MAX_SCENE_OBJECTS } from '../state/sceneActions.ts'

function automaticRecord(id: string): { manifest: CatalogueManifestV1; record: CatalogueRecordV1 } {
  const fixture = buildAutomaticSnapshotFixture()
  const manifest = decodeCatalogueManifest(fixture.manifest)
  const shardIndex = fixture.shards.findIndex((shard) => id in shard.records)
  return { manifest, record: decodeCatalogueShard(fixture.shards[shardIndex], manifest, shardIndex).records[id] }
}

it('converts automatic and legacy records into conservative SGP4 scene objects', () => {
  const automatic = automaticRecord('900001')
  const result = sceneObjectFromCatalogueRecord(automatic.record, automatic.manifest, 0x123456)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.object).toMatchObject({
    id: 'catalogue-900001', propagation: { kind: 'sgp4' }, style: { colorHex: 0x123456 },
    display: { orbitPathVisible: true, bodyVisible: true, groundTrackVisible: false, groundTrackHistoryRecording: false, sensorGeometryVisible: false },
  })
  if (result.object.source.kind !== 'omm') throw new Error('Expected an OMM source.')
  expect(result.object.source.definition.provenance).toEqual(catalogueImportProvenance(automatic.record, automatic.manifest))

  const legacyManifest = decodeCatalogueManifest(JSON.parse(legacyManifestText))
  const legacyRecord = decodeCatalogueShard(JSON.parse(legacyShard7Text), legacyManifest, 7).records['25544']
  const legacy = sceneObjectFromCatalogueRecord(legacyRecord, legacyManifest, 0xffffff)
  expect(legacy.ok).toBe(true)
  if (legacy.ok && legacy.object.source.kind === 'omm') expect(legacy.object.source.definition.provenance).toEqual(legacyRecord.provenance)
})

it('rejects malformed records and identifies only catalogue-backed objects', () => {
  const { manifest, record } = automaticRecord('900001')
  const malformed = sceneObjectFromCatalogueRecord({ ...record, MEAN_MOTION: 'not a number' } as unknown as CatalogueRecordV1, manifest, 0)
  expect(malformed).toMatchObject({ ok: false, catalogId: '900001' })
  const valid = sceneObjectFromCatalogueRecord(record, manifest, 0)
  if (!valid.ok) throw new Error('Expected a valid record.')
  expect(catalogueIdOfSceneObject(valid.object)).toBe('900001')
  expect(catalogueIdOfSceneObject(createDefaultOrbitLabObject('orbit', 0, SIMULATION_START_INSTANT))).toBeNull()
})

it('classifies duplicate requests as present, pending or new in request order', () => {
  const { manifest, record } = automaticRecord('900001')
  const converted = sceneObjectFromCatalogueRecord(record, manifest, OBJECT_COLORS[0])
  if (!converted.ok) throw new Error('Expected a valid record.')
  const present = { ...converted.object, id: 'omm-1', name: 'Already here' }
  const scene: SceneState = { objects: [present], selection: { ids: [], primaryId: null } }
  expect(planCatalogueAddition(scene, ['900002', '900001', '900003', '900002'], new Set(['900003']))).toEqual({
    requested: ['900002', '900001', '900003'],
    present: [{ sceneId: 'omm-1', catalogId: '900001', name: 'Already here' }],
    pending: ['900003'], toAdd: ['900002'],
  })
  expect(planCatalogueAddition(scene, [], new Set())).toEqual({ requested: [], present: [], pending: [], toAdd: [] })
})

it('assigns unused palette colours first and then cycles', () => {
  const empty: SceneState = { objects: [], selection: { ids: [], primaryId: null } }
  expect(nextObjectColors(empty, 3)).toEqual(OBJECT_COLORS.slice(0, 3))
  const template = createDefaultOrbitLabObject('x', OBJECT_COLORS[0], SIMULATION_START_INSTANT)
  const used: SceneState = { objects: [template, { ...template, id: 'y', style: { ...template.style, colorHex: OBJECT_COLORS[1] } }], selection: { ids: [], primaryId: null } }
  expect(nextObjectColors(used, 2)).toEqual(OBJECT_COLORS.slice(2, 4))
  expect(nextObjectColors(empty, OBJECT_COLORS.length + 2)).toEqual([...OBJECT_COLORS, OBJECT_COLORS[0], OBJECT_COLORS[1]])
})

it('builds duplicate and capacity previews without resolving catalogue records', () => {
  const { manifest, record } = automaticRecord('900001')
  const converted = sceneObjectFromCatalogueRecord(record, manifest, OBJECT_COLORS[0])
  if (!converted.ok) throw new Error('Expected valid fixture record.')
  const scene: SceneState = { objects: [{ ...converted.object, id: 'present' }], selection: { ids: [], primaryId: null } }
  expect(buildCatalogueAdditionPreview(scene, ['900001', '900002', '900001'])).toMatchObject({ totalSelected: 2, alreadyInScene: 1, newRecordsToAdd: 1, slotsRemaining: MAX_SCENE_OBJECTS - 1, canAddAll: true })
  expect(buildCatalogueAdditionPreview(scene, ['900001'])).toMatchObject({ totalSelected: 1, alreadyInScene: 1, newRecordsToAdd: 0, canAddAll: false })
  const full: SceneState = { objects: Array.from({ length: MAX_SCENE_OBJECTS }, (_, index) => ({ ...converted.object, id: `full-${index}` })), selection: { ids: [], primaryId: null } }
  expect(buildCatalogueAdditionPreview(full, ['900002'])).toMatchObject({ totalSelected: 1, alreadyInScene: 0, newRecordsToAdd: 1, slotsRemaining: 0, canAddAll: false })
  expect(buildCatalogueAdditionPreview(full, [])).toMatchObject({ totalSelected: 0, canAddAll: false })
})
