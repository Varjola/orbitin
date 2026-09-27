import { SNAPSHOT_ID_PATTERN } from './catalogueSchema.ts'
import { MAX_SCENE_DOCUMENT_OBJECTS, SCENE_DOCUMENT_FORMAT, type CatalogueObjectRefV1, type KeplerianObjectV1, type ManualOmmObjectV1, type ManualTleObjectV1, type ObjectPresentationV1, type RealObjectV1, type SceneDocumentError, type SceneDocumentV1 } from './sceneDocument.ts'
import { normalizedSceneIds, sharedSceneSummary, toSharedScene } from './sharedScene.ts'
import type { ProductMode } from '../state/AppState.ts'

/** The compact binary link encoding `s1`.
 *
 * A lossless binary form of a shared scene. Decoding rebuilds the version 1
 * document and hands it to `decodeSceneDocument` (through `toSharedScene`),
 * so the JSON validator stays the single authority on document validity.
 *
 * Every constant below is part of the published link contract:
 * `LINK_DEFAULTS_V1` and `MANUAL_OMM_FIELDS_V1` never change, and
 * `SHARED_NOTES_V1` is append-only. They are literals on purpose, never
 * imported from the simulation defaults, so later default changes cannot
 * change the meaning of links already made. */

export const SCENE_LINK_FRAGMENT_KEY = 'scene'
export const SCENE_LINK_ENCODING = 's1'
export const MAX_SCENE_LINK_PAYLOAD_CHARS = 16_000
export const MAX_LINK_ORBIT_LAB_OBJECTS = 20
export const MAX_LINK_REAL_OBJECTS = 100
export const MAX_LINK_MANUAL_REAL_OBJECTS = 10
export const MAX_SCENE_LINK_ACCEPTED_CHARS = 65_536
export const MAX_SCENE_LINK_BODY_BYTES = 262_144
/** Link text bounds, the input to the worst-case size proof. */
export const MAX_LINK_NAME_UNITS = 80
/** OMM string fields other than OBJECT_NAME: printable ASCII only,
 *  since 32 arbitrary code units per field would not fit 10 manual objects. */
export const MAX_LINK_OMM_ASCII_CHARS = 32

export const LINK_DEFAULTS_V1 = Object.freeze({
  markerSizeRenderUnits: 0.02,
  fieldOfViewHalfAngleRad: 5 * Math.PI / 180,
  maxOffNadirSteeringRad: 3 * Math.PI / 180,
  minimumGroundElevationRad: 0,
})

/** Keplerian notes are fixed application strings. Index n in a link means
 *  `SHARED_NOTES_V1[n - 1]`. Append-only: a changed preset description is
 *  added at the end, and old indices keep their old text. */
export const SHARED_NOTES_V1: readonly string[] = Object.freeze([
  'Ideal two-body Keplerian demonstration',
  'Low Earth orbit: a circular path 500 km above Earth, inclined 51.5° to the equator.',
  'Medium Earth orbit: a higher circular path with a longer period than LEO, typical of navigation orbit scales.',
  'A circular equatorial orbit with a sidereal-day period: about 23 h 56 min. It follows Earth’s rotation and stays over nearly the same longitude.',
  'A circular orbit 800 km above Earth whose plane crosses both poles. Run it against the Sun-synchronous example, which sits at the same altitude and only 8.6° more inclination: with J2 drift on, this plane sweeps through every local solar time over a year while that one holds its crossing time.',
  'A stretched orbit with geocentric periapsis and apoapsis radii of 6,916 km and 46,284 km. The body moves fastest near periapsis. Its 63.5° inclination is the critical inclination, where J2 apsidal drift vanishes and the periapsis stays put.',
  'A circular orbit 800 km above Earth whose plane drifts eastward at the same rate the mean Sun does, so it crosses the equator southbound at 10:30 and northbound at 22:30 local mean solar time. Its inclination is solved from its altitude rather than quoted, and its RAAN is solved from that crossing time at the moment you add it — so adding it on a different date gives a different RAAN.',
])

