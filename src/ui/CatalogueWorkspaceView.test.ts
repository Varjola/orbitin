import { expect, it } from 'vitest'
import { catalogueWorkspaceMarkup } from './CatalogueWorkspaceView.ts'
import { catalogueFullSearchMarkup } from './CatalogueResultsView.ts'
import workspaceSource from './CatalogueWorkspaceView.ts?raw'
import shellSource from './AppShellView.ts?raw'

const order = (markup: string, ...tokens: string[]) => tokens.map((token) => markup.indexOf(token))
const CATALOGUE_WORKSPACE_MARKUP = catalogueWorkspaceMarkup()
const CATALOGUE_FULL_SEARCH_MARKUP = catalogueFullSearchMarkup()

it('is a labelled modal dialog whose Close button is first, followed by the full search', () => {
  expect(workspaceSource).toContain("setAttribute('role', 'dialog')")
  expect(workspaceSource).toContain("setAttribute('aria-modal', 'true')")
  expect(workspaceSource).toContain("setAttribute('aria-labelledby', 'catalogue-workspace-heading')")
  const firstControl = CATALOGUE_WORKSPACE_MARKUP.search(/<(button|input|select|a)\b/)
  expect(CATALOGUE_WORKSPACE_MARKUP.slice(firstControl)).toMatch(/^<button id="catalogue-workspace-close"/)
  // Search mounts before refresh, Explore, Results and Review in DOM order.
  const positions = order(CATALOGUE_WORKSPACE_MARKUP, 'catalogue-workspace-close', 'catalogue-find-mount', 'catalogue-refresh', 'catalogue-discovery-region', 'catalogue-page-region', 'catalogue-results-region', 'catalogue-review-region')
  expect(positions.every((position) => position >= 0)).toBe(true)
  expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  expect(CATALOGUE_FULL_SEARCH_MARKUP).toMatch(/<input id="catalogue-search" type="search"/)
})

it('keeps freshness, warning and attribution visible in the workspace', () => {
  for (const id of ['catalogue-status', 'catalogue-warning', 'catalogue-attribution', 'catalogue-scope']) expect(CATALOGUE_WORKSPACE_MARKUP).toContain(`id="${id}"`)
  expect(CATALOGUE_WORKSPACE_MARKUP).toMatch(/id="catalogue-notice"[^>]*role="alert"/)
})

it('wraps Tab inside the workspace, closes on Escape and makes the background shell inert', () => {
  expect(workspaceSource).toMatch(/event\.key === 'Escape' && !event\.defaultPrevented/)
  expect(workspaceSource).toMatch(/event\.key !== 'Tab'/)
  expect(workspaceSource).toContain('last.focus()')
  expect(workspaceSource).toContain('first.focus()')
  expect(shellSource).toMatch(/toggleAttribute\('inert', model\.catalogueWorkspace\.open\)/)
})

it('restores a connected, visible invoker and otherwise reports failure for the launcher fallback', () => {
  expect(workspaceSource).toMatch(/active !== this\.root\.ownerDocument\.body/)
  expect(workspaceSource).toMatch(/!target\.isConnected\) return false/)
})

it('switches to Compare only on an explicit add and never loads records itself', () => {
  const toggle = workspaceSource.slice(workspaceSource.indexOf('private toggleComparison'), workspaceSource.indexOf('private syncRowState'))
  expect(toggle.indexOf('this.review.showComparison()')).toBeGreaterThan(toggle.indexOf('if (ids.length >= MAX_COMPARED_RECORDS) return'))
  expect(workspaceSource).not.toMatch(/CatalogueClient|loadRecord|resolveRecords|addCatalogueRecordsToScene/)
})

it('shows the working-selection count in the header after search and announces count changes without moving focus', () => {
  const markup = CATALOGUE_WORKSPACE_MARKUP
  expect(markup.indexOf('catalogue-find-mount')).toBeLessThan(markup.indexOf('catalogue-working-selection-button'))
  expect(markup).toMatch(/id="catalogue-working-selection-button"[^>]*aria-controls="catalogue-panel-selection"/)
  expect(markup).toMatch(/<p id="catalogue-selection-count-status" class="sr-only" role="status">/)
  const sync = workspaceSource.slice(workspaceSource.indexOf('  private syncWorkingSelection('), workspaceSource.indexOf('  private renderAttribution('))
  expect(sync).toContain('!snapshotChanged')
  expect(sync).not.toMatch(/\.focus\(/)
  expect(sync).toContain('(catalogId) => this.entries.get(catalogId)')
})
