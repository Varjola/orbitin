/** The Orbitin catalogue definitions.
 *
 * These are the application's own educational selections. They are deliberately
 * not a copy of any provider's group taxonomy: an upstream provider decides what
 * a "group" means for its own users, and that is an ingestion detail, not part
 * of this project's teaching model. A catalogue here answers "what should a
 * learner be able to find, and what does it teach", and the provider layer is
 * then asked only for the resulting catalogue identifiers.
 *
 *     Orbitin catalogue
 *             ↓ selection definition
 *     catalogue identifiers
 *             ↓ one batched provider query
 *     current GP/OMM records
 *
 * Membership is static: an explicit reviewed list of objects, revised by a
 * maintainer rather than derived from a live query. That keeps every scheduled
 * run bounded and identical in cost, keeps the published catalogue small enough
 * to search entirely in the browser, and means a provider change cannot quietly
 * alter what the application teaches. The cost is that membership ages; the
 * review procedure lives in the operator guide.
 *
 * `designator` is the COSPAR international designator recorded when the member
 * was chosen, and ingestion refuses any record whose `OBJECT_ID` disagrees with
 * it. A catalogue identifier alone is a number that could be mistyped into a
 * different object entirely; the designator makes that mistake loud instead of
 * silent. `name` is documentation for whoever reviews this list - provider
 * naming conventions differ, so it is never used for matching. */

export interface CatalogueMember {
  readonly catalogId: string
  readonly designator: string
  readonly name: string
}

export interface CatalogueDefinition {
  readonly id: string
  readonly title: string
  /** What a learner is meant to get from this catalogue. Published in the
   *  manifest so a snapshot explains itself. */
  readonly purpose: string
  readonly membership: 'static' | 'query-derived'
  /** Human-readable description of how membership is defined. It carries no
   *  provider query syntax. */
  readonly selection: string
  readonly members: readonly CatalogueMember[]
}

export const CATALOGUE_DEFINITIONS: readonly CatalogueDefinition[] = [
  {
    id: 'space-stations',
    title: 'Crewed space stations',
    purpose: 'Low Earth orbit at human scale: two inhabited stations in different inclinations, with short periods and fast, frequently visible ground tracks.',
    membership: 'static',
    selection: 'The core module of each currently inhabited space station. Visiting vehicles are excluded because their catalogue membership changes weekly and would make the published catalogue unstable.',
    members: [
      { catalogId: '25544', designator: '1998-067A', name: 'ISS (ZARYA)' },
      { catalogId: '48274', designator: '2021-035A', name: 'CSS (TIANHE)' },
    ],
  },
  {
    id: 'navigation',
    title: 'Navigation constellations',
    purpose: 'Semi-synchronous medium Earth orbit: near-circular orbits around 55° inclination whose periods divide the day, giving repeating ground tracks and putting the propagator into its deep-space regime.',
    membership: 'static',
    selection: 'A representative sample of each of the four global navigation constellations rather than a whole constellation, so that differences in period and inclination are visible without downloading dozens of near-identical objects.',
    members: [
      { catalogId: '43873', designator: '2018-109A', name: 'NAVSTAR 77 (USA 289)' },
      { catalogId: '44506', designator: '2019-056A', name: 'NAVSTAR 78 (USA 293)' },
      { catalogId: '55268', designator: '2023-009A', name: 'NAVSTAR 82 (USA 343)' },
      { catalogId: '49810', designator: '2021-116B', name: 'GSAT0224 (GALILEO 28)' },
      { catalogId: '67160', designator: '2025-302A', name: 'GSAT0233 (GALILEO 33)' },
      { catalogId: '44864', designator: '2019-090A', name: 'BEIDOU-3 M19' },
      { catalogId: '58654', designator: '2023-207A', name: 'BEIDOU-3 M28' },
      { catalogId: '54031', designator: '2022-130A', name: 'COSMOS 2559 [GLONASS-K]' },
      { catalogId: '54377', designator: '2022-161A', name: 'COSMOS 2564 [GLONASS-M]' },
      // Deliberately included: a catalogue identifier past the legacy five-digit
      // limit, so the post-five-digit path is exercised by real published data
      // rather than only by fixtures.
      { catalogId: '100460', designator: '2026-194A', name: 'COSMOS 2619 [GLONASS-K1]' },
    ],
  },
  {
    id: 'earth-observation',
    title: 'Earth observation and weather',
    purpose: 'The two ways of watching Earth continuously: sun-synchronous polar orbits whose planes precess with the seasons, and geostationary orbits that hold one longitude. Sun-synchronous members connect directly to the nodal-precession model.',
    membership: 'static',
    selection: 'Operational civil Earth-observation and meteorological payloads chosen to contrast sun-synchronous, non-sun-synchronous polar, inclined ocean-altimetry and geostationary regimes.',
    members: [
      { catalogId: '27424', designator: '2002-022A', name: 'AQUA' },
      { catalogId: '37849', designator: '2011-061A', name: 'SUOMI NPP' },
      { catalogId: '43689', designator: '2018-087A', name: 'METOP-C' },
      { catalogId: '39084', designator: '2013-008A', name: 'LANDSAT 8' },
      { catalogId: '49260', designator: '2021-088A', name: 'LANDSAT 9' },
      { catalogId: '40697', designator: '2015-028A', name: 'SENTINEL-2A' },
      { catalogId: '43613', designator: '2018-070A', name: 'ICESAT-2' },
      { catalogId: '46984', designator: '2020-086A', name: 'SENTINEL-6A' },
      { catalogId: '51850', designator: '2022-021A', name: 'GOES 18' },
      { catalogId: '60133', designator: '2024-119A', name: 'GOES 19' },
      { catalogId: '54743', designator: '2022-170C', name: 'METEOSAT-12 (MTG-I1)' },
      { catalogId: '41836', designator: '2016-064A', name: 'HIMAWARI-9' },
    ],
  },
  {
    id: 'space-science',
    title: 'Space science observatories',
    purpose: 'Orbits chosen for what an instrument needs rather than for looking at the ground: near-equatorial low orbits, and highly eccentric orbits that spend most of their period far above the radiation belts.',
    membership: 'static',
    selection: 'Long-running astrophysics observatories whose orbits span the range from a nearly circular equatorial low orbit to an eccentricity above 0.7.',
    members: [
      { catalogId: '20580', designator: '1990-037B', name: 'HST' },
      { catalogId: '28485', designator: '2004-047A', name: 'SWIFT' },
      { catalogId: '33053', designator: '2008-029A', name: 'FGRST (GLAST)' },
      { catalogId: '38358', designator: '2012-031A', name: 'NUSTAR' },
      { catalogId: '49954', designator: '2021-121A', name: 'IXPE' },
      { catalogId: '25867', designator: '1999-040B', name: 'CXO' },
      { catalogId: '25989', designator: '1999-066A', name: 'XMM-NEWTON' },
    ],
  },
]

