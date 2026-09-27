import { expect, it } from 'vitest'
import { buildAutomaticSnapshotFixture } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { FEATURED_PICKS } from '../data/featuredPicks.ts'
import { OFFICIAL_GROUP_BUNDLES } from '../data/officialGroups/index.ts'
import { localDevelopmentRecords } from './catalogueFixtureFetch.ts'

it('gives the local development catalogue every official group member and featured pick', () => {
  const fixture = buildAutomaticSnapshotFixture({ syntheticRecords: localDevelopmentRecords() })
  const ids = new Set((fixture.index.entries as { catalogId: string }[]).map((entry) => entry.catalogId))
  for (const bundle of OFFICIAL_GROUP_BUNDLES) for (const id of bundle.group.membership.catalogIds) expect(ids.has(id), `${bundle.group.id} ${id}`).toBe(true)
  for (const pick of FEATURED_PICKS) expect(ids.has(pick.catalogId), pick.id).toBe(true)
  // Every synthetic record says so in its name.
  for (const entry of fixture.index.entries as { catalogId: string; name: string }[]) if (ids.has(entry.catalogId) && Number(entry.catalogId) < 900000) expect(entry.name).toMatch(/^SYNTHETIC /)
})
