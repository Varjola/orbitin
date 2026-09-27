import { decodeSceneDocument, encodeSceneDocument, type KeplerianObjectV1, type RealObjectV1, type SceneDocumentDecodeResult, type SceneDocumentV1 } from './sceneDocument.ts'
import type { AppState, ProductMode } from '../state/AppState.ts'

/** The sharing profile, a set of rules over scene
 *  document version 1. A shared scene carries one mode's scene, no simulation
 *  block and normalized ids. Links and files both hold shared scenes. */
export interface SharedSceneSummary { readonly mode: ProductMode; readonly objectCount: number; readonly manualObjectCount: number; readonly catalogueObjectCount: number }

const EMPTY_SHARED_SCENE = { objects: [], selectedIds: [], primaryId: null } as const

/** Normalized id of the object at `index`, counted separately per kind:
 *  `orbit-1..n`, `catalogue-<NORAD>`, `tle-1..n`, `omm-1..n`. The prefixes
 *  differ by mode, so an opened scene cannot collide with the other mode. */
export function normalizedSceneIds(objects: readonly (KeplerianObjectV1 | RealObjectV1)[]): string[] {
  const counters = { keplerian: 0, tle: 0, omm: 0 }
  return objects.map((object) => {
    if (object.kind === 'catalogue') return `catalogue-${object.catalogId}`
    const prefix = object.kind === 'keplerian' ? 'orbit' : object.kind
    return `${prefix}-${++counters[object.kind]}`
  })
}

function withNormalizedIds<T extends KeplerianObjectV1 | RealObjectV1>(scene: { readonly objects: readonly T[]; readonly selectedIds: readonly string[]; readonly primaryId: string | null }): { objects: T[]; selectedIds: string[]; primaryId: string | null } {
  const ids = normalizedSceneIds(scene.objects)
  const remap = new Map(scene.objects.map((object, index) => [object.id, ids[index]]))
  return {
    objects: scene.objects.map((object, index) => ({ ...object, id: ids[index] })),
    selectedIds: scene.selectedIds.map((id) => remap.get(id) ?? id),
    primaryId: scene.primaryId === null ? null : remap.get(scene.primaryId) ?? scene.primaryId,
  }
}

/** Rules 1-3 without validation: simulation null, only the active scene, ids normalized. */
function applySharingProfile(document: SceneDocumentV1): SceneDocumentV1 {
  const orbitLab = document.activeMode === 'orbitLab' ? withNormalizedIds(document.orbitLab) : EMPTY_SHARED_SCENE
  const realObjects = document.activeMode === 'realObjects' ? withNormalizedIds(document.realObjects) : EMPTY_SHARED_SCENE
  return { format: document.format, version: document.version, activeMode: document.activeMode, simulation: null, view: { ...document.view }, orbitLab, realObjects }
}

/** Builds the shared document for the active mode: that scene only, the other empty, simulation null, ids normalized. */
export function sharedSceneDocument(state: AppState): SceneDocumentV1 {
  return applySharingProfile(encodeSceneDocument(state, { includeSimulation: false }))
}

/** Applies the opening rules to any valid version 1 document and validates
 *  the result again. Two catalogue objects with the same NORAD id normalize to
 *  the same id, so rule 4 surfaces as a duplicate-id error. */
export function toSharedScene(document: SceneDocumentV1): SceneDocumentDecodeResult {
  return decodeSceneDocument(applySharingProfile(document))
}

export function sharedSceneSummary(document: SceneDocumentV1): SharedSceneSummary {
  const objects: readonly (KeplerianObjectV1 | RealObjectV1)[] = document.activeMode === 'orbitLab' ? document.orbitLab.objects : document.realObjects.objects
  const catalogueObjectCount = objects.filter((object) => object.kind === 'catalogue').length
  const manualObjectCount = objects.filter((object) => object.kind === 'tle' || object.kind === 'omm').length
  return { mode: document.activeMode, objectCount: objects.length, manualObjectCount, catalogueObjectCount }
}
