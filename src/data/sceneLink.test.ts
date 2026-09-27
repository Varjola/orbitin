import { expect, it } from 'vitest'
import { encodeSceneDocument, type SceneDocumentV1 } from './sceneDocument.ts'
import { sharedSceneDocument } from './sharedScene.ts'
import {
  base64UrlDecode, base64UrlEncode, createSceneLink, decodeSceneLinkPayload, encodeSceneLinkPayload, hashWithoutSceneKey, LINK_DEFAULTS_V1,
  MANUAL_OMM_CONSTANTS_V1, MANUAL_OMM_FIELDS_V1, MAX_LINK_MANUAL_REAL_OBJECTS, MAX_LINK_ORBIT_LAB_OBJECTS, MAX_LINK_REAL_OBJECTS,
  MAX_SCENE_LINK_ACCEPTED_CHARS, MAX_SCENE_LINK_BODY_BYTES, MAX_SCENE_LINK_PAYLOAD_CHARS, SHARED_NOTES_V1, sceneLinkAvailability, sceneLinkPayload,
} from './sceneLink.ts'
import { ORBIT_PRESETS } from '../simulation/orbitPresets.ts'
import { defaultGroundReachConstraint, defaultSensorDefinition } from '../simulation/sensorFootprint.ts'
import { createInitialState } from '../state/initialState.ts'
import { orbitLabState, realObjectsState, sharedDocument, WORST_NAME, worstCatalogue, worstOmm, worstOrbit, worstTle } from '../test-fixtures/sharedSceneFixtures.ts'

async function roundTrip(document: SceneDocumentV1, compress: 'never' | 'always' | 'auto' = 'auto'): Promise<SceneDocumentV1> {
  const encoded = await encodeSceneLinkPayload(document, { compress })
  if (!encoded.ok) throw new Error(`Not linkable: ${JSON.stringify(encoded.reason)}`)
  const decoded = await decodeSceneLinkPayload('s1', encoded.payload)
  if (!decoded.ok) throw new Error(`Not decodable: ${JSON.stringify(decoded.failure)}`)
  return decoded.document
}

/** A stored `s1` payload from raw body bytes. */
function storedPayload(body: readonly number[]): string { return base64UrlEncode(new Uint8Array([0, ...body])) }
function f64(value: number): number[] { const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value, true); return [...new Uint8Array(view.buffer)] }
/** One default-presentation Keplerian object, with the name bytes and note index given. */
function orbitBody(nameBytes: readonly number[], note = 0, model = 0): number[] {
  return [0x0c, 0x0f, 0x33, 0x66, 0xff, model, ...f64(7000), ...f64(0), ...f64(0.5), ...f64(0), ...f64(0), ...f64(1774008000), ...f64(0), nameBytes.length, ...nameBytes, note]
}
const ORBIT_HEADER = [0x06, 1, 1, 0, 1]
async function failureOf(payload: string, encoding = 's1'): Promise<string> {
  const result = await decodeSceneLinkPayload(encoding, payload)
  return result.ok ? 'ok' : result.failure.kind
}
async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
}

it('round-trips an Orbit Lab scene exactly, including floats, notes and null notes', async () => {
  const document = sharedSceneDocument(orbitLabState())
  expect(document.orbitLab.objects[2].notes).toBeNull()
  expect(await roundTrip(document)).toEqual(document)
  expect(await roundTrip(document, 'never')).toEqual(document)
  expect(await roundTrip(document, 'always')).toEqual(document)
})

it('round-trips every Real Objects kind, a null TLE name and absent optional OMM fields', async () => {
  const document = sharedSceneDocument(realObjectsState())
  const tle = document.realObjects.objects.find((object) => object.kind === 'tle' && object.name === null)
  const minimal = document.realObjects.objects.find((object) => object.kind === 'omm' && !('OBJECT_ID' in object.record))
  expect(tle).toBeDefined()
  expect(minimal).toBeDefined()
  expect(await roundTrip(document, 'never')).toEqual(document)
  expect(await roundTrip(document, 'always')).toEqual(document)
})

it('round-trips worst-case names with 3-byte and 4-byte characters and every non-default value', async () => {
  const fourByte = { ...worstOrbit(1), name: '𝕏'.repeat(40) }
  expect(await roundTrip(sharedDocument('orbitLab', [worstOrbit(0), fourByte]))).toEqual(sharedDocument('orbitLab', [worstOrbit(0), fourByte]))
  const real = sharedDocument('realObjects', [worstCatalogue(0), worstTle(0), worstOmm(0)])
  expect(await roundTrip(real)).toEqual(real)
  const empty = sharedDocument('realObjects', [])
  expect(await roundTrip(empty)).toEqual(empty)
})

