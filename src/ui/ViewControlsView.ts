import type { AppState, LookState, ProductMode, SceneState } from '../state/AppState.ts'
import { text } from '../i18n/index.ts'
import { html } from './markup.ts'
import type { UiCallbacks } from './uiTypes.ts'

export class ViewControlsView {
  readonly root: HTMLElement
  private readonly callbacks: UiCallbacks

  constructor(container: HTMLElement, callbacks: UiCallbacks) {
    this.root = container
    this.callbacks = callbacks
    this.root.dataset.region = 'viewControls'
    const t = text().view
    const l = text().look
    this.root.innerHTML = html`
      <button id="view-drawer-toggle" class="view-drawer-trigger" type="button" aria-controls="view-drawer-content" aria-expanded="false" aria-label="${t.expand}">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 4 8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4"></path></svg><span class="sr-only">${t.controls}</span>
      </button>
      <div id="view-drawer-content" class="drawer-content view-drawer-content" hidden>
        <div class="region-body compact-region-body view-controls-layout">
          <div class="view-controls-heading">
            <div class="region-kicker">${t.kicker}</div>
            <div class="view-action-stack">
              <button id="fit-orbits" class="action-button primary-action" type="button">${t.fitVisible}</button>
              <button id="ground-track-map-open" class="action-button" type="button">${t.openMap}</button>
            </div>
          </div>
          <div class="view-toggle-stack">
            <label class="toggle-row" title="${t.markerScalingTitle}">
              <span>${t.markerScaling}</span><input id="marker-scaling-toggle" type="checkbox" checked aria-label="${t.markerScaling}" /><span class="toggle-ui" aria-hidden="true"></span>
            </label>
            <label class="toggle-row"><span>${t.allOrbitPaths}</span><input id="all-orbit-paths-toggle" type="checkbox" aria-label="${t.showAllOrbitPaths}" /><span class="toggle-ui" aria-hidden="true"></span></label>
            <label class="toggle-row"><span>${t.allHistories}</span><input id="all-ground-track-histories-toggle" type="checkbox" aria-label="${t.showAllHistories}" /><span class="toggle-ui" aria-hidden="true"></span></label>
            <label class="toggle-row"><span>${t.allSensors}</span><input id="all-sensor-geometries-toggle" type="checkbox" aria-label="${t.showAllSensors}" /><span class="toggle-ui" aria-hidden="true"></span></label>
            <p id="view-budget-status" class="time-note" role="status"></p>
          </div>
          <div class="view-toggle-stack view-look-stack" role="group" aria-labelledby="view-look-heading">
            <div id="view-look-heading" class="region-kicker">${l.heading}</div>
            <label class="toggle-row" title="${l.mapEarthTitle}"><span>${l.mapEarth}</span><input id="look-map-earth-toggle" type="checkbox" aria-label="${l.mapEarth}" /><span class="toggle-ui" aria-hidden="true"></span></label>
            <label id="look-lab-row" class="toggle-row" title="${l.labTitle}"><span>${l.lab}</span><input id="look-lab-toggle" type="checkbox" aria-label="${l.lab}" /><span class="toggle-ui" aria-hidden="true"></span></label>
            <p id="look-lab-note" class="time-note" hidden>${l.notInLab}</p>
          </div>
        </div>
      </div>
    `
    this.root.querySelector('#view-drawer-toggle')!.addEventListener('click', () => this.callbacks.onToggleViewDrawer())
    this.root.querySelector('#fit-orbits')!.addEventListener('click', () => this.callbacks.onFitVisibleOrbits())
    this.root.querySelector<HTMLInputElement>('#marker-scaling-toggle')!.addEventListener('change', (event) => this.callbacks.onMarkerScalingChange((event.currentTarget as HTMLInputElement).checked))
    this.root.querySelector('#ground-track-map-open')!.addEventListener('click', () => this.callbacks.onGroundTrackMapChange(true))
    this.root.querySelector<HTMLInputElement>('#all-orbit-paths-toggle')!.addEventListener('change', (event) => this.callbacks.onAllOrbitPathsVisibilityChange((event.currentTarget as HTMLInputElement).checked))
    this.root.querySelector<HTMLInputElement>('#all-ground-track-histories-toggle')!.addEventListener('change', (event) => this.callbacks.onAllGroundTrackHistoriesChange((event.currentTarget as HTMLInputElement).checked))
    this.root.querySelector<HTMLInputElement>('#look-map-earth-toggle')!.addEventListener('change', (event) => this.callbacks.onEarthStyleChange((event.currentTarget as HTMLInputElement).checked ? 'map' : 'imagery'))
    this.root.querySelector<HTMLInputElement>('#look-lab-toggle')!.addEventListener('change', (event) => this.callbacks.onOrbitLabBackdropChange((event.currentTarget as HTMLInputElement).checked ? 'lab' : 'space'))
    this.root.querySelector<HTMLInputElement>('#all-sensor-geometries-toggle')!.addEventListener('change', (event) => this.callbacks.onAllSensorGeometriesVisibilityChange((event.currentTarget as HTMLInputElement).checked))
  }

