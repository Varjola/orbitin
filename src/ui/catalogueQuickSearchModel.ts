import type { CatalogueSearchEntryV1 } from '../data/catalogueSchema.ts'
import { automaticSearchProjection } from '../data/catalogueProfile.ts'
import type { SceneState } from '../state/AppState.ts'
import { MAX_SCENE_OBJECTS } from '../state/sceneActions.ts'
import { catalogueIdOfSceneObject } from '../app/catalogueToScene.ts'
import { text } from '../i18n/index.ts'

/** Index-only identity text for one compact result. Launch date and element
 * epoch are deliberately absent. */
export interface QuickSearchIdentity {
  readonly name: string
  readonly details: readonly string[]
}

export function quickSearchIdentity(entry: CatalogueSearchEntryV1): QuickSearchIdentity {
  const t = text().catalogue
  const details = [t.noradId(entry.catalogId)]
  if (entry.internationalDesignator) details.push(entry.internationalDesignator)
  const projection = automaticSearchProjection(entry)
  if (projection?.source.typeCategory) details.push(t.typeCategories[projection.source.typeCategory])
  if (projection?.derived.primaryOrbitClass) details.push(t.orbitClasses[projection.derived.primaryOrbitClass])
  return { name: entry.name, details }
}

export interface QuickSearchPrimaryAction {
  readonly kind: 'add' | 'select'
  readonly label: string
  readonly accessibleLabel: string
  readonly disabled: boolean
  readonly inScene: boolean
  readonly sceneObjectId: string | null
}

/** The primary action is derived from the Real Objects scene only; it never
 * needs a catalogue record. A full scene disables Add but never Select. */
export function quickSearchPrimaryAction(entry: CatalogueSearchEntryV1, scene: SceneState, pending: boolean): QuickSearchPrimaryAction {
  const t = text().catalogue
  const object = scene.objects.find((candidate) => catalogueIdOfSceneObject(candidate) === entry.catalogId)
  if (object) return { kind: 'select', label: t.selectInScene, accessibleLabel: t.selectNamedInScene(entry.name), disabled: false, inScene: true, sceneObjectId: object.id }
  const full = scene.objects.length >= MAX_SCENE_OBJECTS
  const label = full ? t.sceneFull : pending ? t.adding : t.addToScene
  return { kind: 'add', label, accessibleLabel: full ? t.cannotAdd(entry.name) : t.actionOn(label, entry.name), disabled: full, inScene: false, sceneObjectId: null }
}

export type QuickSearchFocusTarget =
  | { readonly kind: 'input' }
  | { readonly kind: 'result'; readonly index: number }
  | { readonly kind: 'none' }

/** Arrow/Enter focus movement. `from` is null for the input.
 * Movement never mutates catalogue or scene state. */
export function quickSearchKeyTarget(key: string, from: number | null, resultCount: number): QuickSearchFocusTarget {
  if (resultCount === 0) return { kind: 'none' }
  if (from === null) {
    if (key === 'ArrowDown' || key === 'Enter') return { kind: 'result', index: 0 }
    if (key === 'ArrowUp') return { kind: 'result', index: resultCount - 1 }
    return { kind: 'none' }
  }
  if (key === 'ArrowDown') return from + 1 < resultCount ? { kind: 'result', index: from + 1 } : { kind: 'none' }
  if (key === 'ArrowUp') return from > 0 ? { kind: 'result', index: from - 1 } : { kind: 'input' }
  return { kind: 'none' }
}
