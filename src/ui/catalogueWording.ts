import type { CatalogueManifestV1 } from '../data/catalogueSchema.ts'
import { text } from '../i18n/index.ts'

/** Presentation names for upstream providers recorded in catalogue provenance.
 *
 * This is a display map, not application logic: nothing branches on the value,
 * and an unknown provider id simply shows as itself rather than failing. The
 * browser learns which provider produced a snapshot from that snapshot; it never
 * needs to know which provider the ingestion pipeline is configured to use. */
export function providerDisplayName(providerId: string): string {
  return text().catalogue.providers[providerId] ?? providerId
}

export function catalogueSourceLabel(providerId: string): string {
  return text().catalogue.sourceLabel(providerDisplayName(providerId))
}

/** The visible citation for a published snapshot.
 *
 * Space-Track's blanket redistribution approval for basic SSA data is
 * conditioned on appropriate citation. For a Space-Track snapshot this yields
 * exactly the wording recorded on 2026-09-10 and kept by the 2026-09-13
 * determination: `Orbital data: USSPACECOM / 18th Space Defense Squadron,
 * accessed via Space-Track.org`. The provider and authority come from the
 * snapshot's own manifest rather than from a constant, so a snapshot always
 * carries the citation that belongs to it; only the connecting words are
 * translated. */
export function catalogueAttribution(manifest: CatalogueManifestV1): string {
  return text().catalogue.citation(manifest.provider.sourceAuthority, manifest.provider.name)
}

export interface CatalogueAttributionNotice {
  readonly citation: string
  readonly sourceLink: string
  readonly retrieval: string
  readonly educationalUse: string
  /** Present when the snapshot publishes application-derived metadata. */
  readonly derivedData: string | null
}

/** Citation, retrieval time, educational-use and derived-data statements for
 *  the catalogue panel. `formatUtc` renders an ISO UTC instant. */
export function catalogueAttributionNotice(manifest: CatalogueManifestV1, formatUtc: (isoUtc: string) => string): CatalogueAttributionNotice {
  const t = text().catalogue
  const run = manifest.sourceRun
  const retrieval = run && run.retrievalStartedAtUtc !== run.retrievedAtUtc
    ? t.retrievedBetween(formatUtc(run.retrievalStartedAtUtc), formatUtc(run.retrievedAtUtc))
    : t.retrievedAt(formatUtc(manifest.provider.retrievedAtUtc))
  return {
    citation: catalogueAttribution(manifest),
    sourceLink: manifest.provider.homepage,
    retrieval,
    educationalUse: t.educationalUse,
    derivedData: manifest.catalogueProfile ? t.derivedData : null,
  }
}

/** Whole-group add. */
export const GROUP_ADD_CONFIRMATION_THRESHOLD = 10

const MAX_LISTED_MISSING_MEMBERS = 10
/** Missing reviewed members are named by id only; they never become records. */
export function catalogueGroupMissingMembersNote(missingCatalogIds: readonly string[]): string | null {
  const count = missingCatalogIds.length
  if (count === 0) return null
  const listed = missingCatalogIds.slice(0, MAX_LISTED_MISSING_MEMBERS).map((id) => text().catalogue.noradId(id))
  return text().catalogue.missingMembers(count, listed, Math.max(0, count - MAX_LISTED_MISSING_MEMBERS))
}

/** Honest bounded-window summary. The window is never
 *  implied to scroll beyond the rows actually rendered. */
export function catalogueResultWindowSummary(result: { readonly totalMatches: number; readonly entries: readonly unknown[] }): string {
  const t = text().catalogue
  if (result.totalMatches === 0) return t.noMatches
  return result.entries.length < result.totalMatches ? t.showingSome(result.entries.length, result.totalMatches) : t.showingAll(result.totalMatches)
}

export function catalogueScopeSummary(page: { readonly title: string } | null, legacyGroupLabel: string | null = null): string {
  const t = text().catalogue
  if (page) return t.scopePage(page.title)
  if (legacyGroupLabel) return t.scopeLegacy(legacyGroupLabel)
  return t.allObjects
}

export function catalogueComparisonCountStatus(count: number, max: number): string {
  return count === 0 ? text().catalogue.comparisonCleared : text().catalogue.comparing(count, max)
}

export function quickSearchResultStatus(result: { readonly totalMatches: number; readonly entries: readonly unknown[]; readonly hasMore: boolean }): string {
  const t = text().catalogue
  if (result.totalMatches === 0) return t.quickSearchNone
  if (result.totalMatches === 1) return t.quickSearchOne
  return result.hasMore ? t.quickSearchSome(result.totalMatches, result.entries.length) : t.quickSearchAll(result.totalMatches)
}

export type CatalogueFreshness = 'current' | 'delayed' | 'stale'
/** Wall-clock health of a published snapshot. Distinct from an object's element
 *  age, which is measured against the selected simulation instant. */
export function catalogueFreshness(providerRetrievedAtUtc: string, nowMs: number): CatalogueFreshness {
  const ageHours = Math.max(0, (nowMs - Date.parse(providerRetrievedAtUtc)) / 3_600_000)
  return ageHours <= 18 ? 'current' : ageHours <= 36 ? 'delayed' : 'stale'
}

/** A legacy group's label: the reviewed translation by id, else the label the
 *  Worker published. */
export function legacyGroupLabel(groupId: string, publishedLabel: string): string {
  return text().groups.legacy[groupId] ?? publishedLabel
}

/** An official group's title by id, else the reviewed data title. */
export function officialGroupTitle(groupId: string, dataTitle: string): string {
  return text().groups.official[groupId]?.title ?? dataTitle
}
