import { describe, expect, it } from 'vitest'
import { normalizeCatalogueGroupDefinitionSet, validateCatalogueGroupDefinitionSet } from '../catalogueGroups.ts'
import { CATALOGUE_DISCOVERY_PAGES, validateCatalogueDiscoveryPages } from '../catalogueDiscoveryPages.ts'
import { ORBIT_PRESETS } from '../../simulation/orbitPresets.ts'
import { MAX_SCENE_OBJECTS } from '../../state/sceneActions.ts'
import { officialCatalogueGroupInjection, officialGroupBundle, OFFICIAL_GROUP_BUNDLES } from './index.ts'

/** GPS and the seven other reviewed groups. */
const EXPECTED = {
  'gps-operational': 32, 'galileo-operational': 30, 'glonass-operational': 28, 'beidou-operational': 37,
  'crewed-space-stations': 2, 'geostationary-weather': 15, 'copernicus-sentinels': 11, 'arctic-heo': 2,
}

describe('the official groups', () => {
  it('carries exactly the decided groups, in presentation order, each with its reviewed member count', () => {
    expect(OFFICIAL_GROUP_BUNDLES.map((bundle) => bundle.group.id)).toEqual(Object.keys(EXPECTED))
    for (const bundle of OFFICIAL_GROUP_BUNDLES) expect(bundle.group.membership.catalogIds, bundle.group.id).toHaveLength(EXPECTED[bundle.group.id as keyof typeof EXPECTED])
  })

  it('validates as one definition set whose Discovery Pages all resolve', () => {
    const injection = officialCatalogueGroupInjection()
    const pages = [...CATALOGUE_DISCOVERY_PAGES, ...injection.discoveryPages]
    expect(() => validateCatalogueDiscoveryPages(pages)).not.toThrow()
    expect(() => validateCatalogueGroupDefinitionSet(injection.groupDefinitions, pages)).not.toThrow()
    expect(normalizeCatalogueGroupDefinitionSet(injection.groupDefinitions).groups).toHaveLength(OFFICIAL_GROUP_BUNDLES.length)
  })

  it.each(OFFICIAL_GROUP_BUNDLES.map((bundle) => [bundle.group.id, bundle] as const))('%s is a reviewed, canonical bundle', (_id, bundle) => {
    const ids = bundle.group.membership.catalogIds
    // Canonical ids in numeric order.
    expect([...ids].sort((a, b) => Number(a) - Number(b))).toEqual([...ids])
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[1-9]\d{0,8}$/)
    // Every group fits the scene on its own, so Add all can work.
    expect(ids.length).toBeLessThanOrEqual(MAX_SCENE_OBJECTS)
    // One revision, dated like its review, named in the reviewed description.
    expect(bundle.revision).toMatch(/-\d{4}-\d{2}-\d{2}$/)
    expect(bundle.group.provenance.reviewedAtUtc.slice(0, 10)).toBe(bundle.revision.slice(-10))
    expect(bundle.group.provenance.sourceDescription).toContain(`Revision ${bundle.revision}.`)
    expect(bundle.group.provenance.sourceUrl).toMatch(/^https:\/\//)
    // The page belongs to its group; the education page links public pages and a real example.
    expect(bundle.page).toMatchObject({ id: bundle.group.id, kind: 'official-system', membership: { kind: 'official-group', groupId: bundle.group.id } })
    expect(bundle.education.links.length).toBeGreaterThan(0)
    for (const link of bundle.education.links) expect(link.url).toMatch(/^https?:\/\/[a-z0-9.-]+\//)
    expect(ORBIT_PRESETS.map((preset) => preset.id)).toContain(bundle.education.orbitLabExample)
    expect(officialGroupBundle(bundle.group.id)).toBe(bundle)
  })
})
