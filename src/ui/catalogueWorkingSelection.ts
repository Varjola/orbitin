import type { CatalogueSearchEntryV1 } from '../data/catalogueSchema.ts'
import type { SceneState } from '../state/AppState.ts'
import { buildCatalogueAdditionPreview, catalogueIdOfSceneObject, type CatalogueAdditionPreview } from '../app/catalogueToScene.ts'
import { format, text } from '../i18n/index.ts'

export interface CatalogueWorkingSelectionItem {
  readonly catalogId: string
  readonly name: string
  readonly internationalDesignator: string | null
  readonly inScene: boolean
  readonly sceneId: string | null
}

export interface CatalogueWorkingSelectionModel {
  readonly ids: readonly string[]
  readonly items: readonly CatalogueWorkingSelectionItem[]
  readonly preview: CatalogueAdditionPreview
}

/** Index-only identity lookup; never a shard record. */
export type CatalogueIndexLookup = (catalogId: string) => CatalogueSearchEntryV1 | undefined

export function normalizeWorkingSelectionIds(ids: readonly string[]): readonly string[] {
  const unique: string[] = []
  for (const id of ids) if (id && !unique.includes(id)) unique.push(id)
  return unique
}

export function toggleWorkingSelection(ids: readonly string[], catalogId: string): readonly string[] {
  const current = normalizeWorkingSelectionIds(ids)
  return current.includes(catalogId) ? current.filter((id) => id !== catalogId) : [...current, catalogId]
}

/** Query/filter changes retain selection, while a replaced index can remove
 * ids that no longer exist. The original insertion order is preserved. */
export function reconcileWorkingSelection(ids: readonly string[], available: readonly CatalogueSearchEntryV1[] | ReadonlySet<string>): readonly string[] {
  const availableIds: ReadonlySet<string> = Array.isArray(available)
    ? new Set((available as readonly CatalogueSearchEntryV1[]).map((entry) => entry.catalogId))
    : available as ReadonlySet<string>
  return normalizeWorkingSelectionIds(ids).filter((id) => availableIds.has(id))
}

export function buildCatalogueWorkingSelectionModel(
  ids: readonly string[],
  entries: readonly CatalogueSearchEntryV1[] | CatalogueIndexLookup,
  scene: SceneState,
): CatalogueWorkingSelectionModel {
  const normalized = normalizeWorkingSelectionIds(ids)
  const lookup: CatalogueIndexLookup = typeof entries === 'function' ? entries : lookupFor(entries)
  const sceneByCatalogId = new Map(scene.objects.map((object) => [catalogueIdOfSceneObject(object), object]).filter(([catalogId]) => catalogId !== null) as [string, SceneState['objects'][number]][])
  const items = normalized.flatMap((catalogId) => {
    const entry = lookup(catalogId)
    if (!entry) return []
    const object = sceneByCatalogId.get(catalogId)
    return [{ catalogId, name: entry.name, internationalDesignator: entry.internationalDesignator, inScene: object !== undefined, sceneId: object?.id ?? null }]
  })
  return { ids: normalized, items, preview: buildCatalogueAdditionPreview(scene, normalized) }
}

export interface CatalogueWorkingSelectionFact { readonly key: 'total' | 'present' | 'new' | 'slots'; readonly label: string; readonly value: string }

/** Everything the Working selection panel shows, derived before any record
 *  loads. `canAddAll` drives the add button and the fit/capacity message. */
export interface CatalogueWorkingSelectionPresentation {
  readonly items: readonly CatalogueWorkingSelectionItem[]
  readonly facts: readonly CatalogueWorkingSelectionFact[]
  readonly addLabel: string
  readonly addEnabled: boolean
  /** Polite explanation when adding is possible or unnecessary. */
  readonly message: string | null
  /** Alert when the new records exceed the remaining scene slots. */
  readonly capacityAlert: string | null
  readonly viewSceneVisible: boolean
  readonly clearEnabled: boolean
}

export function buildWorkingSelectionPresentation(model: CatalogueWorkingSelectionModel, pending: boolean): CatalogueWorkingSelectionPresentation {
  const { preview } = model
  const empty = preview.totalSelected === 0
  const nothingNew = !empty && preview.newRecordsToAdd === 0
  const overCapacity = preview.newRecordsToAdd > preview.slotsRemaining
  const t = text().catalogue
  const f = format()
  return {
    items: model.items,
    facts: [
      { key: 'total', label: t.workingSelectionFacts.total, value: f.integer(preview.totalSelected) },
      { key: 'present', label: t.workingSelectionFacts.present, value: f.integer(preview.alreadyInScene) },
      { key: 'new', label: t.workingSelectionFacts.new, value: f.integer(preview.newRecordsToAdd) },
      { key: 'slots', label: t.workingSelectionFacts.slots, value: f.integer(preview.slotsRemaining) },
    ],
    addLabel: pending ? t.addingSelected : nothingNew ? t.alreadyInScene : t.addSelected,
    addEnabled: preview.canAddAll && !pending,
    message: empty ? null : nothingNew ? t.workingSelectionAllInScene : preview.canAddAll ? t.workingSelectionFits(preview.newRecordsToAdd) : null,
    capacityAlert: overCapacity ? t.workingSelectionCapacity(preview.newRecordsToAdd, preview.slotsRemaining) : null,
    viewSceneVisible: preview.alreadyInScene > 0,
    clearEnabled: !empty,
  }
}

function lookupFor(entries: readonly CatalogueSearchEntryV1[]): CatalogueIndexLookup {
  const byId = new Map(entries.map((entry) => [entry.catalogId, entry]))
  return (catalogId) => byId.get(catalogId)
}