export type ManualOmmFieldType = 'text' | 'f64' | 'varint'
export interface ManualOmmField { readonly key: string; readonly type: ManualOmmFieldType; readonly optional: boolean }
/** The manual OMM record written by `encodeSceneDocument`, in its key order. */
export const MANUAL_OMM_FIELDS_V1: readonly ManualOmmField[] = Object.freeze([
  { key: 'OBJECT_NAME', type: 'text', optional: false },
  { key: 'OBJECT_ID', type: 'text', optional: true },
  { key: 'CLASSIFICATION_TYPE', type: 'text', optional: true },
  { key: 'EPOCH', type: 'text', optional: false },
  { key: 'MEAN_MOTION', type: 'f64', optional: false },
  { key: 'ECCENTRICITY', type: 'f64', optional: false },
  { key: 'INCLINATION', type: 'f64', optional: false },
  { key: 'RA_OF_ASC_NODE', type: 'f64', optional: false },
  { key: 'ARG_OF_PERICENTER', type: 'f64', optional: false },
  { key: 'MEAN_ANOMALY', type: 'f64', optional: false },
  { key: 'EPHEMERIS_TYPE', type: 'varint', optional: false },
  { key: 'NORAD_CAT_ID', type: 'text', optional: false },
  { key: 'BSTAR', type: 'f64', optional: false },
  { key: 'MEAN_MOTION_DOT', type: 'f64', optional: false },
  { key: 'MEAN_MOTION_DDOT', type: 'f64', optional: false },
  { key: 'ELEMENT_SET_NO', type: 'varint', optional: true },
  { key: 'REV_AT_EPOCH', type: 'varint', optional: true },
] as const)
/** Implied by every `s1` OMM object; a record must carry exactly these to be linkable. */
export const MANUAL_OMM_CONSTANTS_V1: Readonly<Record<string, string>> = Object.freeze({ CENTER_NAME: 'Earth', REF_FRAME: 'TEME', TIME_SYSTEM: 'UTC', MEAN_ELEMENT_THEORY: 'SGP4' })

export type SceneLinkUnavailable =
  | { readonly kind: 'over-limit'; readonly mode: ProductMode; readonly objectCount: number; readonly manualObjectCount: number }
  | { readonly kind: 'outside-bounds' }
export type SceneTextFailure =
  | { readonly kind: 'malformed' }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'newer-version' }
  | { readonly kind: 'unsupported-browser' }
  | { readonly kind: 'invalid-document'; readonly errors: readonly SceneDocumentError[] }
export type SceneTextDecodeResult =
  | { readonly ok: true; readonly document: SceneDocumentV1 }
  | { readonly ok: false; readonly failure: SceneTextFailure }
export type SceneLinkAvailability = { readonly ok: true } | { readonly ok: false; readonly reason: SceneLinkUnavailable }
export type SceneLinkPayloadResult = { readonly ok: true; readonly payload: string } | { readonly ok: false; readonly reason: SceneLinkUnavailable }
type DecompressionConstructor = new (format: 'deflate-raw') => TransformStream<Uint8Array, Uint8Array>
export interface SceneLinkDecodeOptions {
  /** Test seam: `null` models a browser without `DecompressionStream`. */
  readonly decompressionStream?: DecompressionConstructor | null
}

const DISPLAY_KEYS = ['orbitPathVisible', 'bodyVisible', 'groundTrackVisible', 'groundTrackHistoryRecording', 'sensorGeometryVisible'] as const
const KIND_CODES = { keplerian: 0, catalogue: 1, tle: 2, omm: 3 } as const
const MAX_VARINT = 0xffff_ffff
const TLE_LINE_LENGTH = 69
const STORED = 0x00
const DEFLATED = 0x01
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

class OutsideBounds extends Error {}
class Malformed extends Error {}

// ---------------------------------------------------------------- bytes

