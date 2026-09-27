import type { OrbitalObject } from '../simulation/OrbitalObject.ts'
import type { SceneSelection, SceneState } from './AppState.ts'
/** The measured capacity of one mode scene with the current
 *  per-object rendering technique. */
export const MAX_SCENE_OBJECTS = 100
export function sceneObject(scene: SceneState, id: string): OrbitalObject | undefined { return scene.objects.find((object) => object.id === id) }
export function primaryObject(scene: SceneState): OrbitalObject | undefined { return scene.selection.primaryId ? sceneObject(scene, scene.selection.primaryId) : undefined }
export function singleSelectedObject(scene: SceneState): OrbitalObject | undefined { return scene.selection.ids.length === 1 ? sceneObject(scene, scene.selection.ids[0]) : undefined }
export function remainingCapacity(scene: SceneState): number { return Math.max(0, MAX_SCENE_OBJECTS - scene.objects.length) }
export function addObjects(scene: SceneState, objects: readonly OrbitalObject[]): SceneState {
  if (objects.length === 0 || objects.length > remainingCapacity(scene)) return scene
  const known = new Set(scene.objects.map((object) => object.id)); const added = new Set<string>()
  for (const object of objects) { if (known.has(object.id) || added.has(object.id)) return scene; added.add(object.id) }
  return { objects: [...scene.objects, ...objects], selection: { ids: objects.map((object) => object.id), primaryId: objects[0].id } }
}
export function selectOnly(scene: SceneState, id: string): SceneState { if (!sceneObject(scene, id)) return scene; return scene.selection.ids.length === 1 && scene.selection.ids[0] === id && scene.selection.primaryId === id ? scene : { ...scene, selection: { ids: [id], primaryId: id } } }
export function toggleSelected(scene: SceneState, id: string): SceneState {
  if (!sceneObject(scene, id)) return scene
  if (!scene.selection.ids.includes(id)) return { ...scene, selection: { ids: [...scene.selection.ids, id], primaryId: id } }
  const ids = scene.selection.ids.filter((candidate) => candidate !== id)
  return { ...scene, selection: { ids, primaryId: scene.selection.primaryId === id ? ids[ids.length - 1] ?? null : scene.selection.primaryId } }
}
/** Scene Objects checkbox semantics. Unlike
 *  `toggleSelected`, adding a member never moves the primary; only an empty
 *  selection or unchecking the primary itself changes it. */
export function toggleMembership(scene: SceneState, id: string): SceneState {
  if (!sceneObject(scene, id)) return scene
  if (!scene.selection.ids.includes(id)) return { ...scene, selection: { ids: [...scene.selection.ids, id], primaryId: scene.selection.primaryId ?? id } }
  const ids = scene.selection.ids.filter((candidate) => candidate !== id)
  return { ...scene, selection: { ids, primaryId: scene.selection.primaryId === id ? ids[ids.length - 1] ?? null : scene.selection.primaryId } }
}
export function setSelection(scene: SceneState, selection: SceneSelection): SceneState {
  const known = new Set(scene.objects.map((object) => object.id)); const ids: string[] = []
  for (const id of selection.ids) if (known.has(id) && !ids.includes(id)) ids.push(id)
  const primaryId = ids.length === 0 ? null : selection.primaryId && ids.includes(selection.primaryId) ? selection.primaryId : ids[ids.length - 1]
  if (ids.length === scene.selection.ids.length && ids.every((id, index) => id === scene.selection.ids[index]) && primaryId === scene.selection.primaryId) return scene
  return { ...scene, selection: { ids, primaryId } }
}
export function selectMany(scene: SceneState, ids: readonly string[]): SceneState { const known = new Set(scene.objects.map((object) => object.id)); return setSelection(scene, { ids, primaryId: ids.find((id) => known.has(id)) ?? null }) }
export function clearSelection(scene: SceneState): SceneState { return scene.selection.ids.length === 0 ? scene : { ...scene, selection: { ids: [], primaryId: null } } }
export function removeObjects(scene: SceneState, ids: readonly string[]): SceneState {
  const removed = new Set(ids.filter((id) => sceneObject(scene, id))); if (removed.size === 0) return scene
  const removedIndex = removed.size === 1 ? scene.objects.findIndex((object) => removed.has(object.id)) : -1; const objects = scene.objects.filter((object) => !removed.has(object.id)); const selected = scene.selection.ids.filter((id) => !removed.has(id))
  let selection: SceneSelection = { ids: selected, primaryId: selected.includes(scene.selection.primaryId ?? '') ? scene.selection.primaryId : selected[selected.length - 1] ?? null }
  if (removed.size === 1 && scene.selection.ids.length === 1 && removed.has(scene.selection.ids[0]) && objects.length > 0) { const neighbor = objects[Math.min(removedIndex, objects.length - 1)].id; selection = { ids: [neighbor], primaryId: neighbor } }
  return { objects, selection }
}
export function updateSceneObject(scene: SceneState, id: string, update: (object: OrbitalObject) => OrbitalObject): SceneState { const current = sceneObject(scene, id); if (!current) return scene; const next = update(current); if (next.id !== id) throw new Error('An object update must preserve its ID'); return next === current ? scene : { ...scene, objects: scene.objects.map((object) => object.id === id ? next : object) } }
