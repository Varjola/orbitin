import { catalogueComparisonCountStatus } from './catalogueWording.ts'
import { text } from '../i18n/index.ts'
import type { CatalogueFailure } from '../data/catalogueFailure.ts'
import { html } from './markup.ts'
import { buildComparisonTable, comparisonFocusCandidates, MAX_COMPARED_RECORDS, type CatalogueComparisonItem, type ComparisonFocusTarget } from './catalogueComparison.ts'
import type { DetailGroup } from './catalogueRecordDetails.ts'
import type { CatalogueWorkingSelectionModel } from './catalogueWorkingSelection.ts'
import { CatalogueWorkingSelectionView, type CatalogueWorkingSelectionCallbacks } from './CatalogueWorkingSelectionView.ts'

export type CatalogueReviewTab = 'details' | 'selection' | 'compare'
const REVIEW_TABS: readonly CatalogueReviewTab[] = ['details', 'selection', 'compare']

export interface CatalogueReviewCallbacks {
  onAddToScene(catalogIds: readonly string[], jumpToEpoch: boolean): void
  onDetailsChange(catalogId: string | null): void
  onDetailsRetry(catalogId: string): void
  onToggleCompare(catalogId: string, name: string): void
  onCompareChange(ids: readonly string[]): void
  onCompareRetry(catalogId: string): void
  readonly workingSelection: CatalogueWorkingSelectionCallbacks
}

/** Scene and comparison status the review panels need; index/scene-derived only. */
export interface CatalogueReviewSceneState {
  readonly sceneFull: boolean
  readonly sceneCatalogIds: ReadonlySet<string>
  readonly comparedIds: readonly string[]
  readonly compareAvailable: boolean
}


/** Stable review area. Tabs are explicit, and background loads update their
 * own panel without changing the active tab or moving focus. */
export function catalogueReviewMarkup(): string {
  const t = text().catalogue
  return html`
  <div id="catalogue-review-tabs" class="tab-list catalogue-review-tabs" role="tablist" aria-label="${t.review}">
    <button id="catalogue-tab-details" type="button" role="tab" aria-selected="true" aria-controls="catalogue-panel-details" tabindex="0">${t.details}</button>
    <button id="catalogue-tab-selection" type="button" role="tab" aria-selected="false" aria-controls="catalogue-panel-selection" tabindex="-1">${t.workingSelection}</button>
    <button id="catalogue-tab-compare" type="button" role="tab" aria-selected="false" aria-controls="catalogue-panel-compare" tabindex="-1">${t.compareTab(0, MAX_COMPARED_RECORDS)}</button>
  </div>
  <p id="catalogue-review-status" class="sr-only" role="status"></p>
  <p id="catalogue-review-alert" class="sr-only" role="alert"></p>
  <section id="catalogue-panel-details" class="catalogue-review-panel" role="tabpanel" aria-labelledby="catalogue-tab-details">
    <div id="catalogue-details-body" class="catalogue-details"><p class="catalogue-review-empty">${t.detailsEmpty}</p></div>
    <label class="toggle-row catalogue-epoch-toggle" title="${t.goToEpochHint}"><span>${t.goToEpoch}</span><input id="catalogue-epoch-toggle" type="checkbox" checked><span class="toggle-ui" aria-hidden="true"></span></label>
  </section>
  <section id="catalogue-panel-selection" class="catalogue-review-panel" role="tabpanel" aria-labelledby="catalogue-tab-selection" hidden>
    <div id="catalogue-selection-body" class="catalogue-selection"></div>
  </section>
  <section id="catalogue-panel-compare" class="catalogue-review-panel" role="tabpanel" aria-labelledby="catalogue-tab-compare" hidden>
    <div id="catalogue-compare-body" class="catalogue-compare"><p class="catalogue-review-empty">${t.compareEmpty(MAX_COMPARED_RECORDS)}</p></div>
  </section>
`
}

type DetailsContent =
  | { readonly kind: 'empty' }
  | { readonly kind: 'loading'; readonly catalogId: string; readonly name: string }
  | { readonly kind: 'loaded'; readonly catalogId: string; readonly name: string; readonly groups: readonly DetailGroup[] }
  | { readonly kind: 'error'; readonly catalogId: string; readonly name: string; readonly failure: CatalogueFailure }

