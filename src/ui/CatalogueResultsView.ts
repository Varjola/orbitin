import { EMPTY_CATALOGUE_QUERY, ORBIT_FLAGS, PRIMARY_ORBIT_CLASSES, SGP4_REGIMES, TYPE_CATEGORIES, type CatalogueQuery } from '../data/catalogueQuery.ts'
import type { PrimaryOrbitClass, Sgp4Regime } from '../data/catalogueEnrichment.ts'
import type { CatalogueObjectTypeCategory } from '../data/catalogueSourceRecord.ts'
import type { OrbitFlag } from '../data/catalogueQuery.ts'
import { text } from '../i18n/index.ts'
import { clearCatalogueFilters, elementAgeOptions, type CatalogueResultRow, type CatalogueResultsModel, type FilterOptionModel } from './catalogueResultsModel.ts'
import { html, trusted } from './markup.ts'
import { termLabelMarkup } from './termLabel.ts'
import { MAX_COMPARED_RECORDS } from './catalogueComparison.ts'

export interface CatalogueResultsCallbacks {
  onQueryChange(query: CatalogueQuery): void
  /** Show this object: focus it in Details. May fetch only its owning shard. */
  onFocusRecord(catalogId: string, name: string): void
  onToggleCompare(catalogId: string, name: string): void
  /** Toggle one id in the working selection only: no focus, fetch, compare or add. */
  onToggleWorkingSelection(catalogId: string): void
}

/** Row status that changes without a new query: scene membership, working
 *  selection, comparison and focus. */
export interface CatalogueResultRowState {
  readonly sceneCatalogIds: ReadonlySet<string>
  readonly workingSelectionIds: ReadonlySet<string>
  readonly comparedIds: readonly string[]
  readonly focusedId: string | null
  readonly compareAvailable: boolean
}

/** The always-visible full search lives in the workspace header; this view
 *  still owns the field and its query events. */
export function catalogueFullSearchMarkup(): string {
  const t = text().catalogue
  return html`
  <label class="catalogue-full-search"><span class="sr-only">${t.searchAll}</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="m16 16 4 4"></path></svg><input id="catalogue-search" type="search" maxlength="80" autocomplete="off" placeholder="${t.searchPlaceholder}" /></label>
`
}

export function catalogueResultsMarkup(): string {
  const t = text().catalogue
  return html`
  <div class="catalogue-find-controls">
    <fieldset id="catalogue-type-filter" class="catalogue-filter-fieldset catalogue-visible-filter"><legend>${t.objectTypeFilter}</legend></fieldset>
    <fieldset id="catalogue-class-filter" class="catalogue-filter-fieldset catalogue-visible-filter"><legend>${t.orbitClassFilter}</legend></fieldset>
    <div class="catalogue-find-actions">
      <label class="catalogue-sort-label">${t.sortBy} <select id="catalogue-sort"></select></label>
      <button id="catalogue-all-filters-toggle" class="action-button" type="button" aria-expanded="false" aria-controls="catalogue-all-filters">${t.allFilters}</button>
      <button id="catalogue-clear-filters" class="action-button" type="button" disabled>${t.clearFilters}</button>
    </div>
  </div>
  <div id="catalogue-all-filters" class="catalogue-all-filters" hidden>
    <p class="time-note">${t.facetCountExplanation}</p>
    <fieldset id="catalogue-regime-filter" class="catalogue-filter-fieldset"><legend>${t.regimeFilter}</legend></fieldset>
    <fieldset id="catalogue-flag-filter" class="catalogue-filter-fieldset"><legend>${t.geometryFilter}</legend><p class="time-note">${t.geometryFilterNote}</p></fieldset>
    <fieldset class="catalogue-filter-fieldset"><legend>${t.countryFilter}</legend><select id="catalogue-country" aria-label="${t.countryFilterAccessible}"></select></fieldset>
    <fieldset class="catalogue-filter-fieldset"><legend>${t.launchYearFilter}</legend><label class="catalogue-year-input">${t.from} <input id="catalogue-launch-from" type="number" min="1957" step="1" /></label><label class="catalogue-year-input">${t.to} <input id="catalogue-launch-to" type="number" min="1957" step="1" /></label></fieldset>
    <fieldset class="catalogue-filter-fieldset"><legend>${trusted(termLabelMarkup(t.elementAgeFilter, 'elementSet'))}</legend><select id="catalogue-element-age" aria-label="${t.elementAgeFilter}"></select></fieldset>
  </div>
  <div class="catalogue-results-heading">
    <h3 id="catalogue-results-heading">${t.results}</h3>
    <p id="catalogue-summary" class="catalogue-summary" tabindex="-1" role="status"></p>
  </div>
  <div class="catalogue-table-wrap">
    <table id="catalogue-results-table" class="catalogue-results-table" aria-labelledby="catalogue-results-heading" aria-describedby="catalogue-summary">
      <thead><tr id="catalogue-results-head"></tr></thead>
      <tbody id="catalogue-results-body"></tbody>
    </table>
  </div>
`
}

