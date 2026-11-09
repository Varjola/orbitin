import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { RENDER_UNITS_PER_KM } from '../core/constants.ts'
import type { ProjectInertialVec3 } from '../core/referenceFrames.ts'
import { projectInertialToRender } from '../core/renderFrame.ts'
import { lengthVec3 } from '../core/vec3.ts'
import type { OrbitalState } from '../orbital/propagator.ts'
import type { OrbitApsis } from '../simulation/maneuverGame.ts'
import { OrbitalBodyView } from './OrbitalBodyView.ts'

/** Sky blue for the learner's satellite, yellow for the target and
 *  vermillion for the warning: well apart for colour-blind viewers. The
 *  apogee and perigee marks are near white. */
export const MANEUVER_COLORS = { player: 0x56b4e9, target: 0xf0e442, warning: 0xd55e00, apsis: 0xe7fbff } as const
const MARKER_SIZE_RENDER_UNITS = 0.022
const APSIS_MARK_SIZE_RENDER_UNITS = 0.014
/** A trail's oldest end is drawn at this share of its colour. */
const TRAIL_TAIL_BRIGHTNESS = 0.18

export interface ManeuverFrame {
  readonly player: OrbitalState
  readonly target: OrbitalState
  /** Oldest first, ending at the satellite. */
  readonly playerTrail: readonly ProjectInertialVec3[]
  readonly targetTrail: readonly ProjectInertialVec3[]
  /** The dashed aim line, or null when there is none. */
  readonly arc: readonly ProjectInertialVec3[] | null
  /** The apogee and perigee marks; empty when Aid is off. */
  readonly apsides: readonly OrbitApsis[]
  /** Arc points nearer Earth's centre than this are drawn in the warning colour. */
  readonly warningRadiusKm: number
}

function renderPositions(points: readonly ProjectInertialVec3[]): number[] {
  const positions: number[] = []
  for (const point of points) {
    const render = projectInertialToRender({ x: point.x * RENDER_UNITS_PER_KM, y: point.y * RENDER_UNITS_PER_KM, z: point.z * RENDER_UNITS_PER_KM })
    positions.push(render.x, render.y, render.z)
  }
  return positions
}

/** One colour per point: the line's own, or the warning colour below the
 *  re-entry altitude. */
function warnedColors(points: readonly ProjectInertialVec3[], colorHex: number, brightness: number, warningRadiusKm: number): number[] {
  const base = new THREE.Color(colorHex).multiplyScalar(brightness)
  const warning = new THREE.Color(MANEUVER_COLORS.warning)
  const colors: number[] = []
  for (const point of points) {
    const color = lengthVec3(point) < warningRadiusKm ? warning : base
    colors.push(color.r, color.g, color.b)
  }
  return colors
}

/** The Interception game in the 3D view: both satellites, their trails, the
 *  dashed aim line and the apogee and perigee marks. Nothing here is pickable. */
export class ManeuverSceneView {
  private readonly group = new THREE.Group()
  private readonly player: OrbitalBodyView
  private readonly target: OrbitalBodyView
  private readonly playerTrail: Line2
  private readonly targetTrail: Line2
  private readonly arc: Line2
  /** Apogee, then perigee. */
  private readonly apsisMarks: readonly OrbitalBodyView[]
  private marksShown = false
  private visible = false
  private readonly materials: LineMaterial[] = []
  private readonly unregisterMaterial: (material: LineMaterial) => void
  private disposed = false

