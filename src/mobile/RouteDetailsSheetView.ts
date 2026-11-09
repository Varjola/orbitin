import { replaceKeepingFocus } from '../ui/focusKeeping.ts'
import type { RouteShownModel } from '../ui/routePanelModel.ts'
import { routeDetailsMarkup } from './RoutePlanSheetView.ts'

/** The route playing, as an expanded sheet from the playback bar's Route or the
 *  burn caption: the same details as in Plan, the burn held or next marked, and
 *  opened at a burn when asked. Playback goes on behind it. */
export class RouteDetailsSheetView {
  readonly root: HTMLElement
  private shown = ''

  constructor(documentRef: Document) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-route-plan m-route-details-sheet'
    this.root.tabIndex = -1
  }

  sync(shown: RouteShownModel | null, currentBurn: number | null): void {
    const markup = shown === null ? '' : routeDetailsMarkup(shown)
    if (markup !== this.shown) { this.shown = markup; replaceKeepingFocus(this.root, markup) }
    for (const burn of this.root.querySelectorAll<HTMLElement>('[data-burn]')) burn.classList.toggle('is-current', burn.dataset.burn === String(currentBurn))
  }

  /** Scrolls the sheet to a burn, or to its top. */
  openAt(burnIndex: number | null): void {
    const scroller = this.root.closest<HTMLElement>('.m-panel-body')
    const burn = burnIndex === null ? null : this.root.querySelector<HTMLElement>(`[data-burn="${burnIndex}"]`)
    if (burn) burn.scrollIntoView?.({ block: 'center' })
    else if (scroller) scroller.scrollTop = 0
  }
}
