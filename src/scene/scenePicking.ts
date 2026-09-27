import * as THREE from 'three'
import { pointNearRect, type ScreenPoint, type ScreenRect } from '../core/screenGeometry.ts'
import { distanceToSegmentCssPx } from '../core/screenGeometry.ts'
import { markerPickRadiusCssPx, MOUSE_PICK_TOLERANCES, type PickHit, type PickTolerances } from '../interaction/pickRanking.ts'

/** Screen-space 3D picking.
 *
 * Performance contract: each object's projected path polylines, their
 * per-vertex depths and a screen rectangle per polyline are cached and reused
 * while the camera's projection-view matrix, the viewport size and that
 * object's path `pickRevision` are unchanged. Only markers, which move every
 * frame while time runs, are re-projected on each pick. The broad phase
 * rejects whole polylines, then 16-segment chunks, whose rectangle (grown by
 * the pick radius) does not contain the pointer. */

/** Earth is the unit sphere at the render origin. */
const EARTH_RADIUS_RENDER = 1
const OCCLUSION_EPSILON = 1e-6

export interface PickSource {
  readonly id: string
  readonly errored: boolean
  readonly bodyVisible: boolean
  readonly orbitPathVisible: boolean
  readonly body: {
    pickPositionRender?(): { readonly x: number; readonly y: number; readonly z: number } | null
    renderedRadiusRender?(): number
  }
  readonly path: {
    pickPolylinesRender?(): readonly Float32Array[]
    pickRevision?(): number
  }
}

export interface Viewport { readonly width: number; readonly height: number }

export interface ProjectedPoint {
  readonly x: number
  readonly y: number
  /** Camera distance in render units. */
  readonly depth: number
}

/** Vertices per broad-phase chunk. Concentric orbits share one bounding
 *  rectangle around the Earth, so the whole-polyline rectangle alone rejects
 *  little; chunk rectangles keep the segment tests near the pointer. */
const PICK_CHUNK_SEGMENTS = 16

interface ProjectedPolyline {
  /** `[x0, y0, x1, y1, ...]`; NaN marks a vertex behind the camera or occluded. */
  readonly screen: Float32Array
  readonly depths: Float32Array
  readonly rect: ScreenRect
  /** Rectangle of segments `[i * 16, (i + 1) * 16)`, over their valid vertices. */
  readonly chunks: readonly ScreenRect[]
}

interface PathCacheEntry {
  cameraVersion: number
  width: number
  height: number
  revision: number
  polylines: ProjectedPolyline[]
}

/** True when the straight line of sight from `camera` to `point` passes
 *  through the Earth sphere before reaching the point. */
export function occludedByEarth(camera: { readonly x: number; readonly y: number; readonly z: number }, point: { readonly x: number; readonly y: number; readonly z: number }): boolean {
  const dx = point.x - camera.x, dy = point.y - camera.y, dz = point.z - camera.z
  const a = dx * dx + dy * dy + dz * dz
  if (a === 0) return false
  const b = 2 * (camera.x * dx + camera.y * dy + camera.z * dz)
  const c = camera.x * camera.x + camera.y * camera.y + camera.z * camera.z - EARTH_RADIUS_RENDER * EARTH_RADIUS_RENDER
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return false
  const entry = (-b - Math.sqrt(discriminant)) / (2 * a)
  return entry > 0 && entry < 1 - OCCLUSION_EPSILON
}

export class ScenePicker {
  private readonly camera: THREE.PerspectiveCamera
  private readonly viewProjection = new THREE.Matrix4()
  private readonly lastViewProjection = new Float64Array(16).fill(Number.NaN)
  private readonly cameraPosition = new THREE.Vector3()
  private cameraVersion = 0
  private readonly pathCache = new Map<string, PathCacheEntry>()
  /** Verification counters: path projections rebuilt, and segment tests run. */
  projectionsBuilt = 0
  segmentTests = 0

  constructor(camera: THREE.PerspectiveCamera) { this.camera = camera }

  /** Refreshes the camera matrices this picker projects with. */
  private syncCamera(): void {
    this.camera.updateMatrixWorld()
    this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
    this.cameraPosition.setFromMatrixPosition(this.camera.matrixWorld)
    const elements = this.viewProjection.elements
    let changed = false
    for (let index = 0; index < 16; index += 1) if (elements[index] !== this.lastViewProjection[index]) { changed = true; this.lastViewProjection[index] = elements[index] }
    if (changed) this.cameraVersion += 1
  }

  /** Screen position and depth of a world point, or null when it is behind
   *  the camera or, unless `occlusion` is false, hidden by the Earth. */
  project(point: { readonly x: number; readonly y: number; readonly z: number }, viewport: Viewport, alreadySynced = false, occlusion = true): ProjectedPoint | null {
    if (!alreadySynced) this.syncCamera()
    const e = this.viewProjection.elements
    const w = e[3] * point.x + e[7] * point.y + e[11] * point.z + e[15]
    if (!(w > 0)) return null
    if (occlusion && occludedByEarth(this.cameraPosition, point)) return null
    const x = (e[0] * point.x + e[4] * point.y + e[8] * point.z + e[12]) / w
    const y = (e[1] * point.x + e[5] * point.y + e[9] * point.z + e[13]) / w
    return {
      x: (x + 1) / 2 * viewport.width,
      y: (1 - y) / 2 * viewport.height,
      depth: Math.hypot(point.x - this.cameraPosition.x, point.y - this.cameraPosition.y, point.z - this.cameraPosition.z),
    }
  }

