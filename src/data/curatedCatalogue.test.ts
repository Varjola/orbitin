import { describe, expect, it } from 'vitest'
import { CURATED_CATALOGUE, curatedGroupMemberIds, curatedSupplementIds } from './curatedCatalogue.ts'
import curatedSource from './curatedCatalogue.ts?raw'
import { FEATURED_PICKS } from './featuredPicks.ts'
import { OFFICIAL_GROUP_BUNDLES, OFFICIAL_GROUPS_REVISION } from './officialGroups/index.ts'

/** Space-Track's batched id query bound (`MAX_BATCHED_CATALOG_IDS`). */
const MAX_SUPPLEMENT_IDS = 500
const CANONICAL = /^[1-9]\d{0,8}$/
const numeric = (ids: readonly string[]) => [...ids].sort((a, b) => Number(a) - Number(b))

describe('the curated catalogue file', () => {
  it('holds canonical ids with no duplicate inside a group or the featured list', () => {
    for (const [id, group] of Object.entries(CURATED_CATALOGUE.groups)) {
      for (const catalogId of group.catalogIds) expect(catalogId, id).toMatch(CANONICAL)
      expect(new Set(group.catalogIds).size, id).toBe(group.catalogIds.length)
    }
    for (const catalogId of CURATED_CATALOGUE.featured) expect(catalogId).toMatch(CANONICAL)
    expect(new Set(CURATED_CATALOGUE.featured).size).toBe(CURATED_CATALOGUE.featured.length)
  })

  it('asks for element sets the ten-day sweep does not already cover, within the batched query bound', () => {
    expect(Number.isInteger(CURATED_CATALOGUE.maxSupplementEpochAgeDays)).toBe(true)
    expect(CURATED_CATALOGUE.maxSupplementEpochAgeDays).toBeGreaterThanOrEqual(11)
    expect(CURATED_CATALOGUE.maxSupplementEpochAgeDays).toBeLessThanOrEqual(60)
    expect(curatedSupplementIds().length).toBeLessThanOrEqual(MAX_SUPPLEMENT_IDS)
  })

  it('has exactly one entry per official group, equal to that group’s bundle', () => {
    expect(Object.keys(CURATED_CATALOGUE.groups)).toEqual(OFFICIAL_GROUP_BUNDLES.map((bundle) => bundle.group.id))
    for (const bundle of OFFICIAL_GROUP_BUNDLES) {
      const entry = CURATED_CATALOGUE.groups[bundle.group.id as keyof typeof CURATED_CATALOGUE.groups]
      expect(bundle.revision, bundle.group.id).toBe(entry.revision)
      expect(bundle.group.membership.catalogIds, bundle.group.id).toEqual(entry.catalogIds)
    }
    expect(OFFICIAL_GROUPS_REVISION).toBe(CURATED_CATALOGUE.officialGroupsRevision)
  })

  it('lists the featured picks in presentation order', () => {
    expect(FEATURED_PICKS.map((pick) => pick.catalogId)).toEqual(CURATED_CATALOGUE.featured)
  })

  it('is data only, so the producer bundle pulls in no frontend code', () => {
    expect(curatedSource).not.toMatch(/^\s*import\b/m)
    expect(curatedSource).not.toMatch(/\bimport\s*\(/)
  })

  it('requests the sorted union of every group member and featured pick', () => {
    const union = new Set<string>([...Object.values(CURATED_CATALOGUE.groups).flatMap((group) => [...group.catalogIds]), ...CURATED_CATALOGUE.featured])
    expect(curatedSupplementIds()).toEqual(numeric([...union]))
    expect(curatedGroupMemberIds()).toEqual(numeric([...new Set(Object.values(CURATED_CATALOGUE.groups).flatMap((group) => [...group.catalogIds]))]))
    // Six-digit ids sort after five-digit ones, as numbers.
    expect(curatedSupplementIds().at(-1)).toBe('100690')
    expect(curatedSupplementIds()[0]).toBe('5')
  })
})
