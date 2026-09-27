import type { ProductMode } from '../state/AppState.ts'
import { text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'
import { icon } from './mobileIcons.ts'

export interface MobileTopBarCallbacks {
  onModeChange(mode: ProductMode): void
  onMenu(): void
}

const MODES: readonly ProductMode[] = ['orbitLab', 'realObjects']

export function mobileTopBarMarkup(): string {
  const t = text().mobile
  return html`
    <img class="m-mark" src="/favicon.svg?v=6" width="28" height="28" alt="${t.mark}" />
    <div class="m-mode-switch" role="group" aria-label="${t.modeSwitch}">
      ${trusted(MODES.map((mode) => html`<button class="m-mode" type="button" data-mode="${mode}" aria-pressed="false">${t.modes[mode]}</button>`).join(''))}
    </div>
    <button class="m-icon-button m-menu-button" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="${t.menuButton}">${trusted(icon('menu'))}</button>
  `
}

/** The Orbitin mark, the two-segment mode switch with
 *  the short mode names, and the menu button. */
export class MobileTopBarView {
  readonly root: HTMLElement
  readonly menuButton: HTMLButtonElement
  private readonly modeButtons: readonly HTMLButtonElement[]

  constructor(container: HTMLElement, callbacks: MobileTopBarCallbacks) {
    this.root = container.ownerDocument.createElement('header')
    this.root.className = 'm-topbar'
    this.root.innerHTML = mobileTopBarMarkup()
    this.modeButtons = [...this.root.querySelectorAll<HTMLButtonElement>('.m-mode')]
    this.menuButton = this.root.querySelector<HTMLButtonElement>('.m-menu-button')!
    for (const button of this.modeButtons) button.addEventListener('click', () => callbacks.onModeChange(button.dataset.mode as ProductMode))
    this.menuButton.addEventListener('click', () => callbacks.onMenu())
    container.append(this.root)
  }

  sync(mode: ProductMode, menuOpen: boolean, loading: boolean): void {
    for (const button of this.modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode))
      button.disabled = loading
    }
    this.menuButton.setAttribute('aria-expanded', String(menuOpen))
  }

  dispose(): void { this.root.remove() }
}
