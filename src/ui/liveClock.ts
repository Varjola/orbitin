import type { AppState } from '../state/AppState.ts'

/** How far the simulation clock may be from the wall clock and still count
 *  as following real time. */
export const LIVE_TOLERANCE_SECONDS = 5

/** True while the clock follows real time: playing
 *  forward at 1× within a few seconds of now. Real Objects shows a Live
 *  badge then, and a Now button otherwise. */
export function isLiveClock(simulation: Pick<AppState['simulation'], 'playing' | 'speedMultiplier' | 'reversed'>, instantUnixSeconds: number, wallUnixSeconds: number): boolean {
  return simulation.playing && simulation.speedMultiplier === 1 && !simulation.reversed && Math.abs(instantUnixSeconds - wallUnixSeconds) <= LIVE_TOLERANCE_SECONDS
}
