import { expect, it } from 'vitest'
import { quickSearchMarkup } from './CatalogueQuickSearchView.ts'
import viewSource from './CatalogueQuickSearchView.ts?raw'

const QUICK_SEARCH_MARKUP = quickSearchMarkup()

const tag = (id: string) => QUICK_SEARCH_MARKUP.match(new RegExp(`<[a-z0-9]+ id="${id}"[^>]*>`))?.[0] ?? ''

it('uses a combobox input controlling a non-modal results dialog', () => {
  const input = tag('catalogue-quick-search')
  expect(input).toContain('role="combobox"')
  expect(input).toContain('aria-expanded="false"')
  expect(input).toContain('aria-controls="catalogue-quick-search-results"')
  expect(input).toContain('aria-haspopup="dialog"')
  expect(input).not.toContain('aria-activedescendant')
  expect(QUICK_SEARCH_MARKUP).toContain('<span class="sr-only">Search catalogue</span>')

  const dialog = tag('catalogue-quick-search-results')
  expect(dialog).toContain('role="dialog"')
  expect(dialog).toContain('aria-labelledby="catalogue-quick-search-heading"')
  expect(dialog).not.toContain('aria-modal')
  expect(QUICK_SEARCH_MARKUP).toMatch(/id="catalogue-quick-search-heading"[^>]*>Quick Search results</)
})

it('renders results as a semantic list with separate live status and alert regions, never a listbox', () => {
  expect(tag('catalogue-quick-search-list').startsWith('<ul ')).toBe(true)
  expect(QUICK_SEARCH_MARKUP).not.toMatch(/listbox|role="option"/)
  expect(viewSource).not.toMatch(/'listbox'|'option'/)
  expect(tag('catalogue-quick-search-status')).toContain('aria-live="polite"')
  expect(tag('catalogue-quick-search-error')).toContain('role="alert"')
  // Footer and no-match copy sit outside the list so the item count is the result count.
  expect(QUICK_SEARCH_MARKUP.indexOf('catalogue-quick-search-footer')).toBeGreaterThan(QUICK_SEARCH_MARKUP.indexOf('</ul>'))
  expect(QUICK_SEARCH_MARKUP.indexOf('catalogue-quick-search-empty')).toBeGreaterThan(QUICK_SEARCH_MARKUP.indexOf('</ul>'))
})

it('stays index-only: the view cannot load records or mutate the scene directly', () => {
  expect(viewSource).not.toMatch(/CatalogueClient|loadRecord|resolveRecords|addCatalogueRecordsToScene/)
  expect(viewSource).toContain('onQuickSearchAddToScene')
  expect(viewSource).not.toContain('onAddToScene(')
})
