import type { PrimaryOrbitClass } from './catalogueEnrichment.ts'
import type { CatalogueObjectTypeCategory } from './catalogueSourceRecord.ts'

export type CatalogueDiscoveryPageKind = 'educational-view' | 'official-system'

export type CatalogueDiscoveryMembership =
  | {
      readonly kind: 'index-query'
      readonly typeCategories?: readonly CatalogueObjectTypeCategory[]
      readonly primaryOrbitClasses?: readonly PrimaryOrbitClass[]
    }
  | { readonly kind: 'official-group'; readonly groupId: string }

export interface CatalogueDiscoveryPage {
  readonly id: string
  readonly kind: CatalogueDiscoveryPageKind
  readonly title: string
  readonly summary: string
  readonly whyItMatters?: string
  readonly membership: CatalogueDiscoveryMembership
}

/** Reviewed broad views shipped with the application. Counts and membership
 * facts are deliberately absent: the current loaded index supplies them. */
export const CATALOGUE_DISCOVERY_PAGES: readonly CatalogueDiscoveryPage[] = [
  {
    id: 'low-earth-orbit', kind: 'educational-view', title: 'Low Earth orbit',
    summary: 'Explore objects travelling relatively close to Earth, where orbital periods are short and the catalogue is especially dense.',
    whyItMatters: 'Low Earth orbit is home to many observation, science and communications missions.',
    membership: { kind: 'index-query', primaryOrbitClasses: ['low-earth'] },
  },
  {
    id: 'medium-earth-orbit', kind: 'educational-view', title: 'Medium Earth orbit',
    summary: 'Browse the region between low Earth and geosynchronous orbit, including long-lived navigation and communications paths.',
    membership: { kind: 'index-query', primaryOrbitClasses: ['medium-earth'] },
  },
  {
    id: 'geosynchronous-orbit', kind: 'educational-view', title: 'Geosynchronous orbit',
    summary: 'Find objects whose orbital period is close to Earth’s rotation, including geostationary-like spacecraft.',
    whyItMatters: 'A geosynchronous object can revisit the same longitude on a predictable schedule.',
    membership: { kind: 'index-query', primaryOrbitClasses: ['geosynchronous'] },
  },
  {
    id: 'highly-elliptical-orbits', kind: 'educational-view', title: 'Highly elliptical orbits',
    summary: 'Compare objects that spend very different amounts of time near and far from Earth on elongated paths.',
    membership: { kind: 'index-query', primaryOrbitClasses: ['highly-elliptical'] },
  },
  {
    id: 'rocket-bodies', kind: 'educational-view', title: 'Rocket bodies',
    summary: 'Browse launch hardware that remains represented in the tracked catalogue after supporting a mission.',
    membership: { kind: 'index-query', typeCategories: ['rocket-body'] },
  },
  {
    id: 'debris', kind: 'educational-view', title: 'Debris',
    summary: 'Explore catalogued debris and compare the orbital regions where it is currently represented.',
    membership: { kind: 'index-query', typeCategories: ['debris'] },
  },
]

export function catalogueDiscoveryPage(id: string, pages: readonly CatalogueDiscoveryPage[] = CATALOGUE_DISCOVERY_PAGES): CatalogueDiscoveryPage | undefined {
  return pages.find((page) => page.id === id)
}

export function validateCatalogueDiscoveryPage(page: CatalogueDiscoveryPage): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.id) || page.title.trim() === '' || page.summary.trim() === '') throw new Error('Invalid catalogue Discovery Page identity or copy.')
  if (page.kind === 'official-system' && page.membership.kind !== 'official-group') throw new Error(`Official Discovery Page ${page.id} must reference an official group.`)
  if (page.kind === 'educational-view' && page.membership.kind !== 'index-query') throw new Error(`Educational Discovery Page ${page.id} must use an index query.`)
  if (page.membership.kind === 'official-group') {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.membership.groupId)) throw new Error(`Discovery Page ${page.id} references an invalid group id.`)
    return
  }
  const typeCount = page.membership.typeCategories?.length ?? 0
  const classCount = page.membership.primaryOrbitClasses?.length ?? 0
  if ((typeCount === 0) === (classCount === 0) || typeCount > 0 && classCount > 0) throw new Error(`Discovery Page ${page.id} must declare exactly one non-empty index membership field.`)
  if (new Set(page.membership.typeCategories ?? []).size !== typeCount || new Set(page.membership.primaryOrbitClasses ?? []).size !== classCount) throw new Error(`Discovery Page ${page.id} repeats a membership value.`)
}

export function validateCatalogueDiscoveryPages(pages: readonly CatalogueDiscoveryPage[]): void {
  const ids = new Set<string>()
  for (const page of pages) {
    validateCatalogueDiscoveryPage(page)
    if (ids.has(page.id)) throw new Error(`Duplicate Discovery Page id ${page.id}.`)
    ids.add(page.id)
  }
}

validateCatalogueDiscoveryPages(CATALOGUE_DISCOVERY_PAGES)
