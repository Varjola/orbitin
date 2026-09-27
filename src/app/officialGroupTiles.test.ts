import { expect, it } from 'vitest'
import { decodeCatalogueIndex, decodeCatalogueManifest, decodeCatalogueShard, type CatalogueRecordV1 } from '../data/catalogueSchema.ts'
import { buildAutomaticSnapshotFixture } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { EMPTY_SCENE, type SceneState } from '../state/AppState.ts'
import { MAX_SCENE_OBJECTS } from '../state/sceneActions.ts'
import { resolveDiscoveryMembership } from '../ui/catalogueDiscoveryModel.ts'
import { FIXTURE_CATALOGUE_GROUP_DEFINITIONS, FIXTURE_GPS_DISCOVERY_PAGE, FIXTURE_GPS_PRESENT_MEMBER_IDS } from '../test-fixtures/catalogueGroupFixtures.ts'
import { sceneObjectFromCatalogueRecord } from './catalogueToScene.ts'
import { officialGroupTiles } from './officialGroupTiles.ts'

const fixture = buildAutomaticSnapshotFixture({ syntheticNavigationMembers: true })
const manifest = decodeCatalogueManifest(fixture.manifest)
const index = decodeCatalogueIndex(fixture.index, manifest)
const records: CatalogueRecordV1[] = fixture.shards.flatMap((shard, position) => Object.values(decodeCatalogueShard(shard, manifest, position).records))
/** The desktop whole-group add's membership resolution, against the fixture index. */
const loaded = (groupId: string) => groupId === 'gps-system' ? resolveDiscoveryMembership(FIXTURE_GPS_DISCOVERY_PAGE, index.entries, FIXTURE_CATALOGUE_GROUP_DEFINITIONS).catalogIds : []
const sceneWith = (ids: readonly string[]): SceneState => {
  const objects = ids.map((id) => {
    const record = records.find((candidate) => candidate.NORAD_CAT_ID === id)!
    const converted = sceneObjectFromCatalogueRecord(record, manifest, 0x56b4e9)
    if (!converted.ok) throw new Error(converted.message)
    return converted.object
  })
  return { objects, selection: { ids: [], primaryId: null } }
}

it('is unavailable until the catalogue is loaded, and loading changes nothing else', () => {
  expect(officialGroupTiles(FIXTURE_CATALOGUE_GROUP_DEFINITIONS, () => null, EMPTY_SCENE)).toEqual([
    { groupId: 'gps-system', title: 'GPS system', memberIds: [], state: 'unavailable' },
  ])
})

it('offers the present members in reviewed order and leaves absent members out', () => {
  const [tile] = officialGroupTiles(FIXTURE_CATALOGUE_GROUP_DEFINITIONS, loaded, EMPTY_SCENE)
  expect(tile).toEqual({ groupId: 'gps-system', title: 'GPS system', memberIds: [...FIXTURE_GPS_PRESENT_MEMBER_IDS], state: 'ready' })
})

it('is unavailable when no member is present in the snapshot', () => {
  expect(officialGroupTiles(FIXTURE_CATALOGUE_GROUP_DEFINITIONS, () => [], EMPTY_SCENE)[0].state).toBe('unavailable')
})

it('reports a group whose present members are all in the scene', () => {
  expect(officialGroupTiles(FIXTURE_CATALOGUE_GROUP_DEFINITIONS, loaded, sceneWith(FIXTURE_GPS_PRESENT_MEMBER_IDS))[0].state).toBe('in-scene')
  expect(officialGroupTiles(FIXTURE_CATALOGUE_GROUP_DEFINITIONS, loaded, sceneWith(FIXTURE_GPS_PRESENT_MEMBER_IDS.slice(0, 2)))[0].state).toBe('ready')
})

it('reports a scene without room for the members still missing', () => {
  const partial = sceneWith(FIXTURE_GPS_PRESENT_MEMBER_IDS.slice(0, 1))
  const filler = { ...partial.objects[0], name: 'filler' }
  const almostFull: SceneState = { objects: [...partial.objects, ...Array.from({ length: MAX_SCENE_OBJECTS - 3 }, (_, n) => ({ ...filler, id: `filler-${n}` }))], selection: partial.selection }
  // Three members are missing, and there is room for two.
  expect(officialGroupTiles(FIXTURE_CATALOGUE_GROUP_DEFINITIONS, loaded, almostFull)[0].state).toBe('full')
  const roomForThree: SceneState = { ...almostFull, objects: almostFull.objects.slice(0, -1) }
  expect(officialGroupTiles(FIXTURE_CATALOGUE_GROUP_DEFINITIONS, loaded, roomForThree)[0].state).toBe('ready')
})
