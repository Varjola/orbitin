import { afterAll, bench, describe } from 'vitest'
import { EMPTY_CATALOGUE_QUERY, runCatalogueQuery, type CatalogueQuery, type CatalogueQueryProfile } from '../data/catalogueQuery.ts'
import { preparedFacetRows } from '../data/catalogueQuery.ts'
import { preparedSearchTexts, searchCatalogue } from '../data/catalogueSearch.ts'
import { generateCatalogueIndex } from '../test-fixtures/generatedCatalogueIndex.ts'

const entries = generateCatalogueIndex().entries
const automaticProfile: CatalogueQueryProfile = { mode: 'automatic', contractVersion: 1 }
const referenceUnixMs = Date.parse('2026-09-20T12:00:00Z')
const fullQuery: CatalogueQuery = {
  ...EMPTY_CATALOGUE_QUERY,
  text: 'fixture',
  typeCategories: ['payload'],
  primaryOrbitClasses: ['low-earth'],
  sort: 'name',
}
const benchmarkOptions = { time: 0, iterations: 20, warmupIterations: 5 } as const
const currentResultEntries = runCatalogueQuery(entries, EMPTY_CATALOGUE_QUERY, { referenceUnixMs, profile: automaticProfile, limit: 100 }).entries
const measuredSamples = new Map<string, number[]>()

/** The earlier result-row work currently assembles one article per entry. This
 *  string equivalent keeps the benchmark independent of a browser DOM while
 *  retaining the same fields and 100-row window. */
function renderCurrentResultRows(): string {
  return currentResultEntries.map((entry) => `<article class="catalogue-result"><strong>${entry.name}</strong><span>NORAD ${entry.catalogId}${entry.internationalDesignator ? ` · ${entry.internationalDesignator}` : ''} · epoch ${entry.epochUtc}</span></article>`).join('')
}

function measuredBench(name: string, operation: () => void): void {
  bench(name, () => {
    const started = performance.now()
    operation()
    const samples = measuredSamples.get(name) ?? []
    samples.push(performance.now() - started)
    measuredSamples.set(name, samples)
  }, benchmarkOptions)
}

describe('catalogue operations baseline (40,000 synthetic entries)', () => {
  measuredBench('prepared text and facet construction', () => {
    const freshEntries = entries.slice()
    preparedSearchTexts(freshEntries)
    preparedFacetRows(freshEntries)
  })

  measuredBench('common-text query', () => {
    searchCatalogue(entries, { query: 'fixture payload', group: null, limit: 8 })
  })

  measuredBench('exact-id query', () => {
    searchCatalogue(entries, { query: '100000', group: null, limit: 8 })
  })

  measuredBench('full faceted text/type/class/sort query', () => {
    runCatalogueQuery(entries, fullQuery, { referenceUnixMs, profile: automaticProfile, limit: 100 })
  })

  measuredBench('current 100-result row render payload', () => {
    renderCurrentResultRows()
  })
})

afterAll(() => {
  for (const [name, allSamples] of measuredSamples) {
    const samples = allSamples.slice(-benchmarkOptions.iterations).sort((a, b) => a - b)
    const median = samples[Math.ceil(samples.length * 0.5) - 1]
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1]
    console.log(`[M0 samples] ${name}: samples=${samples.length} median=${median.toFixed(3)}ms p95=${p95.toFixed(3)}ms`)
  }
})
