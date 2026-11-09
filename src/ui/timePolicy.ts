import type { ProductMode } from '../state/AppState.ts'

/** What the time controls offer in a mode, on either presentation. */
export interface TimePolicy {
  /** The compact button's speeds, in order. */
  readonly cycle: readonly number[]
  /** The step buttons in the drawer. */
  readonly steps: readonly number[]
  /** The date field, Now, Reset and Reverse: changing the instant or the
   *  direction of time. Without them nothing is left for a drawer, so the
   *  controls are one row with a speed slider. */
  readonly travel: boolean
}

const SCENE_TIME_POLICY: TimePolicy = { cycle: [1, 60, 600], steps: [1, 60, 600, 3600], travel: true }
const TIME_POLICIES: Readonly<Record<ProductMode, TimePolicy>> = {
  orbitLab: SCENE_TIME_POLICY,
  // A game runs only forward from its start, and a burn sets 1× itself.
  maneuvers: { cycle: [60, 120, 600], steps: [], travel: false },
  // Hidden in this mode, which is driven by its own playback.
  routePlanner: { cycle: [1], steps: [], travel: false },
  realObjects: SCENE_TIME_POLICY,
}

export function timePolicyFor(mode: ProductMode): TimePolicy { return TIME_POLICIES[mode] }