  /** Every marker and path hit at `point`, unranked. */
  pick(point: ScreenPoint, viewport: Viewport, sources: Iterable<PickSource>, tolerances: PickTolerances = MOUSE_PICK_TOLERANCES): PickHit[] {
    this.syncCamera()
    const hits: PickHit[] = []
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)
    const seen = new Set<string>()
    for (const source of sources) {
      seen.add(source.id)
      if (source.errored) continue
      if (source.bodyVisible) {
        const position = source.body.pickPositionRender?.()
        const projected = position ? this.project(position, viewport, true) : null
        if (projected) {
          const radiusRender = source.body.renderedRadiusRender?.() ?? 0
          const radiusCssPx = radiusRender / (projected.depth * tanHalfFov) * (viewport.height / 2)
          const distance = Math.hypot(point.x - projected.x, point.y - projected.y)
          if (distance <= markerPickRadiusCssPx(radiusCssPx, tolerances)) hits.push({ objectId: source.id, kind: 'marker', distanceCssPx: distance, depth: projected.depth })
        }
      }
      if (source.orbitPathVisible && source.path.pickPolylinesRender) {
        const hit = this.pickPath(source, point, viewport, tolerances.pathCssPx)
        if (hit) hits.push(hit)
      }
    }
    for (const id of this.pathCache.keys()) if (!seen.has(id)) this.pathCache.delete(id)
    return hits
  }

  private pickPath(source: PickSource, point: ScreenPoint, viewport: Viewport, radiusCssPx: number): PickHit | null {
    const revision = source.path.pickRevision?.() ?? 0
    let entry = this.pathCache.get(source.id)
    if (!entry || entry.cameraVersion !== this.cameraVersion || entry.width !== viewport.width || entry.height !== viewport.height || entry.revision !== revision) {
      entry = { cameraVersion: this.cameraVersion, width: viewport.width, height: viewport.height, revision, polylines: (source.path.pickPolylinesRender?.() ?? []).map((world) => this.projectPolyline(world, viewport)) }
      this.pathCache.set(source.id, entry)
      this.projectionsBuilt += 1
    }
    let bestDistance = Infinity
    let bestDepth = Infinity
    for (const polyline of entry.polylines) {
      if (!pointNearRect(point, polyline.rect, radiusCssPx)) continue
      const { screen, depths } = polyline
      for (let chunk = 0; chunk < polyline.chunks.length; chunk += 1) {
        if (!pointNearRect(point, polyline.chunks[chunk], radiusCssPx)) continue
        const end = Math.min(depths.length, (chunk + 1) * PICK_CHUNK_SEGMENTS + 1)
        for (let index = chunk * PICK_CHUNK_SEGMENTS + 1; index < end; index += 1) {
          const ax = screen[(index - 1) * 2], bx = screen[index * 2]
          // A segment with an occluded or behind-camera endpoint is ignored.
          if (Number.isNaN(ax) || Number.isNaN(bx)) continue
          this.segmentTests += 1
          const distance = distanceToSegmentCssPx(point, { x: ax, y: screen[(index - 1) * 2 + 1] }, { x: bx, y: screen[index * 2 + 1] })
          if (distance < bestDistance) { bestDistance = distance; bestDepth = Math.min(depths[index - 1], depths[index]) }
        }
      }
    }
    return bestDistance <= radiusCssPx ? { objectId: source.id, kind: 'path', distanceCssPx: bestDistance, depth: bestDepth } : null
  }

  private projectPolyline(world: Float32Array, viewport: Viewport): ProjectedPolyline {
    const count = Math.floor(world.length / 3)
    const screen = new Float32Array(count * 2)
    const depths = new Float32Array(count)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const vertex = { x: 0, y: 0, z: 0 }
    for (let index = 0; index < count; index += 1) {
      vertex.x = world[index * 3]; vertex.y = world[index * 3 + 1]; vertex.z = world[index * 3 + 2]
      const projected = this.project(vertex, viewport, true)
      if (!projected) { screen[index * 2] = Number.NaN; screen[index * 2 + 1] = Number.NaN; depths[index] = Number.NaN; continue }
      screen[index * 2] = projected.x; screen[index * 2 + 1] = projected.y; depths[index] = projected.depth
      if (projected.x < minX) minX = projected.x
      if (projected.y < minY) minY = projected.y
      if (projected.x > maxX) maxX = projected.x
      if (projected.y > maxY) maxY = projected.y
    }
    const chunks: ScreenRect[] = []
    for (let start = 0; start < count - 1; start += PICK_CHUNK_SEGMENTS) {
      let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity
      for (let index = start; index <= Math.min(count - 1, start + PICK_CHUNK_SEGMENTS); index += 1) {
        const x = screen[index * 2], y = screen[index * 2 + 1]
        if (Number.isNaN(x)) continue
        if (x < cMinX) cMinX = x
        if (y < cMinY) cMinY = y
        if (x > cMaxX) cMaxX = x
        if (y > cMaxY) cMaxY = y
      }
      chunks.push({ minX: cMinX, minY: cMinY, maxX: cMaxX, maxY: cMaxY })
    }
    return { screen, depths, rect: { minX, minY, maxX, maxY }, chunks }
  }
}