interface OptionControl { readonly value: string; readonly input: HTMLInputElement; readonly label: HTMLElement }

/** Find surface: full search, visible and progressive filters, sort, the
 * explicit count and the bounded dense result table. Rows are rendered from
 * index-derived row models only; no control here can request a record shard
 * except the explicit Show this object action delegated to the coordinator. */
export class CatalogueResultsView {
  readonly root: HTMLElement
  private readonly callbacks: CatalogueResultsCallbacks
  private readonly search: HTMLInputElement
  private readonly sort: HTMLSelectElement
  private readonly country: HTMLSelectElement
  private readonly launchFrom: HTMLInputElement
  private readonly launchTo: HTMLInputElement
  private readonly elementAge: HTMLSelectElement
  private readonly allFiltersToggle: HTMLButtonElement
  private readonly allFilters: HTMLElement
  private readonly clearButton: HTMLButtonElement
  private readonly summary: HTMLElement
  private readonly head: HTMLElement
  private readonly body: HTMLElement
  private readonly options = new Map<'typeCategories' | 'primaryOrbitClasses' | 'requiredFlags' | 'sgp4Regime', OptionControl[]>()
  private query: CatalogueQuery = EMPTY_CATALOGUE_QUERY
  private pending: Partial<CatalogueQuery> = {}
  private pendingFrame: number | null = null
  private countryValues = ''
  private columnSignature = ''
  private rowState: CatalogueResultRowState = { sceneCatalogIds: new Set(), workingSelectionIds: new Set(), comparedIds: [], focusedId: null, compareAvailable: false }

