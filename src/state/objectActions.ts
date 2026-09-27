import type { OrbitalObject } from '../simulation/OrbitalObject.ts'
import { activeScene, sceneFor, withScene, type AppState, type ProductMode } from './AppState.ts'
import { addObjects, MAX_SCENE_OBJECTS, removeObjects, selectOnly, singleSelectedObject, updateSceneObject } from './sceneActions.ts'
import { SENSOR_MAX_FIELD_OF_VIEW_HALF_ANGLE_RAD, SENSOR_MAX_GROUND_ELEVATION_RAD, SENSOR_MAX_OFF_NADIR_STEERING_RAD, SENSOR_MIN_FIELD_OF_VIEW_HALF_ANGLE_RAD, SENSOR_MIN_GROUND_ELEVATION_RAD, SENSOR_MIN_OFF_NADIR_STEERING_RAD } from '../core/constants.ts'
import { checkSceneBudgets, LAYER_BUDGETS, withLayer, type BudgetCheck, type BudgetedLayer, type LayerBudgets } from './sceneComplexity.ts'
export { MAX_SCENE_OBJECTS }
/** The colour chooser's palette in display order: a
 *  typical palette of hues, tuned to stay visible on the dark scene, then light
 *  tints and neutrals. Their names, which describe colours only, are interface
 *  text (`colours.names`). */
export const OBJECT_PALETTE: readonly number[] = [
  0xff4d4f, 0xd55e00, 0xe69f00, 0xffc857, 0xf0e442, 0xa3e635, 0x4fd18b, 0x009e73,
  0x22d3ee, 0x56b4e9, 0x3b82f6, 0x6f7cf2, 0x9b6bff, 0xb05bd6, 0xe040fb, 0xcc79a7,
  0xff8fab, 0xffb38a, 0xe8d5a3, 0xa7f3d0, 0xbfe3ff, 0xd0bcff, 0xb8c2cc, 0xffffff,
]
/** Automatic assignment order: the whole palette, ordered so consecutive
 *  objects differ in hue. The first eight are the colour-vision-deficiency
 *  friendly set earlier releases assigned. */
export const OBJECT_COLORS: readonly number[] = [
  0xffc857, 0x56b4e9, 0xe69f00, 0x009e73, 0xcc79a7, 0xf0e442, 0xd55e00, 0xffffff,
  0xff4d4f, 0x22d3ee, 0xa3e635, 0x9b6bff, 0x3b82f6, 0xe040fb, 0x4fd18b, 0xffb38a,
  0x6f7cf2, 0xff8fab, 0xbfe3ff, 0xb05bd6, 0xa7f3d0, 0xd0bcff, 0xe8d5a3, 0xb8c2cc,
]
/** The one row of swatches the colour chooser offers before its custom colour:
 *  the first eight automatic colours, in hue
 *  order, so small scenes keep a pressed swatch. Other palette colours still
 *  keep their names when shown as the current colour. */