export class CatalogueReviewView {
  readonly root: HTMLElement
  private readonly callbacks: CatalogueReviewCallbacks
  private readonly tabs: Readonly<Record<CatalogueReviewTab, HTMLButtonElement>>
  private readonly panels: Readonly<Record<CatalogueReviewTab, HTMLElement>>
  private readonly detailsBody: HTMLElement
  private readonly compareBody: HTMLElement
  private readonly status: HTMLElement
  private readonly alert: HTMLElement
  private readonly epochToggle: HTMLInputElement
  private readonly workingSelection: CatalogueWorkingSelectionView
  private activeTab: CatalogueReviewTab = 'details'
  private details: DetailsContent = { kind: 'empty' }
  private comparison: readonly CatalogueComparisonItem[] = []
  private scene: CatalogueReviewSceneState = { sceneFull: false, sceneCatalogIds: new Set(), comparedIds: [], compareAvailable: false }

  constructor(container: HTMLElement, callbacks: CatalogueReviewCallbacks) {
    this.root = container
    this.callbacks = callbacks
    this.root.innerHTML = catalogueReviewMarkup()
    this.tabs = { details: this.root.querySelector<HTMLButtonElement>('#catalogue-tab-details')!, selection: this.root.querySelector<HTMLButtonElement>('#catalogue-tab-selection')!, compare: this.root.querySelector<HTMLButtonElement>('#catalogue-tab-compare')! }
    this.panels = { details: this.root.querySelector<HTMLElement>('#catalogue-panel-details')!, selection: this.root.querySelector<HTMLElement>('#catalogue-panel-selection')!, compare: this.root.querySelector<HTMLElement>('#catalogue-panel-compare')! }
    this.detailsBody = this.root.querySelector<HTMLElement>('#catalogue-details-body')!
    this.compareBody = this.root.querySelector<HTMLElement>('#catalogue-compare-body')!
    this.status = this.root.querySelector<HTMLElement>('#catalogue-review-status')!
    this.alert = this.root.querySelector<HTMLElement>('#catalogue-review-alert')!
    this.epochToggle = this.root.querySelector<HTMLInputElement>('#catalogue-epoch-toggle')!
    this.workingSelection = new CatalogueWorkingSelectionView(this.root.querySelector<HTMLElement>('#catalogue-selection-body')!, callbacks.workingSelection)
    for (const tab of REVIEW_TABS) this.tabs[tab].addEventListener('click', () => this.activateTab(tab))
    this.root.querySelector('#catalogue-review-tabs')!.addEventListener('keydown', (event) => this.onTabKeyDown(event as KeyboardEvent))
  }

  activateTab(tab: CatalogueReviewTab, focusTab = false): void {
    this.activeTab = tab
    for (const key of REVIEW_TABS) {
      const selected = key === tab
      this.tabs[key].setAttribute('aria-selected', String(selected))
      this.tabs[key].tabIndex = selected ? 0 : -1
      this.panels[key].hidden = !selected
    }
    if (focusTab) this.tabs[tab].focus()
  }

  syncScene(state: CatalogueReviewSceneState): void {
    const countChanged = state.comparedIds.length !== this.scene.comparedIds.length
    this.scene = state
    if (countChanged) {
      this.tabs.compare.textContent = text().catalogue.compareTab(state.comparedIds.length, MAX_COMPARED_RECORDS)
      this.announce(catalogueComparisonCountStatus(state.comparedIds.length, MAX_COMPARED_RECORDS))
    }
    this.tabs.compare.hidden = !state.compareAvailable
    if (!state.compareAvailable && this.activeTab === 'compare') this.activateTab('details')
    this.updateDetailActions()
    this.updateComparisonAddButtons()
  }

  showDetailsLoading(catalogId: string, name: string): void {
    this.activateTab('details')
    this.renderDetails({ kind: 'loading', catalogId, name })
    this.announce(text().catalogue.loadingDetails(name))
  }

  showDetails(catalogId: string, name: string, groups: readonly DetailGroup[]): void {
    if (this.details.kind === 'empty' || this.details.catalogId !== catalogId) return
    this.renderDetails({ kind: 'loaded', catalogId, name, groups })
    this.announce(text().catalogue.showingDetails(name))
  }

