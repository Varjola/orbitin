import type { AppState } from '../state/AppState.ts'
import { addObjects, remainingCapacity, selectMany } from '../state/sceneActions.ts'
import { withScene } from '../state/AppState.ts'
import { nextObjectColors, planCatalogueAddition, sceneObjectFromCatalogueRecord } from './catalogueToScene.ts'
import type { ResolvedCatalogueRecords } from './CatalogueController.ts'
import type { AddCatalogueRecordsOutcome } from '../state/catalogueAdditionOutcome.ts'
import { catalogueFailureOf } from '../data/catalogueFailure.ts'

export interface AddCatalogueRecordsDependencies {
  getState(): AppState
  commit(next: AppState): void
  resolveRecords(catalogIds: readonly string[], options: { readonly requireAll: true }): Promise<ResolvedCatalogueRecords>
  readonly pendingIds: Set<string>
}
export interface AddCatalogueRecordsOptions {
  /** One colour for every newly created object (a whole-group
   *  add): the next unused palette colour, or the cyclic fallback. */
  readonly sharedColor?: boolean
}
export async function addCatalogueRecordsToScene(deps: AddCatalogueRecordsDependencies, catalogIds: readonly string[], options: AddCatalogueRecordsOptions = {}): Promise<AddCatalogueRecordsOutcome> {
  const initial = deps.getState(); const initialPlan = planCatalogueAddition(initial.realObjects.scene, catalogIds, deps.pendingIds)
  if (initialPlan.requested.length === 0) return { kind: 'nothing-requested' }
  if (initialPlan.pending.length > 0) return { kind: 'in-progress', catalogIds: initialPlan.pending }
  if (initialPlan.toAdd.length === 0) { const next = withScene(initial, 'realObjects', selectMany(initial.realObjects.scene, initialPlan.present.map((item) => item.sceneId))); if (next !== initial) deps.commit(next); return { kind: 'already-present', objects: initialPlan.present } }
  if (initialPlan.toAdd.length > remainingCapacity(initial.realObjects.scene)) return { kind: 'refused-capacity', available: remainingCapacity(initial.realObjects.scene), requested: initialPlan.toAdd.length }
  for (const id of initialPlan.toAdd) deps.pendingIds.add(id)
  try {
    const resolved = await deps.resolveRecords(initialPlan.toAdd, { requireAll: true })
    if (resolved.missingIds.length > 0) return { kind: 'missing-records', missingIds: resolved.missingIds }
    const latest = deps.getState(); const latestPlan = planCatalogueAddition(latest.realObjects.scene, initialPlan.requested, new Set())
    if (latestPlan.toAdd.some((id) => !initialPlan.toAdd.includes(id)) || initialPlan.present.some((identity) => !latestPlan.present.some((current) => current.catalogId === identity.catalogId))) return { kind: 'failed', reason: { kind: 'scene-changed' } }
    if (latestPlan.toAdd.length > remainingCapacity(latest.realObjects.scene)) return { kind: 'refused-capacity', available: remainingCapacity(latest.realObjects.scene), requested: latestPlan.toAdd.length }
    const colors = options.sharedColor ? Array<number>(latestPlan.toAdd.length).fill(nextObjectColors(latest.realObjects.scene, 1)[0]) : nextObjectColors(latest.realObjects.scene, latestPlan.toAdd.length); const objects = []
    for (let i = 0; i < latestPlan.toAdd.length; i++) { const record = resolved.records.find((candidate) => candidate.NORAD_CAT_ID === latestPlan.toAdd[i]); if (!record) return { kind: 'failed', reason: { kind: 'record-not-added' } }; const result = sceneObjectFromCatalogueRecord(record, resolved.manifest, colors[i]); if (!result.ok) return { kind: 'failed', reason: { kind: 'record-invalid', catalogId: result.catalogId, message: result.message } }; objects.push(result.object) }
    const withAdded = objects.length > 0 ? addObjects(latest.realObjects.scene, objects) : latest.realObjects.scene
    if (objects.length > 0 && withAdded === latest.realObjects.scene) return { kind: 'failed', reason: { kind: 'record-not-added' } }
    const finalPlan = planCatalogueAddition(withAdded, initialPlan.requested, new Set()); const selected = selectMany(withAdded, finalPlan.present.map((identity) => identity.sceneId)); deps.commit(withScene(latest, 'realObjects', selected))
    const addedIds = new Set(objects.map((object) => object.id)); const added = finalPlan.present.filter((identity) => addedIds.has(identity.sceneId)); const alreadyPresent = finalPlan.present.filter((identity) => !addedIds.has(identity.sceneId))
    return objects.length > 0 ? { kind: 'added', added, alreadyPresent } : { kind: 'already-present', objects: finalPlan.present }
  } catch (error) { return { kind: 'failed', reason: { kind: 'catalogue', failure: catalogueFailureOf(error, 'The catalogue record could not be added.') } } }
  finally { for (const id of initialPlan.toAdd) deps.pendingIds.delete(id) }
}
