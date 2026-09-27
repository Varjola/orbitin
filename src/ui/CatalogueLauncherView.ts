import { workspaceSnapshotId, type CatalogueWorkspaceState } from '../state/catalogueWorkspaceState.ts'
import type { CatalogueSearchResult } from '../data/catalogueSearch.ts'
import type { SceneState } from '../state/AppState.ts'
import { text } from '../i18n/index.ts'
import { CatalogueQuickSearchView } from './CatalogueQuickSearchView.ts'
import { html, trusted } from './markup.ts'
import { firstVisitHintMarkup } from './firstVisitHint.ts'
import type { UiCallbacks } from './uiTypes.ts'
import type { FeaturedPickTile } from './applicationUi.ts'

/** Compact catalogue entry point over the visualization. Detailed catalogue
 * controls remain in the existing workspace behind the settings button. */
export class CatalogueLauncherView {
  readonly root: HTMLElement
  private readonly quickSearch: CatalogueQuickSearchView
  private readonly featured: HTMLElement
  private featuredPicks: readonly FeaturedPickTile[] = []
  private featuredKey = ''
  private readonly pendingPicks = new Set<string>()
  private lastSync: { readonly workspace: CatalogueWorkspaceState; readonly loading: boolean; readonly scene: SceneState } | null = null

  private readonly hint: HTMLElement

  constructor(container: HTMLElement, callbacks: UiCallbacks, onDismissHint: () => void = () => {}) {
    this.root = container
    this.root.dataset.region = 'catalogueLauncher'
    const t = text().catalogue
    this.root.innerHTML = html`
      <button id="enable-catalogue" class="floating-action primary-action" type="button">${t.enable}</button>
      ${trusted(firstVisitHintMarkup('real-objects-hint', text().firstVisit.realObjects))}
      <p id="catalogue-launcher-error" class="time-note catalogue-launcher-error" role="alert"></p>
      <div id="catalogue-quick-tools" class="catalogue-quick-tools" hidden>
        <button id="catalogue-settings" class="icon-button" type="button" aria-label="${t.settings}" title="${t.settings}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M8 4v6M16 14v6"></path></svg></button>
      </div>
      <section id="catalogue-featured" class="catalogue-featured" aria-labelledby="catalogue-featured-heading" hidden>
        <h2 id="catalogue-featured-heading" class="catalogue-featured-heading">${text().featured.heading}</h2>
        <ul id="catalogue-featured-list" class="catalogue-featured-list"></ul>
      </section>
    `
    const tools = this.root.querySelector<HTMLElement>('#catalogue-quick-tools')!
    const searchMount = this.root.ownerDocument.createElement('div')
    searchMount.id = 'catalogue-quick-search-mount'
    tools.prepend(searchMount)
    this.quickSearch = new CatalogueQuickSearchView(searchMount, callbacks)
    this.hint = this.root.querySelector<HTMLElement>('#real-objects-hint')!
    this.hint.querySelector('button')!.addEventListener('click', () => onDismissHint())
    this.featured = this.root.querySelector<HTMLElement>('#catalogue-featured')!
    this.featured.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-catalog-id]') : null
      const catalogId = button?.dataset.catalogId
      if (!button || !catalogId || button.disabled) return
      this.pendingPicks.add(catalogId)
      this.renderFeatured()
      void callbacks.onAddFeaturedPick(catalogId).finally(() => { this.pendingPicks.delete(catalogId); this.renderFeatured() })
    })
    this.root.querySelector('#enable-catalogue')!.addEventListener('click', () => callbacks.onCatalogueLoad())
    this.root.querySelector('#catalogue-settings')!.addEventListener('click', () => callbacks.onOpenCatalogueWorkspace())
  }

  sync(workspace: CatalogueWorkspaceState, loading: boolean, scene: SceneState): void {
    // A retained snapshot keeps Quick Search usable while a refresh loads or fails.
    const enabled = workspaceSnapshotId(workspace) !== null
    const availability = workspace.availability
    const enable = this.root.querySelector<HTMLButtonElement>('#enable-catalogue')!
    const tools = this.root.querySelector<HTMLElement>('#catalogue-quick-tools')!
    enable.hidden = enabled
    tools.hidden = !enabled
    enable.disabled = loading || availability.kind === 'loading'
    const t = text().catalogue
    enable.textContent = availability.kind === 'loading' ? t.enabling : availability.kind === 'error' ? t.retry : t.enable
    const error = this.root.querySelector<HTMLElement>('#catalogue-launcher-error')!
    const message = availability.kind === 'error' && !enabled ? text().errors.catalogue(availability.failure) : ''
    if (error.textContent !== message) error.textContent = message
    this.root.querySelector<HTMLButtonElement>('#catalogue-settings')!.disabled = loading
    this.quickSearch.sync(workspace, scene, loading)
    this.lastSync = { workspace, loading, scene }
    this.renderFeatured()
  }

  /** The first-visit hint. */
  setHintVisible(visible: boolean): void { this.hint.hidden = !visible }

  /** Featured picks on the empty Real Objects scene. */
  setFeaturedPicks(picks: readonly FeaturedPickTile[]): void { this.featuredPicks = picks; this.renderFeatured() }

  private renderFeatured(): void {
    const sync = this.lastSync
    const visible = sync !== null && this.featuredPicks.length > 0 && sync.scene.objects.length === 0 && sync.workspace.quickSearchText.trim() === ''
    this.featured.hidden = !visible
    if (!visible || !sync) return
    const key = [sync.loading, [...this.pendingPicks].join(','), ...this.featuredPicks.map((pick) => `${pick.catalogId}:${pick.inScene}`)].join('|')
    if (key === this.featuredKey) return
    this.featuredKey = key
    const documentRef = this.root.ownerDocument
    const t = text().featured
    this.root.querySelector('#catalogue-featured-list')!.replaceChildren(...this.featuredPicks.map((pick) => {
      const item = documentRef.createElement('li')
      const button = documentRef.createElement('button')
      button.type = 'button'
      button.className = 'featured-pick'
      button.dataset.catalogId = pick.catalogId
      const line = t.lines[pick.id] ?? ''
      button.innerHTML = html`<span class="featured-pick-name"></span><span class="featured-pick-line"></span>`
      button.querySelector('.featured-pick-name')!.textContent = pick.name
      button.querySelector('.featured-pick-line')!.textContent = line
      button.setAttribute('aria-label', pick.inScene ? t.showNamed(pick.name) : t.addNamed(pick.name, line))
      button.disabled = sync.loading || this.pendingPicks.has(pick.catalogId)
      item.append(button)
      return item
    }))
  }

  renderQuickSearch(result: CatalogueSearchResult, reason: 'input' | 'snapshot'): void { this.quickSearch.render(result, reason) }
  focusSearch(): void { this.quickSearch.focusInput() }
  focusSettings(): void { this.root.querySelector<HTMLButtonElement>('#catalogue-settings')?.focus() }
  dispose(): void { this.quickSearch.dispose(); this.root.textContent = '' }
}
