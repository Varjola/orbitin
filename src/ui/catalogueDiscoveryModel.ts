import { automaticSearchProjection } from '../data/catalogueProfile.ts'
import { catalogueGroupById, EMPTY_CATALOGUE_GROUP_DEFINITIONS, type CatalogueGroupDefinitionSet } from '../data/catalogueGroups.ts'
import { CATALOGUE_DISCOVERY_PAGES, type CatalogueDiscoveryPage } from '../data/catalogueDiscoveryPages.ts'
import type { PrimaryOrbitClass } from '../data/catalogueEnrichment.ts'
import type { CatalogueSearchEntryV1 } from '../data/catalogueSchema.ts'
import type { CatalogueObjectTypeCategory } from '../data/catalogueSourceRecord.ts'
import { text } from '../i18n/index.ts'
import { catalogueGroupMissingMembersNote, catalogueScopeSummary, legacyGroupLabel } from './catalogueWording.ts'

/** Index facts are language-free: words are chosen when presented, so a
 *  cached membership survives a language change. */
export interface CatalogueDiscoveryFactItem {
  readonly value: string
  readonly count: number
}

export interface CatalogueDiscoveryFact {
  readonly key: 'object-type' | 'orbit-class'
  readonly items: readonly CatalogueDiscoveryFactItem[]
}

export interface CatalogueDiscoveryMembershipModel {
  readonly page: CatalogueDiscoveryPage
  readonly supported: boolean
  readonly catalogIds: readonly string[]
  readonly missingCatalogIds: readonly string[]
  readonly memberCount: number
  readonly facts: readonly CatalogueDiscoveryFact[]
  readonly group: CatalogueGroupDefinitionSet['groups'][number] | null
  /** Revision of the injected definition set that supplied `group`. */
  readonly groupRevision: string | null
}

export interface CatalogueDiscoveryNavigationItem {
  readonly page: CatalogueDiscoveryPage
  readonly supported: boolean
  readonly memberCount: number | null
}

/** A page's words in the active language: reviewed pages by id, else the
 *  page's own data (an injected page the catalogue does not know yet). */
export function discoveryPageText(page: CatalogueDiscoveryPage): { readonly title: string; readonly summary: string; readonly whyItMatters: string | null } {
  const reviewed = text().discovery[page.id]
  return reviewed ?? { title: page.title, summary: page.summary, whyItMatters: page.whyItMatters ?? null }
}

/** Resolve a page strictly from the loaded index and injected group contract.
 * No record or shard information participates in this computation. */
export function resolveDiscoveryMembership(
  page: CatalogueDiscoveryPage,
  entries: readonly CatalogueSearchEntryV1[],
  groupDefinitions: CatalogueGroupDefinitionSet = EMPTY_CATALOGUE_GROUP_DEFINITIONS,
  profile: 'automatic' | 'legacy' | null = null,
): CatalogueDiscoveryMembershipModel {
  if (page.membership.kind === 'official-group') {
    const group = catalogueGroupById(page.membership.groupId, groupDefinitions) ?? null
    if (group === null) return { page, supported: false, catalogIds: [], missingCatalogIds: [], memberCount: 0, facts: [], group: null, groupRevision: null }
    const reviewed = new Set(group.membership.catalogIds)
    const members = entries.filter((entry) => reviewed.has(entry.catalogId))
    const present = new Set(members.map((entry) => entry.catalogId))
    const missingCatalogIds = group.membership.catalogIds.filter((catalogId) => !present.has(catalogId))
    return { page, supported: true, catalogIds: members.map((entry) => entry.catalogId), missingCatalogIds, memberCount: members.length, facts: buildFacts(members, page), group, groupRevision: groupDefinitions.revision }
  }

  const automatic = profile === null ? entries.length === 0 || entries.every((entry) => entry.src !== undefined && entry.drv !== undefined) : profile === 'automatic'
  if (!automatic) return { page, supported: false, catalogIds: [], missingCatalogIds: [], memberCount: 0, facts: [], group: null, groupRevision: null }
  const members = entries.filter((entry) => matchesIndexMembership(entry, page))
  return { page, supported: true, catalogIds: members.map((entry) => entry.catalogId), missingCatalogIds: [], memberCount: members.length, facts: buildFacts(members, page), group: null, groupRevision: null }
}

