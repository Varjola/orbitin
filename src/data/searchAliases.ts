import { normalizeSearchText } from './catalogueSchema.ts'
import { BEIDOU_OPERATIONAL_CATALOG_IDS } from './officialGroups/beidouOperational.ts'
import { GALILEO_OPERATIONAL_CATALOG_IDS } from './officialGroups/galileoOperational.ts'
import { GLONASS_OPERATIONAL_CATALOG_IDS } from './officialGroups/glonassOperational.ts'
import { GPS_OPERATIONAL_CATALOG_IDS } from './officialGroups/gpsOperational.ts'

/** Reviewed common names for catalogue objects.
 *
 * The published catalogue names objects as the provider does: the Hubble
 * Space Telescope is `HST`, GLONASS satellites are `COSMOS nnnn`, and the
 * International Space Station shares its prefix with its separately
 * catalogued modules and debris. These aliases let Quick Search find what
 * people type. They are application data, client-side only, and never
 * change the catalogue contract.
 *
 * An alias lists its objects in the order they should appear. */
export interface SearchAlias {
  readonly names: readonly string[]
  readonly catalogIds: readonly string[]
}

export const SEARCH_ALIASES: readonly SearchAlias[] = [
  { names: ['ISS', 'International Space Station', 'Zarya'], catalogIds: ['25544'] },
  { names: ['Space station', 'Space stations'], catalogIds: ['25544', '48274'] },
  { names: ['Tiangong', 'Tianhe', 'CSS', 'China Space Station'], catalogIds: ['48274'] },
  { names: ['Hubble', 'Hubble Space Telescope', 'HST'], catalogIds: ['20580'] },
  { names: ['Landsat'], catalogIds: ['49260', '39084'] },
  { names: ['Landsat 9'], catalogIds: ['49260'] },
  { names: ['Landsat 8'], catalogIds: ['39084'] },
  { names: ['NOAA 20', 'JPSS-1'], catalogIds: ['43013'] },
  { names: ['NOAA 21', 'JPSS-2'], catalogIds: ['54234'] },
  { names: ['GOES'], catalogIds: ['60133', '51850'] },
  { names: ['GOES 19', 'GOES-East'], catalogIds: ['60133'] },
  { names: ['GOES 18', 'GOES-West'], catalogIds: ['51850'] },
  { names: ['Envisat'], catalogIds: ['27386'] },
  { names: ['Terra'], catalogIds: ['25994'] },
  { names: ['Aqua'], catalogIds: ['27424'] },
  { names: ['Vanguard', 'Vanguard 1'], catalogIds: ['5'] },
  { names: ['Molniya'], catalogIds: ['25847'] },
  // Space Norway's Arctic satellites; the aliases also match without the hyphen.
  { names: ['ASBM', 'Arctic Satellite Broadband Mission'], catalogIds: ['60422', '60423'] },
  { names: ['ASBM 1', 'ASBM1'], catalogIds: ['60422'] },
  { names: ['ASBM 2', 'ASBM2'], catalogIds: ['60423'] },
  // Whole navigation systems, in their reviewed rosters (the members' catalogue names often do not say so).
  { names: ['GPS', 'Navstar'], catalogIds: GPS_OPERATIONAL_CATALOG_IDS },
  { names: ['Galileo'], catalogIds: GALILEO_OPERATIONAL_CATALOG_IDS },
  { names: ['GLONASS'], catalogIds: GLONASS_OPERATIONAL_CATALOG_IDS },
  { names: ['BeiDou', 'Compass'], catalogIds: BEIDOU_OPERATIONAL_CATALOG_IDS },
]

/** Letters and digits only, words separated by one space: `GOES-East`,
 *  `goes east` and `Goes  East` share one key. */
export function aliasKey(value: string): string {
  return normalizeSearchText(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

const ALIAS_INDEX: readonly { readonly key: string; readonly catalogIds: readonly string[] }[] = SEARCH_ALIASES.flatMap((alias) => alias.names.map((name) => ({ key: aliasKey(name), catalogIds: alias.catalogIds })))

/** A query's alias matches as catalogue id -> rank (lower first). A whole
 *  alias matches at any length; the start of an alias matches from three
 *  characters, so `hubb` finds Hubble but `is` finds nothing extra. */
export function aliasMatches(query: string): ReadonlyMap<string, number> {
  const key = aliasKey(query)
  const matches = new Map<string, number>()
  if (key === '') return matches
  let rank = 0
  const add = (ids: readonly string[]) => { for (const id of ids) if (!matches.has(id)) matches.set(id, rank++) }
  for (const alias of ALIAS_INDEX) if (alias.key === key) add(alias.catalogIds)
  if (key.length >= 3) for (const alias of ALIAS_INDEX) if (alias.key !== key && alias.key.startsWith(key)) add(alias.catalogIds)
  return matches
}