it('keeps the shorter container', async () => {
  const document = sharedSceneDocument(realObjectsState())
  const stored = await encodeSceneLinkPayload(document, { compress: 'never' })
  const auto = await encodeSceneLinkPayload(document)
  if (!stored.ok || !auto.ok) throw new Error('Expected linkable scene.')
  expect(auto.payload.length).toBeLessThan(stored.payload.length)
  expect(base64UrlDecode(auto.payload)![0]).toBe(1)
  // A tiny scene does not compress, so the stored container is kept.
  const tiny = await encodeSceneLinkPayload(sharedDocument('orbitLab', []))
  expect(tiny.ok && base64UrlDecode(tiny.payload)![0]).toBe(0)
})

it('fits the worst-case scene at every link limit in the payload budget and refuses one more object', async () => {
  const lab = sharedDocument('orbitLab', Array.from({ length: MAX_LINK_ORBIT_LAB_OBJECTS }, (_, index) => worstOrbit(index)))
  const catalogueOnly = sharedDocument('realObjects', Array.from({ length: MAX_LINK_REAL_OBJECTS }, (_, index) => worstCatalogue(index)))
  const manualCount = MAX_LINK_MANUAL_REAL_OBJECTS
  const mixedOmm = sharedDocument('realObjects', [...Array.from({ length: MAX_LINK_REAL_OBJECTS - manualCount }, (_, index) => worstCatalogue(index)), ...Array.from({ length: manualCount }, (_, index) => worstOmm(index))])
  const mixedTle = sharedDocument('realObjects', [...Array.from({ length: MAX_LINK_REAL_OBJECTS - manualCount }, (_, index) => worstCatalogue(index)), ...Array.from({ length: manualCount }, (_, index) => worstTle(index))])
  for (const document of [lab, catalogueOnly, mixedOmm, mixedTle]) {
    expect(sceneLinkAvailability(document)).toEqual({ ok: true })
    const stored = await encodeSceneLinkPayload(document, { compress: 'never' })
    expect(stored.ok && stored.payload.length).toBeLessThanOrEqual(MAX_SCENE_LINK_PAYLOAD_CHARS)
    expect(await roundTrip(document, 'never')).toEqual(document)
  }
  expect(sceneLinkAvailability(sharedDocument('orbitLab', Array.from({ length: MAX_LINK_ORBIT_LAB_OBJECTS + 1 }, (_, index) => worstOrbit(index)))))
    .toEqual({ ok: false, reason: { kind: 'over-limit', mode: 'orbitLab', objectCount: 21, manualObjectCount: 0 } })
  expect(sceneLinkAvailability(sharedDocument('realObjects', Array.from({ length: MAX_LINK_REAL_OBJECTS + 1 }, (_, index) => worstCatalogue(index)))))
    .toEqual({ ok: false, reason: { kind: 'over-limit', mode: 'realObjects', objectCount: 101, manualObjectCount: 0 } })
  expect(sceneLinkAvailability(sharedDocument('realObjects', Array.from({ length: manualCount + 1 }, (_, index) => worstTle(index)))))
    .toEqual({ ok: false, reason: { kind: 'over-limit', mode: 'realObjects', objectCount: 11, manualObjectCount: 11 } })
})

it('refuses scenes outside the link text bounds, which files still hold', () => {
  const outside = { ok: false, reason: { kind: 'outside-bounds' } }
  expect(sceneLinkAvailability(sharedDocument('orbitLab', [{ ...worstOrbit(0), name: `${WORST_NAME}x` }]))).toEqual(outside)
  expect(sceneLinkAvailability(sharedDocument('orbitLab', [{ ...worstOrbit(0), name: 'Lone \uD800 surrogate' }]))).toEqual(outside)
  expect(sceneLinkAvailability(sharedDocument('orbitLab', [{ ...worstOrbit(0), notes: 'A hand-edited note' }]))).toEqual(outside)
  expect(sceneLinkAvailability(sharedDocument('realObjects', [{ ...worstCatalogue(0), id: 'catalogue-025544', catalogId: '025544' }]))).toEqual(outside)
  expect(sceneLinkAvailability(sharedDocument('realObjects', [{ ...worstCatalogue(0), savedSnapshotId: 'hand-edited' }]))).toEqual(outside)
  const omm = worstOmm(0)
  expect(sceneLinkAvailability(sharedDocument('realObjects', [{ ...omm, record: { ...omm.record, OBJECT_ID: 'É' } }]))).toEqual(outside)
  expect(sceneLinkAvailability(sharedDocument('realObjects', [{ ...omm, record: { ...omm.record, EXTRA_FIELD: 1 } }]))).toEqual(outside)
  expect(sceneLinkAvailability(sharedDocument('realObjects', [{ ...omm, record: { ...omm.record, REF_FRAME: 'GCRF' } }]))).toEqual(outside)
  expect(sceneLinkAvailability(sharedDocument('realObjects', [{ ...omm, record: { ...omm.record, ELEMENT_SET_NO: -1 } }]))).toEqual(outside)
})