/** Presentation-ready navigation cards. Unsupported broad pages are omitted by
 * default for legacy snapshots; supported zero-member automatic pages remain. */
export function buildCatalogueDiscoveryNavigationModel(
  entries: readonly CatalogueSearchEntryV1[],
  pages: readonly CatalogueDiscoveryPage[] = CATALOGUE_DISCOVERY_PAGES,
  groupDefinitions: CatalogueGroupDefinitionSet = EMPTY_CATALOGUE_GROUP_DEFINITIONS,
  profile: 'automatic' | 'legacy' | null = null,
): CatalogueDiscoveryNavigationItem[] {
  return pages.map((page) => {
    const membership = resolveDiscoveryMembership(page, entries, groupDefinitions, profile)
    return { page, supported: membership.supported, memberCount: membership.supported ? membership.memberCount : null }
  }).filter((item) => item.supported)
}

export function buildCatalogueDiscoveryPageModels(
  entries: readonly CatalogueSearchEntryV1[],
  pages: readonly CatalogueDiscoveryPage[] = CATALOGUE_DISCOVERY_PAGES,
  groupDefinitions: CatalogueGroupDefinitionSet = EMPTY_CATALOGUE_GROUP_DEFINITIONS,
  profile: 'automatic' | 'legacy' | null = null,
): readonly CatalogueDiscoveryMembershipModel[] {
  return pages.map((page) => resolveDiscoveryMembership(page, entries, groupDefinitions, profile)).filter((model) => model.supported)
}

function matchesIndexMembership(entry: CatalogueSearchEntryV1, page: CatalogueDiscoveryPage): boolean {
  const projection = automaticSearchProjection(entry)
  if (!projection || page.membership.kind !== 'index-query') return false
  if (page.membership.typeCategories && page.membership.typeCategories.length > 0) return page.membership.typeCategories.includes(projection.source.typeCategory!)
  return page.membership.primaryOrbitClasses?.includes(projection.derived.primaryOrbitClass!) ?? false
}

function buildFacts(members: readonly CatalogueSearchEntryV1[], page: CatalogueDiscoveryPage): readonly CatalogueDiscoveryFact[] {
  if (page.membership.kind !== 'index-query') return []
  if (page.membership.primaryOrbitClasses && page.membership.primaryOrbitClasses.length > 0) {
    const counts = countValues(members, (entry) => automaticSearchProjection(entry)?.source.typeCategory ?? null)
    return counts.length === 0 ? [] : [{ key: 'object-type', items: counts.map(([value, count]) => ({ value, count })) }]
  }
  const counts = countValues(members, (entry) => automaticSearchProjection(entry)?.derived.primaryOrbitClass ?? null)
  return counts.length === 0 ? [] : [{ key: 'orbit-class', items: counts.map(([value, count]) => ({ value, count })) }]
}

