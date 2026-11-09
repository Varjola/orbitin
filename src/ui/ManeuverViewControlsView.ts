import { text } from '../i18n/index.ts'
import { html } from './markup.ts'
import type { ManeuverDisplay, ManeuverPanelModel } from './maneuverPanelModel.ts'
import type { UiCallbacks } from './uiTypes.ts'

/** The game's view buttons at the bottom right, in place of the View drawer:
 *  the altitude view (2D), the 3D view and Recentre. */
export class ManeuverViewControlsView {
  readonly root: HTMLElement
  private readonly recentre: HTMLButtonElement

  constructor(container: HTMLElement, callbacks: UiCallbacks) {
    this.root = container
    this.root.dataset.region = 'maneuverViewControls'
    const t = text().maneuvers
    this.root.innerHTML = html`
      <button id="maneuver-view-altitude" class="maneuver-view-button" type="button" data-display="altitude" aria-pressed="true" aria-label="${t.altitudeView}" title="${t.altitudeViewTitle}">${t.altitudeViewShort}</button>
      <button id="maneuver-view-globe" class="maneuver-view-button" type="button" data-display="globe" aria-pressed="false" aria-label="${t.globeView}" title="${t.globeViewTitle}">${t.globeViewShort}</button>
      <button id="maneuver-recentre" class="maneuver-view-button" type="button" title="${t.recentreTitle}">${t.recentre}</button>
    `
    this.recentre = this.root.querySelector<HTMLButtonElement>('#maneuver-recentre')!
    this.recentre.addEventListener('click', () => callbacks.onManeuverFaceOn())
    for (const button of this.displayButtons()) button.addEventListener('click', () => callbacks.onManeuverDisplayChange(button.dataset.display as ManeuverDisplay))
  }

  setActive(active: boolean): void { this.root.hidden = !active }

  sync(model: ManeuverPanelModel | null, loading: boolean): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('button')) button.disabled = loading || !model
    if (!model) return
    const t = text().maneuvers
    for (const button of this.displayButtons()) button.setAttribute('aria-pressed', String(button.dataset.display === model.display))
    this.recentre.title = model.display === 'altitude' ? t.recentreTitle : t.faceOnTitle
  }

  dispose(): void { this.root.textContent = '' }

  private displayButtons(): readonly HTMLButtonElement[] {
    return [...this.root.querySelectorAll<HTMLButtonElement>('[data-display]')]
  }
}
