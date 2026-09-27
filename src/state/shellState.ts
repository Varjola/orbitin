import type { ProductMode } from './AppState.ts'
export const NARROW_VIEWPORT_QUERY = '(max-width: 639px)'
export interface ShellState {
  readonly narrowViewport: boolean
  readonly leftDrawerOpen: boolean
  readonly inspectorOpen: boolean
  readonly timeDrawerOpen: boolean
  readonly viewDrawerOpen: boolean
  /** The 2D map is the alternative main view. */
  readonly mapMaximized: boolean
  readonly catalogueWorkspaceOpen: boolean
  /** Scene Objects shows its full manager, or only the active-object bar. */
  readonly sceneObjectsExpanded: boolean
}
export function initialShellState(narrowViewport: boolean): ShellState { return { narrowViewport, leftDrawerOpen: false, inspectorOpen: false, timeDrawerOpen: false, viewDrawerOpen: false, mapMaximized: false, catalogueWorkspaceOpen: false, sceneObjectsExpanded: true } }
export function toggleLeftDrawer(state: ShellState): ShellState {
  const leftDrawerOpen = !state.leftDrawerOpen
  return state.narrowViewport && leftDrawerOpen ? { ...state, leftDrawerOpen, inspectorOpen: false, timeDrawerOpen: false, viewDrawerOpen: false } : { ...state, leftDrawerOpen }
}
export function toggleInspector(state: ShellState): ShellState {
  const inspectorOpen = !state.inspectorOpen
  return state.narrowViewport && inspectorOpen ? { ...state, inspectorOpen, leftDrawerOpen: false, timeDrawerOpen: false, viewDrawerOpen: false } : { ...state, inspectorOpen }
}
export function toggleTimeDrawer(state: ShellState): ShellState { const timeDrawerOpen = !state.timeDrawerOpen; return { ...state, timeDrawerOpen, viewDrawerOpen: timeDrawerOpen ? false : state.viewDrawerOpen } }
export function toggleViewDrawer(state: ShellState): ShellState { const viewDrawerOpen = !state.viewDrawerOpen; return { ...state, viewDrawerOpen, timeDrawerOpen: viewDrawerOpen ? false : state.timeDrawerOpen } }
/** 3D drawing is skipped only while the maximized map
 *  is open and actually drawn over the 3D view. */
export function mapCoversScene(state: ShellState, mapVisible: boolean, mapOpen: boolean): boolean { return state.mapMaximized && mapVisible && mapOpen }
export function toggleSceneObjects(state: ShellState): ShellState { return { ...state, sceneObjectsExpanded: !state.sceneObjectsExpanded } }
export function toggleMapMaximized(state: ShellState): ShellState { return { ...state, mapMaximized: !state.mapMaximized } }
export function shellAfterMapVisibilityChange(state: ShellState, visible: boolean): ShellState { return visible || !state.mapMaximized ? state : { ...state, mapMaximized: false } }
export function setCatalogueWorkspaceOpen(state: ShellState, open: boolean): ShellState { return state.catalogueWorkspaceOpen === open ? state : { ...state, catalogueWorkspaceOpen: open } }
export function shellAfterModeChange(state: ShellState, mode: ProductMode): ShellState { return mode === 'orbitLab' && state.catalogueWorkspaceOpen ? { ...state, catalogueWorkspaceOpen: false } : state }
export function shellAfterViewportChange(state: ShellState, narrowViewport: boolean): ShellState { if (state.narrowViewport === narrowViewport) return state; return narrowViewport && state.leftDrawerOpen && state.inspectorOpen ? { ...state, narrowViewport, leftDrawerOpen: false, inspectorOpen: false } : { ...state, narrowViewport } }
export function shellForCameraFit(state: ShellState): ShellState { return state.narrowViewport && (state.leftDrawerOpen || state.inspectorOpen) ? { ...state, leftDrawerOpen: false, inspectorOpen: false } : state }
/** A presentation switch closes the desktop drawers and
 *  the Catalogue workspace. On mobile the 2D map is a full-screen alternative
 *  view, so entering mobile maximizes it exactly when it is showing. */
export function shellAfterPresentationChange(state: ShellState, next: 'desktop' | 'mobile', mapVisible: boolean): ShellState {
  const closed: ShellState = { ...state, leftDrawerOpen: false, inspectorOpen: false, timeDrawerOpen: false, viewDrawerOpen: false, catalogueWorkspaceOpen: false }
  return next === 'mobile' ? { ...closed, mapMaximized: mapVisible } : closed
}
