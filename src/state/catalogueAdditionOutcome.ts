import type { CatalogueFailure } from '../data/catalogueFailure.ts'

export interface SceneObjectIdentity { readonly sceneId: string; readonly catalogId: string; readonly name: string }

/** Why an add did nothing, independent of language. */
export type AddFailureReason =
  | { readonly kind: 'scene-changed' }
  | { readonly kind: 'record-not-added' }
  | { readonly kind: 'record-invalid'; readonly catalogId: string; readonly message: string }
  | { readonly kind: 'catalogue'; readonly failure: CatalogueFailure }
  | { readonly kind: 'group-unavailable' }
  | { readonly kind: 'not-ready' }
  | { readonly kind: 'wait-for-open' }

export type AddCatalogueRecordsOutcome =
  | { readonly kind: 'nothing-requested' }
  | { readonly kind: 'added'; readonly added: readonly SceneObjectIdentity[]; readonly alreadyPresent: readonly SceneObjectIdentity[] }
  | { readonly kind: 'already-present'; readonly objects: readonly SceneObjectIdentity[] }
  | { readonly kind: 'in-progress'; readonly catalogIds: readonly string[] }
  | { readonly kind: 'refused-capacity'; readonly available: number; readonly requested: number }
  | { readonly kind: 'missing-records'; readonly missingIds: readonly string[] }
  | { readonly kind: 'failed'; readonly reason: AddFailureReason }