  constructor(scene: THREE.Scene, registerMaterial: (material: LineMaterial) => void, unregisterMaterial: (material: LineMaterial) => void) {
    this.unregisterMaterial = unregisterMaterial
    this.group.name = 'Interception game'
    scene.add(this.group)
    this.player = new OrbitalBodyView(scene, MANEUVER_COLORS.player, MARKER_SIZE_RENDER_UNITS)
    this.target = new OrbitalBodyView(scene, MANEUVER_COLORS.target, MARKER_SIZE_RENDER_UNITS)
    const line = (material: LineMaterial, name: string): Line2 => {
      const created = new Line2(new LineGeometry(), material)
      created.name = name
      this.group.add(created)
      this.materials.push(material)
      registerMaterial(material)
      return created
    }
    const trailMaterial = () => new LineMaterial({ color: 0xffffff, vertexColors: true, linewidth: 2, transparent: true, opacity: 0.9, depthTest: true, depthWrite: false })
    this.playerTrail = line(trailMaterial(), 'Your trail')
    this.targetTrail = line(trailMaterial(), 'Target trail')
    this.arc = line(new LineMaterial({ color: 0xffffff, vertexColors: true, linewidth: 2, transparent: true, opacity: 0.95, dashed: true, dashSize: 0.05, gapSize: 0.035, depthTest: true, depthWrite: false }), 'Aim line')
    this.apsisMarks = [new OrbitalBodyView(scene, MANEUVER_COLORS.apsis, APSIS_MARK_SIZE_RENDER_UNITS), new OrbitalBodyView(scene, MANEUVER_COLORS.apsis, APSIS_MARK_SIZE_RENDER_UNITS)]
    this.setVisible(false)
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.group.visible = visible
    this.player.setVisible(visible)
    this.target.setVisible(visible)
    for (const mark of this.apsisMarks) mark.setVisible(visible && this.marksShown)
  }

  update(frame: ManeuverFrame): void {
    this.player.update(frame.player)
    this.target.update(frame.target)
    this.setTrail(this.playerTrail, frame.playerTrail, MANEUVER_COLORS.player)
    this.setTrail(this.targetTrail, frame.targetTrail, MANEUVER_COLORS.target)
    this.arc.visible = frame.arc !== null && frame.arc.length > 1
    if (frame.arc && this.arc.visible) {
      // From the far end, so the dashes stay still while the satellite flies along them.
      const fromFarEnd = [...frame.arc].reverse()
      this.setLine(this.arc, renderPositions(fromFarEnd), warnedColors(fromFarEnd, MANEUVER_COLORS.player, 1, frame.warningRadiusKm))
      this.arc.computeLineDistances()
    }
    this.updateMarks(frame.apsides)
  }

  /** Render-frame marker centres, for the labels. */
  markerPositions(): { readonly player: THREE.Vector3; readonly target: THREE.Vector3; readonly apsides: readonly THREE.Vector3[] } {
    return { player: this.player.mesh.position, target: this.target.mesh.position, apsides: this.apsisMarks.map((mark) => mark.mesh.position) }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.player.dispose()
    this.target.dispose()
    for (const mark of this.apsisMarks) mark.dispose()
    this.group.removeFromParent()
    for (const line of [this.playerTrail, this.targetTrail, this.arc]) line.geometry.dispose()
    for (const material of this.materials) { this.unregisterMaterial(material); material.dispose() }
  }

  private updateMarks(apsides: readonly OrbitApsis[]): void {
    this.marksShown = apsides.length > 0
    this.apsisMarks.forEach((mark, index) => {
      const apsis = apsides[index]
      mark.setVisible(this.visible && apsis !== undefined)
      if (apsis) mark.update(apsis.state)
    })
  }

  /** Brightens from the tail to the satellite, so the trail reads as a
   *  direction of travel. */
  private setTrail(line: Line2, points: readonly ProjectInertialVec3[], colorHex: number): void {
    line.visible = points.length > 1
    if (!line.visible) return
    const base = new THREE.Color(colorHex)
    const colors: number[] = []
    const last = points.length - 1
    for (let index = 0; index <= last; index += 1) {
      const brightness = TRAIL_TAIL_BRIGHTNESS + (1 - TRAIL_TAIL_BRIGHTNESS) * (index / last)
      colors.push(base.r * brightness, base.g * brightness, base.b * brightness)
    }
    this.setLine(line, renderPositions(points), colors)
  }

  private setLine(line: Line2, positions: number[], colors: number[]): void {
    const previous = line.geometry
    const geometry = new LineGeometry()
    geometry.setPositions(positions)
    geometry.setColors(colors)
    line.geometry = geometry
    previous.dispose()
  }
}
