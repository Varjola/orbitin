import { text } from '../i18n/index.ts'
import { isRealPairId, ROUTE_TRY_THESE, type RouteTryId } from '../simulation/route/routeSources.ts'
import { replaceKeepingFocus } from '../ui/focusKeeping.ts'
import { html, trusted } from '../ui/markup.ts'
import type { RoutePanelModel } from '../ui/routePanelModel.ts'
import { pairText, refusalText } from '../ui/routeWording.ts'
import { icon } from './mobileIcons.ts'
import type { RouteSide } from './routeRulerModel.ts'

export interface RouteChooseCallbacks {
  onTry(id: RouteTryId): void
  onLoad(): void
  onSearch(query: string): void
  onPick(catalogId: string): void
  onSearchFocus(focused: boolean): void
}

function tryMarkup(id: RouteTryId): string {
  const t = text().routePlanner
  const words = isRealPairId(id) ? t.realPairs[id] : t.examples[id]
  const tag = isRealPairId(id) ? html`<span class="m-caption">${t.fromCatalogue}</span>` : ''
  return html`<li><button class="m-example" type="button" data-try="${id}"><span class="m-example-name">${words.name}</span><span class="m-example-line">${words.line}</span>${trusted(tag)}</button></li>`
}

export function routeChooseMarkup(): string {
  const t = text().mobile.route
  const r = text().routePlanner
  return html`
    <h3 class="m-subheading">${r.tryThese}</h3>
    <p class="m-line">${r.tryTheseHint}</p>
    <p class="m-line m-route-pair-status" role="status"></p>
    <ul class="m-examples">${trusted(ROUTE_TRY_THESE.map(tryMarkup).join(''))}</ul>
    <h3 class="m-subheading">${t.real}</h3>
    <p class="m-line m-route-applies"></p>
    <div class="m-load">
      <p class="m-line m-route-load-line">${t.loadSentence}</p>
      <div class="m-progress" hidden><span></span></div>
      <button class="m-button is-primary m-load-button" type="button">${text().mobile.add.load}</button>
    </div>
    <label class="m-search" hidden>${trusted(icon('search'))}<input type="search" autocomplete="off" spellcheck="false" aria-label="${r.search.label}" placeholder="${r.search.placeholder}" /></label>
    <p class="m-line m-route-search-status" role="status"></p>
    <ul class="m-results" tabindex="-1"></ul>
  `
}

/** Choose, an expanded sheet: the nine examples, which set both objects, and real
 *  satellites from the catalogue once it is loaded, each taking the place of the
 *  object chosen in Edit. The catalogue loads only on the learner's press. */
export class RouteChooseSheetView {
  readonly root: HTMLElement
  private readonly search: HTMLInputElement
  private resultsMarkup = ''

  constructor(documentRef: Document, callbacks: RouteChooseCallbacks) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-route-choose'
    this.root.innerHTML = routeChooseMarkup()
    this.search = this.root.querySelector<HTMLInputElement>('.m-search input')!
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-try]')) button.addEventListener('click', () => callbacks.onTry(button.dataset.try as RouteTryId))
    this.root.querySelector('.m-load-button')!.addEventListener('click', () => callbacks.onLoad())
    this.search.addEventListener('input', () => callbacks.onSearch(this.search.value))
    this.search.addEventListener('focus', () => callbacks.onSearchFocus(true))
    this.search.addEventListener('blur', () => callbacks.onSearchFocus(false))
    this.root.querySelector('.m-results')!.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button[data-catalog-id]')
      if (button && !button.disabled) callbacks.onPick(button.dataset.catalogId!)
    })
  }

  sync(model: RoutePanelModel | null, side: RouteSide, loading: boolean): void {
    const r = text().routePlanner
    const t = text().mobile.route
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-try]')) {
      button.disabled = loading || model === null
      if (button.dataset.try === model?.tryId) button.setAttribute('aria-current', 'true')
      else button.removeAttribute('aria-current')
      button.toggleAttribute('aria-busy', model?.pair?.kind === 'loading' && model.pair.id === button.dataset.try)
    }
    if (!model) return
    this.setText('.m-route-pair-status', model.pair === null ? '' : pairText(model.pair))
    const sideName = side === 'own' ? r.yourSatellite : r.target
    this.setText('.m-route-applies', t.appliesTo(sideName))
    const { catalogue, search } = model
    const ready = catalogue === 'ready'
    this.root.querySelector<HTMLElement>('.m-load')!.hidden = ready
    this.root.querySelector<HTMLElement>('.m-progress')!.hidden = catalogue !== 'loading'
    const load = this.root.querySelector<HTMLButtonElement>('.m-load-button')!
    load.hidden = catalogue === 'loading'
    load.disabled = loading
    load.textContent = catalogue === 'unavailable' ? text().mobile.add.retry : text().mobile.add.load
    this.setText('.m-route-load-line', catalogue === 'loading' ? r.search.loading : catalogue === 'unavailable' ? r.search.unavailable : t.loadSentence)
    this.root.querySelector<HTMLElement>('.m-search')!.hidden = !ready
    if (!ready) { this.setText('.m-route-search-status', ''); this.setResults(''); return }
    if (this.search.value !== search.text && this.root.ownerDocument.activeElement !== this.search) this.search.value = search.text
    this.setText('.m-route-search-status', search.pending !== null ? r.search.fetching
      : search.refusal !== null ? refusalText(search.refusal)
        : search.text.trim() === '' ? r.search.prompt
          : search.results.length === 0 ? r.search.noMatches
            : search.moreResults ? r.search.more : '')
    this.setResults(search.results.map((entry) => {
      const busy = search.pending?.catalogId === entry.catalogId ? 'aria-busy="true"' : ''
      return html`<li><button class="m-result" type="button" data-catalog-id="${entry.catalogId}" aria-label="${r.catalogue.setAs(entry.name, sideName)}" ${trusted(busy)}><span class="m-result-text"><span class="m-result-name">${entry.name}</span><span class="m-result-line">${r.catalogueNumber(entry.catalogId)}</span></span></button></li>`
    }).join(''))
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.m-results button')) button.disabled = loading || search.pending !== null
  }

  private setResults(markup: string): void {
    if (markup === this.resultsMarkup) return
    this.resultsMarkup = markup
    replaceKeepingFocus(this.root.querySelector<HTMLElement>('.m-results')!, markup)
  }

  private setText(selector: string, value: string): void {
    const element = this.root.querySelector(selector)!
    if (element.textContent !== value) element.textContent = value
  }
}
