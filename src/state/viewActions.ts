import type { AppState, EarthStyle, LookState, SceneBackdrop } from './AppState.ts'

/** The one place that writes the global 2D-map preference.
 *
 * A map is a view. Opening or closing it must not change the
 * learning mode, the selection, any object's ground-track or recording flag, or
 * the simulation clock. Routing both the panel toggle and the overlay's Close
 * button through this function is what makes that a single, testable rule
 * rather than two call sites that have to remember it.
 */
export function setGroundTrackMapVisible(state: AppState, groundTrackMapVisible: boolean): AppState {
  if (state.view.groundTrackMapVisible === groundTrackMapVisible) return state
  return { ...state, view: { ...state.view, groundTrackMapVisible } }
}

/** The default look. */
export const DEFAULT_LOOK: LookState = Object.freeze({ earthStyle: 'imagery', orbitLabBackdrop: 'space' })

function withLook(state: AppState, look: Partial<LookState>): AppState {
  const next = { ...state.look, ...look }
  if (next.earthStyle === state.look.earthStyle && next.orbitLabBackdrop === state.look.orbitLabBackdrop) return state
  return { ...state, look: next }
}

export function setEarthStyle(state: AppState, earthStyle: EarthStyle): AppState { return withLook(state, { earthStyle }) }
export function setOrbitLabBackdrop(state: AppState, orbitLabBackdrop: SceneBackdrop): AppState { return withLook(state, { orbitLabBackdrop }) }

/** The backdrop actually drawn: the Lab backdrop belongs to Orbit Lab only;
 *  Real Objects is always in space. */
export function effectiveBackdrop(state: AppState): SceneBackdrop {
  return state.activeMode === 'orbitLab' ? state.look.orbitLabBackdrop : 'space'
}
