import type { ProductMode } from '../state/AppState.ts'
import { text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'
import { modeIcon } from '../ui/modeSwitcherModel.ts'
import { icon } from './mobileIcons.ts'

export interface MobileTopBarCallbacks {
  onModes(): void
  onMenu(): void
}

export function mobileTopBarMarkup(mode: ProductMode = 'orbitLab'): string {
  const t = text().mobile
  return html`
    <img class="m-mark" src="/favicon.svg?v=6" width="28" height="28" alt="${t.mark}" />
    <button class="m-mode-button" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="${t.currentMode(t.modes[mode])}">
      <span class="m-mode-button-icon">${trusted(modeIcon(mode))}</span>
      <span class="m-mode-button-name">${t.modes[mode]}</span>
      <svg class="mode-icon m-mode-button-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9.5 6 6 6-6"/></svg>
    </button>
    <button class="m-icon-button m-menu-button" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="${t.menuButton}">${trusted(icon('menu'))}</button>
  `
}

/** The Orbitin mark, the button showing the current mode, and the menu button. */
export class MobileTopBarView {
  readonly root: HTMLElement
  readonly menuButton: HTMLButtonElement
  readonly modeButton: HTMLButtonElement

  constructor(container: HTMLElement, callbacks: MobileTopBarCallbacks) {
    this.root = container.ownerDocument.createElement('header')
    this.root.className = 'm-topbar'
    this.root.innerHTML = mobileTopBarMarkup()
    this.modeButton = this.root.querySelector<HTMLButtonElement>('.m-mode-button')!
    this.menuButton = this.root.querySelector<HTMLButtonElement>('.m-menu-button')!
    this.modeButton.addEventListener('click', () => callbacks.onModes())
    this.menuButton.addEventListener('click', () => callbacks.onMenu())
    container.append(this.root)
  }

  sync(mode: ProductMode, modesOpen: boolean, menuOpen: boolean, loading: boolean): void {
    const t = text().mobile
    this.modeButton.querySelector('.m-mode-button-icon')!.innerHTML = modeIcon(mode)
    this.modeButton.querySelector('.m-mode-button-name')!.textContent = t.modes[mode]
    this.modeButton.setAttribute('aria-label', t.currentMode(t.modes[mode]))
    this.modeButton.setAttribute('aria-expanded', String(modesOpen))
    this.modeButton.disabled = loading
    this.menuButton.setAttribute('aria-expanded', String(menuOpen))
  }

  dispose(): void { this.root.remove() }
}