  sync(view: AppState['view'], scene: SceneState, loading: boolean, drawerOpen: boolean, look: LookState, mode: ProductMode): void {
    this.syncLook(look, mode, loading)
    this.root.toggleAttribute('aria-busy', loading)
    this.root.classList.toggle('is-expanded', drawerOpen)
    const toggle = this.root.querySelector<HTMLButtonElement>('#view-drawer-toggle')!
    toggle.setAttribute('aria-expanded', String(drawerOpen))
    toggle.setAttribute('aria-label', drawerOpen ? text().view.collapse : text().view.expand)
    this.root.querySelector<HTMLElement>('#view-drawer-content')!.hidden = !drawerOpen
    this.root.querySelector<HTMLInputElement>('#marker-scaling-toggle')!.checked = view.scaleMarkersWithZoom
    this.root.querySelector<HTMLButtonElement>('#ground-track-map-open')!.disabled = loading || view.groundTrackMapVisible
    this.syncSceneToggle('#all-orbit-paths-toggle', scene, loading, (object) => object.display.orbitPathVisible)
    this.syncSceneToggle('#all-ground-track-histories-toggle', scene, loading, (object) => object.display.groundTrackHistoryRecording)
    this.syncSceneToggle('#all-sensor-geometries-toggle', scene, loading, (object) => object.display.sensorGeometryVisible)
  }

  /** The Lab backdrop exists in Orbit Lab only; while it is on,
   *  the Earth switch keeps its value but has no effect. */
  private syncLook(look: LookState, mode: ProductMode, loading: boolean): void {
    const inLab = mode === 'orbitLab' && look.orbitLabBackdrop === 'lab'
    const mapEarth = this.root.querySelector<HTMLInputElement>('#look-map-earth-toggle')!
    const lab = this.root.querySelector<HTMLInputElement>('#look-lab-toggle')!
    mapEarth.checked = look.earthStyle === 'map'
    lab.checked = look.orbitLabBackdrop === 'lab'
    mapEarth.disabled = loading || inLab
    lab.disabled = loading
    this.root.querySelector<HTMLElement>('#look-lab-row')!.hidden = mode !== 'orbitLab'
    this.root.querySelector<HTMLElement>('#look-lab-note')!.hidden = !inLab
  }

  setLayerBudgetMessage(message: string): void { const status = this.root.querySelector('#view-budget-status')!; if (status.textContent !== message) status.textContent = message }

  setLoading(loading: boolean): void { this.root.toggleAttribute('aria-busy', loading) }

  focusMapButton(): void {
    const content = this.root.querySelector<HTMLElement>('#view-drawer-content')!
    ;(content.hidden ? this.root.querySelector<HTMLButtonElement>('#view-drawer-toggle') : this.root.querySelector<HTMLButtonElement>('#ground-track-map-open'))?.focus()
  }

  private syncSceneToggle(selector: string, scene: SceneState, loading: boolean, read: (object: SceneState['objects'][number]) => boolean): void {
    const input = this.root.querySelector<HTMLInputElement>(selector)!
    input.checked = scene.objects.length > 0 && scene.objects.every(read)
    input.indeterminate = scene.objects.some(read) && !input.checked
    input.disabled = loading || scene.objects.length === 0
  }
}
