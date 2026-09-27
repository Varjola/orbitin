import type { SimulationInstant } from '../core/time.ts'
import type { ElementConstraint } from '../orbital/geometry.ts'
import type { OrbitalObject } from '../simulation/OrbitalObject.ts'

export type ProductMode = 'orbitLab' | 'realObjects'
export const PRODUCT_MODES: readonly ProductMode[] = ['orbitLab', 'realObjects']
export interface SceneSelection { readonly ids: readonly string[]; readonly primaryId: string | null }
export interface SceneState { readonly objects: readonly OrbitalObject[]; readonly selection: SceneSelection }
export type OrbitLabDrawerTab = 'edit' | 'examples'
/** How the scene looks. Kept apart from `view`, which scene files
 *  and links carry; looks are never shared or stored. */
export type EarthStyle = 'imagery' | 'map'
export type SceneBackdrop = 'space' | 'lab'
/** The map style includes country borders. */
export interface LookState { readonly earthStyle: EarthStyle; readonly orbitLabBackdrop: SceneBackdrop }
export interface AppState {
  readonly activeMode: ProductMode
  readonly orbitLab: { readonly scene: SceneState; readonly authoring: { readonly drawerTab: OrbitLabDrawerTab; readonly lastConstraint: ElementConstraint } }
  readonly realObjects: { readonly scene: SceneState }
  readonly simulation: { readonly playing: boolean; readonly reversed: boolean; readonly speedMultiplier: number; readonly currentInstant: SimulationInstant }
  readonly view: { readonly scaleMarkersWithZoom: boolean; readonly groundTrackMapVisible: boolean }
  readonly look: LookState
}
export const EMPTY_SELECTION: SceneSelection = { ids: [], primaryId: null }
export const EMPTY_SCENE: SceneState = { objects: [], selection: EMPTY_SELECTION }
export function activeScene(state: AppState): SceneState { return sceneFor(state, state.activeMode) }
export function sceneFor(state: AppState, mode: ProductMode): SceneState { return mode === 'orbitLab' ? state.orbitLab.scene : state.realObjects.scene }
export function withScene(state: AppState, mode: ProductMode, next: SceneState): AppState {
  if (next === sceneFor(state, mode)) return state
  return mode === 'orbitLab' ? { ...state, orbitLab: { ...state.orbitLab, scene: next } } : { ...state, realObjects: { ...state.realObjects, scene: next } }
}
export function withActiveScene(state: AppState, update: (scene: SceneState) => SceneState): AppState { return withScene(state, state.activeMode, update(activeScene(state))) }
export function allSceneObjectIds(state: AppState): Set<string> { return new Set([...state.orbitLab.scene.objects, ...state.realObjects.scene.objects].map((object) => object.id)) }
export type StateListener = (state: AppState) => void
export class AppStateStore {
  private listeners = new Set<StateListener>()
  private state: AppState
  constructor(state: AppState) { this.state = state }
  getState(): AppState { return this.state }
  update(updater: (state: AppState) => AppState): void { this.state = updater(this.state); for (const listener of this.listeners) listener(this.state) }
  subscribe(listener: StateListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
}
