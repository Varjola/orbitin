import type { CatalogueSearchEntryV1 } from '../data/catalogueSchema.ts'
import type { CatalogueSearchResult } from '../data/catalogueSearch.ts'
import { automaticSearchProjection } from '../data/catalogueProfile.ts'
import type { SceneState } from '../state/AppState.ts'
import type { CatalogueAvailability } from '../state/catalogueWorkspaceState.ts'
import { text } from '../i18n/index.ts'
import type { FeaturedPickTile, OfficialGroupTile } from '../ui/applicationUi.ts'
import { officialGroupTitle } from '../ui/catalogueWording.ts'
import { quickSearchPrimaryAction } from '../ui/catalogueQuickSearchModel.ts'
import { html, trusted } from '../ui/markup.ts'
import { icon } from './mobileIcons.ts'

export interface AddSheetCallbacks {
  /** The only mobile action that loads the catalogue index. */
  onLoad(): void
  onSearch(query: string): void
  onAdd(catalogId: string): void
  onAddGroup(groupId: string): void
  /** A featured pick. */
  onAddFeatured(catalogId: string): void
  onSearchFocus(focused: boolean): void
}

/** The row's short line: orbit kind and object type. */
export function searchRowLine(entry: CatalogueSearchEntryV1): string {
  const t = text().mobile.add
  const projection = automaticSearchProjection(entry)
  const orbit = projection?.derived.primaryOrbitClass ? t.orbitClasses[projection.derived.primaryOrbitClass] : ''
  const type = projection?.source.typeCategory ? t.types[projection.source.typeCategory] : ''
  return t.rowLine(orbit, type)
}

/** A group tile's title: the mobile short title, else the reviewed one. */
export function groupTileTitle(tile: Pick<OfficialGroupTile, 'groupId' | 'title'>): string {
  return text().mobile.add.groupTitles[tile.groupId] ?? officialGroupTitle(tile.groupId, tile.title)
}

export function addSheetMarkup(): string {
  const t = text().mobile.add
  return html`
    <div class="m-load">
      <p class="m-line m-load-sentence"></p>
      <div class="m-progress" hidden><span></span></div>
      <button class="m-button is-primary m-load-button" type="button"></button>
    </div>
    <label class="m-search">${trusted(icon('search'))}<span class="sr-only">${t.search}</span><input type="search" enterkeyhint="search" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" placeholder="${t.search}" /></label>
    <ul class="m-results" aria-label="${t.results}" hidden></ul>
    <p class="m-line m-results-note" role="status"></p>
    <section class="m-featured" aria-label="${text().featured.heading}" hidden><h3 class="m-subheading">${text().featured.heading}</h3><div class="m-featured-list"></div></section>
    <section class="m-groups" aria-label="${t.groups}"></section>
  `
}

/** Loading the catalogue on request only, one search
 *  field over the existing Quick Search, and the official groups as tiles.
 *  A tap adds (or reveals what is already in the scene); there is no
 *  Details, View all or Catalogue workspace on mobile. */
export class AddSheetView {
  readonly root: HTMLElement
  private readonly search: HTMLInputElement
  private readonly results: HTMLElement
  private readonly note: HTMLElement
  private readonly groups: HTMLElement
  private readonly featured: HTMLElement
  private featuredPicks: readonly FeaturedPickTile[] = []
  private featuredKey = ''
  private readonly loadButton: HTMLButtonElement
  private availability: CatalogueAvailability = { kind: 'not-loaded' }
  private scene: SceneState | null = null
  private result: CatalogueSearchResult | null = null
  private tiles: readonly OfficialGroupTile[] = []
  private readonly adding = new Set<string>()
  private loading = true
  /** What the rows and tiles were last built from: a commit that changes
   *  neither keeps them, and with them focus and a tap in progress. */
  private rowsKey = ''
  private tilesKey = ''

