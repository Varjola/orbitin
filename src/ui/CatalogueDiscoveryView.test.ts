import { expect, it } from 'vitest'
import { catalogueDiscoveryMarkup, catalogueDiscoveryPageMarkup } from './CatalogueDiscoveryView.ts'
import viewSource from './CatalogueDiscoveryView.ts?raw'

const CATALOGUE_DISCOVERY_MARKUP = catalogueDiscoveryMarkup()
const CATALOGUE_DISCOVERY_PAGE_MARKUP = catalogueDiscoveryPageMarkup()

it('offers Explore entry points and Browse all, and a separate active page header for the results column', () => {
  expect(CATALOGUE_DISCOVERY_MARKUP).toMatch(/<h3 id="catalogue-explore-heading">Explore<\/h3>/)
  expect(CATALOGUE_DISCOVERY_MARKUP).toMatch(/<button id="catalogue-browse-all"[^>]*>Browse all objects<\/button>/)
  expect(CATALOGUE_DISCOVERY_MARKUP).toMatch(/<ul id="catalogue-explore-list"[^>]*aria-labelledby="catalogue-explore-heading"/)
  expect(CATALOGUE_DISCOVERY_PAGE_MARKUP).toMatch(/<section id="catalogue-active-page"[^>]*aria-labelledby="catalogue-active-page-heading" hidden>/)
  expect(CATALOGUE_DISCOVERY_MARKUP).not.toContain('catalogue-active-page')
})

it('renders supplied membership only; it never decides membership from page ids or loads records', () => {
  expect(viewSource).not.toMatch(/low-earth|rocket-bod|debris|resolveDiscoveryMembership|automaticSearchProjection/)
  expect(viewSource).not.toMatch(/CatalogueClient|loadRecord|resolveRecords/)
  expect(viewSource).toContain("setAttribute('aria-current', 'true')")
})

it('shows official-group provenance, missing members and the whole-group add', () => {
  expect(CATALOGUE_DISCOVERY_PAGE_MARKUP).toMatch(/<p id="catalogue-active-page-missing" class="time-note" hidden>/)
  expect(CATALOGUE_DISCOVERY_PAGE_MARKUP).toMatch(/<div id="catalogue-active-page-provenance"[^>]*hidden>\s*<h4 id="catalogue-active-page-provenance-heading">Membership provenance<\/h4>/)
  expect(CATALOGUE_DISCOVERY_PAGE_MARKUP).toMatch(/<a id="catalogue-active-page-source"[^>]*target="_blank" rel="noopener noreferrer" hidden>Membership source reference<\/a>/)
  // The whole-group add section is hidden until an official-group page with
  // present members is active; the Explore list has no add control.
  expect(CATALOGUE_DISCOVERY_PAGE_MARKUP).toMatch(/<div id="catalogue-group-add" class="catalogue-group-add" hidden>/)
  expect(CATALOGUE_DISCOVERY_MARKUP).not.toMatch(/Add|scene|select all/i)
  // It never reaches the catalogue working selection or the add paths directly.
  expect(viewSource).not.toMatch(/AddToScene|addCatalogue|WorkingSelection/)
  expect(viewSource).toContain('onAddGroup')
})