class ByteWriter {
  private buffer = new Uint8Array(512)
  private length = 0
  private readonly scratch = new DataView(new ArrayBuffer(8))
  private reserve(count: number): void {
    if (this.length + count <= this.buffer.length) return
    const next = new Uint8Array(Math.max(this.buffer.length * 2, this.length + count)); next.set(this.buffer.subarray(0, this.length)); this.buffer = next
  }
  u8(value: number): void { this.reserve(1); this.buffer[this.length++] = value & 0xff }
  u24(value: number): void { this.u8(value); this.u8(value >>> 8); this.u8(value >>> 16) }
  u32(value: number): void { this.u8(value); this.u8(value >>> 8); this.u8(value >>> 16); this.u8(value >>> 24) }
  f64(value: number): void { this.scratch.setFloat64(0, value, true); this.bytes(new Uint8Array(this.scratch.buffer)) }
  varint(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > MAX_VARINT) throw new OutsideBounds()
    let rest = value
    while (rest >= 0x80) { this.u8((rest & 0x7f) | 0x80); rest = Math.floor(rest / 0x80) }
    this.u8(rest)
  }
  bytes(values: Uint8Array): void { this.reserve(values.length); this.buffer.set(values, this.length); this.length += values.length }
  text(value: string): void { const encoded = new TextEncoder().encode(value); this.varint(encoded.length); this.bytes(encoded) }
  result(): Uint8Array<ArrayBuffer> { return this.buffer.slice(0, this.length) }
}

class ByteReader {
  private offset = 0
  private readonly source: Uint8Array
  private readonly view: DataView
  private readonly decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  constructor(source: Uint8Array) { this.source = source; this.view = new DataView(source.buffer, source.byteOffset, source.byteLength) }
  get done(): boolean { return this.offset === this.source.length }
  u8(): number { if (this.offset >= this.source.length) throw new Malformed(); return this.source[this.offset++] }
  u24(): number { return this.u8() | (this.u8() << 8) | (this.u8() << 16) }
  u32(): number { return (this.u8() | (this.u8() << 8) | (this.u8() << 16) | (this.u8() << 24)) >>> 0 }
  f64(): number { if (this.offset + 8 > this.source.length) throw new Malformed(); const value = this.view.getFloat64(this.offset, true); this.offset += 8; return value }
  /** Unsigned LEB128 of at most five bytes, minimal, at most 2^32 - 1. */
  varint(): number {
    let value = 0
    for (let index = 0; index < 5; index++) {
      const byte = this.u8()
      if (index === 4 && byte > 0x0f) throw new Malformed()
      value += (byte & 0x7f) * 2 ** (7 * index)
      if ((byte & 0x80) === 0) { if (index > 0 && byte === 0) throw new Malformed(); return value }
    }
    throw new Malformed()
  }
  bytes(count: number): Uint8Array { if (this.offset + count > this.source.length) throw new Malformed(); const slice = this.source.subarray(this.offset, this.offset + count); this.offset += count; return slice }
  text(): string { const bytes = this.bytes(this.varint()); try { return this.decoder.decode(bytes) } catch { throw new Malformed() } }
  ascii(count: number): string { const bytes = this.bytes(count); if (bytes.some((byte) => byte > 0x7f)) throw new Malformed(); return String.fromCharCode(...bytes) }
}

// ------------------------------------------------------------- base64url

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const BASE64URL_VALUES = new Map([...BASE64URL].map((character, index) => [character, index]))

export function base64UrlEncode(bytes: Uint8Array): string {
  let text = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0)
    const characters = Math.min(4, Math.ceil((bytes.length - index) * 4 / 3))
    for (let position = 0; position < characters; position++) text += BASE64URL[(chunk >>> (18 - 6 * position)) & 0x3f]
  }
  return text
}

/** Strict: URL-safe alphabet, no padding, zero trailing bits. */
export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> | null {
  if (text.length % 4 === 1) return null
  const output = new Uint8Array(Math.floor(text.length * 3 / 4))
  let bits = 0; let bitCount = 0; let written = 0
  for (const character of text) {
    const value = BASE64URL_VALUES.get(character)
    if (value === undefined) return null
    bits = ((bits << 6) | value) & 0xffffff; bitCount += 6
    if (bitCount >= 8) { bitCount -= 8; output[written++] = (bits >>> bitCount) & 0xff }
  }
  if ((bits & ((1 << bitCount) - 1)) !== 0) return null
  return output
}

// -------------------------------------------------------------- encoding

