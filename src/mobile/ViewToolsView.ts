import { text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'
import { icon } from './mobileIcons.ts'

export interface ViewToolsCallbacks {
  onMapView(showMap: boolean): void
  onLayers(): void
  onFit(): void
  onInfo(): void
  onRouteView(): void
  onRoutePlanes(): void
}

/** What the view tools show in the Route Planner: Fit, View and Planes. */
export interface ViewToolsRoute {
  readonly viewOpen: boolean
  readonly planesShown: boolean
  readonly infoOpen: boolean
}

/** What the view tools change to in Interception. */
export interface ViewToolsGame {
  readonly flat: string
  readonly globe: string
  readonly recentre: string
  readonly infoOpen: boolean
}

export function viewToolsMarkup(): string {
  const t = text().mobile.view
  return html`
    <button class="m-icon-button m-view-map" type="button"><span class="m-view-code"></span></button>
    <button class="m-icon-button m-view-layers" type="button" aria-haspopup="true" aria-expanded="false" aria-label="${t.layers}">${trusted(icon('layers'))}</button>
    <button class="m-icon-button m-view-fit" type="button" aria-label="${text().view.fitVisible}">${trusted(icon('fit'))}</button>
    <button class="m-icon-button m-view-info" type="button" aria-haspopup="true" aria-expanded="false" aria-label="${text().maneuvers.hohmann.open}" hidden>${trusted(icon('info'))}</button>
    <button class="m-icon-button m-view-camera" type="button" aria-haspopup="true" aria-expanded="false" aria-label="${text().mobile.route.viewName}" hidden>${trusted(icon('camera'))}</button>
    <button class="m-icon-button m-view-planes" type="button" aria-pressed="false" aria-label="${text().mobile.route.planesName}" hidden>${trusted(icon('planes'))}</button>
  `
}

/** 2D/3D, Layers and Fit as round buttons at the top right, below the top bar
 *  (the left edge in landscape). Interception keeps them on the right in both
 *  orientations: 2D/3D, Recentre, and last the Hohmann transfer note. Routes
 *  has Fit, View, Planes and the Δv budgets note. */
export class ViewToolsView {
  readonly root: HTMLElement
  readonly layersButton: HTMLButtonElement
  readonly infoButton: HTMLButtonElement
  readonly cameraButton: HTMLButtonElement
  private readonly planesButton: HTMLButtonElement
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
    this.infoButton = this.root.querySelector<HTMLButtonElement>('.m-view-info')!
    this.cameraButton = this.root.querySelector<HTMLButtonElement>('.m-view-camera')!
    this.planesButton = this.root.querySelector<HTMLButtonElement>('.m-view-planes')!
    this.mapButton.addEventListener('click', () => callbacks.onMapView(!this.showingMap))
    this.layersButton.addEventListener('click', () => callbacks.onLayers())
    this.fitButton.addEventListener('click', () => callbacks.onFit())
    this.infoButton.addEventListener('click', () => callbacks.onInfo())
    this.cameraButton.addEventListener('click', () => callbacks.onRouteView())
    this.planesButton.addEventListener('click', () => callbacks.onRoutePlanes())
    container.append(this.root)
  }

  /** In Interception the 2D/3D button switches between the altitude view and the
   *  3D view, and `game` says so. */
  sync(showingMap: boolean, layersOpen: boolean, sceneEmpty: boolean, loading: boolean, game?: ViewToolsGame, route?: ViewToolsRoute): void {
    const t = text().mobile.view
    this.showingMap = showingMap
    // The button names the view it switches to.
    this.mapButton.querySelector('.m-view-code')!.textContent = showingMap ? t.globe : t.map
    this.mapButton.setAttribute('aria-label', showingMap ? game?.globe ?? t.globeName : game?.flat ?? t.mapName)
    this.layersButton.setAttribute('aria-expanded', String(layersOpen))
    this.mapButton.disabled = loading
    this.layersButton.disabled = loading
    this.layersButton.hidden = game !== undefined
    this.root.classList.toggle('is-game', game !== undefined)
    // Fit concerns the 3D view, except that the game's altitude view recentres too.
    this.fitButton.hidden = showingMap && !game
    this.fitButton.disabled = loading || sceneEmpty
    this.fitButton.setAttribute('aria-label', game?.recentre ?? text().view.fitVisible)
    // The info note: the Hohmann transfer in Interception, Δv budgets in Routes.
    this.infoButton.hidden = !game && !route
    this.infoButton.disabled = loading
    this.infoButton.setAttribute('aria-expanded', String(game?.infoOpen ?? route?.infoOpen ?? false))
    this.infoButton.setAttribute('aria-label', route ? text().routePlanner.budgets.open : text().maneuvers.hohmann.open)
    // The Route Planner has no map and no layers: Fit, View and Planes.
    this.root.classList.toggle('is-route', route !== undefined)
    this.mapButton.hidden = route !== undefined
    if (route !== undefined) this.layersButton.hidden = true
    this.cameraButton.hidden = route === undefined
    this.planesButton.hidden = route === undefined
    this.cameraButton.disabled = loading
    this.planesButton.disabled = loading
    this.cameraButton.setAttribute('aria-expanded', String(route?.viewOpen ?? false))
    this.planesButton.setAttribute('aria-pressed', String(route?.planesShown ?? false))
  }

  dispose(): void { this.root.remove() }
}
