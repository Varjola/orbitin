import { automaticSearchProjection } from './catalogueProfile.ts'
import { aliasMatches } from './searchAliases.ts'
import { normalizeSearchText, type CatalogueSearchEntryV1 } from './catalogueSchema.ts'
import type { AltitudeBand, PrimaryOrbitClass, Sgp4Regime } from './catalogueEnrichment.ts'
import type { CatalogueObjectTypeCategory } from './catalogueSourceRecord.ts'

export interface CatalogueSearchOptions {
  readonly query: string
  readonly group: string | null
  readonly limit?: number
  /** `names` ranks reviewed common names (aliases), whole names
   *  and name prefixes above other substring matches. The default keeps
   *  index order within the id tiers. */
  readonly ranking?: 'index' | 'names'
}

export interface CatalogueSearchResult {
  readonly entries: readonly CatalogueSearchEntryV1[]
  readonly totalMatches: number
  readonly hasMore: boolean
}

/** Rendering and safety cap; not a catalogue size limit. */
export const MAX_CATALOGUE_RESULTS = 100
/** Quick Search shows a fixed, bounded result set. */
export const QUICK_SEARCH_RESULT_LIMIT = 8

/** Search text for one index entry, prepared once per index.
 *
 * `text` holds free-text fields - name, catalogue id and designator - matched
 * as substrings, as before. `keywords` holds the automatic-profile source codes,
 * launch date, derived classification vocabulary and element epoch, each word
 * preceded by a marker and matched only at the start of a word. That keeps a
 * query such as `2020` matching a launch year without matching every element
 * epoch (`epoch-2026-...`), and `polar` matching near-polar without matching
 * inside unrelated codes. A legacy entry has no keywords beyond its epoch:
 * missing metadata creates no token. */
export interface PreparedCatalogueSearchText {
  readonly text: string
  readonly keywords: string
}

export interface CompiledTextQuery {
  readonly terms: readonly string[]
  readonly keywordTerms: readonly string[]
  /** Canonical numeric id for a single all-digit term, else null. */
  readonly idQuery: string | null
}

export type TextMatch = 'exact-id' | 'id-prefix' | 'text' | null

const FIELD = '\u0000'
const WORD = '\u0001'

const TYPE_CATEGORY_WORDS: Readonly<Record<CatalogueObjectTypeCategory, string>> = {
  payload: 'payload', 'rocket-body': 'rocket-body rocket body', debris: 'debris', unknown: 'unknown-type',
}
const PRIMARY_CLASS_WORDS: Readonly<Record<PrimaryOrbitClass, string>> = {
  geosynchronous: 'geosynchronous geo', 'highly-elliptical': 'highly-elliptical highly elliptical heo',
  'low-earth': 'low-earth low earth leo', 'medium-earth': 'medium-earth medium earth meo', 'high-earth': 'high-earth high earth', 'crossing-bands': 'crossing-bands crossing',
}
const BAND_WORDS: Readonly<Record<AltitudeBand, string>> = {
  'low-earth': 'low-earth leo', 'medium-earth': 'medium-earth meo', 'high-earth': 'high-earth', 'crossing-bands': 'crossing-bands',
}
const REGIME_WORDS: Readonly<Record<Sgp4Regime, string>> = { 'near-earth': 'near-earth', 'deep-space': 'deep-space deep space' }

export function prepareCatalogueSearchText(entry: CatalogueSearchEntryV1): PreparedCatalogueSearchText {
  const text = [entry.normalizedName, entry.catalogId, normalizeSearchText(entry.internationalDesignator ?? '')].join(FIELD)
  const words: string[] = [`epoch-${entry.epochUtc.slice(0, 10)}`]
  const projection = automaticSearchProjection(entry)
  if (projection) {
    const { source, derived } = projection
    if (source.type !== undefined) words.push(normalizeSearchText(source.type))
    if (source.typeCategory !== undefined) words.push(TYPE_CATEGORY_WORDS[source.typeCategory])
    if (source.countryOrSourceCode !== undefined) words.push(normalizeSearchText(source.countryOrSourceCode))
    if (source.launchDate !== undefined) words.push(source.launchDate)
    words.push(PRIMARY_CLASS_WORDS[derived.primaryOrbitClass], BAND_WORDS[derived.altitudeBand], REGIME_WORDS[derived.sgp4Regime])
    if (derived.nearPolar) words.push('near-polar polar')
    if (derived.nearEquatorial) words.push('near-equatorial equatorial')
    if (derived.highEccentricity) words.push('high-eccentricity eccentric')
    if (derived.nearGeosynchronous) words.push('near-geosynchronous')
    if (derived.geoLike) words.push('geo-like')
  }
  return { text, keywords: words.join(' ').split(' ').filter(Boolean).map((word) => `${WORD}${word}`).join('') }
}

const prepared = new WeakMap<readonly CatalogueSearchEntryV1[], readonly PreparedCatalogueSearchText[]>()

/** Prepared search text for a decoded index, built on first use and kept for
 *  that index array's lifetime. */
export function preparedSearchTexts(entries: readonly CatalogueSearchEntryV1[]): readonly PreparedCatalogueSearchText[] {
  let texts = prepared.get(entries)
  if (!texts) { texts = entries.map(prepareCatalogueSearchText); prepared.set(entries, texts) }
  return texts
}

