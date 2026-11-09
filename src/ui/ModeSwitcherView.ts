import type { ProductMode } from '../state/AppState.ts'
import { text } from '../i18n/index.ts'
import { html, trusted } from './markup.ts'
import { modeCardKeyTarget, modeCardsMarkup, modeIcon, syncModeCards } from './modeSwitcherModel.ts'

export function modeSwitcherMarkup(mode: ProductMode): string {
  const t = text().shell
  return html`
    <button id="mode-switcher-button" class="mode-switcher-button" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="mode-switcher-window">
      <span class="mode-switcher-icon">${trusted(modeIcon(mode))}</span>
      <span class="mode-switcher-name">${t.modes[mode]}</span>
      <svg class="mode-icon mode-switcher-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9.5 6 6 6-6"/></svg>
    </button>
    <div id="mode-switcher-window" class="mode-switcher-window" role="dialog" aria-label="${t.chooseMode}" hidden>
      ${trusted(modeCardsMarkup(t.modes))}
    </div>
  `
}

/** The desktop top bar's mode control: a button showing the current mode and a
 *  window of mode cards. The window's open state belongs to this view alone: it
 *  is never part of the application or shell state. */
export class ModeSwitcherView {
  private readonly root: HTMLElement
  private readonly button: HTMLButtonElement
  private readonly window: HTMLElement
  private readonly cards: readonly HTMLButtonElement[]
  private readonly onSelect: (mode: ProductMode) => void
  private mode: ProductMode = 'orbitLab'
  private readonly onOutsidePointer = (event: Event): void => {
    if (event.target instanceof Node && !this.root.contains(event.target)) this.close(false)
  }

  constructor(root: HTMLElement, onSelect: (mode: ProductMode) => void) {
    this.root = root
    this.onSelect = onSelect
    root.innerHTML = modeSwitcherMarkup(this.mode)
    this.button = root.querySelector<HTMLButtonElement>('#mode-switcher-button')!
    this.window = root.querySelector<HTMLElement>('#mode-switcher-window')!
    this.cards = [...root.querySelectorAll<HTMLButtonElement>('.mode-card')]
    this.button.addEventListener('click', () => { if (this.window.hidden) this.open(); else this.close(true) })
    for (const card of this.cards) card.addEventListener('click', () => this.select(card.dataset.mode as ProductMode))
    root.addEventListener('keydown', (event) => this.onKey(event))
    root.addEventListener('focusout', (event) => {
      if (!this.window.hidden && event.relatedTarget instanceof Node && !root.contains(event.relatedTarget)) this.close(false)
    })
    this.sync(this.mode)
  }

  sync(mode: ProductMode): void {
    this.mode = mode
    const t = text().shell
    this.button.querySelector('.mode-switcher-icon')!.innerHTML = modeIcon(mode)
    this.button.querySelector('.mode-switcher-name')!.textContent = t.modes[mode]
    this.button.setAttribute('aria-label', t.currentMode(t.modes[mode]))
    syncModeCards(this.cards, mode, false)
  }

  dispose(): void { this.root.ownerDocument.removeEventListener('pointerdown', this.onOutsidePointer, true) }

  private open(): void {
    this.window.hidden = false
    this.button.setAttribute('aria-expanded', 'true')
    this.root.ownerDocument.addEventListener('pointerdown', this.onOutsidePointer, true)
    this.cards.find((card) => card.dataset.mode === this.mode)?.focus({ preventScroll: true })
  }

  private close(returnFocus: boolean): void {
    if (this.window.hidden) return
    this.window.hidden = true
    this.button.setAttribute('aria-expanded', 'false')
    this.root.ownerDocument.removeEventListener('pointerdown', this.onOutsidePointer, true)
    if (returnFocus) this.button.focus({ preventScroll: true })
  }

  private select(mode: ProductMode): void {
    this.close(true)
    if (mode !== this.mode) this.onSelect(mode)
  }

  /** While the window is open, keys stop at this view: the arrow keys and W and
   *  S also fly the Interception game, whose listener is on the document. */
  private onKey(event: KeyboardEvent): void {
    if (this.window.hidden) return
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close(true)
      return
    }
    const from = this.cards.indexOf(event.target as HTMLButtonElement)
    const target = modeCardKeyTarget(event.key, from, this.cards.length)
    if (target === null) return
    event.preventDefault()
    this.cards[target].focus({ preventScroll: true })
  }
}