export const OBJECT_SWATCHES: readonly number[] = [0xd55e00, 0xe69f00, 0xffc857, 0xf0e442, 0x009e73, 0x56b4e9, 0xcc79a7, 0xffffff]
/** Any 24-bit RGB colour is a valid object colour; the palette only suggests. */
export function isObjectColor(value: number): boolean { return Number.isInteger(value) && value >= 0 && value <= 0xffffff }
export function objectColorCss(value: number): string { return `#${(value >>> 0 & 0xffffff).toString(16).padStart(6, '0')}` }
export function getSelectedObject(state: AppState): OrbitalObject | undefined { return singleSelectedObject(activeScene(state)) }
export function addObjectToMode(state: AppState, mode: ProductMode, object: OrbitalObject): AppState { const next = withScene(state, mode, addObjects(sceneFor(state, mode), [object])); return mode === 'orbitLab' && next !== state ? { ...next, orbitLab: { ...next.orbitLab, authoring: { ...next.orbitLab.authoring, lastConstraint: { kind: 'none' } } } } : next }
export function addObject(state: AppState, object: OrbitalObject): AppState { return addObjectToMode(state, state.activeMode, object) }
export function selectObject(state: AppState, id: string): AppState { const next = withScene(state, state.activeMode, selectOnly(activeScene(state), id)); return next !== state && state.activeMode === 'orbitLab' ? { ...next, orbitLab: { ...next.orbitLab, authoring: { ...next.orbitLab.authoring, lastConstraint: { kind: 'none' } } } } : next }
export function removeObject(state: AppState, id: string): AppState { const next = withScene(state, state.activeMode, removeObjects(activeScene(state), [id])); return next !== state && state.activeMode === 'orbitLab' ? { ...next, orbitLab: { ...next.orbitLab, authoring: { ...next.orbitLab.authoring, lastConstraint: { kind: 'none' } } } } : next }
export function updateObject(state: AppState, id: string, update: (object: OrbitalObject) => OrbitalObject): AppState { return withScene(state, state.activeMode, updateSceneObject(activeScene(state), id, update)) }
export function setObjectPropagation(state: AppState, id: string, next: OrbitalObject): AppState { return updateObject(state, id, () => next) }
export function setLastConstraint(state: AppState, constraint: AppState['orbitLab']['authoring']['lastConstraint']): AppState { return state.orbitLab.authoring.lastConstraint === constraint ? state : { ...state, orbitLab: { ...state.orbitLab, authoring: { ...state.orbitLab.authoring, lastConstraint: constraint } } } }
export function setObjectSensorGeometryVisible(state: AppState, id: string, visible: boolean): AppState { return updateObject(state, id, (object) => ({ ...object, display: { ...object.display, sensorGeometryVisible: visible } })) }
export function setObjectSensorFieldOfViewHalfAngle(state: AppState, id: string, valueRad: number): AppState { if (!Number.isFinite(valueRad) || valueRad < SENSOR_MIN_FIELD_OF_VIEW_HALF_ANGLE_RAD || valueRad > SENSOR_MAX_FIELD_OF_VIEW_HALF_ANGLE_RAD) return state; return updateObject(state, id, (object) => ({ ...object, sensor: { ...object.sensor, fieldOfViewHalfAngleRad: valueRad } })) }
export function setObjectSensorSteeringLimit(state: AppState, id: string, valueRad: number): AppState { if (!Number.isFinite(valueRad) || valueRad < SENSOR_MIN_OFF_NADIR_STEERING_RAD || valueRad > SENSOR_MAX_OFF_NADIR_STEERING_RAD) return state; return updateObject(state, id, (object) => ({ ...object, sensor: { ...object.sensor, maxOffNadirSteeringRad: valueRad } })) }
export function setObjectMinimumGroundElevation(state: AppState, id: string, valueRad: number): AppState { if (!Number.isFinite(valueRad) || valueRad < SENSOR_MIN_GROUND_ELEVATION_RAD || valueRad > SENSOR_MAX_GROUND_ELEVATION_RAD) return state; return updateObject(state, id, (object) => ({ ...object, reachConstraint: { ...object.reachConstraint, minimumGroundElevationRad: valueRad } })) }
/** Bulk display actions. Each applies one layer to a set of ids in
 *  the active scene through the budget check, and returns the unchanged state
 *  with the failed check when a budget refuses. Nothing partial is applied. */
export function setLayerForObjects(state: AppState, ids: readonly string[], layer: BudgetedLayer, on: boolean, budgets: LayerBudgets = LAYER_BUDGETS): { readonly state: AppState; readonly check: BudgetCheck } {
  const scene = activeScene(state)
  const targets = new Set(ids)
  const objects = scene.objects.map((object) => targets.has(object.id) ? withLayer(object, layer, on) : object)
  const check = checkSceneBudgets(scene.objects, objects, budgets)
  if (!check.ok || objects.every((object, index) => object === scene.objects[index])) return { state, check }
  return { state: withScene(state, state.activeMode, { ...scene, objects }), check }
}
export function setColorForObjects(state: AppState, ids: readonly string[], colorHex: number): AppState {
  if (!isObjectColor(colorHex)) return state
  const scene = activeScene(state)
  const targets = new Set(ids)
  let changed = false
  const objects = scene.objects.map((object) => {
    if (!targets.has(object.id) || object.style.colorHex === colorHex) return object
    changed = true
    return { ...object, style: { ...object.style, colorHex } }
  })
  return changed ? withScene(state, state.activeMode, { ...scene, objects }) : state
}