  showDetailsError(catalogId: string, name: string, failure: CatalogueFailure): void {
    if (this.details.kind === 'empty' || this.details.catalogId !== catalogId) return
    this.renderDetails({ kind: 'error', catalogId, name, failure })
  }

  clearDetails(): void { this.renderDetails({ kind: 'empty' }) }

  /** Background comparison progress: updates Compare without switching tabs
   *  or moving focus. A new load failure is announced once as an alert. */
  setComparison(items: readonly CatalogueComparisonItem[]): void {
    const failed = items.filter((item) => item.state === 'error' && !this.comparison.some((previous) => previous.catalogId === item.catalogId && previous.state === 'error'))
    this.comparison = items
    this.renderComparison()
    if (failed.length > 0) this.alert.textContent = failed.map((item) => text().catalogue.comparisonLoadFailed(item.name)).join(' ')
    else if (!items.some((item) => item.state === 'error')) this.alert.textContent = ''
  }

  /** Details' Compare button hides with its panel when Compare activates; keep
   *  keyboard focus inside the review area by moving it to the Compare tab. */
  showComparison(): void {
    const active = this.root.ownerDocument.activeElement
    this.activateTab('compare', active !== null && this.panels.details.contains(active))
  }

  /** Checking rows updates the tray in place; the active tab never changes. */
  setWorkingSelection(model: CatalogueWorkingSelectionModel): void { this.workingSelection.render(model) }
  /** The header Working selection (<n>) action opens the stable panel. */
  showWorkingSelection(): void { this.activateTab('selection', true) }

  focusDetails(): void { this.detailsBody.querySelector<HTMLElement>('#catalogue-details-heading')?.focus() }
  dispose(): void { this.workingSelection.dispose(); this.root.textContent = '' }

  private onTabKeyDown(event: KeyboardEvent): void {
    const order = REVIEW_TABS.filter((tab) => !this.tabs[tab].hidden)
    const index = order.indexOf(this.activeTab)
    const next = event.key === 'ArrowRight' ? order[(index + 1) % order.length]
      : event.key === 'ArrowLeft' ? order[(index - 1 + order.length) % order.length]
        : event.key === 'Home' ? order[0] : event.key === 'End' ? order[order.length - 1] : null
    if (!next) return
    event.preventDefault()
    this.activateTab(next, true)
  }

  private renderDetails(content: DetailsContent): void {
    const documentRef = this.root.ownerDocument
    const focusedHeading = documentRef.activeElement !== null && documentRef.activeElement === this.detailsBody.querySelector('#catalogue-details-heading')
    const focusedAction = documentRef.activeElement instanceof HTMLElement && this.detailsBody.contains(documentRef.activeElement) ? documentRef.activeElement.dataset.detailAction ?? null : null
    this.details = content
    this.detailsBody.textContent = ''
    const t = text().catalogue
    if (content.kind === 'empty') {
      const empty = this.element('p', 'catalogue-review-empty'); empty.textContent = t.detailsEmpty; this.detailsBody.append(empty)
      return
    }
    const eyebrow = this.element('p', 'catalogue-eyebrow'); eyebrow.textContent = t.focusedObject
    const heading = this.element('h3'); heading.id = 'catalogue-details-heading'; heading.tabIndex = -1; heading.textContent = content.name
    this.detailsBody.append(eyebrow, heading)
    const actions = this.element('div', 'catalogue-detail-actions')
    if (content.kind === 'loading') {
      const loading = this.element('p', 'time-note'); loading.textContent = t.loadingRecord; this.detailsBody.append(loading)
    }
    if (content.kind === 'error') {
      const error = this.element('p', 'time-note'); error.setAttribute('role', 'alert'); error.textContent = text().errors.catalogue(content.failure); this.detailsBody.append(error)
      actions.append(this.button(t.retryRecord, 'retry', () => { this.renderDetails({ kind: 'loading', catalogId: content.catalogId, name: content.name }); this.callbacks.onDetailsRetry(content.catalogId) }))
    }
    if (content.kind === 'loaded') {
      const add = this.button(t.addToScene, 'add', () => this.callbacks.onAddToScene([content.catalogId], this.epochToggle.checked)); add.classList.add('primary-action', 'catalogue-detail-import')
      actions.append(add)
    }
    const compare = this.button(t.compare, 'compare', () => this.callbacks.onToggleCompare(content.catalogId, content.name)); compare.classList.add('catalogue-detail-compare')
    actions.append(compare, this.button(t.closeDetails, 'close', () => this.callbacks.onDetailsChange(null)))
    this.detailsBody.append(actions)
    if (content.kind === 'loaded') this.appendDetailGroups(content.groups)
    this.updateDetailActions()
    if (focusedHeading) heading.focus()
    else if (focusedAction) this.detailsBody.querySelector<HTMLElement>(`[data-detail-action="${focusedAction}"]`)?.focus()
  }

