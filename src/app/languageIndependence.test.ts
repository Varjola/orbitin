import { afterEach, expect, it } from 'vitest'
import { setActiveLocale } from '../i18n/active.ts'
import { pseudoCatalogue } from '../i18n/messages/pseudo.ts'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { decodeSceneFileText, sceneFileText } from '../data/sceneFile.ts'
import { decodeSceneLinkPayload, encodeSceneLinkPayload, SHARED_NOTES_V1 } from '../data/sceneLink.ts'
import { sharedSceneDocument } from '../data/sharedScene.ts'
import { createObjectFromPreset, ORBIT_PRESETS } from '../simulation/orbitPresets.ts'
import { withScene } from '../state/AppState.ts'
import { createInitialState } from '../state/initialState.ts'
import orbitLabFile from '../data/fixtures/scene-v1/orbit-lab.orbitin.json?raw'
import orbitLabStored from '../data/fixtures/scene-v1/orbit-lab.s1-stored.txt?raw'
import orbitLabDeflated from '../data/fixtures/scene-v1/orbit-lab.s1-deflated.txt?raw'
import realObjectsFile from '../data/fixtures/scene-v1/real-objects.orbitin.json?raw'
import realObjectsStored from '../data/fixtures/scene-v1/real-objects.s1-stored.txt?raw'
import realObjectsDeflated from '../data/fixtures/scene-v1/real-objects.s1-deflated.txt?raw'

afterEach(() => setActiveLocale('en'))

const LANGUAGES = [['Finnish', () => setActiveLocale('fi')], ['the pseudo-locale', () => setActiveLocale('pseudo', pseudoCatalogue())]] as const

/** Data never depends on the language. A scene saved or
 *  shared in any language is byte-identical and opens identically. */
it.each(LANGUAGES)('opens and re-encodes the golden scene files and links byte-identically in %s', async (_name, activate) => {
  activate()
  for (const [file, stored, deflated] of [[orbitLabFile, orbitLabStored, orbitLabDeflated], [realObjectsFile, realObjectsStored, realObjectsDeflated]] as const) {
    const opened = decodeSceneFileText(file)
    if (!opened.ok) throw new Error('A golden file no longer opens.')
    expect(sceneFileText(opened.document)).toBe(file)
    for (const [payload, compress] of [[stored.trim(), 'never'], [deflated.trim(), 'always']] as const) {
      expect(await decodeSceneLinkPayload('s1', payload)).toEqual({ ok: true, document: opened.document })
      const encoded = await encodeSceneLinkPayload(opened.document, { compress })
      expect(encoded.ok && encoded.payload).toBe(payload)
    }
  }
})

it.each(LANGUAGES)('stores the canonical English note for every preset created in %s, and still shares it by link', async (_name, activate) => {
  activate()
  const base = createInitialState(() => 0)
  const objects = ORBIT_PRESETS.map((preset, index) => createObjectFromPreset(preset, { id: `orbit-${index + 2}`, name: `Preset ${index}`, colorHex: 0xffc857 }, SIMULATION_START_INSTANT))
  for (const [index, object] of objects.entries()) {
    expect(object.notes).toBe(ORBIT_PRESETS[index].canonicalNote)
    expect(SHARED_NOTES_V1).toContain(object.notes)
  }
  expect(SHARED_NOTES_V1).toContain(base.orbitLab.scene.objects[0].notes)
  const state = withScene(base, 'orbitLab', { objects, selection: { ids: [], primaryId: null } })
  const encoded = await encodeSceneLinkPayload(sharedSceneDocument(state), { compress: 'auto' })
  expect(encoded.ok).toBe(true)
})