/** The union every scheduled run asks the provider for, as one sorted,
 *  deduplicated list. An object may belong to more than one catalogue without
 *  being requested twice. */
export const CATALOGUE_SELECTION_IDS: readonly string[] = [...new Set(CATALOGUE_DEFINITIONS.flatMap((definition) => definition.members.map((member) => member.catalogId)))]
  .sort((a, b) => (a.length - b.length) || a.localeCompare(b, 'en'))

/** Expected designator for a selected identifier, or `undefined` when the
 *  identifier is not part of any catalogue. */
export const EXPECTED_DESIGNATORS: ReadonlyMap<string, string> = new Map(
  CATALOGUE_DEFINITIONS.flatMap((definition) => definition.members.map((member) => [member.catalogId, member.designator] as const)),
)

const CATALOGUE_ID = /^[a-z0-9-]{1,40}$/
const CATALOG_NUMBER = /^[1-9]\d{0,8}$/
const DESIGNATOR = /^\d{4}-\d{3}[A-Z]{1,3}$/

/** Structural invariants of the definitions above.
 *
 * These are properties of hand-maintained configuration, so they are checked
 * rather than assumed: a duplicated identifier inside one catalogue, a
 * malformed identifier or two catalogues claiming one object under different
 * designators would all corrupt a published snapshot in ways that are much
 * harder to diagnose later. */
export function catalogueDefinitionProblems(definitions: readonly CatalogueDefinition[] = CATALOGUE_DEFINITIONS): readonly string[] {
  const problems: string[] = []
  const seenCatalogueIds = new Set<string>()
  const designators = new Map<string, string>()
  if (definitions.length === 0) problems.push('At least one catalogue must be defined.')
  for (const definition of definitions) {
    if (!CATALOGUE_ID.test(definition.id)) problems.push(`Catalogue id ${definition.id} is not a stable lower-case slug.`)
    if (seenCatalogueIds.has(definition.id)) problems.push(`Catalogue id ${definition.id} is defined twice.`)
    seenCatalogueIds.add(definition.id)
    if (definition.title.trim().length === 0) problems.push(`Catalogue ${definition.id} has no title.`)
    if (definition.purpose.trim().length === 0) problems.push(`Catalogue ${definition.id} has no stated educational purpose.`)
    if (definition.selection.trim().length === 0) problems.push(`Catalogue ${definition.id} does not state how membership is defined.`)
    if (definition.members.length === 0) problems.push(`Catalogue ${definition.id} has no members.`)
    const seenMembers = new Set<string>()
    for (const member of definition.members) {
      if (!CATALOG_NUMBER.test(member.catalogId)) problems.push(`Catalogue ${definition.id} member ${member.catalogId} is not a canonical catalogue identifier.`)
      if (!DESIGNATOR.test(member.designator)) problems.push(`Catalogue ${definition.id} member ${member.catalogId} has a malformed international designator.`)
      if (seenMembers.has(member.catalogId)) problems.push(`Catalogue ${definition.id} lists ${member.catalogId} twice.`)
      seenMembers.add(member.catalogId)
      const existing = designators.get(member.catalogId)
      if (existing !== undefined && existing !== member.designator) problems.push(`Catalogue identifier ${member.catalogId} is listed with two different designators.`)
      designators.set(member.catalogId, member.designator)
    }
  }
  return problems
}
