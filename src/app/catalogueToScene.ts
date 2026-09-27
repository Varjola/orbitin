import { defaultGroundReachConstraint, defaultSensorDefinition } from '../simulation/sensorFootprint.ts'
import type { OrbitalObject } from '../simulation/OrbitalObject.ts'
import { parseOmmRecord } from '../data/omm.ts'
import { catalogueImportProvenance } from '../data/catalogueImport.ts'
import type { CatalogueManifestV1, CatalogueRecordV1 } from '../data/catalogueSchema.ts'
import { OBJECT_COLORS } from '../state/objectActions.ts'
import { remainingCapacity } from '../state/sceneActions.ts'
import type { SceneState } from '../state/AppState.ts'
import type { SceneObjectIdentity } from '../state/catalogueAdditionOutcome.ts'
import { CATALOGUE_OBJECT_NOTE } from '../state/canonicalNotes.ts'

export type CatalogueSceneObjectResult = { readonly ok: true; readonly object: OrbitalObject } | { readonly ok: false; readonly catalogId: string; readonly message: string }
export function sceneObjectFromCatalogueRecord(record: CatalogueRecordV1, manifest: CatalogueManifestV1, colorHex: number): CatalogueSceneObjectResult {
  const parsed = parseOmmRecord(record, catalogueImportProvenance(record, manifest))
  if (!parsed.ok) return { ok: false, catalogId: record.NORAD_CAT_ID, message: parsed.errors.map((error) => error.message).join(' ') }
  return { ok: true, object: { id: `catalogue-${parsed.definition.meanElements.catalogId}`, name: parsed.definition.name, source: { kind: 'omm', definition: parsed.definition }, propagation: { kind: 'sgp4' }, editingLock: { kind: 'none' }, style: { colorHex, markerSizeRenderUnits: 0.02 }, sensor: defaultSensorDefinition(), reachConstraint: defaultGroundReachConstraint(), display: { bodyVisible: true, orbitPathVisible: true, groundTrackVisible: false, groundTrackHistoryRecording: false, sensorGeometryVisible: false }, notes: CATALOGUE_OBJECT_NOTE } }
}
export function catalogueIdOfSceneObject(object: OrbitalObject): string | null { return object.source.kind === 'omm' && object.source.definition.provenance.kind === 'catalogue' ? object.source.definition.meanElements.catalogId : null }
export interface CatalogueAdditionPlan { readonly requested: readonly string[]; readonly present: readonly SceneObjectIdentity[]; readonly pending: readonly string[]; readonly toAdd: readonly string[] }
export function planCatalogueAddition(scene: SceneState, requestedIds: readonly string[], pendingIds: ReadonlySet<string>): CatalogueAdditionPlan {
  const requested = [...new Set(requestedIds)]; const present: SceneObjectIdentity[] = []; const pending: string[] = []; const toAdd: string[] = []
  for (const catalogId of requested) { const object = scene.objects.find((candidate) => catalogueIdOfSceneObject(candidate) === catalogId); if (object) present.push({ sceneId: object.id, catalogId, name: object.name }); else if (pendingIds.has(catalogId)) pending.push(catalogId); else toAdd.push(catalogId) }
  return { requested, present, pending, toAdd }
}
export interface CatalogueAdditionPreview {
  readonly totalSelected: number
  readonly alreadyInScene: number
  readonly newRecordsToAdd: number
  readonly slotsRemaining: number
  readonly canAddAll: boolean
}
/** Pure index/scene preview. It deliberately has no CatalogueClient input, so
 * callers can explain duplicates and capacity before any shard is requested. */
export function buildCatalogueAdditionPreview(scene: SceneState, catalogIds: readonly string[]): CatalogueAdditionPreview {
  const plan = planCatalogueAddition(scene, catalogIds, new Set())
  const slotsRemaining = remainingCapacity(scene)
  return {
    totalSelected: plan.requested.length,
    alreadyInScene: plan.present.length,
    newRecordsToAdd: plan.toAdd.length,
    slotsRemaining,
    canAddAll: plan.toAdd.length > 0 && plan.toAdd.length <= slotsRemaining,
  }
}
export function nextObjectColors(scene: SceneState, count: number): number[] { const used = new Set(scene.objects.map((object) => object.style.colorHex)); const colors: number[] = []; for (let i = 0; i < count; i++) { const color = OBJECT_COLORS.find((candidate) => !used.has(candidate)) ?? OBJECT_COLORS[(scene.objects.length + i) % OBJECT_COLORS.length]; colors.push(color); used.add(color) } return colors }
export function capacityForAddition(scene: SceneState, count: number): number { return Math.min(remainingCapacity(scene), count) }
