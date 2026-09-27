import { sceneFor, withScene, type AppState, type ProductMode, type SceneState } from './AppState.ts'

/** One undoable scene change. Mobile
 *  offers Undo instead of confirmation for adding, creating and removing.
 *
 *  The entry holds the mode's scene before and after the change. Removed
 *  objects are restored from their stored `OrbitalObject` values, so undo
 *  never needs the network. */
export interface SceneUndoEntry {
  readonly mode: ProductMode
  readonly before: SceneState
  readonly after: SceneState
}

/** The change from `before` to `after` in `mode`'s scene (by default the
 *  active mode), or null when that scene did not change. An action names the
 *  scene it changed, since the learner may have switched modes meanwhile. */
export function recordSceneChange(before: AppState, after: AppState, mode: ProductMode = after.activeMode): SceneUndoEntry | null {
  const previous = sceneFor(before, mode)
  const next = sceneFor(after, mode)
  return previous === next ? null : { mode, before: previous, after: next }
}

/** True while the mode's scene is still exactly `after` (reference equality):
 *  any other change to that scene, including its selection, makes the entry stale. */
export function canUndo(entry: SceneUndoEntry, state: AppState): boolean {
  return sceneFor(state, entry.mode) === entry.after
}

/** Restores the mode's scene and selection as they were; any other state
 *  (the other mode's scene, the clock, the active mode) is untouched. */
export function undoSceneChange(entry: SceneUndoEntry, state: AppState): AppState {
  return canUndo(entry, state) ? withScene(state, entry.mode, entry.before) : state
}

/** Every object in either scene: whose session-only provenance an undo restores. */
export function undoObjectIds(entry: SceneUndoEntry): string[] {
  return [...new Set([...entry.before.objects, ...entry.after.objects].map((object) => object.id))]
}

/** Ids whose presence differs between the two scenes: what an undo adds back
 *  or takes away, and so whose session-only provenance it must restore. */
export function touchedObjectIds(entry: SceneUndoEntry): string[] {
  const before = new Set(entry.before.objects.map((object) => object.id))
  const after = new Set(entry.after.objects.map((object) => object.id))
  return [...[...before].filter((id) => !after.has(id)), ...[...after].filter((id) => !before.has(id))]
}
