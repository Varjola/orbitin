import type { CatalogueManifestV1, CatalogueRecordV1 } from './catalogueSchema.ts'
import type { CatalogueImportSourceProvenance, OmmProvenance } from './omm.ts'

/** Provenance stored on an object imported from the published catalogue.
 *
 * A shard record does not repeat run-level provenance, so an import from an
 * automatic-profile snapshot combines the manifest's run values with the
 * record's own `CREATION_DATE` and any varying originator. A legacy
 * record keeps exactly its v1 provenance. Catalogue search metadata and derived
 * classifications do not enter application state. */
export function catalogueImportProvenance(record: CatalogueRecordV1, manifest: CatalogueManifestV1): OmmProvenance {
  const base = record.provenance
  const run = manifest.sourceRun
  const profile = manifest.catalogueProfile
  if (base.kind !== 'catalogue' || !run || !profile || !record.source) return base
  const recordProvenance = record.source.recordProvenance
  const automatic: CatalogueImportSourceProvenance = Object.fromEntries(Object.entries({
    sourceAuthority: run.sourceAuthority,
    providerRecordClass: run.providerRecordClass,
    retrievalStartedAtUtc: run.retrievalStartedAtUtc,
    ommVersion: run.ommVersion,
    originator: recordProvenance?.originator ?? run.originator,
    recordCreatedAtUtc: recordProvenance?.createdAtUtc,
    normalizationRulesVersion: profile.normalizationRulesVersion,
    enrichmentRulesVersion: profile.enrichmentRulesVersion,
  }).filter(([, value]) => value !== undefined)) as unknown as CatalogueImportSourceProvenance
  return { ...base, automatic }
}