  private updateDetailActions(): void {
    if (this.details.kind === 'empty') return
    const { catalogId, name } = this.details
    const t = text().catalogue
    const add = this.detailsBody.querySelector<HTMLButtonElement>('.catalogue-detail-import')
    if (add) {
      const inScene = this.scene.sceneCatalogIds.has(catalogId)
      add.textContent = inScene ? t.alreadyInScene : this.scene.sceneFull ? t.sceneFull : t.addToScene
      const hadFocus = this.root.ownerDocument.activeElement === add
      add.disabled = inScene || this.scene.sceneFull
      // A successful add disables the focused button; keep focus on the object.
      if (hadFocus && add.disabled) this.focusDetails()
    }
    const compare = this.detailsBody.querySelector<HTMLButtonElement>('.catalogue-detail-compare')
    if (compare) {
      const compared = this.scene.comparedIds.includes(catalogId)
      const full = !compared && this.scene.comparedIds.length >= MAX_COMPARED_RECORDS
      const label = compared ? t.removeFromComparison : full ? t.comparisonFull : t.compare
      compare.textContent = label; compare.setAttribute('aria-label', t.labelledAction(label, name)); compare.disabled = full
      compare.hidden = !this.scene.compareAvailable
    }
  }

  private renderComparison(): void {
    const restore = this.comparisonFocusTarget()
    this.compareBody.textContent = ''
    const t = text().catalogue
    if (this.comparison.length === 0) {
      const empty = this.element('p', 'catalogue-review-empty'); empty.textContent = t.compareEmpty(MAX_COMPARED_RECORDS); this.compareBody.append(empty)
      if (restore) this.restoreComparisonFocus(restore)
      return
    }
    const table = buildComparisonTable(this.comparison)
    const wrap = this.element('div', 'catalogue-compare-wrap')
    const tableElement = this.element('table'); tableElement.style.setProperty('--compare-columns', String(table.columns.length))
    const caption = this.element('caption', 'sr-only'); caption.textContent = t.comparedObjects; tableElement.append(caption)
    const head = this.element('thead'); const headRow = this.element('tr'); const corner = this.element('td'); headRow.append(corner)
    for (const column of table.columns) {
      const cell = this.element('th'); cell.scope = 'col'
      const title = this.element('div'); title.textContent = column.name; cell.append(title)
      if (column.state === 'loading') { const state = this.element('p', 'time-note'); state.textContent = t.loadingRecord; cell.append(state) }
      if (column.state === 'error') {
        const state = this.element('p', 'time-note'); state.textContent = text().errors.catalogueDefaults.record; cell.append(state)
        const retry = this.button(t.retryRecord, 'compare-retry', () => this.callbacks.onCompareRetry(column.catalogId))
        retry.setAttribute('aria-label', t.retryLoading(column.name)); retry.dataset.catalogId = column.catalogId
        cell.append(retry)
      }
      const actions = this.element('div', 'catalogue-comparison-actions')
      const remove = this.button(t.remove, 'compare-remove', () => this.callbacks.onCompareChange(this.scene.comparedIds.filter((id) => id !== column.catalogId)))
      remove.setAttribute('aria-label', t.labelledAction(t.removeFromComparison, column.name)); remove.dataset.catalogId = column.catalogId
      const add = this.button(t.addToScene, 'compare-add', () => this.callbacks.onAddToScene([column.catalogId], this.epochToggle.checked)); add.classList.add('catalogue-comparison-import'); add.dataset.catalogId = column.catalogId; add.dataset.name = column.name
      actions.append(remove, add); cell.append(actions)
      headRow.append(cell)
    }
    head.append(headRow); tableElement.append(head)
    const body = this.element('tbody')
    for (const row of table.rows) {
      const tr = this.element('tr'); const label = this.element('th'); label.scope = 'row'; label.textContent = row.label; tr.append(label)
      for (const value of row.values) { const cell = this.element('td'); cell.textContent = value; tr.append(cell) }
      body.append(tr)
    }
    tableElement.append(body); wrap.append(tableElement); this.compareBody.append(wrap)
    this.compareBody.append(this.button(t.clearComparison, 'compare-clear', () => this.callbacks.onCompareChange([])))
    this.updateComparisonAddButtons()
    if (restore) this.restoreComparisonFocus(restore)
  }