it('creates a link from the page origin and path only', async () => {
  const link = await createSceneLink(sharedSceneDocument(orbitLabState()), { origin: 'https://orbitin.example', pathname: '/app/' })
  expect(link.ok).toBe(true)
  if (!link.ok) return
  expect(link.url).toMatch(/^https:\/\/orbitin\.example\/app\/#scene=s1\.[A-Za-z0-9_-]+$/)
  const parsed = sceneLinkPayload(new URL(link.url).hash)
  expect(parsed?.encoding).toBe('s1')
})

it('reports every malformed input without throwing', async () => {
  expect(await failureOf(storedPayload([...ORBIT_HEADER, ...orbitBody([0x41])]))).toBe('ok')
  expect(await failureOf('AAAA', 's2')).toBe('newer-version')
  expect(await failureOf('AAAA', 'x1')).toBe('malformed')
  expect(await failureOf('')).toBe('malformed')
  expect(await failureOf('AA+A')).toBe('malformed')
  expect(await failureOf('AAAAA')).toBe('malformed')
  expect(await failureOf('AB')).toBe('malformed')
  expect(await failureOf(base64UrlEncode(new Uint8Array([2, 6, 0, 0, 0])))).toBe('malformed')
  // Reserved header, object, defaults and model bits.
  expect(await failureOf(storedPayload([0x0e, 0, 0, 0]))).toBe('malformed')
  const valid = orbitBody([0x41])
  expect(await failureOf(storedPayload([...ORBIT_HEADER, 0x80 | valid[0], ...valid.slice(1)]))).toBe('malformed')
  expect(await failureOf(storedPayload([...ORBIT_HEADER, valid[0], 0x1f, ...valid.slice(2)]))).toBe('malformed')
  expect(await failureOf(storedPayload([...ORBIT_HEADER, ...orbitBody([0x41], 0, 4)]))).toBe('malformed')
  // A catalogue kind inside an Orbit Lab scene.
  expect(await failureOf(storedPayload([...ORBIT_HEADER, valid[0] | 1, ...valid.slice(1)]))).toBe('malformed')
  // Over-long and non-minimal varints.
  expect(await failureOf(storedPayload([0x06, 0x80, 0x00, 0, 0]))).toBe('malformed')
  expect(await failureOf(storedPayload([0x06, 0xff, 0xff, 0xff, 0xff, 0x7f, 0, 0]))).toBe('malformed')
  // Selection index, primary index and note index out of range.
  expect(await failureOf(storedPayload([0x06, 1, 1, 1, 1, ...valid]))).toBe('malformed')
  expect(await failureOf(storedPayload([0x06, 1, 1, 0, 2, ...valid]))).toBe('malformed')
  expect(await failureOf(storedPayload([...ORBIT_HEADER, ...orbitBody([0x41], SHARED_NOTES_V1.length + 1)]))).toBe('malformed')
  expect(await failureOf(storedPayload([...ORBIT_HEADER, ...orbitBody([0x41], SHARED_NOTES_V1.length)]))).toBe('ok')
  // Invalid UTF-8, truncation and trailing bytes.
  expect(await failureOf(storedPayload([...ORBIT_HEADER, ...orbitBody([0xc3, 0x28])]))).toBe('malformed')
  expect(await failureOf(storedPayload([...ORBIT_HEADER, ...valid.slice(0, -3)]))).toBe('malformed')
  expect(await failureOf(storedPayload([...ORBIT_HEADER, ...valid, 0]))).toBe('malformed')
  // A snapshot index beyond the table.
  const catalogue = [0x05, 0x0f, 0, 0, 0, 0x81, 0x01, 1, ...f64(1774008000)]
  expect(await failureOf(storedPayload([0x01, 1, 0, 0, 1, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, ...catalogue]))).toBe('malformed')
})

it('hands structurally readable but invalid documents to the document validator', async () => {
  // Eccentricity 2 reads fine and is rejected by decodeSceneDocument.
  const body = orbitBody([0x41]); body.splice(6 + 8, 8, ...f64(2))
  const result = await decodeSceneLinkPayload('s1', storedPayload([...ORBIT_HEADER, ...body]))
  expect(result.ok).toBe(false)
  if (!result.ok && result.failure.kind === 'invalid-document') expect(result.failure.errors.map((error) => error.path)).toContain('orbitLab.objects[0].geometry.eccentricity')
  else throw new Error('Expected invalid-document.')
  // An empty name is not a valid version 1 name.
  expect(await failureOf(storedPayload([...ORBIT_HEADER, ...orbitBody([])]))).toBe('invalid-document')
})

it('bounds payload size, streamed decompression and truncated streams', async () => {
  expect(await failureOf('A'.repeat(MAX_SCENE_LINK_ACCEPTED_CHARS + 1))).toBe('too-large')
  const bomb = await deflate(new Uint8Array(MAX_SCENE_LINK_BODY_BYTES * 4))
  expect(bomb.length).toBeLessThan(2_000)
  expect(await failureOf(base64UrlEncode(new Uint8Array([1, ...bomb])))).toBe('too-large')
  const document = sharedSceneDocument(realObjectsState())
  const encoded = await encodeSceneLinkPayload(document, { compress: 'always' })
  if (!encoded.ok) throw new Error('Expected linkable scene.')
  const bytes = base64UrlDecode(encoded.payload)!
  expect(await failureOf(base64UrlEncode(bytes.subarray(0, bytes.length - 12)))).toBe('malformed')
  const unsupported = await decodeSceneLinkPayload('s1', encoded.payload, { decompressionStream: null })
  expect(unsupported).toEqual({ ok: false, failure: { kind: 'unsupported-browser' } })
  // A stored link opens without any decompression support.
  const stored = await encodeSceneLinkPayload(document, { compress: 'never' })
  expect(stored.ok && (await decodeSceneLinkPayload('s1', stored.payload, { decompressionStream: null })).ok).toBe(true)
})

it('freezes the link defaults, notes and manual OMM fields against the current application', () => {
  expect(LINK_DEFAULTS_V1).toEqual({ markerSizeRenderUnits: 0.02, fieldOfViewHalfAngleRad: defaultSensorDefinition().fieldOfViewHalfAngleRad, maxOffNadirSteeringRad: defaultSensorDefinition().maxOffNadirSteeringRad, minimumGroundElevationRad: defaultGroundReachConstraint().minimumGroundElevationRad })
  expect(createInitialState().orbitLab.scene.objects[0].style.markerSizeRenderUnits).toBe(LINK_DEFAULTS_V1.markerSizeRenderUnits)
  // Append-only: every note the application can write today has an index.
  for (const note of [createInitialState().orbitLab.scene.objects[0].notes, ...ORBIT_PRESETS.map((preset) => preset.canonicalNote)]) expect(SHARED_NOTES_V1).toContain(note)
  expect(SHARED_NOTES_V1[0]).toBe('Ideal two-body Keplerian demonstration')
  expect(SHARED_NOTES_V1).toHaveLength(7)
  // The manual OMM record the encoder writes, with every optional field present.
  const record = encodeSceneDocument(realObjectsState(), { includeSimulation: false }).realObjects.objects.find((object) => object.kind === 'omm')!
  if (record.kind !== 'omm') throw new Error('Expected OMM.')
  expect(Object.keys(record.record)).toEqual([...MANUAL_OMM_FIELDS_V1.map((field) => field.key), ...Object.keys(MANUAL_OMM_CONSTANTS_V1)])
  for (const field of MANUAL_OMM_FIELDS_V1) expect(typeof record.record[field.key]).toBe(field.type === 'text' ? 'string' : 'number')
})

it('reads and removes only the scene key of a fragment', () => {
  expect(sceneLinkPayload('')).toBeNull()
  expect(sceneLinkPayload('#other=1')).toBeNull()
  expect(sceneLinkPayload('#scene=s1.abc')).toEqual({ encoding: 's1', payload: 'abc' })
  expect(sceneLinkPayload('#a=1&scene=s2.x.y&b')).toEqual({ encoding: 's2', payload: 'x.y' })
  expect(sceneLinkPayload('#scene')).toEqual({ encoding: '', payload: '' })
  expect(hashWithoutSceneKey('#scene=s1.abc')).toBe('')
  expect(hashWithoutSceneKey('#a=1&scene=s1.abc&b=2')).toBe('#a=1&b=2')
  expect(hashWithoutSceneKey('#section')).toBe('#section')
})