export function compileTextQuery(query: string): CompiledTextQuery {
  const normalized = normalizeSearchText(query)
  const terms = normalized.split(' ').filter(Boolean)
  return {
    terms,
    keywordTerms: terms.map((term) => `${WORD}${term}`),
    idQuery: terms.length === 1 && /^\d+$/.test(normalized) ? normalized.replace(/^0+(?=\d)/, '') : null,
  }
}

/** Null when an entry does not match. An empty query matches everything as
 * `text`, which is the same lowest relevance tier used by today's search. */
export function matchCatalogueText(
  compiled: CompiledTextQuery,
  entry: CatalogueSearchEntryV1,
  prepared: PreparedCatalogueSearchText,
): TextMatch {
  if (compiled.terms.length === 0) return 'text'
  if (compiled.idQuery !== null && entry.catalogId.includes(compiled.idQuery)) {
    if (entry.catalogId === compiled.idQuery) return 'exact-id'
    if (entry.catalogId.startsWith(compiled.idQuery)) return 'id-prefix'
    return 'text'
  }
  for (let index = 0; index < compiled.terms.length; index += 1) {
    if (!prepared.text.includes(compiled.terms[index]) && !prepared.keywords.includes(compiled.keywordTerms[index])) return null
  }
  return 'text'
}

/** Pure, local, deterministic. Every query term must match some field. Exact
 *  catalogue-id matches rank first, then id prefixes, then index order. With
 *  `ranking: 'names'` (Quick Search), reviewed common names follow the exact
 *  id, and whole names and name prefixes rank above other substrings, so
 *  `ISS` finds the station before `ISS DEB`. */
export function searchCatalogue(entries: readonly CatalogueSearchEntryV1[], options: CatalogueSearchOptions): CatalogueSearchResult {
  const compiled = compileTextQuery(options.query)
  const group = options.group
  const limit = Math.max(1, Math.min(MAX_CATALOGUE_RESULTS, options.limit ?? MAX_CATALOGUE_RESULTS))

  if (compiled.terms.length === 0) {
    const matches: CatalogueSearchEntryV1[] = []
    let totalMatches = 0
    for (const entry of entries) {
      if (group && !entry.groups.includes(group)) continue
      totalMatches += 1
      if (matches.length < limit) matches.push(entry)
    }
    return { entries: matches, totalMatches, hasMore: totalMatches > limit }
  }

  const texts = preparedSearchTexts(entries)
  const names = options.ranking === 'names'
  const aliases = names ? aliasMatches(options.query) : new Map<string, number>()
  const query = compiled.terms.join(' ')
  const exact: CatalogueSearchEntryV1[] = []
  const aliased: CatalogueSearchEntryV1[] = []
  const prefix: CatalogueSearchEntryV1[] = []
  const wholeName: CatalogueSearchEntryV1[] = []
  const namePrefix: CatalogueSearchEntryV1[] = []
  const other: CatalogueSearchEntryV1[] = []
  let total = 0
  for (let position = 0; position < entries.length; position += 1) {
    const entry = entries[position]
    if (group && !entry.groups.includes(group)) continue
    const match = matchCatalogueText(compiled, entry, texts[position])
    // A reviewed common name finds its object even where the published name
    // does not contain the words (Hubble is published as HST).
    if (match === 'exact-id') { total += 1; exact.push(entry); continue }
    if (aliases.has(entry.catalogId)) { total += 1; aliased.push(entry); continue }
    if (match === null) continue
    total += 1
    if (match === 'id-prefix') { if (prefix.length <= limit) prefix.push(entry) }
    else if (names && entry.normalizedName === query) { if (wholeName.length <= limit) wholeName.push(entry) }
    else if (names && entry.normalizedName.startsWith(query)) { if (namePrefix.length <= limit) namePrefix.push(entry) }
    else if (other.length <= limit) other.push(entry)
  }
  aliased.sort((a, b) => aliases.get(a.catalogId)! - aliases.get(b.catalogId)!)
  const ranked = [...exact, ...aliased, ...prefix, ...wholeName, ...namePrefix, ...other]
  return { entries: ranked.slice(0, limit), totalMatches: total, hasMore: total > limit }
}

/** The bounded whole-index text/identity path used by Quick Search. It has no
 * group or full-query filter input, so a caller cannot accidentally inherit
 * hidden workspace filters. An empty value intentionally has no results: the
 * compact search surface closes before calling this path for empty input. */
export function runQuickCatalogueQuery(entries: readonly CatalogueSearchEntryV1[], text: string, limit = QUICK_SEARCH_RESULT_LIMIT): CatalogueSearchResult {
  if (normalizeSearchText(text) === '') return { entries: [], totalMatches: 0, hasMore: false }
  return searchCatalogue(entries, { query: text, group: null, limit, ranking: 'names' })
}

export function sortCatalogueEntries(entries: readonly CatalogueSearchEntryV1[]): CatalogueSearchEntryV1[] {
  return [...entries].sort((a, b) => a.normalizedName.localeCompare(b.normalizedName, 'en') || a.catalogId.localeCompare(b.catalogId, 'en'))
}
