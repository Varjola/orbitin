import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { earthFixedToRenderLocal } from '../core/renderFrame.ts'
import type { RenderVec3 } from '../core/referenceFrames.ts'
import {
  GROUND_TRACK_SURFACE_LIFT_RENDER_UNITS,
  type GroundTrackSegment,
  type GroundTrackWindow,
  type SubSatellitePoint,
} from '../simulation/groundTrack.ts'

const STANDARD_LINE_WIDTH = 2
const SELECTED_LINE_WIDTH = 3
const CURRENT_MARKER_RADIUS = 0.012
/**
 * The physical lift alone becomes comparable to one depth-buffer step when the
 * camera is far from Earth. Line2 is a triangle strip, so polygon offset gives
 * the surface overlay a stable tie-break without disabling far-side occlusion.
 */
const GROUND_TRACK_DEPTH_BIAS_FACTOR = -1
const GROUND_TRACK_DEPTH_BIAS_UNITS = -2
const LINE_NAMES: Record<TrackKind, string> = {
  trailing: 'Trailing ground track',
  leading: 'Leading ground track',
  history: 'Recorded ground track',
}

type TrackKind = 'trailing' | 'leading' | 'history'

interface TrackLine {
  readonly line: Line2
  /** Replaced, not rewritten, on every upload. See `uploadPositions`. */
  geometry: LineGeometry
  readonly material: LineMaterial
  /** Last uploaded segment and its length. A recorded history segment is either
   *  a completed segment that is never touched again or the one open segment
   *  whose array grows, so matching both means the buffer is already correct and
   *  a re-upload of up to twenty thousand points can be skipped. */
  source: GroundTrackSegment | null
  uploadedPoints: number
}

/** Three.js adapter for Earth-fixed domain track data.
 *
 * The parent is the shared Earth-fixed root. The view never computes frames,
 * longitude seams or propagation; it only turns immutable domain directions
 * into local render vertices and owns their resources.
 */
export class GroundTrackView {
  private readonly group = new THREE.Group()
  private readonly marker: THREE.Mesh
  private readonly registerMaterial: (material: LineMaterial) => void
  private readonly unregisterMaterial: (material: LineMaterial) => void
  private readonly trailing: TrackLine[] = []
  private readonly leading: TrackLine[] = []
  private readonly history: TrackLine[] = []
  private colorHex: number
  private selected = false
  private visible = false
  private disposed = false