function linkName(value: string): string {
  // A lone surrogate would not survive UTF-8.
  if (value.length > MAX_LINK_NAME_UNITS || LONE_SURROGATE.test(value)) throw new OutsideBounds()
  return value
}
function ommAscii(value: string): string {
  if (value.length > MAX_LINK_OMM_ASCII_CHARS || !/^[\x20-\x7e]*$/.test(value)) throw new OutsideBounds()
  return value
}

function snapshotStamp(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z'
}
function writeSnapshot(writer: ByteWriter, snapshotId: string): void {
  if (!SNAPSHOT_ID_PATTERN.test(snapshotId)) throw new OutsideBounds()
  const seconds = Date.UTC(+snapshotId.slice(0, 4), +snapshotId.slice(4, 6) - 1, +snapshotId.slice(6, 8), +snapshotId.slice(9, 11), +snapshotId.slice(11, 13), +snapshotId.slice(13, 15)) / 1000
  if (!(seconds >= 0 && seconds <= MAX_VARINT) || snapshotStamp(seconds) !== snapshotId.slice(0, 16)) throw new OutsideBounds()
  writer.u32(seconds)
  for (let index = 17; index < 29; index += 2) writer.u8(parseInt(snapshotId.slice(index, index + 2), 16))
}

function writePresentation(writer: ByteWriter, object: ObjectPresentationV1, kind: number): void {
  let display = 0
  DISPLAY_KEYS.forEach((key, bit) => { if (object.display[key]) display |= 1 << bit })
  writer.u8(kind | (display << 2))
  const values = [object.style.markerSizeRenderUnits, object.sensor.fieldOfViewHalfAngleRad, object.sensor.maxOffNadirSteeringRad, object.reachConstraint.minimumGroundElevationRad]
  const defaults = [LINK_DEFAULTS_V1.markerSizeRenderUnits, LINK_DEFAULTS_V1.fieldOfViewHalfAngleRad, LINK_DEFAULTS_V1.maxOffNadirSteeringRad, LINK_DEFAULTS_V1.minimumGroundElevationRad]
  let flags = 0
  values.forEach((value, bit) => { if (Object.is(value, defaults[bit])) flags |= 1 << bit })
  writer.u8(flags)
  writer.u24(object.style.colorHex)
  values.forEach((value, bit) => { if ((flags & (1 << bit)) === 0) writer.f64(value) })
}

function writeKeplerian(writer: ByteWriter, object: KeplerianObjectV1): void {
  writePresentation(writer, object, KIND_CODES.keplerian)
  writer.u8((object.propagation === 'j2Secular' ? 1 : 0) | (object.editingLock === 'sunSynchronous' ? 2 : 0))
  const { geometry, phase } = object
  for (const value of [geometry.semiMajorAxisKm, geometry.eccentricity, geometry.inclinationRad, geometry.raanRad, geometry.argOfPeriapsisRad, phase.referenceUnixSeconds, phase.meanAnomalyAtReferenceRad]) writer.f64(value)
  writer.text(linkName(object.name))
  if (object.notes === null) writer.varint(0)
  else { const index = SHARED_NOTES_V1.indexOf(object.notes); if (index < 0) throw new OutsideBounds(); writer.varint(index + 1) }
}

function writeCatalogue(writer: ByteWriter, object: CatalogueObjectRefV1, snapshotIndex: number): void {
  writePresentation(writer, object, KIND_CODES.catalogue)
  // A leading zero would not survive the integer form.
  if (String(Number(object.catalogId)) !== object.catalogId) throw new OutsideBounds()
  writer.varint(Number(object.catalogId))
  writer.varint(snapshotIndex)
  writer.f64(object.savedEpochUnixSeconds)
}

function writeTle(writer: ByteWriter, object: ManualTleObjectV1): void {
  writePresentation(writer, object, KIND_CODES.tle)
  writer.text(object.name === null ? '' : linkName(object.name))
  for (const line of [object.line1, object.line2]) {
    if (line.length !== TLE_LINE_LENGTH || !/^[\x00-\x7f]*$/.test(line)) throw new OutsideBounds()
    writer.bytes(new TextEncoder().encode(line))
  }
}