  /** The comparison control that owns focus before a re-render, if any. */
  private comparisonFocusTarget(): ComparisonFocusTarget | null {
    const active = this.root.ownerDocument.activeElement
    if (!(active instanceof HTMLElement) || !this.compareBody.contains(active)) return null
    const catalogId = active.dataset.catalogId ?? null
    const columns = [...this.compareBody.querySelectorAll<HTMLElement>('[data-detail-action="compare-remove"]')].map((button) => button.dataset.catalogId)
    return { action: active.dataset.detailAction ?? '', catalogId, column: catalogId === null ? -1 : columns.indexOf(catalogId) }
  }

  /** Put focus back on the same control, else the nearest stable one, else
   *  the Compare tab; a background update never leaves focus on the body. */
  private restoreComparisonFocus(target: ComparisonFocusTarget): void {
    const buttons = [...this.compareBody.querySelectorAll<HTMLButtonElement>('button[data-detail-action]')]
    for (const candidate of comparisonFocusCandidates(target, this.comparison.map((item) => item.catalogId))) {
      const button = buttons.find((item) => !item.disabled && item.dataset.detailAction === candidate.action && (candidate.catalogId === null || item.dataset.catalogId === candidate.catalogId))
      if (button) { button.focus(); return }
    }
    this.tabs.compare.focus()
  }

  private updateComparisonAddButtons(): void {
    const t = text().catalogue
    for (const add of this.compareBody.querySelectorAll<HTMLButtonElement>('.catalogue-comparison-import')) {
      const inScene = this.scene.sceneCatalogIds.has(add.dataset.catalogId ?? '')
      const label = inScene ? t.alreadyInScene : this.scene.sceneFull ? t.sceneFull : t.addToScene
      add.textContent = label; add.setAttribute('aria-label', t.labelledAction(label, add.dataset.name ?? add.dataset.catalogId ?? ''))
      const hadFocus = this.root.ownerDocument.activeElement === add
      add.disabled = inScene || this.scene.sceneFull
      if (hadFocus && add.disabled) add.parentElement?.querySelector<HTMLElement>('[data-detail-action="compare-remove"]')?.focus()
    }
  }

  private appendDetailGroups(groups: readonly DetailGroup[]): void {
    for (const group of groups) {
      const section = this.element('section', 'catalogue-detail-group'); const heading = this.element('h4'); heading.textContent = group.heading; section.append(heading)
      if (group.note) { const note = this.element('p', 'time-note'); note.textContent = group.note; section.append(note) }
      const list = this.element('dl', 'catalogue-detail-rows')
      for (const row of group.rows) { const label = this.element('dt'); label.textContent = row.label; const value = this.element('dd'); value.textContent = row.value; list.append(label, value) }
      section.append(list); this.detailsBody.append(section)
    }
  }

  private announce(message: string): void { if (this.status.textContent !== message) this.status.textContent = message }

  private button(text: string, action: string, onClick: () => void): HTMLButtonElement {
    const button = this.element('button', 'action-button'); button.type = 'button'; button.textContent = text; button.dataset.detailAction = action
    button.addEventListener('click', onClick)
    return button
  }

  private element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const element = this.root.ownerDocument.createElement(tag); if (className) element.className = className; return element
  }
}
