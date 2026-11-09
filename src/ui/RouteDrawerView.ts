import type { RouteSide } from '../app/RoutePlannerController.ts'
import { format, text } from '../i18n/index.ts'
import type { RouteOrbitValues } from '../simulation/route/routeObjects.ts'
import { ROUTE_CAMERA_VIEWS, type RouteCameraView } from '../simulation/route/routeDrawing.ts'
import { isRealPairId, ROUTE_TRY_THESE, type RouteTryId } from '../simulation/route/routeSources.ts'
import { html, trusted } from './markup.ts'
import { altitudeFromPosition, positionFromAltitude, ROUTE_SLIDER_STEPS, type RoutePanelModel, type RouteSideModel } from './routePanelModel.ts'
import { elementAgeLines, refusalText, separationLines, sideTitle, statusText } from './routeWording.ts'
import type { UiCallbacks } from './uiTypes.ts'

const SIDES: readonly RouteSide[] = ['own', 'target']

/** The sliders of an object's card: each sets one value of its orbit. */
type OrbitField = 'altitude' | 'perigeeAltitudeKm' | 'apogeeAltitudeKm' | 'inclinationDeg' | 'raanDeg' | 'argOfPerigeeDeg'
const FIELDS: readonly OrbitField[] = ['altitude', 'perigeeAltitudeKm', 'apogeeAltitudeKm', 'inclinationDeg', 'raanDeg', 'argOfPerigeeDeg']
const HEIGHT_FIELDS: ReadonlySet<OrbitField> = new Set(['altitude', 'perigeeAltitudeKm', 'apogeeAltitudeKm'])

function tryCardMarkup(id: RouteTryId): string {
  const t = text().routePlanner
  const words = isRealPairId(id) ? t.realPairs[id] : t.examples[id]
  const tag = isRealPairId(id) ? html`<span class="route-example-tag">${t.fromCatalogue}</span>` : ''
  return html`<li><button class="route-example" type="button" data-try="${id}"><span class="route-example-name">${words.name}</span><span class="route-example-line">${words.line}</span>${trusted(tag)}</button></li>`
}

function fieldLabel(field: OrbitField): string {
  const t = text().routePlanner.objects
  switch (field) {
    case 'altitude': return t.altitude
    case 'perigeeAltitudeKm': return t.perigee
    case 'apogeeAltitudeKm': return t.apogee
    case 'inclinationDeg': return t.inclination
    case 'raanDeg': return t.node
    case 'argOfPerigeeDeg': return t.argOfPerigee
  }
}

function sliderRange(field: OrbitField): { readonly min: number; readonly max: number; readonly step: number } {
  if (HEIGHT_FIELDS.has(field)) return { min: 0, max: ROUTE_SLIDER_STEPS, step: 1 }
  if (field === 'inclinationDeg') return { min: 0, max: 180, step: 0.1 }
  return { min: 0, max: 359, step: 1 }
}

function objectCardMarkup(side: RouteSide): string {
  const t = text().routePlanner
  const role = side === 'own' ? t.yourSatellite : t.target
  const row = (field: OrbitField) => {
    const range = sliderRange(field)
    return html`<label class="slider-row" data-field-row="${field}"><span class="slider-label"><span>${fieldLabel(field)}</span><output id="route-${side}-${field}-value">—</output></span><input id="route-${side}-${field}" data-side="${side}" data-field="${field}" type="range" min="${range.min}" max="${range.max}" step="${range.step}" value="0" /></label>`
  }
  return html`
    <section class="field-group route-object" data-side="${side}" aria-labelledby="route-${side}-role">
      <div class="route-side-head">
        <span id="route-${side}-role" class="route-side-role">${role}</span>
        <label class="route-circular"><input id="route-${side}-circular" type="checkbox" data-side="${side}" /> ${t.objects.circular}</label>
      </div>
      <strong id="route-${side}-title" class="route-side-name ${side === 'own' ? 'maneuver-you' : 'maneuver-target'}"></strong>
      <span id="route-${side}-id" class="route-side-id"></span>
      <ul id="route-${side}-notes" class="route-side-notes"></ul>
      ${trusted(FIELDS.map(row).join(''))}
    </section>
  `
}