function writeOmm(writer: ByteWriter, object: ManualOmmObjectV1): void {
  writePresentation(writer, object, KIND_CODES.omm)
  const record = object.record
  const known = new Set([...MANUAL_OMM_FIELDS_V1.map((field) => field.key), ...Object.keys(MANUAL_OMM_CONSTANTS_V1)])
  if (Object.keys(record).some((key) => !known.has(key))) throw new OutsideBounds()
  for (const [key, value] of Object.entries(MANUAL_OMM_CONSTANTS_V1)) if (record[key] !== value) throw new OutsideBounds()
  for (const field of MANUAL_OMM_FIELDS_V1) {
    const value = Object.hasOwn(record, field.key) ? record[field.key] : undefined
    if (value === undefined && !field.optional) throw new OutsideBounds()
    if (field.type === 'text') {
      if (value === undefined) { writer.text(''); continue }
      if (typeof value !== 'string' || (field.optional && value === '')) throw new OutsideBounds()
      writer.text(field.key === 'OBJECT_NAME' ? linkName(value) : ommAscii(value))
    } else if (field.type === 'f64') {
      if (typeof value !== 'number') throw new OutsideBounds()
      writer.f64(value)
    } else {
      if (value === undefined) { writer.varint(0); continue }
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || (field.optional && value >= MAX_VARINT)) throw new OutsideBounds()
      writer.varint(field.optional ? value + 1 : value)
    }
  }
}

/** The uncompressed `s1` body of a shared document's active scene. */
function sceneLinkBody(document: SceneDocumentV1): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter()
  const mode = document.activeMode
  const scene = mode === 'orbitLab' ? document.orbitLab : document.realObjects
  writer.u8((mode === 'realObjects' ? 1 : 0) | (document.view.groundTrackMapVisible ? 2 : 0) | (document.view.scaleMarkersWithZoom ? 4 : 0))
  writer.varint(scene.objects.length)
  const indexOf = (id: string): number => { const index = scene.objects.findIndex((object) => object.id === id); if (index < 0) throw new OutsideBounds(); return index }
  writer.varint(scene.selectedIds.length)
  for (const id of scene.selectedIds) writer.varint(indexOf(id))
  writer.varint(scene.primaryId === null ? 0 : indexOf(scene.primaryId) + 1)
  if (mode === 'orbitLab') {
    for (const object of document.orbitLab.objects) writeKeplerian(writer, object)
    return writer.result()
  }
  const snapshots: string[] = []
  for (const object of document.realObjects.objects) if (object.kind === 'catalogue' && !snapshots.includes(object.savedSnapshotId)) snapshots.push(object.savedSnapshotId)
  writer.varint(snapshots.length)
  for (const snapshotId of snapshots) writeSnapshot(writer, snapshotId)
  for (const object of document.realObjects.objects) {
    if (object.kind === 'catalogue') writeCatalogue(writer, object, snapshots.indexOf(object.savedSnapshotId))
    else if (object.kind === 'tle') writeTle(writer, object)
    else writeOmm(writer, object)
  }
  return writer.result()
}

function container(tag: number, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(body.length + 1); bytes[0] = tag; bytes.set(body, 1); return bytes
}

async function deflateRaw(body: Uint8Array<ArrayBuffer>): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  try { return new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()) } catch { return null }
}

/** Characters of the uncompressed payload; throws `OutsideBounds` for unlinkable scenes. */
function storedPayloadLength(document: SceneDocumentV1): number { return Math.ceil((sceneLinkBody(document).length + 1) * 4 / 3) }

/** Link limits first, then the text bounds, then the payload budget. The
 *  stored container is the size bound, so this answer never depends on
 *  whether the browser can compress. */
export function sceneLinkAvailability(document: SceneDocumentV1): SceneLinkAvailability {
  const summary = sharedSceneSummary(document)
  const overLimit = summary.mode === 'orbitLab'
    ? summary.objectCount > MAX_LINK_ORBIT_LAB_OBJECTS
    : summary.objectCount > MAX_LINK_REAL_OBJECTS || summary.manualObjectCount > MAX_LINK_MANUAL_REAL_OBJECTS
  if (overLimit) return { ok: false, reason: { kind: 'over-limit', mode: summary.mode, objectCount: summary.objectCount, manualObjectCount: summary.manualObjectCount } }
  try {
    if (storedPayloadLength(document) > MAX_SCENE_LINK_PAYLOAD_CHARS) return { ok: false, reason: { kind: 'outside-bounds' } }
  } catch (error) {
    if (error instanceof OutsideBounds) return { ok: false, reason: { kind: 'outside-bounds' } }
    throw error
  }
  return { ok: true }
}