function countValues(members: readonly CatalogueSearchEntryV1[], read: (entry: CatalogueSearchEntryV1) => string | null): readonly [string, number][] {
  const counts = new Map<string, number>()
  for (const entry of members) {
    const value = read(entry)
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
}

export interface CatalogueDiscoveryCardModel {
  readonly id: string
  readonly kind: CatalogueDiscoveryPage['kind']
  readonly title: string
  readonly summary: string
  readonly kindLabel: string
  readonly countLabel: string
  readonly active: boolean
}

export interface CatalogueDiscoveryActivePageModel {
  readonly id: string
  readonly title: string
  readonly kindLabel: string
  readonly summary: string
  readonly whyItMatters: string | null
  readonly memberCountLabel: string
  readonly facts: readonly { readonly label: string; readonly text: string }[]
  /** Official-system pages only: who reviewed the membership, from what, when,
   *  and which definition revision is in use. */
  readonly provenance: CatalogueDiscoveryProvenanceModel | null
  /** Reviewed members absent from the current index are reported, never shown as records. */
  readonly missingMembersNote: string | null
  /** Official-group pages only: the present members, in reviewed order, for Add all. */
  readonly groupAdd: { readonly groupId: string; readonly memberIds: readonly string[] } | null
}

export interface CatalogueDiscoveryProvenanceModel {
  readonly rows: readonly { readonly label: string; readonly text: string }[]
  readonly sourceUrl: string | null
}

export interface CatalogueDiscoveryPresentation {
  readonly mode: 'automatic' | 'legacy'
  readonly cards: readonly CatalogueDiscoveryCardModel[]
  readonly active: CatalogueDiscoveryActivePageModel | null
  readonly legacyGroups: readonly { readonly id: string; readonly label: string; readonly active: boolean }[]
  /** Short Browse all introduction for a legacy snapshot without groups. */
  readonly legacyIntro: string | null
  readonly scopeSummary: string
}

/** Presentation for the Explore area. Copy comes from the reviewed page
 * definitions; every number comes from the supplied current-index membership. */
export function buildCatalogueDiscoveryPresentation(input: {
  readonly mode: 'automatic' | 'legacy'
  readonly navigation: readonly CatalogueDiscoveryNavigationItem[]
  readonly active: CatalogueDiscoveryMembershipModel | null
  readonly legacyGroups: readonly { readonly id: string; readonly label: string }[]
  readonly activeLegacyGroup: string | null
}): CatalogueDiscoveryPresentation {
  const t = text().catalogue
  const activeId = input.active?.supported ? input.active.page.id : null
  const legacy = input.mode === 'legacy'
  const legacyGroups = legacy ? input.legacyGroups.map((group) => ({ id: group.id, label: legacyGroupLabel(group.id, group.label), active: group.id === input.activeLegacyGroup })) : []
  const active = input.active?.supported ? input.active : null
  const activeText = active === null ? null : discoveryPageText(active.page)
  return {
    mode: input.mode,
    cards: input.navigation.filter((item) => item.supported).map((item) => {
      const page = discoveryPageText(item.page)
      return {
        id: item.page.id, kind: item.page.kind, title: page.title, summary: page.summary,
        kindLabel: t.kinds[item.page.kind], countLabel: t.objectCount(item.memberCount ?? 0), active: item.page.id === activeId,
      }
    }),
    active: active === null || activeText === null ? null : {
      id: active.page.id, title: activeText.title, kindLabel: t.kinds[active.page.kind],
      summary: activeText.summary, whyItMatters: activeText.whyItMatters,
      memberCountLabel: t.inCurrentCatalogue(active.memberCount),
      facts: active.facts.map((fact) => ({ label: fact.key === 'object-type' ? t.typeComposition : t.classComposition, text: fact.items.map((item) => t.factItem(factItemLabel(fact.key, item.value), item.count)).join(' · ') })),
      provenance: active.group === null ? null : buildProvenance(active.group, active.groupRevision),
      missingMembersNote: active.group === null ? null : catalogueGroupMissingMembersNote(active.missingCatalogIds),
      groupAdd: active.group === null ? null : { groupId: active.group.id, memberIds: active.group.membership.catalogIds.filter((id) => active.catalogIds.includes(id)) },
    },
    legacyGroups,
    legacyIntro: legacy && legacyGroups.length === 0 ? t.legacyIntro : null,
    scopeSummary: catalogueScopeSummary(activeText, legacyGroups.find((group) => group.active)?.label ?? null),
  }
}

function factItemLabel(key: CatalogueDiscoveryFact['key'], value: string): string {
  const t = text().catalogue
  return key === 'object-type' ? t.compositionTypes[value as CatalogueObjectTypeCategory] : t.compositionClasses[value as PrimaryOrbitClass]
}

function buildProvenance(group: NonNullable<CatalogueDiscoveryMembershipModel['group']>, revision: string | null): CatalogueDiscoveryProvenanceModel {
  const t = text().catalogue
  // The authority is a proper name; the reviewed description is translated by group id.
  const rows: { label: string; text: string }[] = [
    { label: t.provenance.authority, text: group.provenance.authority },
    { label: t.provenance.source, text: text().groups.official[group.id]?.sourceDescription ?? group.provenance.sourceDescription },
    { label: t.provenance.reviewed, text: t.provenanceDate(group.provenance.reviewedAtUtc.slice(0, 10)) },
  ]
  if (revision !== null) rows.push({ label: t.provenance.revision, text: revision })
  return { rows, sourceUrl: group.provenance.sourceUrl ?? null }
}
