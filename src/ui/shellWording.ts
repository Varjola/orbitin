import { text } from '../i18n/index.ts'
import type { OrbitalObject } from '../simulation/OrbitalObject.ts'
import { MAX_SCENE_OBJECTS } from '../state/sceneActions.ts'
import type { BudgetCheck } from '../state/sceneComplexity.ts'

/** Single manual add refused because the scene is full. */
export function sceneFullForManualAdd(record: 'tle' | 'omm'): string { return text().realObjects.sceneFull(MAX_SCENE_OBJECTS, record) }

/** Names the layer and its budget; empty when the check passed. */
export function layerBudgetMessage(check: BudgetCheck): string {
  if (check.ok) return ''
  return text().shell.layerBudget(check.layer, check.budget, check.wouldBe)
}

export function inspectorSourceLabel(object: OrbitalObject): string {
  const labels = text().shell.sourceLabels
  if (object.source.kind === 'keplerian') return labels.keplerian
  if (object.source.kind === 'tle') return labels.tle
  return object.source.definition.provenance.kind === 'catalogue' ? labels.catalogue : labels.omm
}
