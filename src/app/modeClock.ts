import type { SimulationInstant } from '../core/time.ts'
import type { ProductMode } from '../state/AppState.ts'

/** The shared clock as Orbit Lab left it. */
export interface ClockSnapshot {
  readonly instant: SimulationInstant
  readonly speedMultiplier: number
  readonly playing: boolean
  readonly reversed: boolean
}

/** What entering a mode does to the shared clock: keep it as it is, put Orbit
 *  Lab's clock back, or follow real time. */
export type ModeClockEntry =
  | { readonly kind: 'keep' }
  | { readonly kind: 'restore'; readonly clock: ClockSnapshot }
  | { readonly kind: 'live' }

/** A mode switch first remembers Orbit Lab's clock when leaving it, then
 *  applies the entry. */
export interface ModeClockStep {
  readonly rememberLab: boolean
  readonly entry: ModeClockEntry
}

const KEEP: ModeClockEntry = { kind: 'keep' }
const LIVE: ModeClockEntry = { kind: 'live' }

/** Orbit Lab keeps a clock of its own: leaving it remembers the clock, and
 *  coming back from any mode puts it back. Real Objects always follows real
 *  time, the current instant at 1×. Interception and the Route Planner set the
 *  clock themselves, so entering them keeps it. */
export function modeClockStep(previous: ProductMode, next: ProductMode, labClock: ClockSnapshot | null): ModeClockStep {
  if (previous === next) return { rememberLab: false, entry: KEEP }
  const rememberLab = previous === 'orbitLab'
  if (next === 'realObjects') return { rememberLab, entry: LIVE }
  if (next === 'orbitLab' && labClock) return { rememberLab, entry: { kind: 'restore', clock: labClock } }
  return { rememberLab, entry: KEEP }
}