/** Uncompressed body bytes of a linkable scene, or null. For size evidence and tests. */
export function sceneLinkBodyLength(document: SceneDocumentV1): number | null {
  try { return sceneLinkBody(document).length } catch (error) { if (error instanceof OutsideBounds) return null; throw error }
}

/** The `s1` payload. `compress: 'auto'` keeps the deflated container only when
 *  it is shorter; `'never'` and `'always'` exist for fixtures and tests. */
export async function encodeSceneLinkPayload(document: SceneDocumentV1, options: { readonly compress?: 'auto' | 'never' | 'always' } = {}): Promise<SceneLinkPayloadResult> {
  const availability = sceneLinkAvailability(document)
  if (!availability.ok) return availability
  const body = sceneLinkBody(document)
  const stored = container(STORED, body)
  const compress = options.compress ?? 'auto'
  const deflated = compress === 'never' ? null : await deflateRaw(body)
  const chosen = deflated && (compress === 'always' || deflated.length + 1 < stored.length) ? container(DEFLATED, deflated) : stored
  return { ok: true, payload: base64UrlEncode(chosen) }
}

export async function createSceneLink(document: SceneDocumentV1, base: { readonly origin: string; readonly pathname: string }): Promise<{ readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: SceneLinkUnavailable }> {
  const encoded = await encodeSceneLinkPayload(document)
  if (!encoded.ok) return encoded
  return { ok: true, url: `${base.origin}${base.pathname}#${SCENE_LINK_FRAGMENT_KEY}=${SCENE_LINK_ENCODING}.${encoded.payload}` }
}

// -------------------------------------------------------------- fragment

function fragmentEntries(hash: string): string[] { const text = hash.startsWith('#') ? hash.slice(1) : hash; return text === '' ? [] : text.split('&') }
function entryKey(entry: string): string { const equals = entry.indexOf('='); return equals < 0 ? entry : entry.slice(0, equals) }

/** The `scene` value of a location hash, split at its first dot; null when absent. */
export function sceneLinkPayload(hash: string): { readonly encoding: string; readonly payload: string } | null {
  const entry = fragmentEntries(hash).find((candidate) => entryKey(candidate) === SCENE_LINK_FRAGMENT_KEY)
  if (entry === undefined) return null
  const value = entry.slice(SCENE_LINK_FRAGMENT_KEY.length + 1)
  const dot = value.indexOf('.')
  return dot < 0 ? { encoding: value, payload: '' } : { encoding: value.slice(0, dot), payload: value.slice(dot + 1) }
}

/** The hash with every `scene` key removed and other keys kept; '' when none remain. */
export function hashWithoutSceneKey(hash: string): string {
  const kept = fragmentEntries(hash).filter((entry) => entryKey(entry) !== SCENE_LINK_FRAGMENT_KEY)
  return kept.length === 0 ? '' : `#${kept.join('&')}`
}

// -------------------------------------------------------------- decoding

function readPresentation(reader: ByteReader, header: number): Omit<ObjectPresentationV1, 'id'> {
  if (header & 0x80) throw new Malformed()
  const display = header >>> 2
  const flags = reader.u8()
  if (flags & 0xf0) throw new Malformed()
  const colorHex = reader.u24()
  const defaults = [LINK_DEFAULTS_V1.markerSizeRenderUnits, LINK_DEFAULTS_V1.fieldOfViewHalfAngleRad, LINK_DEFAULTS_V1.maxOffNadirSteeringRad, LINK_DEFAULTS_V1.minimumGroundElevationRad]
  const [markerSizeRenderUnits, fieldOfViewHalfAngleRad, maxOffNadirSteeringRad, minimumGroundElevationRad] = defaults.map((value, bit) => flags & (1 << bit) ? value : reader.f64())
  const displayValues = Object.fromEntries(DISPLAY_KEYS.map((key, bit) => [key, (display & (1 << bit)) !== 0])) as unknown as ObjectPresentationV1['display']
  return { style: { colorHex, markerSizeRenderUnits }, sensor: { fieldOfViewHalfAngleRad, maxOffNadirSteeringRad }, reachConstraint: { minimumGroundElevationRad }, display: displayValues }
}

