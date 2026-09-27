import { normalizeSearchText, type CatalogueSearchEntryV1 } from '../data/catalogueSchema.ts'
import type { CatalogueSearchResult } from '../data/catalogueSearch.ts'
import type { SceneState } from '../state/AppState.ts'
import type { AddCatalogueRecordsOutcome } from '../state/catalogueAdditionOutcome.ts'
import { INITIAL_CATALOGUE_WORKSPACE, workspaceSnapshotId, type CatalogueWorkspaceState } from '../state/catalogueWorkspaceState.ts'
import { sceneStatusMessage, quickSearchSelectionMessage } from './sceneStatusWording.ts'
import { quickSearchResultStatus } from './catalogueWording.ts'
import { text } from '../i18n/index.ts'
import { catalogueFailureOf } from '../data/catalogueFailure.ts'
import { html } from './markup.ts'
import { quickSearchIdentity, quickSearchKeyTarget, quickSearchPrimaryAction } from './catalogueQuickSearchModel.ts'
import type { UiCallbacks } from './uiTypes.ts'

/** Static structure of the compact search. A combobox input controls a
 * non-modal dialog; results are a plain list whose items contain sibling
 * native buttons, never a listbox with interactive options. */
export function quickSearchMarkup(): string {
  const t = text().catalogue
  return html`
  <label class="catalogue-search-shell"><span class="sr-only">${t.quickSearch}</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="m16 16 4 4"></path></svg><input id="catalogue-quick-search" type="search" maxlength="80" autocomplete="off" placeholder="${t.quickSearch}" role="combobox" aria-expanded="false" aria-controls="catalogue-quick-search-results" aria-haspopup="dialog" /></label>
  <div id="catalogue-quick-search-results" class="catalogue-quick-search-popup" role="dialog" aria-labelledby="catalogue-quick-search-heading" tabindex="-1" hidden>
    <h2 id="catalogue-quick-search-heading" class="sr-only">${t.quickSearchResults}</h2>
    <ul id="catalogue-quick-search-list" class="catalogue-quick-search-list"></ul>
    <p id="catalogue-quick-search-empty" class="catalogue-quick-search-empty" hidden></p>
    <div id="catalogue-quick-search-footer" class="catalogue-quick-search-footer" hidden></div>
  </div>
  <p id="catalogue-quick-search-status" class="time-note catalogue-quick-search-status" role="status" aria-live="polite"></p>
  <p id="catalogue-quick-search-error" class="time-note" role="alert"></p>
`
}

interface QuickSearchRow {
  readonly entry: CatalogueSearchEntryV1
  readonly primary: HTMLButtonElement
  readonly details: HTMLButtonElement
  readonly inScene: HTMLElement
}

/** The bounded, index-only search surface attached to the Real Objects
 * launcher. It owns transient popup and keyboard state; catalogue state and
 * scene mutation remain with the controller/application callbacks. */
export class CatalogueQuickSearchView {
  readonly root: HTMLElement
  private readonly input: HTMLInputElement
  private readonly dialog: HTMLElement
  private readonly results: HTMLUListElement
  private readonly empty: HTMLElement
  private readonly footer: HTMLElement
  private readonly status: HTMLElement
  private readonly error: HTMLElement
  private readonly callbacks: UiCallbacks
  private workspace: CatalogueWorkspaceState = INITIAL_CATALOGUE_WORKSPACE
  private scene: SceneState = { objects: [], selection: { ids: [], primaryId: null } }
  private rows: QuickSearchRow[] = []
  private popupOpen = false
  private disposed = false
  private interactionGeneration = 0
  private pendingFrame: number | null = null
  private actionError = ''
  private readonly pendingIds = new Set<string>()

