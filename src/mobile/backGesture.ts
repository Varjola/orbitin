/** Android Back and the iOS back swipe
 *  close the open panel first.
 *
 *  This module is the only history writer besides `sceneLinkLocation.ts`
 *  (architecture test). While a panel is open it holds one same-URL history
 *  entry with a state marker: a `popstate` that removes that entry closes the
 *  panel; a panel closed any other way steps back over its entry once, and
 *  the resulting `popstate` is ignored. It never changes the URL or fragment,
 *  holds at most one entry and does nothing while a shared scene is opening. */

export interface BackGestureWindow {
  readonly history: { readonly state: unknown; pushState(data: unknown, unused: string): void; back(): void }
  addEventListener(type: 'popstate', listener: (event: PopStateEvent) => void): void
  removeEventListener(type: 'popstate', listener: (event: PopStateEvent) => void): void
}

const MARKER = 'orbitin-panel'

export function isPanelEntry(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[MARKER] === true
}

export class BackGesture {
  private readonly window: BackGestureWindow
  private readonly onBack: () => void
  private readonly blocked: () => boolean
  private pushed = false
  private ignoreNextPop = false
  private readonly onPopState = (): void => {
    if (this.ignoreNextPop) { this.ignoreNextPop = false; return }
    if (!this.pushed) return
    this.pushed = false
    this.onBack()
  }

  constructor(view: BackGestureWindow, onBack: () => void, blocked: () => boolean) {
    this.window = view
    this.onBack = onBack
    this.blocked = blocked
    view.addEventListener('popstate', this.onPopState)
  }

  /** True while this module's entry is on top of the history. */
  get holdsEntry(): boolean { return this.pushed }

  /** A panel is open: hold one entry for Back to remove. */
  panelOpened(): void {
    if (this.pushed || this.blocked()) return
    this.window.history.pushState({ [MARKER]: true }, '')
    this.pushed = true
  }

  /** The panel closed another way: step back over the entry once. */
  panelClosed(): void {
    if (!this.pushed) return
    this.pushed = false
    if (!isPanelEntry(this.window.history.state)) return
    this.ignoreNextPop = true
    this.window.history.back()
  }

  dispose(): void {
    this.panelClosed()
    this.window.removeEventListener('popstate', this.onPopState)
  }
}