  constructor(searchContainer: HTMLElement, container: HTMLElement, callbacks: CatalogueResultsCallbacks) {
    this.root = container
    this.callbacks = callbacks
    searchContainer.innerHTML = catalogueFullSearchMarkup()
    this.root.innerHTML = catalogueResultsMarkup()
    // Nothing to find until the first snapshot renders.
    this.root.hidden = true
    this.search = searchContainer.querySelector<HTMLInputElement>('#catalogue-search')!
    this.sort = this.root.querySelector<HTMLSelectElement>('#catalogue-sort')!
    this.country = this.root.querySelector<HTMLSelectElement>('#catalogue-country')!
    this.launchFrom = this.root.querySelector<HTMLInputElement>('#catalogue-launch-from')!
    this.launchTo = this.root.querySelector<HTMLInputElement>('#catalogue-launch-to')!
    this.elementAge = this.root.querySelector<HTMLSelectElement>('#catalogue-element-age')!
    this.allFiltersToggle = this.root.querySelector<HTMLButtonElement>('#catalogue-all-filters-toggle')!
    this.allFilters = this.root.querySelector<HTMLElement>('#catalogue-all-filters')!
    this.clearButton = this.root.querySelector<HTMLButtonElement>('#catalogue-clear-filters')!
    this.summary = this.root.querySelector<HTMLElement>('#catalogue-summary')!
    this.head = this.root.querySelector<HTMLElement>('#catalogue-results-head')!
    this.body = this.root.querySelector<HTMLElement>('#catalogue-results-body')!
    const year = String(new Date().getUTCFullYear()); this.launchFrom.max = year; this.launchTo.max = year
    for (const option of elementAgeOptions()) this.addOption(this.elementAge, option.label, option.value)

    this.options.set('typeCategories', this.buildOptions(this.root.querySelector('#catalogue-type-filter')!, 'checkbox', 'catalogue-type', TYPE_CATEGORIES))
    this.options.set('primaryOrbitClasses', this.buildOptions(this.root.querySelector('#catalogue-class-filter')!, 'checkbox', 'catalogue-class', PRIMARY_ORBIT_CLASSES))
    this.options.set('sgp4Regime', this.buildOptions(this.root.querySelector('#catalogue-regime-filter')!, 'radio', 'catalogue-regime', ['any', ...SGP4_REGIMES]))
    this.options.set('requiredFlags', this.buildOptions(this.root.querySelector('#catalogue-flag-filter')!, 'checkbox', 'catalogue-flag', ORBIT_FLAGS))
    this.bindEvents()
  }

  render(model: CatalogueResultsModel, query: CatalogueQuery): void {
    this.query = query
    this.root.hidden = false
    if (this.root.ownerDocument.activeElement !== this.search && this.search.value !== model.searchText) this.search.value = model.searchText
    for (const element of this.root.querySelectorAll<HTMLElement>('.catalogue-visible-filter')) element.hidden = !model.automatic
    this.allFiltersToggle.hidden = !model.automatic
    this.clearButton.hidden = !model.automatic
    if (!model.automatic) this.setAllFiltersOpen(false)
    this.allFiltersToggle.textContent = model.allFiltersLabel
    this.clearButton.disabled = !model.clearFiltersEnabled
    this.renderOptions('typeCategories', model.typeOptions)
    this.renderOptions('primaryOrbitClasses', model.classOptions)
    this.renderOptions('requiredFlags', model.flagOptions)
    this.renderOptions('sgp4Regime', model.regimeOptions)
    this.renderCountryOptions(model.countryOptions)
    this.setInputValue(this.launchFrom, model.launchYearMin === null ? '' : String(model.launchYearMin))
    this.setInputValue(this.launchTo, model.launchYearMax === null ? '' : String(model.launchYearMax))
    this.elementAge.value = model.maxElementAgeDays === null ? '' : String(model.maxElementAgeDays)
    const sortValues = model.sortOptions.map((option) => option.value).join(',')
    if ([...this.sort.options].map((option) => option.value).join(',') !== sortValues) {
      this.sort.textContent = ''
      for (const option of model.sortOptions) this.addOption(this.sort, option.label, option.value)
    }
    this.sort.value = model.sortOptions.find((option) => option.selected)?.value ?? 'relevance'
    if (this.summary.textContent !== model.summary) this.summary.textContent = model.summary
    this.renderColumns(model)
    this.renderRows(model.rows, model.columns.map((column) => column.key))
  }

  /** Update In scene, comparison and focus markers in place; never re-queries. */
  syncRowState(state: CatalogueResultRowState): void {
    this.rowState = state
    for (const row of this.body.querySelectorAll<HTMLTableRowElement>('tr[data-catalog-id]')) this.applyRowState(row)
  }

  focusSearch(): void { this.search.focus() }
  /** Return focus to a rendered row's name button, when that row is in the current window. */
  focusRow(catalogId: string): boolean {
    const row = [...this.body.querySelectorAll<HTMLTableRowElement>('tr[data-catalog-id]')].find((candidate) => candidate.dataset.catalogId === catalogId)
    const button = row?.querySelector<HTMLElement>('.catalogue-row-name')
    button?.focus()
    return button !== undefined && button !== null
  }
  focusSummary(): void { this.summary.focus() }
  dispose(): void { this.cancelFrame(); this.root.textContent = '' }

