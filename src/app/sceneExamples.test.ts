import { describe, expect, it } from 'vitest'
import { buildAutomaticSnapshotFixture } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { localDevelopmentRecords } from '../performance/catalogueFixtureFetch.ts'
import { resolveSceneDocument } from './resolveSceneDocument.ts'
import { decodeSceneLinkPayload, sceneLinkPayload } from '../data/sceneLink.ts'
import { sceneDocumentCatalogueIds } from '../data/sceneDocument.ts'
import { SCENE_EXAMPLES, sceneExampleUrl } from '../data/sceneExamples.ts'
import { catalogueFor } from '../i18n/active.ts'

const localIds = new Set((buildAutomaticSnapshotFixture({ syntheticRecords: localDevelopmentRecords() }).index.entries as { catalogId: string }[]).map((entry) => entry.catalogId))

describe('the curated example links', () => {
  it('offers four to six examples with unique ids, each named in both languages', () => {
    expect(SCENE_EXAMPLES.length).toBeGreaterThanOrEqual(4)
    expect(SCENE_EXAMPLES.length).toBeLessThanOrEqual(6)
    expect(new Set(SCENE_EXAMPLES.map((example) => example.id)).size).toBe(SCENE_EXAMPLES.length)
    for (const locale of ['en', 'fi'] as const) for (const example of SCENE_EXAMPLES) {
      expect(catalogueFor(locale).examples.names[example.id], `${locale} ${example.id}`).toBeTruthy()
      expect(catalogueFor(locale).examples.lines[example.id], `${locale} ${example.id}`).toBeTruthy()
    }
  })

  it.each(SCENE_EXAMPLES.map((example) => [example.id, example] as const))('%s decodes as an ordinary s1 link of its mode and resolves against the local catalogue', async (_id, example) => {
    const link = sceneLinkPayload(`#${example.fragment}`)
    expect(link?.encoding).toBe('s1')
    const decoded = await decodeSceneLinkPayload(link!.encoding, link!.payload)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.document.activeMode).toBe(example.mode)
    const ids = sceneDocumentCatalogueIds(decoded.document)
    for (const id of ids) expect(localIds.has(id), id).toBe(true)
    if (ids.length === 0) {
      const resolved = await resolveSceneDocument(decoded.document, { loadCatalogue: async () => {}, resolveRecords: async () => { throw new Error('no catalogue needed') } })
      expect(resolved.orbitLab.objects.length).toBeGreaterThan(0)
      expect(resolved.problems).toEqual([])
    }
    const url = new URL(sceneExampleUrl(example, 'https://orbitin.net'))
    expect(url.searchParams.get('example')).toBe(example.id)
    expect(sceneLinkPayload(url.hash)).toEqual(link)
  })
})