  constructor(
    parent: THREE.Object3D,
    colorHex: number,
    registerMaterial: (material: LineMaterial) => void,
    unregisterMaterial: (material: LineMaterial) => void,
  ) {
    this.colorHex = colorHex
    this.registerMaterial = registerMaterial
    this.unregisterMaterial = unregisterMaterial
    this.group.name = 'Ground track'
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 8),
      new THREE.MeshBasicMaterial({ color: colorHex, depthTest: true, depthWrite: false }),
    )
    this.marker.name = 'Sub-satellite point'
    this.marker.scale.setScalar(CURRENT_MARKER_RADIUS)
    this.group.add(this.marker)
    parent.add(this.group)
  }

  setCurrent(point: SubSatellitePoint | null): void {
    if (!point) { this.marker.visible = false; return }
    const direction: RenderVec3 = earthFixedToRenderLocal(point.directionEarthFixed)
    // Rest the marker on the lifted surface instead of placing its centre
    // there, which embedded most of the sphere inside Earth.
    const radius = 1 + GROUND_TRACK_SURFACE_LIFT_RENDER_UNITS + CURRENT_MARKER_RADIUS
    this.marker.position.set(direction.x * radius, direction.y * radius, direction.z * radius)
    this.marker.visible = true
  }

  setWindow(window: GroundTrackWindow | null): void {
    this.rebuildLineGroup(this.trailing, window?.trailing ?? [], 'trailing')
    this.rebuildLineGroup(this.leading, window?.leading ?? [], 'leading')
  }

  /** Recorded Earth-fixed history. Passing null releases every history line, so
   *  turning recording off leaves nothing of the trail behind. */
  setHistory(segments: readonly GroundTrackSegment[] | null): void {
    this.rebuildLineGroup(this.history, segments ?? [], 'history')
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.group.visible = visible
  }

  setColor(colorHex: number): void {
    this.colorHex = colorHex
    ;(this.marker.material as THREE.MeshBasicMaterial).color.setHex(colorHex)
    for (const trackLine of this.allLines()) trackLine.material.color.setHex(colorHex)
  }

  setSelected(selected: boolean): void {
    this.selected = selected
    for (const trackLine of this.allLines()) trackLine.material.linewidth = selected ? SELECTED_LINE_WIDTH : STANDARD_LINE_WIDTH
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.group.removeFromParent()
    this.marker.geometry.dispose()
    ;(this.marker.material as THREE.Material).dispose()
    this.disposeLines(this.trailing)
    this.disposeLines(this.leading)
    this.disposeLines(this.history)
    this.trailing.length = 0
    this.leading.length = 0
    this.history.length = 0
  }

  private allLines(): TrackLine[] {
    return [...this.trailing, ...this.leading, ...this.history]
  }

  private rebuildLineGroup(target: TrackLine[], segments: readonly GroundTrackSegment[], kind: TrackKind): void {
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      let trackLine = target[index]
      if (!trackLine) {
        trackLine = this.createLine(kind)
        target[index] = trackLine
      }
      if (trackLine.source === segment && trackLine.uploadedPoints === segment.points.length) {
        trackLine.line.visible = this.visible
        continue
      }
      const positions: number[] = []
      for (const point of segment.points) {
        const direction = earthFixedToRenderLocal(point.directionEarthFixed)
        positions.push(
          direction.x * (1 + GROUND_TRACK_SURFACE_LIFT_RENDER_UNITS),
          direction.y * (1 + GROUND_TRACK_SURFACE_LIFT_RENDER_UNITS),
          direction.z * (1 + GROUND_TRACK_SURFACE_LIFT_RENDER_UNITS),
        )
      }
      this.uploadPositions(trackLine, positions)
      trackLine.source = segment
      trackLine.uploadedPoints = segment.points.length
      trackLine.line.visible = this.visible
    }
    while (target.length > segments.length) {
      const surplus = target.pop()!
      this.disposeLine(surplus)
    }
  }

  /** Upload one segment into a **fresh** `LineGeometry` and retire the old one.
   *
   * `LineGeometry.setPositions` replaces the instanced buffer but three.js
   * latches `_maxInstanceCount` from the first buffer a geometry ever binds and
   * never recomputes it, so a re-upload that grows the polyline is silently
   * truncated back to the original segment count - the ground-track window is
   * resampled several times a second and its seam-split segments change length
   * constantly, which left most of a track undrawn. A new geometry per upload
   * starts with no latched count, and disposing the previous one releases the
   * GPU buffer that replacing attributes in place would have orphaned.
   */
  private uploadPositions(trackLine: TrackLine, positions: readonly number[]): void {
    const geometry = new LineGeometry()
    geometry.setPositions(positions as number[])
    const previous = trackLine.geometry
    trackLine.geometry = geometry
    trackLine.line.geometry = geometry
    trackLine.line.computeLineDistances()
    previous.dispose()
  }

  private createLine(kind: TrackKind): TrackLine {
    const dashed = kind === 'leading'
    const geometry = new LineGeometry()
    const material = new LineMaterial({
      color: this.colorHex,
      linewidth: this.selected ? SELECTED_LINE_WIDTH : STANDARD_LINE_WIDTH,
      transparent: true,
      opacity: dashed ? 0.55 : 0.85,
      dashed,
      dashSize: 0.06,
      gapSize: 0.045,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: GROUND_TRACK_DEPTH_BIAS_FACTOR,
      polygonOffsetUnits: GROUND_TRACK_DEPTH_BIAS_UNITS,
    })
    const line = new Line2(geometry, material)
    line.name = LINE_NAMES[kind]
    this.group.add(line)
    this.registerMaterial(material)
    return { line, geometry, material, source: null, uploadedPoints: 0 }
  }

  private disposeLines(lines: readonly TrackLine[]): void {
    for (const trackLine of lines) this.disposeLine(trackLine)
  }

  private disposeLine(trackLine: TrackLine): void {
    trackLine.line.removeFromParent()
    this.unregisterMaterial(trackLine.material)
    trackLine.geometry.dispose()
    trackLine.material.dispose()
  }
}
