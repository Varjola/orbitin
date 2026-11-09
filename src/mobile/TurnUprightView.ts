import { text } from '../i18n/index.ts'
import type { ProductMode } from '../state/AppState.ts'
import { html, trusted } from '../ui/markup.ts'
import { icon } from './mobileIcons.ts'
import { mobileId } from './PanelHost.ts'

/** A phone held sideways leaves the modes with controls along the bottom too
 *  little room for the view; only Orbit Lab works that way. In the other modes
 *  this covers the screen, asks for the phone upright and offers Orbit Lab.
 *  A web page cannot lock the orientation itself outside full screen. */
export class TurnUprightView {
  readonly root: HTMLElement
  private readonly body: HTMLElement
  private readonly button: HTMLButtonElement

  constructor(container: HTMLElement, onOrbitLab: () => void) {
    const t = text().mobile.upright
    const headingId = mobileId('upright-heading')
    this.root = container.ownerDocument.createElement('section')
    this.root.className = 'm-turn-upright'
    this.root.hidden = true
    this.root.setAttribute('aria-labelledby', headingId)
    this.root.innerHTML = html`
      <span class="m-turn-upright-icon">${trusted(icon('upright'))}</span>
      <h2 id="${headingId}">${t.heading}</h2>
      <p class="m-turn-upright-body"></p>
      <button class="m-button is-primary" type="button">${t.openOrbitLab(text().mobile.modes.orbitLab)}</button>
    `
    this.body = this.root.querySelector<HTMLElement>('.m-turn-upright-body')!
    this.button = this.root.querySelector<HTMLButtonElement>('button')!
    this.button.addEventListener('click', () => onOrbitLab())
    container.append(this.root)
  }

  /** Shown with the mode it stands in for, or hidden for `null`. */
  sync(mode: ProductMode | null, loading: boolean): void {
    this.root.hidden = mode === null
    this.button.disabled = loading
    if (mode !== null) this.body.textContent = text().mobile.upright.body(text().mobile.modes[mode], text().mobile.modes.orbitLab)
  }

  dispose(): void { this.root.remove() }
}
