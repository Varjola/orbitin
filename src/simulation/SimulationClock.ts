import { MAX_SIMULATION_INSTANT, MIN_SIMULATION_INSTANT, SIMULATION_START_INSTANT } from '../core/constants.ts'
import type { SimulationInstant } from '../core/time.ts'
import { clampInstant } from '../core/timeFormat.ts'

export class SimulationClock {
  private instant: SimulationInstant = { ...SIMULATION_START_INSTANT }
  playing = true
  speedMultiplier = 60
  reversed = false
  private lastWallMs: number | null = null

  currentInstant(): SimulationInstant {
    return { ...this.instant }
  }

  setInstant(instant: SimulationInstant): void {
    if (!Number.isFinite(instant.unixSeconds)) throw new Error('Simulation instant must be finite')
    this.instant = clampInstant(instant)
    // Wall time that passed before a jump must not be replayed after it.
    this.lastWallMs = null
  }

  /** `realDeltaSeconds` is the capped frame delta. With `wallNowMs`, forward 1×
   * playback instead advances by the wall-clock time since the previous
   * advance, so frames the browser suspended in a background tab are caught
   * up and the clock keeps its offset from real time. */
  advance(realDeltaSeconds: number, wallNowMs?: number): void {
    if (!Number.isFinite(realDeltaSeconds) || realDeltaSeconds < 0) throw new Error('Delta must be finite and non-negative')
    const previousWallMs = this.lastWallMs
    this.lastWallMs = wallNowMs !== undefined && Number.isFinite(wallNowMs) ? wallNowMs : null
    if (!this.playing) return
    if (!Number.isFinite(this.speedMultiplier) || this.speedMultiplier < 1) throw new Error('Speed must be finite and at least one')
    const wallDeltaSeconds = previousWallMs !== null && this.lastWallMs !== null ? Math.max(0, (this.lastWallMs - previousWallMs) / 1000) : null
    const deltaSeconds = wallDeltaSeconds !== null && !this.reversed && this.speedMultiplier === 1 ? wallDeltaSeconds : realDeltaSeconds
    const next = this.instant.unixSeconds + deltaSeconds * this.speedMultiplier * (this.reversed ? -1 : 1)
    this.instant = clampInstant({ unixSeconds: next })
    if (this.reversed ? next <= MIN_SIMULATION_INSTANT.unixSeconds : next >= MAX_SIMULATION_INSTANT.unixSeconds) this.playing = false
  }

  togglePlaying(): void {
    this.playing = !this.playing
  }
}
