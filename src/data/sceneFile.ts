import { stableJson } from './catalogueSchema.ts'
import { decodeSceneDocument, SCENE_DOCUMENT_FORMAT, type SceneDocumentV1 } from './sceneDocument.ts'
import { toSharedScene } from './sharedScene.ts'
import type { SceneTextDecodeResult } from './sceneLink.ts'
import type { ProductMode } from '../state/AppState.ts'

/** The readable scene file. It holds one shared scene
 *  (the sharing profile of `sharedScene.ts`) as sorted-key, indented JSON. */
export const SCENE_FILE_SUFFIX = '.orbitin.json'
export const MAX_SCENE_FILE_BYTES = 1_048_576
const FILE_MODE_NAMES: Readonly<Record<ProductMode, string>> = { orbitLab: 'orbit-lab', realObjects: 'real-objects' }

export function sceneFileText(document: SceneDocumentV1): string { return `${stableJson(document, 2)}\n` }

/** `orbitin-scene-<mode>-YYYYMMDD-HHMM.orbitin.json`, in UTC. */
export function sceneFileName(mode: ProductMode, now: Date): string {
  const stamp = now.toISOString()
  return `orbitin-scene-${FILE_MODE_NAMES[mode]}-${stamp.slice(0, 10).replace(/-/g, '')}-${stamp.slice(11, 16).replace(':', '')}${SCENE_FILE_SUFFIX}`
}

export function decodeSceneFileText(text: string): SceneTextDecodeResult {
  if (text.length > MAX_SCENE_FILE_BYTES) return { ok: false, failure: { kind: 'too-large' } }
  let value: unknown
  try { value = JSON.parse(text.startsWith('﻿') ? text.slice(1) : text) } catch { return { ok: false, failure: { kind: 'malformed' } } }
  const candidate = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
  if (candidate?.format === SCENE_DOCUMENT_FORMAT && Number.isInteger(candidate.version) && (candidate.version as number) > 1) return { ok: false, failure: { kind: 'newer-version' } }
  const decoded = decodeSceneDocument(value)
  if (!decoded.ok) return { ok: false, failure: { kind: 'invalid-document', errors: decoded.errors } }
  const shared = toSharedScene(decoded.document)
  return shared.ok ? { ok: true, document: shared.document } : { ok: false, failure: { kind: 'invalid-document', errors: shared.errors } }
}
