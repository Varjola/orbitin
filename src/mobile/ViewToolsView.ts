import { text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'
import { icon } from './mobileIcons.ts'

export interface ViewToolsCallbacks {
  onMapView(showMap: boolean): void
  onLayers(): void
  onFit(): void
}

export function viewToolsMarkup(): string {
  const t = text().mobile.view
  return html`
    <button class="m-icon-button m-view-map" type="button"><span class="m-view-code"></span></button>
    <button class="m-icon-button m-view-layers" type="button" aria-haspopup="true" aria-expanded="false" aria-label="${t.layers}">${trusted(icon('layers'))}</button>
    <button class="m-icon-button m-view-fit" type="button" aria-label="${text().view.fitVisible}">${trusted(icon('fit'))}</button>
  `
}

/** 2D/3D, Layers and Fit as three round buttons at
 *  the top right, below the top bar (the left edge in landscape). */
export class ViewToolsView {
  readonly root: HTMLElement
  readonly layersButton: HTMLButtonElement
  private readonly mapButton: HTMLButtonElement
  private readonly fitButton: HTMLButtonElement
  private showingMap = false

  constructor(container: HTMLElement, callbacks: ViewToolsCallbacks) {
    this.root = container.ownerDocument.createElement('div')
    this.root.className = 'm-view-tools'
    this.root.setAttribute('role', 'group')
    this.root.setAttribute('aria-label', text().mobile.view.region)
    this.root.innerHTML = viewToolsMarkup()
    this.mapButton = this.root.querySelector<HTMLButtonElement>('.m-view-map')!
    this.layersButton = this.root.querySelector<HTMLButtonElement>('.m-view-layers')!
    this.fitButton = this.root.querySelector<HTMLButtonElement>('.m-view-fit')!
    this.mapButton.addEventListener('click', () => callbacks.onMapView(!this.showingMap))
    this.layersButton.addEventListener('click', () => callbacks.onLayers())
    this.fitButton.addEventListener('click', () => callbacks.onFit())
    container.append(this.root)
  }

  sync(showingMap: boolean, layersOpen: boolean, sceneEmpty: boolean, loading: boolean): void {
    const t = text().mobile.view
    this.showingMap = showingMap
    // The button names the view it switches to.
    this.mapButton.querySelector('.m-view-code')!.textContent = showingMap ? t.globe : t.map
    this.mapButton.setAttribute('aria-label', showingMap ? t.globeName : t.mapName)
    this.layersButton.setAttribute('aria-expanded', String(layersOpen))
    this.mapButton.disabled = loading
    this.layersButton.disabled = loading
    // Fit concerns the 3D view.
    this.fitButton.hidden = showingMap
    this.fitButton.disabled = loading || sceneEmpty
  }

  dispose(): void { this.root.remove() }
}
