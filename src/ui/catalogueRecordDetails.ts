import { automaticRecordMetadata } from '../data/catalogueProfile.ts'
import type { CatalogueManifestV1, CatalogueRecordV1 } from '../data/catalogueSchema.ts'
import { ageSinceLaunch, elementAgeSeconds, type AltitudeBand, type PrimaryOrbitClass, type Sgp4Regime } from '../data/catalogueEnrichment.ts'
import { ORBIT_FLAGS, type OrbitFlag } from '../data/catalogueQuery.ts'
import { format, text } from '../i18n/index.ts'

export interface DetailRow { readonly label: string; readonly value: string }
export interface DetailGroup { readonly heading: string; readonly note: string | null; readonly rows: readonly DetailRow[] }

export function buildCatalogueRecordDetails(record: CatalogueRecordV1, manifest: CatalogueManifestV1, referenceUnixMs: number): readonly DetailGroup[] {
  const t = text().recordDetails
  const c = text().catalogue
  const f = format()
  const metadata = automaticRecordMetadata(record)
  const identity: DetailRow[] = [
    row(t.name, record.OBJECT_NAME),
    row(t.noradId, record.NORAD_CAT_ID),
    row(t.internationalDesignator, metadata?.source.internationalDesignator ?? record.OBJECT_ID),
    row(t.classification, record.CLASSIFICATION_TYPE),
  ]
  const elementRows: DetailRow[] = [
    row(t.elementEpoch, record.EPOCH),
    { label: t.elementAge, value: elementAgeText(record.EPOCH, referenceUnixMs) },
    { label: t.inclination, value: fixed(record.INCLINATION, 2) },
    { label: t.eccentricity, value: fixed(record.ECCENTRICITY, 7) },
    { label: t.meanMotion, value: fixed(record.MEAN_MOTION, 8) },
    rowNumber(t.revolution, record.REV_AT_EPOCH),
    rowNumber(t.elementSetNumber, record.ELEMENT_SET_NO),
  ]
  const groups: DetailGroup[] = [group(t.identity, null, identity), group(t.elementSet, t.elementSetNote, elementRows)]
  if (metadata) {
    const source = metadata.source
    const object = source.object
    const gp = source.gp
    groups.splice(1, 0, group(t.providerHeading(manifest.provider.name), t.providerNote, [
      row(t.objectType, object.type), row(t.country, object.countryOrSourceCode), row(t.launchDate, object.launchDate),
      row(t.launchSite, object.launchSiteCode), row(t.decayDate, object.decayDate), row(t.rcs, object.rcsSizeCategory),
      rowUnit(t.providerSemimajorAxis, gp.sourceSemimajorAxisKm, t.kilometres), rowUnit(t.providerPeriod, gp.sourcePeriodMinutes, t.minutes),
      rowUnit(t.providerApogee, gp.sourceApogeeAltitudeKm, t.kilometres), rowUnit(t.providerPerigee, gp.sourcePerigeeAltitudeKm, t.kilometres),
      row(t.recordCreated, source.recordProvenance?.createdAtUtc),
    ]))
    const orbit = metadata.derived.orbit
    groups.push(group(t.derivedHeading, t.derivedNote(metadata.derived.rulesVersion), [
      { label: t.recoveredPeriod, value: fixed(orbit.recoveredPeriodMinutes, 2) },
      { label: t.semimajorAxis, value: f.integer(Math.round(orbit.semimajorAxisKm)) },
      { label: t.perigeeAltitude, value: f.integer(Math.round(orbit.perigeeAltitudeKm)) },
      { label: t.apogeeAltitude, value: f.integer(Math.round(orbit.apogeeAltitudeKm)) },
      { label: t.sgp4Regime, value: c.sgp4Regimes[orbit.sgp4Regime as Sgp4Regime] },
      { label: t.altitudeBand, value: t.altitudeBands[orbit.altitudeBand as AltitudeBand] },
      { label: t.primaryOrbitClass, value: c.orbitClasses[orbit.primaryOrbitClass as PrimaryOrbitClass] },
      { label: t.orbitGeometry, value: orbitFlagsText(orbit) },
      rowNumber(t.launchYear, metadata.derived.launchYear, false),
    ]))
    if (object.launchDate !== undefined) groups.push(group(t.timeSinceLaunch, null, [{ label: t.timeSinceLaunch, value: launchAgeText(object.launchDate, referenceUnixMs) }]))
  } else {
    groups.push(group(t.metadata, null, [{ label: t.metadata, value: t.metadataMissing }]))
  }
  return groups.filter((candidate) => candidate.rows.length > 0)
}

function group(heading: string, note: string | null, rows: readonly DetailRow[]): DetailGroup {
  return { heading, note, rows: rows.filter((candidate): candidate is DetailRow => candidate.value !== '') }
}

function row(label: string, value: string | null | undefined): DetailRow { return { label, value: value ?? '' } }
/** A count, grouped; a year is written as a year, without grouping. */
function rowNumber(label: string, value: number | null | undefined, grouped = true): DetailRow {
  return value === null || value === undefined ? { label, value: '' } : { label, value: grouped ? format().integer(value) : String(value) }
}
function rowUnit(label: string, value: number | undefined, unit: (value: string) => string): DetailRow {
  return value === undefined || !Number.isFinite(value) ? { label, value: '' } : { label, value: unit(fixed(value, 3)) }
}

function elementAgeText(epoch: string, referenceUnixMs: number): string {
  const ageDays = elementAgeSeconds(Date.parse(epoch) / 1000, referenceUnixMs / 1000) / 86_400
  return ageDays >= 0 ? text().recordDetails.daysBefore(fixed(ageDays, 1)) : text().recordDetails.daysAfter(fixed(-ageDays, 1))
}

function launchAgeText(launchDate: string, referenceUnixMs: number): string {
  const age = ageSinceLaunch(launchDate, referenceUnixMs / 1000)
  const t = text().recordDetails
  if (age.kind === 'not-yet-launched') return t.notYetLaunched
  return age.approximateDays < 60 ? t.aboutDays(Math.round(age.approximateDays)) : t.aboutYears(Math.round(age.approximateDays / 365.25))
}

function orbitFlagsText(orbit: { readonly nearPolar: boolean; readonly nearEquatorial: boolean; readonly highEccentricity: boolean; readonly nearGeosynchronous: boolean; readonly geoLike: boolean }): string {
  const flags = ORBIT_FLAGS.filter((flag) => orbit[flag as OrbitFlag]).map((flag) => text().catalogue.orbitFlags[flag])
  return flags.length === 0 ? text().recordDetails.noFlags : flags.join(', ')
}

function fixed(value: number, digits: number): string { return Number.isFinite(value) ? format().number(value, digits) : '' }
