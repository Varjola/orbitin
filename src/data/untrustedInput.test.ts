import { describe, expect, it } from 'vitest'
import { decodeSceneDocument } from './sceneDocument.ts'
import { decodeSceneFileText } from './sceneFile.ts'
import { parseOmmJson } from './omm.ts'
import { CatalogueClient } from './CatalogueClient.ts'

/** Hostile input fails with a result, never a throw,
 *  a freeze or an unbounded allocation. */
describe('hostile input', () => {
  it('rejects scene documents whose values cannot be turned into text, without throwing', () => {
    const hostile = { toString: 0 }
    expect(decodeSceneDocument({ format: 'orbitin.scene', version: hostile }).ok).toBe(false)
    let nested: unknown = 1
    for (let depth = 0; depth < 200_000; depth += 1) nested = [nested]
    expect(decodeSceneDocument({ format: 'orbitin.scene', version: nested }).ok).toBe(false)
    const document = {
      format: 'orbitin.scene', version: 1, activeMode: hostile, simulation: null, view: { groundTrackMapVisible: false, scaleMarkersWithZoom: true },
      orbitLab: { objects: [], selectedIds: [], primaryId: null },
      realObjects: { objects: [{ id: 'a', kind: hostile, style: {}, sensor: {}, reachConstraint: {}, display: {} }], selectedIds: [], primaryId: null },
    }
    expect(() => decodeSceneDocument(document)).not.toThrow()
    expect(decodeSceneDocument(document).ok).toBe(false)
  })

  it('reports a scene file with such values as invalid', () => {
    expect(decodeSceneFileText('{"format":"orbitin.scene","version":{"toString":0}}').ok).toBe(false)
  })

  it('never mistakes pasted OMM input for its own parse result', () => {
    const posing = parseOmmJson('{"ok":false,"errors":[]}')
    expect(posing.ok).toBe(false)
    if (!posing.ok) expect(posing.errors.length).toBeGreaterThan(0)
    expect(() => parseOmmJson('{"ok":false,"errors":[{"field":{"toString":0}}]}')).not.toThrow()
    const huge = parseOmmJson('x'.repeat(5_000_000))
    expect(huge.ok).toBe(false)
  })

  it('refuses a catalogue pointer larger than any real one before reading it all', async () => {
    const oversized = new Response('x'.repeat(200_000), { status: 200 })
    const client = new CatalogueClient({ fetch: async () => oversized, pointerSessionTtlMs: 0 })
    await expect(client.load()).rejects.toThrow(/larger than expected/)
    client.dispose()
  })
})