  private bindEvents(): void {
    this.search.addEventListener('input', () => this.schedule({ text: this.search.value }))
    this.sort.addEventListener('change', () => this.schedule({ sort: this.sort.value as CatalogueQuery['sort'] }))
    this.country.addEventListener('change', () => this.schedule({ countryOrSourceCode: this.country.value || null }))
    this.elementAge.addEventListener('change', () => this.schedule({ maxElementAgeDays: this.elementAge.value === '' ? null : Number(this.elementAge.value) }))
    const years = () => {
      const from = parseYear(this.launchFrom.value); const to = parseYear(this.launchTo.value)
      const swap = from !== null && to !== null && from > to
      this.schedule({ launchYearMin: swap ? to : from, launchYearMax: swap ? from : to })
    }
    this.launchFrom.addEventListener('change', years); this.launchTo.addEventListener('change', years)
    const checked = (key: 'typeCategories' | 'primaryOrbitClasses' | 'requiredFlags' | 'sgp4Regime') => (this.options.get(key) ?? []).filter((control) => control.input.checked).map((control) => control.value)
    for (const control of this.options.get('typeCategories') ?? []) control.input.addEventListener('change', () => this.schedule({ typeCategories: checked('typeCategories') as CatalogueObjectTypeCategory[] }))
    for (const control of this.options.get('primaryOrbitClasses') ?? []) control.input.addEventListener('change', () => this.schedule({ primaryOrbitClasses: checked('primaryOrbitClasses') as PrimaryOrbitClass[] }))
    for (const control of this.options.get('requiredFlags') ?? []) control.input.addEventListener('change', () => this.schedule({ requiredFlags: checked('requiredFlags') as OrbitFlag[] }))
    for (const control of this.options.get('sgp4Regime') ?? []) control.input.addEventListener('change', () => { const value = checked('sgp4Regime')[0] ?? 'any'; this.schedule({ sgp4Regime: value === 'any' ? null : value as Sgp4Regime }) })
    this.allFiltersToggle.addEventListener('click', () => this.setAllFiltersOpen(this.allFiltersToggle.getAttribute('aria-expanded') !== 'true'))
    this.clearButton.addEventListener('click', () => { this.pending = {}; this.schedule(clearCatalogueFilters({ ...this.query, text: this.search.value })) })
    // Row background, or the name button, shows the object. Native row
    // controls stop propagation so they never also open Details.
    this.body.addEventListener('click', (event) => {
      const row = (event.target as Element | null)?.closest<HTMLTableRowElement>('tr[data-catalog-id]')
      if (!row) return
      // Keep keyboard continuation on the row's name button, inside the dialog.
      if (!(event.target as Element).closest('button')) row.querySelector<HTMLElement>('.catalogue-row-name')?.focus({ preventScroll: true })
      this.callbacks.onFocusRecord(row.dataset.catalogId!, row.dataset.name ?? row.dataset.catalogId!)
    })
  }

  private setAllFiltersOpen(open: boolean): void {
    this.allFilters.hidden = !open
    this.allFiltersToggle.setAttribute('aria-expanded', String(open))
  }

  /** Coalesce control changes to at most one query per animation frame. */
  private schedule(patch: Partial<CatalogueQuery>): void {
    this.pending = { ...this.pending, ...patch }
    if (this.pendingFrame !== null) return
    const callback = () => { this.pendingFrame = null; const next = { ...this.query, ...this.pending }; this.pending = {}; this.callbacks.onQueryChange(next) }
    const requestFrame = globalThis.requestAnimationFrame
    this.pendingFrame = typeof requestFrame === 'function' ? requestFrame(callback) : globalThis.setTimeout(callback, 0)
  }