function readKeplerian(reader: ByteReader, presentation: Omit<ObjectPresentationV1, 'id'>): KeplerianObjectV1 {
  const model = reader.u8()
  if (model & 0xfc) throw new Malformed()
  const [semiMajorAxisKm, eccentricity, inclinationRad, raanRad, argOfPeriapsisRad, referenceUnixSeconds, meanAnomalyAtReferenceRad] = Array.from({ length: 7 }, () => reader.f64())
  const name = reader.text()
  const noteIndex = reader.varint()
  if (noteIndex > SHARED_NOTES_V1.length) throw new Malformed()
  return {
    id: '', ...presentation, kind: 'keplerian', name, notes: noteIndex === 0 ? null : SHARED_NOTES_V1[noteIndex - 1],
    geometry: { semiMajorAxisKm, eccentricity, inclinationRad, raanRad, argOfPeriapsisRad }, phase: { referenceUnixSeconds, meanAnomalyAtReferenceRad },
    propagation: model & 1 ? 'j2Secular' : 'idealTwoBody', editingLock: model & 2 ? 'sunSynchronous' : 'none',
  }
}

function readOmmRecord(reader: ByteReader): Record<string, string | number> {
  const record: Record<string, string | number> = {}
  for (const field of MANUAL_OMM_FIELDS_V1) {
    if (field.type === 'text') { const value = reader.text(); if (value !== '' || !field.optional) record[field.key] = value }
    else if (field.type === 'f64') record[field.key] = reader.f64()
    else { const value = reader.varint(); if (!field.optional) record[field.key] = value; else if (value > 0) record[field.key] = value - 1 }
  }
  return { ...record, ...MANUAL_OMM_CONSTANTS_V1 }
}

function readRealObject(reader: ByteReader, header: number, snapshots: readonly string[]): RealObjectV1 {
  const kind = header & 0x03
  const presentation = readPresentation(reader, header)
  if (kind === KIND_CODES.catalogue) {
    const catalogId = String(reader.varint())
    const snapshotIndex = reader.varint()
    if (snapshotIndex >= snapshots.length) throw new Malformed()
    return { id: '', ...presentation, kind: 'catalogue', catalogId, savedSnapshotId: snapshots[snapshotIndex], savedEpochUnixSeconds: reader.f64() }
  }
  if (kind === KIND_CODES.tle) {
    const name = reader.text()
    return { id: '', ...presentation, kind: 'tle', name: name === '' ? null : name, line1: reader.ascii(TLE_LINE_LENGTH), line2: reader.ascii(TLE_LINE_LENGTH) }
  }
  if (kind === KIND_CODES.omm) return { id: '', ...presentation, kind: 'omm', record: readOmmRecord(reader) }
  throw new Malformed()
}

