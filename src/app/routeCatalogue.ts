import { catalogueImportProvenance } from '../data/catalogueImport.ts'
import { parseOmmRecord } from '../data/omm.ts'
import type { CatalogueController } from './CatalogueController.ts'
import type { RouteCataloguePort } from './RoutePlannerController.ts'

/** The published catalogue as the Route Planner uses it. Loading is the same lazy
 *  load Real Objects uses, so a catalogue loaded in either mode is loaded in both;
 *  searching leaves Real Objects' search alone. The
 *  catalogue is asked for when used, as the application makes it after the planner. */
export function routeCataloguePort(catalogue: () => Pick<CatalogueController, 'load' | 'snapshot' | 'searchEntries' | 'resolveRecords'>): RouteCataloguePort {
  return {
    async load() {
      await catalogue().load()
      return catalogue().snapshot !== null
    },
    loaded: () => catalogue().snapshot !== null,
    search(text, limit) {
      const found = catalogue().searchEntries(text, limit)
      return { entries: found.entries.map((entry) => ({ catalogId: entry.catalogId, name: entry.name })), hasMore: found.hasMore }
    },
    async record(catalogId) {
      let resolved: Awaited<ReturnType<CatalogueController['resolveRecords']>>
      try {
        resolved = await catalogue().resolveRecords([catalogId])
      } catch {
        return { ok: false, refusal: 'unavailable' }
      }
      const record = resolved.records[0]
      if (record === undefined) return { ok: false, refusal: 'missing' }
      const parsed = parseOmmRecord(record, catalogueImportProvenance(record, resolved.manifest))
      if (!parsed.ok) return { ok: false, refusal: 'noElements' }
      return { ok: true, catalogId: parsed.definition.meanElements.catalogId, name: parsed.definition.name, elements: parsed.definition.meanElements }
    },
  }
}
