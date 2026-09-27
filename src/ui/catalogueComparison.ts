import { automaticRecordMetadata } from '../data/catalogueProfile.ts'
import type { CatalogueRecordV1 } from '../data/catalogueSchema.ts'
import type { CatalogueFailure } from '../data/catalogueFailure.ts'
import { format, text } from '../i18n/index.ts'

export { MAX_COMPARED_RECORDS } from '../state/catalogueWorkspaceState.ts'

export type CatalogueComparisonItem =
  | { readonly catalogId: string; readonly name: string; readonly state: 'loading' }
  | { readonly catalogId: string; readonly name: string; readonly state: 'loaded'; readonly record: CatalogueRecordV1 }
  | { readonly catalogId: string; readonly name: string; readonly state: 'error'; readonly failure: CatalogueFailure }

export interface ComparisonTable {
  readonly columns: readonly { readonly catalogId: string; readonly name: string; readonly state: 'loading' | 'loaded' | 'error'; readonly failure?: CatalogueFailure }[]
  readonly rows: readonly { readonly label: string; readonly values: readonly string[] }[]
}

const MISSING = '—'

export function buildComparisonTable(items: readonly CatalogueComparisonItem[]): ComparisonTable {
  const t = text().comparison
  const kilometres = text().recordDetails.kilometres
  const minutes = text().recordDetails.minutes
  const rows: readonly (readonly [string, (record: CatalogueRecordV1) => string | undefined])[] = [
    [t.objectType, (record) => automaticRecordMetadata(record)?.source.object.type],
    [t.country, (record) => automaticRecordMetadata(record)?.source.object.countryOrSourceCode],
    [t.launchDate, (record) => automaticRecordMetadata(record)?.source.object.launchDate],
    [t.primaryOrbitClass, (record) => { const value = automaticRecordMetadata(record)?.derived.orbit.primaryOrbitClass; return value ? text().catalogue.orbitClasses[value] : undefined }],
    [t.perigeeAltitude, (record) => numeric(record, (item) => item.derived.orbit.perigeeAltitudeKm, 0, kilometres)],
    [t.apogeeAltitude, (record) => numeric(record, (item) => item.derived.orbit.apogeeAltitudeKm, 0, kilometres)],
    [t.recoveredPeriod, (record) => numeric(record, (item) => item.derived.orbit.recoveredPeriodMinutes, 2, minutes)],
    [t.inclination, (record) => `${fixed(record.INCLINATION, 2)}°`],
    [t.eccentricity, (record) => fixed(record.ECCENTRICITY, 7)],
    [t.elementEpoch, (record) => record.EPOCH],
  ]
  return {
    columns: items.map((item) => ({ catalogId: item.catalogId, name: item.name, state: item.state, ...(item.state === 'error' ? { failure: item.failure } : {}) })),
    rows: rows.map(([label, read]) => ({ label, values: items.map((item) => item.state === 'loaded' && automaticRecordMetadata(item.record) ? read(item.record) ?? MISSING : MISSING) })),
  }
}

/** The Compare panel control that held focus before a re-render. */
export interface ComparisonFocusTarget {
  readonly action: string
  readonly catalogId: string | null
  /** Column position of `catalogId` before the re-render, or -1. */
  readonly column: number
}

/** Ordered places to put focus back after the Compare panel re-renders for a
 *  background load, a retry, a removal or Clear. The same control wins; a
 *  retried column falls back to its Remove; a removed column falls back to
 *  its neighbour's Remove. An empty list means focus the Compare tab. */
export function comparisonFocusCandidates(target: ComparisonFocusTarget, comparedIds: readonly string[]): readonly { readonly action: string; readonly catalogId: string | null }[] {
  if (comparedIds.length === 0) return []
  if (target.catalogId === null) return [{ action: target.action, catalogId: null }]
  if (comparedIds.includes(target.catalogId)) return [{ action: target.action, catalogId: target.catalogId }, { action: 'compare-remove', catalogId: target.catalogId }]
  const neighbour = comparedIds[Math.min(Math.max(target.column, 0), comparedIds.length - 1)]
  return [{ action: 'compare-remove', catalogId: neighbour }]
}

function numeric(record: CatalogueRecordV1, read: (metadata: ReturnType<typeof automaticRecordMetadata> & object) => number, digits: number, unit: (value: string) => string): string {
  const metadata = automaticRecordMetadata(record)
  if (!metadata) return MISSING
  return unit(fixed(read(metadata as ReturnType<typeof automaticRecordMetadata> & object), digits))
}

function fixed(value: number, digits: number): string { return Number.isFinite(value) ? format().number(value, digits) : '' }
