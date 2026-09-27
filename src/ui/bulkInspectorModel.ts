import { text } from '../i18n/index.ts'
import type { SceneState } from '../state/AppState.ts'
import { BUDGETED_LAYERS, layerOn, type BudgetedLayer } from '../state/sceneComplexity.ts'

/** The multiple-selection inspector as pure data. */
export const BULK_NAME_LIMIT = 6
export type TriState = 'on' | 'off' | 'mixed'

export interface BulkInspectorModel {
  readonly countLabel: string
  readonly namesLabel: string
  readonly layers: Readonly<Record<BudgetedLayer, TriState>>
  /** The colour every selected object shares, else null (individual colours). */
  readonly commonColorHex: number | null
  readonly ids: readonly string[]
}

export function buildBulkInspectorModel(scene: SceneState): BulkInspectorModel {
  const selected = new Set(scene.selection.ids)
  // Selection order for names, scene order for nothing else.
  const objects = scene.selection.ids.map((id) => scene.objects.find((object) => object.id === id)).filter((object) => object !== undefined)
  const names = objects.slice(0, BULK_NAME_LIMIT).map((object) => object.name)
  const more = objects.length - names.length
  const layers = Object.fromEntries(BUDGETED_LAYERS.map((layer) => {
    const on = objects.filter((object) => layerOn(object, layer)).length
    return [layer, on === 0 ? 'off' : on === objects.length ? 'on' : 'mixed']
  })) as Record<BudgetedLayer, TriState>
  const colours = new Set(objects.map((object) => object.style.colorHex))
  return {
    countLabel: text().inspector.bulkCount(objects.length),
    namesLabel: text().inspector.bulkNames(names, more),
    layers,
    commonColorHex: colours.size === 1 ? [...colours][0] : null,
    ids: scene.objects.filter((object) => selected.has(object.id)).map((object) => object.id),
  }
}

/** Activating a mixed or off control turns the layer on for all; an on
 *  control turns it off. */
export function bulkLayerTarget(state: TriState): boolean { return state !== 'on' }