function readSceneLinkBody(body: Uint8Array): SceneDocumentV1 {
  const reader = new ByteReader(body)
  const flags = reader.u8()
  if (flags & 0xf8) throw new Malformed()
  const mode: ProductMode = flags & 1 ? 'realObjects' : 'orbitLab'
  const objectCount = reader.varint()
  if (objectCount > MAX_SCENE_DOCUMENT_OBJECTS) throw new Malformed()
  const selectedCount = reader.varint()
  if (selectedCount > objectCount) throw new Malformed()
  const selected = Array.from({ length: selectedCount }, () => reader.varint())
  const primary = reader.varint()
  if (primary > objectCount || selected.some((index) => index >= objectCount)) throw new Malformed()
  const snapshots: string[] = []
  if (mode === 'realObjects') {
    const snapshotCount = reader.varint()
    if (snapshotCount > objectCount) throw new Malformed()
    for (let index = 0; index < snapshotCount; index++) {
      const seconds = reader.u32()
      const suffix = [...reader.bytes(6)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      snapshots.push(`${snapshotStamp(seconds)}-${suffix}`)
    }
  }
  const objects: (KeplerianObjectV1 | RealObjectV1)[] = []
  for (let index = 0; index < objectCount; index++) {
    const header = reader.u8()
    if (mode === 'orbitLab' && (header & 0x03) !== KIND_CODES.keplerian) throw new Malformed()
    objects.push(mode === 'orbitLab' ? readKeplerian(reader, readPresentation(reader, header)) : readRealObject(reader, header, snapshots))
  }
  if (!reader.done) throw new Malformed()
  const ids = normalizedSceneIds(objects)
  const scene = { objects: objects.map((object, index) => ({ ...object, id: ids[index] })), selectedIds: selected.map((index) => ids[index]), primaryId: primary === 0 ? null : ids[primary - 1] }
  const empty = { objects: [], selectedIds: [], primaryId: null }
  return {
    format: SCENE_DOCUMENT_FORMAT, version: 1, activeMode: mode, simulation: null,
    view: { groundTrackMapVisible: (flags & 2) !== 0, scaleMarkersWithZoom: (flags & 4) !== 0 },
    orbitLab: mode === 'orbitLab' ? scene as SceneDocumentV1['orbitLab'] : empty,
    realObjects: mode === 'realObjects' ? scene as SceneDocumentV1['realObjects'] : empty,
  }
}

async function inflateRaw(bytes: Uint8Array, Decompression: DecompressionConstructor): Promise<Uint8Array | SceneTextFailure> {
  let stream: TransformStream<Uint8Array, Uint8Array>
  try { stream = new Decompression('deflate-raw') } catch { return { kind: 'unsupported-browser' } }
  const writer = stream.writable.getWriter()
  writer.closed.catch(() => {})
  // Written in small slices, each awaited, so a browser that inflates a
  // whole chunk at once never inflates more than one slice past the limit.
  const writing = (async () => {
    for (let offset = 0; offset < bytes.byteLength; offset += 1024) {
      await writer.ready
      await writer.write(bytes.subarray(offset, offset + 1024))
    }
    await writer.close()
  })().catch(() => {})
  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      // Streamed, so a decompression bomb stops at the limit rather than after.
      if (total > MAX_SCENE_LINK_BODY_BYTES) { reader.cancel().catch(() => {}); writer.abort().catch(() => {}); return { kind: 'too-large' } }
      chunks.push(value)
    }
  } catch { return { kind: 'malformed' } }
  await writing
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return body
}

function failed(failure: SceneTextFailure): SceneTextDecodeResult { return { ok: false, failure } }

/** Decoding checks, in order. Never throws for untrusted input. */
export async function decodeSceneLinkPayload(encoding: string, payload: string, options: SceneLinkDecodeOptions = {}): Promise<SceneTextDecodeResult> {
  if (encoding !== SCENE_LINK_ENCODING) return failed({ kind: /^s[1-9]\d{0,5}$/.test(encoding) ? 'newer-version' : 'malformed' })
  if (payload.length > MAX_SCENE_LINK_ACCEPTED_CHARS) return failed({ kind: 'too-large' })
  const bytes = base64UrlDecode(payload)
  if (!bytes || bytes.length === 0) return failed({ kind: 'malformed' })
  let body: Uint8Array
  if (bytes[0] === STORED) body = bytes.subarray(1)
  else if (bytes[0] === DEFLATED) {
    const Decompression = options.decompressionStream === undefined ? (globalThis.DecompressionStream as unknown as DecompressionConstructor | undefined) : options.decompressionStream
    if (!Decompression) return failed({ kind: 'unsupported-browser' })
    const inflated = await inflateRaw(bytes.subarray(1), Decompression)
    if (!(inflated instanceof Uint8Array)) return failed(inflated)
    body = inflated
  } else return failed({ kind: 'malformed' })
  if (body.length > MAX_SCENE_LINK_BODY_BYTES) return failed({ kind: 'too-large' })
  let document: SceneDocumentV1
  try { document = readSceneLinkBody(body) } catch (error) {
    if (error instanceof Malformed) return failed({ kind: 'malformed' })
    throw error
  }
  const shared = toSharedScene(document)
  return shared.ok ? { ok: true, document: shared.document } : failed({ kind: 'invalid-document', errors: shared.errors })
}
