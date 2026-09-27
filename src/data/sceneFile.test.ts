import { expect, it } from 'vitest'
import { decodeSceneFileText, MAX_SCENE_FILE_BYTES, SCENE_FILE_SUFFIX, sceneFileName, sceneFileText } from './sceneFile.ts'
import { base64UrlDecode, decodeSceneLinkPayload } from './sceneLink.ts'
import { encodeSceneDocument } from './sceneDocument.ts'
import { sharedSceneDocument } from './sharedScene.ts'
import { orbitLabState, realObjectsState } from '../test-fixtures/sharedSceneFixtures.ts'
import orbitLabFile from './fixtures/scene-v1/orbit-lab.orbitin.json?raw'
import orbitLabStored from './fixtures/scene-v1/orbit-lab.s1-stored.txt?raw'
import orbitLabDeflated from './fixtures/scene-v1/orbit-lab.s1-deflated.txt?raw'
import realObjectsFile from './fixtures/scene-v1/real-objects.orbitin.json?raw'
import realObjectsStored from './fixtures/scene-v1/real-objects.s1-stored.txt?raw'
import realObjectsDeflated from './fixtures/scene-v1/real-objects.s1-deflated.txt?raw'

it('writes sorted, indented JSON with a trailing newline and reads it back', () => {
  const document = sharedSceneDocument(realObjectsState())
  const text = sceneFileText(document)
  expect(text.endsWith('}\n')).toBe(true)
  expect(text.split('\n')[1]).toBe('  "activeMode": "realObjects",')
  expect(decodeSceneFileText(text)).toEqual({ ok: true, document })
})

it('names files by mode and UTC minute', () => {
  expect(sceneFileName('realObjects', new Date(Date.UTC(2026, 8, 25, 14, 12, 59)))).toBe('orbitin-scene-real-objects-20260925-1412.orbitin.json')
  expect(sceneFileName('orbitLab', new Date(Date.UTC(2026, 0, 2, 3, 4)))).toBe(`orbitin-scene-orbit-lab-20260102-0304${SCENE_FILE_SUFFIX}`)
})

it('strips one byte-order mark and applies the sharing profile to a full document', () => {
  const state = { ...orbitLabState(), realObjects: realObjectsState().realObjects }
  const full = JSON.stringify(encodeSceneDocument(state, { includeSimulation: true }))
  const decoded = decodeSceneFileText(`﻿${full}`)
  expect(decoded).toEqual({ ok: true, document: sharedSceneDocument(orbitLabState()) })
  expect(decodeSceneFileText(`﻿﻿${full}`).ok).toBe(false)
})

it('maps unreadable, invalid, oversized and newer files to their failures', () => {
  expect(decodeSceneFileText('not json')).toEqual({ ok: false, failure: { kind: 'malformed' } })
  expect(decodeSceneFileText('[]')).toMatchObject({ ok: false, failure: { kind: 'invalid-document' } })
  expect(decodeSceneFileText(JSON.stringify({ format: 'orbitin.scene', version: 2, anything: true }))).toEqual({ ok: false, failure: { kind: 'newer-version' } })
  expect(decodeSceneFileText(' '.repeat(MAX_SCENE_FILE_BYTES + 1))).toEqual({ ok: false, failure: { kind: 'too-large' } })
})

it('rejects a __proto__ key through the exact-key check', () => {
  const text = sceneFileText(sharedSceneDocument(orbitLabState())).replace('"activeMode"', '"__proto__": { "polluted": true },\n  "activeMode"')
  const decoded = decodeSceneFileText(text)
  expect(decoded.ok).toBe(false)
  if (!decoded.ok && decoded.failure.kind === 'invalid-document') expect(decoded.failure.errors).toContainEqual({ path: '__proto__', message: 'Unknown key.' })
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
})

it('opens the golden version 1 files and s1 links (a failure here is a contract break)', async () => {
  for (const [file, stored, deflated, mode] of [[orbitLabFile, orbitLabStored, orbitLabDeflated, 'orbitLab'], [realObjectsFile, realObjectsStored, realObjectsDeflated, 'realObjects']] as const) {
    const opened = decodeSceneFileText(file)
    if (!opened.ok) throw new Error(`Golden ${mode} file no longer opens.`)
    expect(opened.document.activeMode).toBe(mode)
    // The file is its own canonical form.
    expect(sceneFileText(opened.document)).toBe(file)
    for (const payload of [stored.trim(), deflated.trim()]) expect(await decodeSceneLinkPayload('s1', payload)).toEqual({ ok: true, document: opened.document })
  }
  for (const payload of [orbitLabDeflated, realObjectsDeflated]) expect(base64UrlDecode(payload.trim())![0]).toBe(1)
  for (const payload of [orbitLabStored, realObjectsStored]) expect(base64UrlDecode(payload.trim())![0]).toBe(0)
})
