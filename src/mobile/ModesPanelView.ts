import type { ProductMode } from '../state/AppState.ts'
import { text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'
import { modeCardKeyTarget, modeCardsMarkup, syncModeCards } from '../ui/modeSwitcherModel.ts'

export function modesPanelMarkup(): string {
  return html`<div class="m-mode-cards">${trusted(modeCardsMarkup(text().mobile.modes))}</div>`
}

/** The phone's window of mode cards, a panel like the others: Back, the close
 *  button and Escape close it. The arrow keys, Home and End move between the
 *  cards, as in the desktop window. */
export class ModesPanelView {
  readonly root: HTMLElement
  private readonly cards: readonly HTMLButtonElement[]

  constructor(documentRef: Document, onSelect: (mode: ProductMode) => void) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-modes'
    this.root.innerHTML = modesPanelMarkup()
    this.cards = [...this.root.querySelectorAll<HTMLButtonElement>('.mode-card')]
    for (const card of this.cards) card.addEventListener('click', () => onSelect(card.dataset.mode as ProductMode))
    this.root.addEventListener('keydown', (event) => {
      const target = modeCardKeyTarget(event.key, this.cards.indexOf(event.target as HTMLButtonElement), this.cards.length)
      if (target === null || event.ctrlKey || event.metaKey || event.altKey) return
      event.preventDefault()
      this.cards[target].focus({ preventScroll: true })
    })
  }

  sync(mode: ProductMode, loading: boolean): void { syncModeCards(this.cards, mode, loading) }
}
