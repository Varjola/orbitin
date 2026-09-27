import type { AppState, OrbitLabDrawerTab, ProductMode } from './AppState.ts'
export function setActiveMode(state: AppState, mode: ProductMode): AppState { return state.activeMode === mode ? state : { ...state, activeMode: mode } }
export function setOrbitLabDrawerTab(state: AppState, tab: OrbitLabDrawerTab): AppState { return state.orbitLab.authoring.drawerTab === tab ? state : { ...state, orbitLab: { ...state.orbitLab, authoring: { ...state.orbitLab.authoring, drawerTab: tab } } } }
