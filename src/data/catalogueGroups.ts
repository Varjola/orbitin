import type { CatalogueDiscoveryPage } from './catalogueDiscoveryPages.ts'

export interface CatalogueGroupDefinitionSet {
  readonly schemaVersion: 1
  readonly revision: string
  readonly groups: readonly CatalogueGroupDefinition[]
}

export interface CatalogueGroupDefinition {
  readonly id: string
  readonly kind: 'official-system'
  readonly title: string
  readonly membership: {
    readonly kind: 'reviewed-catalog-ids'
    readonly catalogIds: readonly string[]
  }
  readonly provenance: {
    readonly authority: string
    readonly sourceDescription: string
    readonly sourceUrl?: string
    readonly reviewedAtUtc: string
  }
}

export const EMPTY_CATALOGUE_GROUP_DEFINITIONS: CatalogueGroupDefinitionSet = { schemaVersion: 1, revision: 'empty', groups: [] }

/** Official groups are reviewed bundles under `src/data/officialGroups/`;
 * each needs maintainer-approved membership semantics and evidence. This module
 * stays generic and names none of them. Fixture-only definitions live in
 * `src/test-fixtures/catalogueGroupFixtures.ts`. */

export interface CatalogueGroupInjection {
  readonly groupDefinitions: CatalogueGroupDefinitionSet
  /** Official-system Discovery Pages shipped with their definitions. */
  readonly discoveryPages: readonly CatalogueDiscoveryPage[]
}

/** No official group at all, for tests and callers that need a baseline. */
export const EMPTY_CATALOGUE_GROUP_INJECTION: CatalogueGroupInjection = { groupDefinitions: EMPTY_CATALOGUE_GROUP_DEFINITIONS, discoveryPages: [] }

const GROUP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CATALOG_ID = /^[1-9]\d{0,8}$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const HTTPS = /^https:\/\/[^\s"'<>]{1,200}$/

export function validateCatalogueGroupDefinitionSet(value: unknown, pages: readonly Pick<CatalogueDiscoveryPage, 'membership'>[] = []): asserts value is CatalogueGroupDefinitionSet {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.revision !== 'string' || value.revision.trim() === '' || !Array.isArray(value.groups)) throw new Error('Invalid catalogue group definition set.')
  const groups = value.groups as unknown[]
  const ids = new Set<string>()
  for (const candidate of groups) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || !GROUP_ID.test(candidate.id) || typeof candidate.title !== 'string' || candidate.title.trim() === '' || candidate.kind !== 'official-system') throw new Error('Invalid catalogue group definition.')
    if (ids.has(candidate.id)) throw new Error(`Duplicate catalogue group id ${candidate.id}.`)
    ids.add(candidate.id)
    if (!isRecord(candidate.membership) || candidate.membership.kind !== 'reviewed-catalog-ids' || !Array.isArray(candidate.membership.catalogIds) || candidate.membership.catalogIds.length === 0) throw new Error(`Group ${candidate.id} has invalid membership.`)
    const memberIds = new Set<string>()
    for (const member of candidate.membership.catalogIds) {
      if (typeof member !== 'string' || !CATALOG_ID.test(member)) throw new Error(`Group ${candidate.id} contains a non-canonical catalogue id.`)
      if (memberIds.has(member)) throw new Error(`Group ${candidate.id} repeats catalogue id ${member}.`)
      memberIds.add(member)
    }
    if (!isRecord(candidate.provenance) || typeof candidate.provenance.authority !== 'string' || candidate.provenance.authority.trim() === '' || typeof candidate.provenance.sourceDescription !== 'string' || candidate.provenance.sourceDescription.trim() === '' || typeof candidate.provenance.reviewedAtUtc !== 'string' || !validUtc(candidate.provenance.reviewedAtUtc) || candidate.provenance.sourceUrl !== undefined && (typeof candidate.provenance.sourceUrl !== 'string' || !validUrl(candidate.provenance.sourceUrl))) throw new Error(`Group ${candidate.id} has invalid provenance.`)
  }
  for (const page of pages) if (page.membership.kind === 'official-group' && !ids.has(page.membership.groupId)) throw new Error(`Discovery Page references missing catalogue group ${page.membership.groupId}.`)
}

/** Return a stable, defensive contract after validating the injected values.
 * Group and member ordering is normalized for deterministic presentation while
 * duplicate inputs remain errors rather than being silently discarded. */
export function normalizeCatalogueGroupDefinitionSet(value: CatalogueGroupDefinitionSet): CatalogueGroupDefinitionSet {
  validateCatalogueGroupDefinitionSet(value)
  return {
    schemaVersion: 1,
    revision: value.revision.trim(),
    groups: value.groups.slice().sort((a, b) => a.id.localeCompare(b.id)).map((group) => ({
      id: group.id, kind: 'official-system', title: group.title.trim(),
      membership: { kind: 'reviewed-catalog-ids', catalogIds: group.membership.catalogIds.slice().sort(compareCatalogIds) },
      provenance: {
        authority: group.provenance.authority.trim(), sourceDescription: group.provenance.sourceDescription.trim(),
        ...(group.provenance.sourceUrl === undefined ? {} : { sourceUrl: group.provenance.sourceUrl }),
        reviewedAtUtc: group.provenance.reviewedAtUtc,
      },
    })),
  }
}

export function catalogueGroupById(groupId: string, definitions: CatalogueGroupDefinitionSet): CatalogueGroupDefinition | undefined {
  return definitions.groups.find((group) => group.id === groupId)
}

export function decodeCatalogueGroupDefinitionSet(value: unknown): CatalogueGroupDefinitionSet {
  validateCatalogueGroupDefinitionSet(value)
  return normalizeCatalogueGroupDefinitionSet(value)
}

function compareCatalogIds(left: string, right: string): number {
  const numeric = Number(left) - Number(right)
  return numeric || left.localeCompare(right)
}

function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

function validUrl(value: string): boolean {
  if (!HTTPS.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.length > 0
  } catch {
    return false
  }
}

function validUtc(value: string): boolean {
  if (!UTC.test(value)) return false
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])))
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) && date.getUTCHours() === Number(match[4]) && date.getUTCMinutes() === Number(match[5]) && date.getUTCSeconds() === Number(match[6])
}