  constructor(documentRef: Document, callbacks: AddSheetCallbacks) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-add'
    this.root.innerHTML = addSheetMarkup()
    this.search = this.root.querySelector<HTMLInputElement>('.m-search input')!
    this.results = this.root.querySelector<HTMLElement>('.m-results')!
    this.note = this.root.querySelector<HTMLElement>('.m-results-note')!
    this.groups = this.root.querySelector<HTMLElement>('.m-groups')!
    this.featured = this.root.querySelector<HTMLElement>('.m-featured')!
    this.featured.addEventListener('click', (event) => {
      const chip = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-id]') : null
      const id = chip?.dataset.id
      if (!chip || !id || chip.disabled) return
      if (chip.dataset.present !== 'true') this.adding.add(id)
      this.render()
      callbacks.onAddFeatured(id)
    })
    this.loadButton = this.root.querySelector<HTMLButtonElement>('.m-load-button')!
    this.loadButton.dataset.autofocus = ''
    this.loadButton.addEventListener('click', () => callbacks.onLoad())
    this.search.addEventListener('input', () => { callbacks.onSearch(this.search.value); this.render() })
    this.search.addEventListener('focus', () => callbacks.onSearchFocus(true))
    this.search.addEventListener('blur', () => callbacks.onSearchFocus(false))
    this.search.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); this.search.blur() } })
    // A tap on a row or tile keeps focus (and the keyboard) in the search
    // field. Otherwise the tap's blur ends the typing layout, the sheet moves
    // under the finger and the click misses, so adding took a second tap.
    this.root.addEventListener('mousedown', (event) => {
      const target = event.target instanceof Element ? event.target.closest('button[data-id], button[data-group]') : null
      if (target && this.root.ownerDocument.activeElement === this.search) event.preventDefault()
    })
    this.results.addEventListener('click', (event) => {
      const row = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-id]') : null
      const id = row?.dataset.id
      if (!row || !id || row.disabled) return
      if (row.dataset.present !== 'true') this.adding.add(id)
      this.render()
      callbacks.onAdd(id)
    })
    this.groups.addEventListener('click', (event) => {
      const tile = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-group]') : null
      const groupId = tile?.dataset.group
      if (!tile || !groupId || tile.disabled) return
      if (tile.dataset.state === 'ready') this.adding.add(`group:${groupId}`)
      this.render()
      callbacks.onAddGroup(groupId)
    })
  }

  get query(): string { return this.search.value }

  sync(availability: CatalogueAvailability, scene: SceneState, loading: boolean): void {
    this.availability = availability
    this.scene = scene
    this.loading = loading
    this.render()
  }

  setResult(result: CatalogueSearchResult): void { this.result = result; this.render() }
  setGroups(tiles: readonly OfficialGroupTile[]): void { this.tiles = tiles; this.render() }
  setFeatured(picks: readonly FeaturedPickTile[]): void { this.featuredPicks = picks; this.render() }

  /** An add has settled: its row or tile leaves the adding state. */
  settle(key: string): void { if (this.adding.delete(key)) this.render() }

  focusSearch(): void { if (!this.search.disabled) this.search.focus() }

  private render(): void {
    const t = text().mobile.add
    const availability = this.availability
    const ready = availability.kind === 'ready' || (availability.kind === 'error' && availability.snapshotId !== null) || (availability.kind === 'loading' && availability.snapshotId !== null)
    const loadingNow = availability.kind === 'loading' && availability.snapshotId === null
    const failed = availability.kind === 'error' && availability.snapshotId === null
    const load = this.root.querySelector<HTMLElement>('.m-load')!
    load.hidden = ready
    this.root.querySelector('.m-load-sentence')!.textContent = loadingNow ? t.loading : failed ? t.failed : t.loadSentence
    this.root.querySelector<HTMLElement>('.m-progress')!.hidden = !loadingNow
    this.loadButton.hidden = loadingNow
    this.loadButton.textContent = failed ? t.retry : t.load
    this.loadButton.disabled = this.loading
    this.search.disabled = !ready || this.loading
    this.root.classList.toggle('is-unloaded', !ready)
    const query = this.search.value.trim()
    const searching = ready && query !== ''
    this.results.hidden = !searching
    this.groups.hidden = searching
    this.renderRows(searching)
    this.renderTiles(ready)
    this.renderFeatured(ready && !searching)
  }

  /** One-tap featured picks above the groups. */
  private renderFeatured(visible: boolean): void {
    const shown = visible && this.featuredPicks.length > 0
    this.featured.hidden = !shown
    if (!shown) return
    const key = [this.loading, [...this.adding].join(','), ...this.featuredPicks.map((pick) => `${pick.catalogId}:${pick.inScene}`)].join('|')
    if (key === this.featuredKey) return
    this.featuredKey = key
    const t = text().featured
    const documentRef = this.root.ownerDocument
    this.featured.querySelector('.m-featured-list')!.replaceChildren(...this.featuredPicks.map((pick) => {
      const chip = documentRef.createElement('button')
      chip.type = 'button'
      chip.className = 'm-chip m-featured-chip'
      chip.dataset.id = pick.catalogId
      chip.dataset.present = String(pick.inScene)
      chip.textContent = pick.name
      chip.setAttribute('aria-label', pick.inScene ? t.showNamed(pick.name) : t.addNamed(pick.name, t.lines[pick.id] ?? ''))
      chip.disabled = this.loading || this.adding.has(pick.catalogId)
      return chip
    }))
  }

  private renderRows(searching: boolean): void {
    const t = text().mobile.add
    const result = this.result
    const scene = this.scene
    if (!searching || !result || !scene) { if (this.rowsKey) { this.rowsKey = ''; this.results.replaceChildren() } this.note.textContent = ''; return }
    const presence = result.entries.map((entry) => quickSearchPrimaryAction(entry, scene, false)).map((action) => `${action.inScene}${action.disabled}`).join(',')
    const key = [result.entries.map((entry) => entry.catalogId).join(','), presence, [...this.adding].join(','), this.loading].join('|')
    if (key !== this.rowsKey) this.buildRows(result, scene)
    this.rowsKey = key
    this.note.textContent = result.totalMatches === 0 ? t.noMatch(this.search.value.trim()) : result.hasMore ? t.typeMore : ''
  }

  private buildRows(result: CatalogueSearchResult, scene: SceneState): void {
    const t = text().mobile.add
    const documentRef = this.root.ownerDocument
    this.results.replaceChildren(...result.entries.map((entry) => {
      const action = quickSearchPrimaryAction(entry, scene, this.adding.has(entry.catalogId))
      const adding = this.adding.has(entry.catalogId)
      const item = documentRef.createElement('li')
      item.innerHTML = html`<button class="m-result" type="button"><span class="m-result-text"><span class="m-result-name"></span><span class="m-result-line"></span></span><span class="m-result-state"></span></button>`
      const button = item.querySelector<HTMLButtonElement>('button')!
      button.dataset.id = entry.catalogId
      button.dataset.present = String(action.inScene)
      button.disabled = this.loading || adding || (action.disabled && !action.inScene)
      button.setAttribute('aria-label', action.inScene ? t.selectNamed(entry.name) : t.addNamed(entry.name))
      item.querySelector('.m-result-name')!.textContent = entry.name
      item.querySelector('.m-result-line')!.textContent = searchRowLine(entry)
      item.querySelector('.m-result-state')!.textContent = adding ? t.adding : action.inScene ? t.inScene : action.disabled ? t.full : ''
      if (!action.inScene && !action.disabled && !adding) item.querySelector('.m-result-state')!.innerHTML = icon('plus')
      return item
    }))
  }

  private renderTiles(ready: boolean): void {
    const t = text().mobile.add
    const documentRef = this.root.ownerDocument
    const shown = ready ? this.tiles.filter((tile) => tile.state !== 'unavailable') : this.tiles
    const key = [ready, this.loading, [...this.adding].join(','), ...shown.map((tile) => `${tile.groupId}:${tile.state}:${tile.memberIds.length}`)].join('|')
    if (key === this.tilesKey) return
    this.tilesKey = key
    this.groups.replaceChildren(...shown.map((tile) => {
      const title = groupTileTitle(tile)
      const adding = this.adding.has(`group:${tile.groupId}`)
      const wrapper = documentRef.createElement('div')
      wrapper.className = 'm-group'
      wrapper.innerHTML = html`<button class="m-group-tile" type="button"><span class="m-group-text"><span class="m-group-title"></span><span class="m-group-lead"></span></span><span class="m-group-action"></span></button><p class="m-line m-group-note"></p>`
      const button = wrapper.querySelector<HTMLButtonElement>('button')!
      button.dataset.group = tile.groupId
      button.dataset.state = tile.state
      const count = tile.memberIds.length
      wrapper.querySelector('.m-group-title')!.textContent = ready && count > 0 ? t.groupTile(title, count) : title
      // Mobile shows only the first sentence of the
      // group's education page; the full page stays on desktop.
      wrapper.querySelector('.m-group-lead')!.textContent = text().groupPages.groups[tile.groupId]?.lead ?? ''
      wrapper.querySelector('.m-group-action')!.textContent = adding ? t.addingGroup : tile.state === 'in-scene' ? t.groupInScene : t.addAll
      button.setAttribute('aria-label', tile.state === 'in-scene' ? t.showGroupNamed(title) : t.addGroupNamed(title, count))
      button.disabled = !ready || this.loading || adding || tile.state === 'full' || tile.state === 'unavailable'
      wrapper.querySelector('.m-group-note')!.textContent = tile.state === 'full' ? t.groupFull : ''
      return wrapper
    }))
  }
}