  private cancelFrame(): void {
    if (this.pendingFrame === null) return
    if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(this.pendingFrame)
    else globalThis.clearTimeout(this.pendingFrame)
    this.pendingFrame = null
  }

  private renderColumns(model: CatalogueResultsModel): void {
    const signature = model.columns.map((column) => column.key).join(',')
    if (signature === this.columnSignature) return
    this.columnSignature = signature
    this.head.textContent = ''
    for (const column of model.columns) {
      const cell = this.element('th'); cell.scope = 'col'; cell.dataset.column = column.key
      if (column.key === 'select') { const label = this.element('span', 'sr-only'); label.textContent = column.label; cell.append(label) } else cell.textContent = column.label
      if (!column.narrow) cell.classList.add('catalogue-wide-only')
      this.head.append(cell)
    }
    this.root.querySelector('#catalogue-results-table')!.classList.toggle('is-legacy', !model.automatic)
  }

  private renderRows(rows: readonly CatalogueResultRow[], columns: readonly string[]): void {
    const documentRef = this.root.ownerDocument
    const active = documentRef.activeElement instanceof HTMLElement && this.body.contains(documentRef.activeElement) ? documentRef.activeElement : null
    const focusKey = active ? `${active.closest<HTMLElement>('tr')?.dataset.catalogId ?? ''}/${active.dataset.rowAction ?? ''}` : null
    this.body.textContent = ''
    for (const row of rows) {
      const tr = this.element('tr'); tr.dataset.catalogId = row.catalogId; tr.dataset.name = row.name
      for (const key of columns) {
        const cell = this.element('td'); cell.dataset.column = key
        if (key === 'select') {
          // A labelled native checkbox; its clicks never reach the row handler.
          const label = this.element('label', 'catalogue-select-label')
          label.addEventListener('click', (event) => event.stopPropagation())
          const checkbox = this.element('input', 'catalogue-select-checkbox'); checkbox.type = 'checkbox'; checkbox.dataset.rowAction = 'select'
          checkbox.addEventListener('change', () => this.callbacks.onToggleWorkingSelection(row.catalogId))
          const labelText = this.element('span', 'sr-only'); labelText.textContent = text().catalogue.keepInWorkingSelection(row.name)
          label.append(checkbox, labelText); cell.append(label)
        } else if (key === 'name') {
          const name = this.element('button', 'catalogue-row-name'); name.type = 'button'; name.textContent = row.name; name.dataset.rowAction = 'focus'
          name.setAttribute('aria-controls', 'catalogue-panel-details')
          cell.append(name)
          if (row.internationalDesignator) { const designator = this.element('span', 'catalogue-row-designator'); designator.textContent = row.internationalDesignator; cell.append(designator) }
        } else if (key === 'status') {
          const inScene = this.element('span', 'catalogue-in-scene'); inScene.textContent = text().catalogue.inScene; inScene.hidden = true
          const compare = this.element('button', 'action-button catalogue-compare-button'); compare.type = 'button'; compare.dataset.rowAction = 'compare'
          compare.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks.onToggleCompare(row.catalogId, row.name) })
          cell.append(inScene, compare)
        } else {
          cell.dataset.label = this.head.querySelector<HTMLElement>(`th[data-column="${key}"]`)?.textContent ?? ''
          cell.textContent = rowValue(row, key)
          if (key === 'launch-date' || key === 'epoch') cell.classList.add('catalogue-wide-only')
        }
        tr.append(cell)
      }
      this.applyRowState(tr)
      this.body.append(tr)
    }
    if (focusKey) {
      const [catalogId, action] = focusKey.split('/')
      const row = [...this.body.querySelectorAll<HTMLTableRowElement>('tr[data-catalog-id]')].find((candidate) => candidate.dataset.catalogId === catalogId)
      row?.querySelector<HTMLElement>(`[data-row-action="${action}"]`)?.focus()
    }
  }

  private applyRowState(row: HTMLTableRowElement): void {
    const catalogId = row.dataset.catalogId!
    const name = row.dataset.name ?? catalogId
    const state = this.rowState
    const focused = state.focusedId === catalogId
    row.classList.toggle('is-focused-record', focused)
    const nameButton = row.querySelector<HTMLElement>('.catalogue-row-name')
    if (focused) nameButton?.setAttribute('aria-current', 'true'); else nameButton?.removeAttribute('aria-current')
    const inScene = row.querySelector<HTMLElement>('.catalogue-in-scene'); if (inScene) inScene.hidden = !state.sceneCatalogIds.has(catalogId)
    const checkbox = row.querySelector<HTMLInputElement>('.catalogue-select-checkbox'); if (checkbox) checkbox.checked = state.workingSelectionIds.has(catalogId)
    const compare = row.querySelector<HTMLButtonElement>('.catalogue-compare-button')
    if (!compare) return
    compare.hidden = !state.compareAvailable
    const compared = state.comparedIds.includes(catalogId)
    const full = !compared && state.comparedIds.length >= MAX_COMPARED_RECORDS
    const t = text().catalogue
    const label = compared ? t.removeFromComparison : full ? t.comparisonFull : t.compare
    compare.textContent = label
    compare.setAttribute('aria-label', t.labelledAction(label, name))
    compare.disabled = full
  }

  private buildOptions(fieldset: HTMLElement, type: 'checkbox' | 'radio', name: string, values: readonly string[]): OptionControl[] {
    return values.map((value) => {
      const wrapper = this.element('label', 'catalogue-filter-option')
      const input = this.element('input'); input.type = type; input.name = name; input.value = value; input.id = `${name}-${value}`
      // Worded on the first render, from the model; the raw key is never shown.
      const label = this.element('span')
      wrapper.append(input, label); fieldset.append(wrapper)
      return { value, input, label }
    })
  }

  private renderOptions(key: 'typeCategories' | 'primaryOrbitClasses' | 'requiredFlags' | 'sgp4Regime', options: readonly FilterOptionModel<string>[]): void {
    for (const control of this.options.get(key) ?? []) {
      const model = options.find((item) => item.value === control.value); if (!model) continue
      control.input.checked = model.checked; control.input.disabled = model.disabled
      if (control.label.textContent !== model.label) control.label.textContent = model.label
    }
  }

  private renderCountryOptions(options: readonly FilterOptionModel<string>[]): void {
    const values = options.map((option) => option.value).join('\u0000')
    if (values !== this.countryValues) {
      this.country.textContent = ''
      for (const option of options) this.addOption(this.country, option.label, option.value)
      this.countryValues = values
    }
    for (const [index, option] of options.entries()) {
      const element = this.country.options[index]
      if (element) { element.textContent = option.label; element.disabled = option.disabled }
    }
    this.country.value = options.find((option) => option.checked)?.value ?? ''
  }

  private setInputValue(input: HTMLInputElement, value: string): void {
    if (this.root.ownerDocument.activeElement !== input && input.value !== value) input.value = value
  }

  private addOption(select: HTMLSelectElement, text: string, value: string): void {
    const option = this.root.ownerDocument.createElement('option'); option.textContent = text; option.value = value; select.append(option)
  }

  private element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const element = this.root.ownerDocument.createElement(tag); if (className) element.className = className; return element
  }
}

function rowValue(row: CatalogueResultRow, key: string): string {
  switch (key) {
    case 'catalog-id': return row.catalogId
    case 'object-type': return row.objectType
    case 'orbit-class': return row.orbitClass
    case 'launch-date': return row.launchDate
    case 'epoch': return row.epoch
    default: return ''
  }
}

function parseYear(value: string): number | null { return /^\d+$/.test(value) ? Number(value) : null }
