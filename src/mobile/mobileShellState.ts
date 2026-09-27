import type { ProductMode } from '../state/AppState.ts'

/** The phone presentation's own shell state. Owned by
 *  `MobileUiRoot`, never serialized and not part of `AppState`. It survives a
 *  language rebuild and starts again on a presentation switch. */

export type MobileSurface =
  | 'none' | 'shape' | 'newOrbit' | 'add' | 'object' | 'objects'
  | 'time' | 'layers' | 'menu' | 'about' | 'help' | 'examples'

export type ShapeParameter =
  | 'size' | 'shape' | 'tilt' | 'node' | 'periapsis' | 'position' | 'drift'

export const SHAPE_PARAMETERS: readonly ShapeParameter[] = ['size', 'shape', 'tilt', 'node', 'periapsis', 'position', 'drift']

export interface MobileShellState {
  readonly surface: MobileSurface
  /** Only the object card has two heights; every other panel has one. */
  readonly expanded: boolean
  readonly shapeParameter: ShapeParameter
  readonly immersive: boolean
  /** The panel to restore when immersive mode ends. */
  readonly surfaceBeforeImmersive: MobileSurface
}

/** What the active scene offers the rules below. */
export interface MobileSceneFacts {
  readonly mode: ProductMode
  readonly sceneEmpty: boolean
  /** The primary selection is an Orbit Lab (Keplerian) orbit. */
  readonly hasKeplerianSelection: boolean
  readonly hasSelection: boolean
}

const COMPACT: ReadonlySet<MobileSurface> = new Set(['shape', 'time', 'layers'])

/** Compact panels count for framing; expanded ones overlay the scene. */
export function isCompactSurface(state: MobileShellState): boolean {
  return COMPACT.has(state.surface) || (state.surface === 'object' && !state.expanded)
}

export function isExpandedSurface(state: MobileShellState): boolean {
  return state.surface !== 'none' && !isCompactSurface(state)
}

/** The first chip is Tilt, because it makes the most visible change. */
export const INITIAL_MOBILE_SHELL: MobileShellState = { surface: 'none', expanded: false, shapeParameter: 'tilt', immersive: false, surfaceBeforeImmersive: 'none' }

/** The panel a mode opens with. */
export function entrySurface(facts: MobileSceneFacts): MobileSurface {
  if (facts.mode === 'orbitLab') return facts.hasKeplerianSelection || facts.sceneEmpty ? 'shape' : 'none'
  return facts.sceneEmpty ? 'add' : 'none'
}

/** The state on the first view of a new mobile root. The page opens on the
 *  scene: the Shape strip waits for **Edit**, and only an empty Orbit Lab
 *  offers New orbit at once. */
export function initialMobileShell(facts: MobileSceneFacts, shapeParameter: ShapeParameter = INITIAL_MOBILE_SHELL.shapeParameter): MobileShellState {
  const surface = entrySurface(facts)
  return { ...INITIAL_MOBILE_SHELL, shapeParameter, surface: surface === 'shape' && !facts.sceneEmpty ? 'none' : surface }
}

/** One panel at a time; opening one ends immersive mode. */
export function openSurface(state: MobileShellState, surface: MobileSurface): MobileShellState {
  if (surface === 'none') return closeSurface(state)
  if (state.surface === surface && !state.immersive) return state
  return { ...state, surface, expanded: false, immersive: false, surfaceBeforeImmersive: 'none' }
}

export function closeSurface(state: MobileShellState): MobileShellState {
  if (state.surface === 'none' && !state.expanded) return state
  return { ...state, surface: 'none', expanded: false }
}

/** Opens `surface`, or closes it when it is already the open panel. */
export function toggleSurface(state: MobileShellState, surface: MobileSurface): MobileShellState {
  return state.surface === surface && !state.immersive ? closeSurface(state) : openSurface(state, surface)
}

/** Entering hides every control and remembers the open panel; leaving brings
 *  that panel back. */
export function toggleImmersive(state: MobileShellState): MobileShellState {
  if (state.immersive) return { ...state, immersive: false, surface: state.surfaceBeforeImmersive, surfaceBeforeImmersive: 'none' }
  return { ...state, immersive: true, surfaceBeforeImmersive: state.surface, surface: 'none', expanded: false }
}

export function setShapeParameter(state: MobileShellState, shapeParameter: ShapeParameter): MobileShellState {
  return state.shapeParameter === shapeParameter ? state : { ...state, shapeParameter }
}

/** Only the object card expands. */
export function setExpanded(state: MobileShellState, expanded: boolean): MobileShellState {
  const next = expanded && state.surface === 'object'
  return state.expanded === next ? state : { ...state, expanded: next }
}

/** An empty tap closes an open expanded panel or the Shape strip (which has
 *  no close button of its own); otherwise it toggles immersive mode. */
export function afterEmptyTap(state: MobileShellState): MobileShellState {
  return isExpandedSurface(state) || state.surface === 'shape' ? closeSurface(state) : toggleImmersive(state)
}

/** A mode switch opens the mode's entry panel and ends immersive mode. */
export function afterModeChange(state: MobileShellState, facts: MobileSceneFacts): MobileShellState {
  return { ...state, surface: entrySurface(facts), expanded: false, immersive: false, surfaceBeforeImmersive: 'none' }
}

/** Keeps the open panel consistent with the scene: the object card closes
 *  when nothing is selected any more, and the objects list when the scene is
 *  empty. The Shape strip stays, and says when there is no orbit to edit. */
export function afterSceneChange(state: MobileShellState, facts: MobileSceneFacts): MobileShellState {
  const stale = (surface: MobileSurface): boolean => (surface === 'object' && !facts.hasSelection) || (surface === 'objects' && facts.sceneEmpty)
  if (state.immersive) return stale(state.surfaceBeforeImmersive) ? { ...state, surfaceBeforeImmersive: 'none' } : state
  return stale(state.surface) ? closeSurface(state) : state
}
