import { text } from '../i18n/index.ts'
import { html } from './markup.ts'
import type { OrbitCreationKind, UiCallbacks } from './uiTypes.ts'

const CREATION_KINDS: readonly OrbitCreationKind[] = ['leo', 'meo', 'geo', 'heo']

export class OrbitLabLauncherView {
  readonly root: HTMLElement
  private readonly trigger: HTMLButtonElement
  private readonly menu: HTMLElement

  constructor(container: HTMLElement, callbacks: UiCallbacks) {
    this.root = container
    this.root.dataset.region = 'orbitLabLauncher'
    const t = text().orbitLab
    this.root.innerHTML = html`
      <button id="create-orbit" class="floating-action primary-action create-orbit-trigger" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="create-orbit-menu">${t.createOrbit}</button>
      <div id="create-orbit-menu" class="create-orbit-menu" role="menu" hidden></div>
    `
    this.trigger = this.root.querySelector<HTMLButtonElement>('#create-orbit')!
    this.menu = this.root.querySelector<HTMLElement>('#create-orbit-menu')!
    for (const kind of CREATION_KINDS) {
      const button = this.root.ownerDocument.createElement('button')
      button.type = 'button'
      button.role = 'menuitem'
      button.className = 'create-orbit-option'
      button.dataset.orbitKind = kind
      // The abbreviation first, then its name in the interface language.
      const orbitKind = t.orbitKinds[kind]
      button.innerHTML = html`<span class="orbit-kind-swatch" aria-hidden="true"></span><span class="orbit-kind-code">${orbitKind.code}</span> <span class="orbit-kind-name">${orbitKind.name}</span>`
      button.addEventListener('click', () => {
        callbacks.onCreateOrbit(kind)
        this.setOpen(false)
        this.trigger.focus()
      })
      this.menu.append(button)
    }
    this.trigger.addEventListener('click', () => this.setOpen(this.menu.hasAttribute('hidden')))
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.menu.hasAttribute('hidden')) return
      event.preventDefault()
      this.setOpen(false)
      this.trigger.focus()
    })
  }

  sync(loading: boolean, enabled: boolean, visible: boolean): void {
    this.trigger.disabled = loading || !enabled
    if (this.trigger.disabled || !visible) this.setOpen(false)
  }

  dispose(): void { this.root.textContent = '' }

  private setOpen(open: boolean): void {
    this.menu.hidden = !open
    this.trigger.setAttribute('aria-expanded', String(open))
    if (open) this.menu.querySelector<HTMLButtonElement>('button')?.focus()
  }
}
