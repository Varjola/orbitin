import { expect, it } from 'vitest'
import { catalogueResultsMarkup } from './CatalogueResultsView.ts'
import viewSource from './CatalogueResultsView.ts?raw'

const CATALOGUE_RESULTS_MARKUP = catalogueResultsMarkup()

const tag = (id: string) => CATALOGUE_RESULTS_MARKUP.match(new RegExp(`<[a-z0-9]+ id="${id}"[^>]*>`))?.[0] ?? ''

it('keeps object type and orbit class visible and discloses the remaining filters behind All filters', () => {
  expect(tag('catalogue-type-filter')).toContain('catalogue-visible-filter')
  expect(tag('catalogue-class-filter')).toContain('catalogue-visible-filter')
  expect(tag('catalogue-all-filters-toggle')).toMatch(/aria-expanded="false"[^>]*aria-controls="catalogue-all-filters"/)
  expect(tag('catalogue-all-filters')).toContain('hidden')
  const allFilters = CATALOGUE_RESULTS_MARKUP.slice(CATALOGUE_RESULTS_MARKUP.indexOf('id="catalogue-all-filters"'), CATALOGUE_RESULTS_MARKUP.indexOf('catalogue-results-heading'))
  for (const id of ['catalogue-regime-filter', 'catalogue-flag-filter', 'catalogue-country', 'catalogue-launch-from', 'catalogue-launch-to', 'catalogue-element-age']) expect(allFilters).toContain(`id="${id}"`)
  expect(allFilters).not.toMatch(/perigee|apogee|inclination|eccentricity/i)
})

it('presents a labelled table with a focusable polite count summary and scoped headers', () => {
  expect(tag('catalogue-results-table')).toMatch(/aria-labelledby="catalogue-results-heading"[^>]*aria-describedby="catalogue-summary"/)
  expect(tag('catalogue-summary')).toMatch(/tabindex="-1"[^>]*role="status"/)
  expect(viewSource).toContain("cell.scope = 'col'")
})

it('focuses Details from a name button or the row background, never from a focusable row or row controls', () => {
  expect(viewSource).toContain("name.setAttribute('aria-controls', 'catalogue-panel-details')")
  expect(viewSource).not.toMatch(/tr\.tabIndex|tr\.setAttribute\('tabindex'/)
  expect(viewSource).toMatch(/compare\.addEventListener\('click', \(event\) => \{ event\.stopPropagation\(\)/)
  // Hover and focus movement never select a record.
  expect(viewSource).not.toMatch(/addEventListener\('(mouseover|mouseenter|focus|focusin)'/)
  expect(viewSource).not.toMatch(/CatalogueClient|loadRecord|resolveRecords|addCatalogueRecordsToScene/)
})

it('coalesces control changes into one query per animation frame without a time debounce', () => {
  expect(viewSource).toContain('requestAnimationFrame')
  expect(viewSource).not.toMatch(/setTimeout\([^,]+,\s*[1-9]/)
})

it('gives each row a uniquely labelled working-selection checkbox that only toggles the working selection', () => {
  expect(viewSource).toContain('keepInWorkingSelection(row.name)')
  expect(viewSource).toContain("label.addEventListener('click', (event) => event.stopPropagation())")
  const handler = viewSource.slice(viewSource.indexOf("checkbox.addEventListener('change'"), viewSource.indexOf("const labelText = this.element('span', 'sr-only')"))
  expect(handler.trim()).toBe("checkbox.addEventListener('change', () => this.callbacks.onToggleWorkingSelection(row.catalogId))")
  // No range or bulk selection exists.
  expect(viewSource).not.toMatch(/shiftKey|Select shown|Select all/)
})