  constructor(container: HTMLElement, callbacks: UiCallbacks) {
    this.root = container
    this.callbacks = callbacks
    this.root.className = 'catalogue-quick-search'
    this.root.innerHTML = quickSearchMarkup()
    this.input = this.root.querySelector<HTMLInputElement>('#catalogue-quick-search')!
    this.dialog = this.root.querySelector<HTMLElement>('#catalogue-quick-search-results')!
    this.results = this.root.querySelector<HTMLUListElement>('#catalogue-quick-search-list')!
    this.empty = this.root.querySelector<HTMLElement>('#catalogue-quick-search-empty')!
    this.footer = this.root.querySelector<HTMLElement>('#catalogue-quick-search-footer')!
    this.status = this.root.querySelector<HTMLElement>('#catalogue-quick-search-status')!
    this.error = this.root.querySelector<HTMLElement>('#catalogue-quick-search-error')!
    this.input.addEventListener('input', () => this.scheduleQuery())
    this.input.addEventListener('keydown', (event) => this.onInputKeyDown(event))
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.popupOpen) { event.preventDefault(); this.closePopup(true) }
    })
    this.root.addEventListener('focusout', () => {
      globalThis.setTimeout(() => {
        if (!this.disposed && this.popupOpen && !this.root.contains(this.root.ownerDocument.activeElement)) this.closePopup(false)
      }, 0)
    })
  }

  sync(workspace: CatalogueWorkspaceState, scene: SceneState, loading: boolean): void {
    this.workspace = workspace
    this.scene = scene
    this.input.disabled = loading || !this.searchable()
    if (this.root.ownerDocument.activeElement !== this.input && this.pendingFrame === null) this.input.value = workspace.quickSearchText
    this.showError()
    this.updateScenePresentation()
  }

  /** `input` results come from the learner's typing and open the popup.
   * `snapshot` results recompute suggestions for a newly loaded index while
   * keeping the popup closed. */
  render(result: CatalogueSearchResult, reason: 'input' | 'snapshot' = 'input'): void {
    if (this.disposed) return
    this.interactionGeneration += 1
    this.actionError = ''
    this.showError()
    this.rows = []
    this.results.textContent = ''
    this.footer.textContent = ''; this.footer.hidden = true
    this.empty.textContent = ''; this.empty.hidden = true
    const query = this.workspace.quickSearchText
    if (normalizeSearchText(query) === '') {
      this.closePopup(this.focusInsidePopup())
      this.status.textContent = ''
      return
    }
    const t = text().catalogue
    if (result.entries.length === 0) {
      this.empty.textContent = t.quickSearchNoMatch(query.trim()); this.empty.hidden = false
      this.appendFooterAction(t.openCatalogue, 'catalogue-quick-search-open', () => this.callbacks.onOpenCatalogueWorkspace())
    } else {
      for (const entry of result.entries) this.appendResult(entry)
      if (result.hasMore) this.appendFooterAction(t.quickSearchViewAll(result.totalMatches), 'catalogue-quick-search-view-all', () => this.callbacks.onOpenCatalogueViewAll())
    }
    this.status.textContent = quickSearchResultStatus(result)
    if (reason === 'input') this.openPopup()
    else this.closePopup(this.focusInsidePopup())
  }

  focusInput(): void { this.input.focus() }
  dispose(): void { this.disposed = true; this.interactionGeneration += 1; this.cancelFrame(); this.root.textContent = '' }

  private searchable(): boolean { return workspaceSnapshotId(this.workspace) !== null }

  private availabilityErrorText(): string {
    const availability = this.workspace.availability
    return availability.kind === 'error' && availability.snapshotId !== null ? text().catalogue.quickSearchRefreshFailed(text().errors.catalogue(availability.failure)) : ''
  }

  /** A failed quick add stays announced until the results change; otherwise
   * the alert reports a failed refresh over the retained snapshot. */
  private showError(): void {
    const message = this.actionError || this.availabilityErrorText()
    if (this.error.textContent !== message) this.error.textContent = message
  }

  private scheduleQuery(): void {
    if (this.pendingFrame !== null) return
    const callback = () => { this.pendingFrame = null; this.runQuery() }
    const requestFrame = globalThis.requestAnimationFrame
    this.pendingFrame = typeof requestFrame === 'function' ? requestFrame(callback) : globalThis.setTimeout(callback, 0)
  }

  /** Apply coalesced typing before a key or action reads the current results. */
  private flushQuery(): void {
    if (this.pendingFrame === null) return
    this.cancelFrame()
    this.runQuery()
  }

  private cancelFrame(): void {
    if (this.pendingFrame === null) return
    if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(this.pendingFrame)
    globalThis.clearTimeout(this.pendingFrame)
    this.pendingFrame = null
  }

  private runQuery(): void {
    if (this.disposed || !this.searchable()) return
    this.callbacks.onCatalogueQuickSearch(this.input.value)
  }

  private appendResult(entry: CatalogueSearchEntryV1): void {
    const identity = quickSearchIdentity(entry)
    const item = this.element('li', 'catalogue-quick-search-result')
    item.dataset.catalogId = entry.catalogId
    const identityText = this.element('div', 'catalogue-quick-search-identity')
    const name = this.element('strong'); name.textContent = identity.name; identityText.append(name)
    for (const detail of identity.details) { const span = this.element('span'); span.textContent = detail; identityText.append(span) }
    const inScene = this.element('span', 'catalogue-quick-search-in-scene')
    inScene.textContent = text().catalogue.inScene
    const actions = this.element('div', 'catalogue-quick-search-actions')
    const primary = this.button('')
    primary.classList.add('catalogue-quick-search-primary')
    const details = this.button(text().catalogue.details)
    details.classList.add('catalogue-quick-search-details')
    details.setAttribute('aria-label', text().catalogue.detailsFor(entry.name))
    const row: QuickSearchRow = { entry, primary, details, inScene }
    primary.addEventListener('click', () => this.activatePrimary(row))
    details.addEventListener('click', () => this.handOff(() => this.callbacks.onOpenCatalogueDetails(entry.catalogId)))
    for (const control of [primary, details]) control.addEventListener('keydown', (event) => this.onResultKeyDown(event, row))
    actions.append(primary, details)
    item.append(identityText, inScene, actions)
    this.results.append(item)
    this.rows.push(row)
    this.updateRow(row)
  }

  private appendFooterAction(label: string, className: string, action: () => void): void {
    const button = this.button(label)
    button.classList.add(className)
    button.addEventListener('click', () => this.handOff(action))
    this.footer.append(button); this.footer.hidden = false
  }

  /** Open Catalogue while the invoking button is still focused, so the
   * workspace captures it as the return target, then close the popup. */
  private handOff(action: () => void): void {
    this.flushQuery()
    this.interactionGeneration += 1
    action()
    this.closePopup(false)
  }

  private activatePrimary(row: QuickSearchRow): void {
    const { entry, primary } = row
    const action = quickSearchPrimaryAction(entry, this.scene, this.pendingIds.has(entry.catalogId))
    if (action.kind === 'select' && action.sceneObjectId !== null) {
      this.callbacks.onSelectSceneObject(action.sceneObjectId, 'only')
      this.finishSuccessfulAction(quickSearchSelectionMessage(entry.name))
      return
    }
    if (action.disabled || this.pendingIds.has(entry.catalogId)) return
    this.pendingIds.add(entry.catalogId)
    this.updateRow(row)
    const generation = this.interactionGeneration
    const settle = (handle: () => void) => {
      this.pendingIds.delete(entry.catalogId)
      this.updateScenePresentation()
      if (!this.disposed && generation === this.interactionGeneration) handle()
    }
    let pending: Promise<AddCatalogueRecordsOutcome>
    try { pending = this.callbacks.onQuickSearchAddToScene(entry.catalogId) }
    catch (reason) { settle(() => this.handleAddFailure(failureMessage(reason), primary)); return }
    pending.then(
      (outcome) => settle(() => this.handleAddOutcome(outcome, primary)),
      (reason: unknown) => settle(() => this.handleAddFailure(failureMessage(reason), primary)),
    )
  }

  private handleAddOutcome(outcome: AddCatalogueRecordsOutcome, button: HTMLButtonElement): void {
    if (outcome.kind === 'added' || outcome.kind === 'already-present') this.finishSuccessfulAction(sceneStatusMessage(outcome))
    else this.handleAddFailure(sceneStatusMessage(outcome), button)
  }

  private handleAddFailure(message: string, button: HTMLButtonElement): void {
    this.actionError = message
    this.showError()
    if (this.popupOpen && this.root.contains(button)) button.focus()
  }

  private finishSuccessfulAction(message: string): void {
    this.cancelFrame()
    this.input.value = ''
    this.callbacks.onCatalogueQuickSearch('')
    this.closePopup(false)
    this.status.textContent = message
    this.input.focus()
  }

  private onInputKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return
    this.flushQuery()
    if (event.key === 'Enter' && !this.popupOpen) return
    const target = quickSearchKeyTarget(event.key, null, this.rows.length)
    if (target.kind !== 'result') return
    event.preventDefault()
    this.openPopup()
    this.focusRow(target.index)
  }

  private onResultKeyDown(event: KeyboardEvent, row: QuickSearchRow): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const target = quickSearchKeyTarget(event.key, this.rows.indexOf(row), this.rows.length)
    if (target.kind === 'result') this.focusRow(target.index)
    else if (target.kind === 'input') this.input.focus()
  }

  private focusRow(index: number): void {
    const row = this.rows[index]
    if (!row) return
    if (!row.primary.disabled) row.primary.focus()
    else row.details.focus()
  }

  private focusInsidePopup(): boolean {
    const active = this.root.ownerDocument.activeElement
    return active !== null && active !== this.input && this.dialog.contains(active)
  }

  private openPopup(): void {
    this.popupOpen = true
    this.dialog.hidden = false
    this.input.setAttribute('aria-expanded', 'true')
    this.keepPopupInViewport()
  }

  /** The launcher can sit mid-row on narrow layouts; shift the popup left so
   * its full width stays inside the viewport instead of being clipped. */
  private keepPopupInViewport(): void {
    const margin = 12
    const viewportWidth = this.root.ownerDocument.documentElement.clientWidth
    const anchorLeft = this.root.getBoundingClientRect().left
    const width = this.dialog.getBoundingClientRect().width
    const shift = Math.max(margin - anchorLeft, Math.min(0, viewportWidth - margin - anchorLeft - width))
    this.dialog.style.left = `${shift}px`
  }

  private closePopup(returnFocus: boolean): void {
    this.popupOpen = false
    this.dialog.hidden = true
    this.input.setAttribute('aria-expanded', 'false')
    if (returnFocus) this.input.focus()
  }

  private updateScenePresentation(): void { for (const row of this.rows) this.updateRow(row) }

  private updateRow(row: QuickSearchRow): void {
    const pending = this.pendingIds.has(row.entry.catalogId)
    const action = quickSearchPrimaryAction(row.entry, this.scene, pending)
    row.inScene.hidden = !action.inScene
    row.primary.textContent = action.label
    row.primary.disabled = action.disabled
    row.primary.setAttribute('aria-label', action.accessibleLabel)
  }

  private element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const element = this.root.ownerDocument.createElement(tag)
    if (className) element.className = className
    return element
  }
  private button(text: string): HTMLButtonElement { const button = this.element('button'); button.type = 'button'; button.className = 'action-button'; button.textContent = text; return button }
}

function failureMessage(reason: unknown): string { return text().errors.catalogue(catalogueFailureOf(reason, text().errors.catalogueDefaults.add)) }
