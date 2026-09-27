import * as THREE from 'three'
import { backFaces } from './labGrid.ts'
import { LAB_PALETTE } from './sceneBackdrop.ts'

type Axis = 0 | 1 | 2
const AXES: readonly Axis[] = [0, 1, 2]
const AXIS_KEYS = ['x', 'y', 'z'] as const
/** Time constant of the size change, in ms. */
const RESIZE_EASE_MS = 90

/**
 * The Lab backdrop's grid box, centred on Earth and
 * aligned with the render axes, so the equator plane is horizontal. Only the
 * three faces on the far side of Earth are drawn, like the walls of a 3D plot;
 * which three follows the camera every frame.
 *
 * Faces are built at unit half-size for the current number of divisions and
 * scaled, so a size change eases smoothly without rebuilding every frame.
 */
export class LabGridBoxView {
  readonly group = new THREE.Group()
  private readonly faces = new Map<string, THREE.Object3D>()
  private readonly gridMaterial = new THREE.LineBasicMaterial({ color: LAB_PALETTE.gridLine, transparent: true, opacity: 0.9, depthWrite: false })
  private readonly outlineMaterial = new THREE.LineBasicMaterial({ color: LAB_PALETTE.gridOutline, transparent: true, opacity: 0.9, depthWrite: false })
  private readonly geometries: THREE.BufferGeometry[] = []
  private divisions = 0
  private currentHalfSize = 0
  private targetHalfSize = 2

  constructor(scene: THREE.Scene) {
    this.group.name = 'Lab grid box'
    this.group.visible = false
    // Behind the objects in the transparent pass; Earth still hides the
    // parts of the walls it covers.
    this.group.renderOrder = -2
    scene.add(this.group)
  }

  setVisible(visible: boolean): void { this.group.visible = visible }

  /** The box's half-size and grid spacing, in Earth radii. */
  setExtent(halfSize: number, spacing: number): void {
    this.targetHalfSize = halfSize
    const divisions = Math.max(1, Math.round((2 * halfSize) / spacing))
    if (divisions !== this.divisions) this.build(divisions)
    if (this.currentHalfSize === 0) this.currentHalfSize = halfSize
  }

  update(camera: THREE.Vector3, elapsedMs: number): void {
    if (!this.group.visible) return
    const blend = 1 - Math.exp(-Math.max(0, elapsedMs) / RESIZE_EASE_MS)
    this.currentHalfSize += (this.targetHalfSize - this.currentHalfSize) * blend
    if (Math.abs(this.targetHalfSize - this.currentHalfSize) < 1e-3) this.currentHalfSize = this.targetHalfSize
    this.group.scale.setScalar(this.currentHalfSize)
    const back = backFaces(camera)
    for (const axis of AXES) {
      const sign = back[AXIS_KEYS[axis]]
      this.faces.get(`${axis}+`)!.visible = sign === 1
      this.faces.get(`${axis}-`)!.visible = sign === -1
    }
  }

  private build(divisions: number): void {
    for (const face of this.faces.values()) face.removeFromParent()
    for (const geometry of this.geometries) geometry.dispose()
    this.faces.clear()
    this.geometries.length = 0
    this.divisions = divisions
    for (const axis of AXES) {
      for (const sign of [1, -1] as const) {
        const face = new THREE.Group()
        const grid: number[] = []
        const outline: number[] = []
        for (let k = 0; k <= divisions; k++) {
          const t = -1 + (2 * k) / divisions
          const target = k === 0 || k === divisions ? outline : grid
          target.push(...facePoint(axis, sign, t, -1), ...facePoint(axis, sign, t, 1))
          target.push(...facePoint(axis, sign, -1, t), ...facePoint(axis, sign, 1, t))
        }
        for (const [positions, material] of [[grid, this.gridMaterial], [outline, this.outlineMaterial]] as const) {
          if (positions.length === 0) continue
          const geometry = new THREE.BufferGeometry()
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
          this.geometries.push(geometry)
          const lines = new THREE.LineSegments(geometry, material)
          lines.renderOrder = -2
          face.add(lines)
        }
        this.faces.set(`${axis}${sign === 1 ? '+' : '-'}`, face)
        this.group.add(face)
      }
    }
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const geometry of this.geometries) geometry.dispose()
    this.gridMaterial.dispose()
    this.outlineMaterial.dispose()
  }
}

/** A point on the face whose normal is `axis` at `sign`, with (u, v) along the
 *  other two axes in order. */
function facePoint(axis: Axis, sign: 1 | -1, u: number, v: number): [number, number, number] {
  if (axis === 0) return [sign, u, v]
  if (axis === 1) return [u, sign, v]
  return [u, v, sign]
}