function fieldValue(values: RouteOrbitValues, field: OrbitField): number {
  return field === 'altitude' ? (values.perigeeAltitudeKm + values.apogeeAltitudeKm) / 2 : values[field]
}

function fieldText(field: OrbitField, value: number): string {
  const f = format()
  if (HEIGHT_FIELDS.has(field)) return f.km(value)
  // A node just short of a full turn reads 0°, not 360°.
  return field === 'inclinationDeg' ? `${f.number(value, 1)}°` : `${f.integer(Math.round(value) % 360)}°`
}

/** The Route Planner's left drawer: the live scene's controls, the two objects and
 *  how far apart they are, the catalogue and the ready-made pairs. Planning itself
 *  is in its own window. */
export class RouteDrawerView {
  readonly root: HTMLElement
  private readonly aheadSlider: HTMLInputElement
  private readonly search: HTMLInputElement
  private status = ''
  private resultsMarkup = ''

  constructor(container: HTMLElement, callbacks: UiCallbacks) {
    this.root = container
    this.root.dataset.region = 'routeDrawer'
    const t = text().routePlanner
    this.root.innerHTML = html`
      <div class="workspace-intro"><p class="time-note">${t.intro}</p></div>
      <section class="field-group route-live" aria-labelledby="route-live-heading">
        <div class="group-heading"><span id="route-live-heading">${t.live.heading}</span></div>
        <label class="slider-row route-camera"><span class="slider-label"><span>${t.camera.label}</span></span><select id="route-camera-live">${trusted(ROUTE_CAMERA_VIEWS.map((view) => html`<option value="${view}">${t.camera.views[view]}</option>`).join(''))}</select></label>
        <p class="time-note">${t.camera.hint}</p>
        <div id="route-view-row" class="button-row">
          <button id="route-back-to-route" class="action-button" type="button">${t.live.backToRoute}</button>
        </div>
      </section>
      ${trusted(objectCardMarkup('own'))}
      <button id="route-swap" class="link-button route-swap" type="button" aria-label="${t.swapLabel}">⇅ ${t.swap}</button>
      ${trusted(objectCardMarkup('target'))}
      <section class="field-group route-separation" aria-labelledby="route-separation-heading">
        <div class="group-heading"><span id="route-separation-heading">${t.separation.heading}</span></div>
        <label class="slider-row"><span class="slider-label"><span>${t.separation.ahead}</span><output id="route-ahead-value">—</output></span><input id="route-ahead" type="range" min="-180" max="180" step="1" value="0" /></label>
        <dl id="route-separation" class="readout-grid route-separation-list"></dl>
      </section>
      <section class="field-group route-catalogue" aria-labelledby="route-catalogue-heading">
        <div class="group-heading"><span id="route-catalogue-heading">${t.catalogue.heading}</span></div>
        <button id="route-catalogue-switch" class="action-button" type="button" aria-pressed="false">${t.catalogue.use}</button>
        <p id="route-catalogue-note" class="time-note">${t.catalogue.note}</p>
        <div id="route-catalogue-search" hidden>
          <label class="sr-only" for="route-search">${t.search.label}</label>
          <input id="route-search" class="route-search" type="search" autocomplete="off" spellcheck="false" placeholder="${t.search.placeholder}" aria-describedby="route-search-status" />
          <p id="route-search-status" class="time-note" role="status"></p>
          <ul id="route-results" class="route-results"></ul>
        </div>
      </section>
      <p id="route-drawer-status" class="maneuver-status" role="status" hidden></p>
      <section class="field-group" aria-labelledby="route-examples-heading">
        <div class="group-heading"><span id="route-examples-heading">${t.tryThese}</span></div>
        <p class="time-note">${t.tryTheseHint}</p>
        <ul class="route-examples">${trusted(ROUTE_TRY_THESE.map(tryCardMarkup).join(''))}</ul>
      </section>
    `
    const q = <T extends Element>(selector: string) => this.root.querySelector<T>(selector)!
    this.aheadSlider = q<HTMLInputElement>('#route-ahead')
    this.search = q<HTMLInputElement>('#route-search')
    q('#route-back-to-route').addEventListener('click', () => callbacks.onRouteViewRoute())
    const camera = q<HTMLSelectElement>('#route-camera-live')
    camera.addEventListener('change', () => callbacks.onRouteCameraView(camera.value as RouteCameraView))
    for (const side of SIDES) {
      for (const field of FIELDS) {
        const slider = q<HTMLInputElement>(`#route-${side}-${field}`)
        slider.addEventListener('input', () => {
          const value = HEIGHT_FIELDS.has(field) ? altitudeFromPosition(Number(slider.value)) : Number(slider.value)
          callbacks.onRouteObjectEdit(side, field === 'altitude' ? { perigeeAltitudeKm: value, apogeeAltitudeKm: value } : { [field]: value })
        })
      }
      const circular = q<HTMLInputElement>(`#route-${side}-circular`)
      circular.addEventListener('change', () => callbacks.onRouteCircular(side, circular.checked))
    }
    this.aheadSlider.addEventListener('input', () => callbacks.onRouteTargetAhead(Number(this.aheadSlider.value)))
    q('#route-swap').addEventListener('click', () => callbacks.onRouteSwap())
    q('#route-catalogue-switch').addEventListener('click', () => callbacks.onRouteCatalogueEnable())
    this.search.addEventListener('input', () => callbacks.onRouteSearch(this.search.value))
    q('#route-results').addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button[data-catalog-id]')
      if (button) callbacks.onRoutePick(button.dataset.side as RouteSide, button.dataset.catalogId!)
    })
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.route-example')) {
      button.addEventListener('click', () => callbacks.onRouteTry(button.dataset.try as RouteTryId))
    }
  }

  sync(model: RoutePanelModel | null, loading: boolean): void {
    this.root.toggleAttribute('aria-busy', loading)
    for (const control of this.root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) control.disabled = loading || !model
    if (!model) return
    const t = text().routePlanner
    const f = format()

    const inRoute = model.view === 'route'
    this.root.querySelector<HTMLElement>('#route-view-row')!.hidden = inRoute || !model.hasRoute
    const camera = this.root.querySelector<HTMLSelectElement>('#route-camera-live')!
    if (camera.value !== model.camera) camera.value = model.camera

    for (const side of SIDES) this.syncObject(side, model[side])
    const ahead = model.separation.phaseAheadRad * 180 / Math.PI
    this.setSlider(this.aheadSlider, Math.round(ahead), t.separation.aheadValue(f.number(ahead, 0)), '#route-ahead-value')
    const lines = separationLines(model.separation)
    const markup = lines.map((line) => html`<dt>${line.label}</dt><dd>${line.value}</dd>`).join('')
    const list = this.root.querySelector<HTMLElement>('#route-separation')!
    if (list.innerHTML !== markup) list.innerHTML = markup
    this.syncCatalogue(model)

    // Only what the drawer itself started: a real pair, or a pair that cannot be planned.
    this.renderStatus(model.pair !== null || model.blocked !== null ? statusText(model) : '')

    const loadingPair = model.pair?.kind === 'loading' ? model.pair.id : null
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.route-example')) {
      if (button.dataset.try === model.tryId) button.setAttribute('aria-current', 'true')
      else button.removeAttribute('aria-current')
      button.toggleAttribute('aria-busy', button.dataset.try === loadingPair)
    }
  }

  dispose(): void { this.root.textContent = '' }

  private syncObject(side: RouteSide, model: RouteSideModel): void {
    const t = text().routePlanner
    this.setText(`#route-${side}-title`, sideTitle(model))
    this.setText(`#route-${side}-id`, model.label.kind === 'catalogue' ? t.catalogueNumber(model.label.catalogId) : '')
    const notes = elementAgeLines(model.elementAgeSeconds)
    const markup = notes.map((note) => html`<li>${note}</li>`).join('')
    const list = this.root.querySelector<HTMLElement>(`#route-${side}-notes`)!
    if (list.innerHTML !== markup) list.innerHTML = markup
    list.hidden = notes.length === 0
    const circular = this.root.querySelector<HTMLInputElement>(`#route-${side}-circular`)!
    circular.checked = model.circular
    for (const field of FIELDS) {
      const row = this.root.querySelector<HTMLElement>(`[data-side="${side}"] [data-field-row="${field}"]`)!
      // A circular orbit has one height and no perigee to point.
      row.hidden = model.circular ? field === 'perigeeAltitudeKm' || field === 'apogeeAltitudeKm' || field === 'argOfPerigeeDeg' : field === 'altitude'
      const value = fieldValue(model.values, field)
      const slider = this.root.querySelector<HTMLInputElement>(`#route-${side}-${field}`)!
      this.setSlider(slider, HEIGHT_FIELDS.has(field) ? positionFromAltitude(value) : field === 'inclinationDeg' ? value : Math.round(value) % 360, fieldText(field, value), `#route-${side}-${field}-value`)
    }
  }

  private syncCatalogue(model: RoutePanelModel): void {
    const t = text().routePlanner
    const { catalogue, search } = model
    const ready = catalogue === 'ready'
    const button = this.root.querySelector<HTMLButtonElement>('#route-catalogue-switch')!
    button.setAttribute('aria-pressed', String(ready))
    button.disabled = ready || catalogue === 'loading'
    button.toggleAttribute('aria-busy', catalogue === 'loading')
    this.setText('#route-catalogue-switch', ready ? t.catalogue.on : t.catalogue.use)
    this.setText('#route-catalogue-note', catalogue === 'loading' ? t.search.loading : catalogue === 'unavailable' ? t.search.unavailable : t.catalogue.note)
    this.root.querySelector<HTMLElement>('#route-catalogue-search')!.hidden = !ready
    if (!ready) return
    if (this.search.value !== search.text && this.root.ownerDocument.activeElement !== this.search) this.search.value = search.text
    const status = search.pending !== null ? t.search.fetching
      : search.refusal !== null ? refusalText(search.refusal)
        : search.text.trim() === '' ? t.search.prompt
          : search.results.length === 0 ? t.search.noMatches
            : search.moreResults ? t.search.more : ''
    this.setText('#route-search-status', status)
    const results = search.results.map((entry) => {
      const busy = (side: RouteSide) => search.pending?.catalogId === entry.catalogId && search.pending.side === side ? 'aria-busy="true"' : ''
      return html`<li class="route-result"><span class="route-result-name">${entry.name}</span><span class="route-result-id">${t.catalogueNumber(entry.catalogId)}</span><span class="route-result-actions"><button type="button" class="link-button" data-catalog-id="${entry.catalogId}" data-side="own" aria-label="${t.catalogue.setAs(entry.name, t.yourSatellite)}" ${trusted(busy('own'))}>${t.catalogue.asOwn}</button><button type="button" class="link-button" data-catalog-id="${entry.catalogId}" data-side="target" aria-label="${t.catalogue.setAs(entry.name, t.target)}" ${trusted(busy('target'))}>${t.catalogue.asTarget}</button></span></li>`
    }).join('')
    if (results !== this.resultsMarkup) {
      this.resultsMarkup = results
      this.root.querySelector('#route-results')!.innerHTML = results
    }
    for (const result of this.root.querySelectorAll<HTMLButtonElement>('#route-results button')) result.disabled = search.pending !== null
  }

  private setText(selector: string, value: string): void {
    const element = this.root.querySelector(selector)!
    if (element.textContent !== value) element.textContent = value
  }

  /** A slider being dragged keeps its own position, between the values it lands on. */
  private setSlider(slider: HTMLInputElement, position: number, value: string, output: string): void {
    if (slider.ownerDocument.activeElement !== slider) slider.value = String(position)
    slider.setAttribute('aria-valuetext', value)
    this.setText(output, value)
  }

  private renderStatus(status: string): void {
    if (status === this.status) return
    this.status = status
    const element = this.root.querySelector<HTMLElement>('#route-drawer-status')!
    element.hidden = status === ''
    element.textContent = status
  }
}
