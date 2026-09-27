import type { OrbitalObject } from '../simulation/OrbitalObject.ts'

/** Per-layer budgets for the expensive optional
 *  overlays. Values come from scene-scale measurements on reference devices
 *  (`npm run measure:scene` and the in-browser harness reproduce them). A
 *  layer whose budget equals the scene capacity never shows a safeguard. */
export type BudgetedLayer = 'orbitPath' | 'groundTrack' | 'groundTrackHistory' | 'sensorGeometry'
export const BUDGETED_LAYERS: readonly BudgetedLayer[] = ['orbitPath', 'groundTrack', 'groundTrackHistory', 'sensorGeometry']
export type LayerBudgets = { readonly [layer in BudgetedLayer]: number }
export const LAYER_BUDGETS: LayerBudgets = { orbitPath: 100, groundTrack: 100, groundTrackHistory: 100, sensorGeometry: 75 }

export type BudgetCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly layer: BudgetedLayer; readonly budget: number; readonly wouldBe: number }

/** Whether the layer is effectively on. A recording without a visible track
 *  records nothing, so history counts only together with its track. */
export function layerOn(object: OrbitalObject, layer: BudgetedLayer): boolean {
  switch (layer) {
    case 'orbitPath': return object.display.orbitPathVisible
    case 'groundTrack': return object.display.groundTrackVisible
    case 'groundTrackHistory': return object.display.groundTrackVisible && object.display.groundTrackHistoryRecording
    case 'sensorGeometry': return object.display.sensorGeometryVisible
  }
}

export function layerCount(objects: readonly OrbitalObject[], layer: BudgetedLayer): number {
  let count = 0
  for (const object of objects) if (layerOn(object, layer)) count += 1
  return count
}

/** One object with one layer set, keeping the Ground track / Record history
 *  dependency: history on also shows the track, and hiding the track also
 *  stops recording, so no object ever records behind a hidden track. */
export function withLayer(object: OrbitalObject, layer: BudgetedLayer, on: boolean): OrbitalObject {
  const display = object.display
  let next = display
  switch (layer) {
    case 'orbitPath': next = { ...display, orbitPathVisible: on }; break
    case 'groundTrack': next = { ...display, groundTrackVisible: on, groundTrackHistoryRecording: on && display.groundTrackHistoryRecording }; break
    case 'groundTrackHistory': next = on ? { ...display, groundTrackVisible: true, groundTrackHistoryRecording: true } : { ...display, groundTrackHistoryRecording: false }; break
    case 'sensorGeometry': next = { ...display, sensorGeometryVisible: on }; break
  }
  if (next.orbitPathVisible === display.orbitPathVisible && next.groundTrackVisible === display.groundTrackVisible &&
    next.groundTrackHistoryRecording === display.groundTrackHistoryRecording && next.sensorGeometryVisible === display.sensorGeometryVisible) return object
  return { ...object, display: next }
}

/** Every layer an update changes, checked on the objects after it. Only a
 *  layer whose count rises above its budget refuses, so turning anything off
 *  is never refused, even in a scene already over a budget. */
export function checkSceneBudgets(before: readonly OrbitalObject[], after: readonly OrbitalObject[], budgets: LayerBudgets = LAYER_BUDGETS): BudgetCheck {
  for (const layer of BUDGETED_LAYERS) {
    const wouldBe = layerCount(after, layer)
    if (wouldBe > budgets[layer] && wouldBe > layerCount(before, layer)) return { ok: false, layer, budget: budgets[layer], wouldBe }
  }
  return { ok: true }
}

/** The check for turning `layer` on or off for `ids`, including any
 *  dependent layer the change implies. */
export function checkLayerChange(objects: readonly OrbitalObject[], ids: readonly string[], layer: BudgetedLayer, on: boolean, budgets: LayerBudgets = LAYER_BUDGETS): BudgetCheck {
  const targets = new Set(ids)
  return checkSceneBudgets(objects, objects.map((object) => targets.has(object.id) ? withLayer(object, layer, on) : object), budgets)
}

export interface LayerBudgetTrim { readonly layer: BudgetedLayer; readonly budget: number; readonly ids: readonly string[] }

/** Scene-document exception: nothing is refused.
 *  Each over-budget layer stays on for the first `budget` objects in document
 *  order and is turned off on the rest. Ground tracks are trimmed before
 *  history, so a history can never survive without its track. */
export function applyLayerBudgetsInOrder(objects: readonly OrbitalObject[], budgets: LayerBudgets = LAYER_BUDGETS): { readonly objects: readonly OrbitalObject[]; readonly trimmed: readonly LayerBudgetTrim[] } {
  let current = objects
  const trimmed: LayerBudgetTrim[] = []
  for (const layer of ['groundTrack', 'groundTrackHistory', 'sensorGeometry', 'orbitPath'] as const) {
    let seen = 0
    const ids: string[] = []
    current = current.map((object) => {
      if (!layerOn(object, layer)) return object
      seen += 1
      if (seen <= budgets[layer]) return object
      ids.push(object.id)
      return withLayer(object, layer, false)
    })
    if (ids.length > 0) trimmed.push({ layer, budget: budgets[layer], ids })
  }
  return { objects: current, trimmed }
}
