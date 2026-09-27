import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import type { SimulationInstant } from '../core/time.ts'
import { clampInstant } from '../core/timeFormat.ts'
import { withScene, type AppState, type ProductMode } from '../state/AppState.ts'
import { setLastConstraint } from '../state/objectActions.ts'
import type { ResolvedSceneDocument } from './resolveSceneDocument.ts'

/** An Orbit Lab scene opens at the start
 *  instant, paused; a Real Objects scene opens at the current time, playing,
 *  so current element sets stay close to their epochs. */
export function sharedSceneOpeningClock(mode: ProductMode, nowUnixMs: number): { readonly instant: SimulationInstant; readonly playing: boolean } {
  return mode === 'orbitLab'
    ? { instant: { ...SIMULATION_START_INSTANT }, playing: false }
    : { instant: clampInstant({ unixSeconds: nowUnixMs / 1000 }), playing: true }
}

/** The one state commit of an open: the shared mode's scene and selection,
 *  the active mode, the view and the clock. The other mode's scene, speed and
 *  direction are kept. `nowUnixMs` is read when applying, not when decoding. */
export function applySharedSceneToState(state: AppState, mode: ProductMode, resolved: ResolvedSceneDocument, nowUnixMs: number): AppState {
  const clock = sharedSceneOpeningClock(mode, nowUnixMs)
  const next = withScene(state, mode, mode === 'orbitLab' ? resolved.orbitLab : resolved.realObjects)
  const opened: AppState = { ...next, activeMode: mode, view: { ...resolved.view }, simulation: { ...next.simulation, currentInstant: clock.instant, playing: clock.playing } }
  return mode === 'orbitLab' ? setLastConstraint(opened, { kind: 'none' }) : opened
}
