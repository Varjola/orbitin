import { expect, it } from 'vitest'
import { catalogueReviewMarkup } from './CatalogueReviewView.ts'
import viewSource from './CatalogueReviewView.ts?raw'

const CATALOGUE_REVIEW_MARKUP = catalogueReviewMarkup()

const tag = (id: string) => CATALOGUE_REVIEW_MARKUP.match(new RegExp(`<[a-z0-9]+ id="${id}"[^>]*>`))?.[0] ?? ''

it('uses an associated tablist for stable Details, Working selection and Compare panels', () => {
  expect(tag('catalogue-review-tabs')).toContain('role="tablist"')
  const tabs = [['catalogue-tab-details', 'catalogue-panel-details', 'true'], ['catalogue-tab-selection', 'catalogue-panel-selection', 'false'], ['catalogue-tab-compare', 'catalogue-panel-compare', 'false']] as const
  expect([...CATALOGUE_REVIEW_MARKUP.matchAll(/role="tab"/g)]).toHaveLength(3)
  expect(CATALOGUE_REVIEW_MARKUP.indexOf('catalogue-tab-details')).toBeLessThan(CATALOGUE_REVIEW_MARKUP.indexOf('catalogue-tab-selection'))
  expect(CATALOGUE_REVIEW_MARKUP.indexOf('catalogue-tab-selection')).toBeLessThan(CATALOGUE_REVIEW_MARKUP.indexOf('catalogue-tab-compare'))
  expect(CATALOGUE_REVIEW_MARKUP).toMatch(/>Working selection</)
  for (const [tab, panel, selected] of tabs) {
    expect(tag(tab)).toMatch(new RegExp(`role="tab" aria-selected="${selected}" aria-controls="${panel}" tabindex="${selected === 'true' ? '0' : '-1'}"`))
    expect(tag(panel)).toMatch(new RegExp(`role="tabpanel" aria-labelledby="${tab}"`))
  }
  expect(CATALOGUE_REVIEW_MARKUP).toMatch(/>Compare \(0\/4\)</)
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) expect(viewSource).toContain(`'${key}'`)
})

it('announces detail loading politely and never switches tabs from background comparison updates', () => {
  expect(tag('catalogue-review-status')).toContain('role="status"')
  const setComparison = viewSource.slice(viewSource.indexOf('  setComparison('), viewSource.indexOf('  showComparison('))
  expect(setComparison).not.toContain('activateTab')
  expect(viewSource).not.toMatch(/CatalogueClient|loadRecord|resolveRecords|addCatalogueRecordsToScene/)
})

it('names the focused object in the Details heading and keeps the single-record epoch option', () => {
  expect(viewSource).toContain("heading.id = 'catalogue-details-heading'; heading.tabIndex = -1; heading.textContent = content.name")
  expect(CATALOGUE_REVIEW_MARKUP).toMatch(/Go to element epoch after adding<\/span><input id="catalogue-epoch-toggle" type="checkbox" checked>/)
})

it('updates the working selection tray without switching tabs; only the explicit header action opens it', () => {
  const setWorkingSelection = viewSource.slice(viewSource.indexOf('  setWorkingSelection('), viewSource.indexOf('  showWorkingSelection('))
  expect(setWorkingSelection).not.toContain('activateTab')
  expect(viewSource).toContain("showWorkingSelection(): void { this.activateTab('selection', true) }")
})

it('announces comparison counts and new failures, and names every per-column action', () => {
  expect(tag('catalogue-review-alert')).toContain('role="alert"')
  expect(viewSource).toContain('this.announce(catalogueComparisonCountStatus(')
  expect(viewSource).toContain("retry.setAttribute('aria-label', t.retryLoading(column.name))")
  expect(viewSource).toContain("remove.setAttribute('aria-label', t.labelledAction(t.removeFromComparison, column.name))")
  expect(viewSource).toContain("add.setAttribute('aria-label', t.labelledAction(label, add.dataset.name ?? add.dataset.catalogId ?? ''))")
  // Each column offers only its own single-record add; there is no add-all.
  expect(viewSource).not.toMatch(/Add all|Add compared|onAddToScene\(this\.(scene\.)?compar/)
})

it('keeps focus on a stable Compare control across background re-renders, removal and Clear', () => {
  const render = viewSource.slice(viewSource.indexOf('  private renderComparison('), viewSource.indexOf('  private comparisonFocusTarget('))
  expect(render.indexOf('const restore = this.comparisonFocusTarget()')).toBeLessThan(render.indexOf("this.compareBody.textContent = ''"))
  expect(render.match(/if \(restore\) this\.restoreComparisonFocus\(restore\)/g)).toHaveLength(2)
  expect(viewSource).toContain('comparisonFocusCandidates(target,')
  // Only focus that was inside the hidden Details panel moves to the Compare tab.
  const show = viewSource.slice(viewSource.indexOf('  showComparison('), viewSource.indexOf('  setWorkingSelection('))
  expect(show).toContain("this.activateTab('compare', active !== null && this.panels.details.contains(active))")
})
