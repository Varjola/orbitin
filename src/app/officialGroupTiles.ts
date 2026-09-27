import type { CatalogueGroupDefinitionSet } from '../data/catalogueGroups.ts'
import type { SceneState } from '../state/AppState.ts'
import { remainingCapacity } from '../state/sceneActions.ts'
import type { OfficialGroupTile } from '../ui/applicationUi.ts'
import { catalogueIdOfSceneObject } from './catalogueToScene.ts'

/** The official groups the build carries, as mobile
 *  Add-sheet tiles. No new data and no new search: membership is the same
 *  resolution the desktop whole-group add uses, and a group's present members
 *  are those in the loaded index, in its reviewed order.
 *
 *  `presentMembers` returns null while the catalogue is not loaded. */
export function officialGroupTiles(
  definitions: CatalogueGroupDefinitionSet,
  presentMembers: (groupId: string) => readonly string[] | null,
  realObjects: SceneState,
): OfficialGroupTile[] {
  const inScene = new Set<string>()
  for (const object of realObjects.objects) { const id = catalogueIdOfSceneObject(object); if (id) inScene.add(id) }
  return definitions.groups.map((group) => {
    const memberIds = presentMembers(group.id) ?? []
    const missing = memberIds.filter((id) => !inScene.has(id)).length
    const state: OfficialGroupTile['state'] = memberIds.length === 0 ? 'unavailable'
      : missing === 0 ? 'in-scene'
        : missing > remainingCapacity(realObjects) ? 'full'
          : 'ready'
    return { groupId: group.id, title: group.title, memberIds, state }
  })
}
