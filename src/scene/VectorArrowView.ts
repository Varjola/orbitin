import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

/** Render units that one CSS pixel covers at `distance` from a perspective camera
 *  with this vertical field of view: what keeps an arrow a readable length on
 *  screen at any zoom. */
export function renderUnitsPerPixel(distanceRender: number, verticalFovRad: number, viewportHeightPx: number): number {
  if (!(viewportHeightPx > 0) || !(distanceRender > 0)) return 0
  return (2 * distanceRender * Math.tan(verticalFovRad / 2)) / viewportHeightPx
}

/** The head's share of a short arrow, so a short arrow is still mostly shaft. */
const MAX_HEAD_SHARE = 0.45
const HEAD_LENGTH_PX = 11
const HEAD_RADIUS_PX = 4.5

/** How an arrow of `lengthRender` splits into shaft and head at this scale. */
export function arrowParts(lengthRender: number, unitsPerPixel: number): { readonly shaft: number; readonly head: number; readonly headRadius: number } {
  const head = Math.min(HEAD_LENGTH_PX * unitsPerPixel, MAX_HEAD_SHARE * lengthRender)
  return { shaft: Math.max(0, lengthRender - head), head, headRadius: head * (HEAD_RADIUS_PX / HEAD_LENGTH_PX) }
}

const UP = new THREE.Vector3(0, 1, 0)
const GHOST_OPACITY = 0.38
/** Dash and gap of the ghost, in its unit-long geometry and on screen. */
const GHOST_DASH = 0.1
const GHOST_DASH_PX = 5

/** A straight arrow in the 3D view: a screen-width shaft and a cone head. Built
 *  once, and placed by its transform each frame. */
export class VectorArrowView {
  private readonly group = new THREE.Group()
  private readonly shaft: Line2
  private readonly head: THREE.Mesh
  private readonly material: LineMaterial
  /** The same arrow, faint and dashed, drawn through Earth: where Earth hides the
   *  arrow, this is what shows of it. */
  private readonly ghostShaft: Line2
  private readonly ghostHead: THREE.Mesh
  private readonly ghostMaterial: LineMaterial
  private readonly unregisterMaterial: (material: LineMaterial) => void
  private readonly tipPosition = new THREE.Vector3()
  private disposed = false

  constructor(parent: THREE.Object3D, name: string, colorHex: number, widthPx: number, registerMaterial: (material: LineMaterial) => void, unregisterMaterial: (material: LineMaterial) => void, opacity = 1) {
    this.unregisterMaterial = unregisterMaterial
    this.group.name = name
    this.group.visible = false
    const geometry = new LineGeometry()
    geometry.setPositions([0, 0, 0, 0, 1, 0])
    this.material = new LineMaterial({ color: colorHex, linewidth: widthPx, transparent: opacity < 1, opacity, depthTest: true, depthWrite: false })
    registerMaterial(this.material)
    this.shaft = new Line2(geometry, this.material)
    this.shaft.name = `${name} shaft`
    const cone = new THREE.ConeGeometry(1, 1, 14)
    // The tip at the origin and the base below it.
    cone.translate(0, -0.5, 0)
    this.head = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: colorHex, transparent: opacity < 1, opacity, depthWrite: false }))
    this.head.name = `${name} head`
    this.ghostMaterial = new LineMaterial({ color: colorHex, linewidth: Math.max(1, widthPx * 0.6), transparent: true, opacity: opacity * GHOST_OPACITY, dashed: true, dashSize: GHOST_DASH, gapSize: GHOST_DASH, depthTest: false, depthWrite: false })
    registerMaterial(this.ghostMaterial)
    this.ghostShaft = new Line2(geometry.clone(), this.ghostMaterial)
    this.ghostShaft.computeLineDistances()
    this.ghostShaft.name = `${name} through Earth`
    this.ghostShaft.renderOrder = -2
    this.ghostHead = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: opacity * GHOST_OPACITY, depthTest: false, depthWrite: false }))
    this.ghostHead.renderOrder = -2
    this.group.add(this.ghostShaft, this.ghostHead, this.shaft, this.head)
    parent.add(this.group)
  }

  /** From `from`, along the unit `direction`, `lengthRender` long; all in render units. */
  set(from: THREE.Vector3, direction: THREE.Vector3, lengthRender: number, unitsPerPixel: number): void {
    if (!(lengthRender > 0) || !(unitsPerPixel > 0) || direction.lengthSq() === 0) { this.hide(); return }
    const parts = arrowParts(lengthRender, unitsPerPixel)
    this.group.visible = true
    this.group.position.copy(from)
    this.group.quaternion.setFromUnitVectors(UP, direction)
    this.shaft.visible = parts.shaft > 0
    this.shaft.scale.set(1, Math.max(parts.shaft, 1e-9), 1)
    this.head.position.set(0, lengthRender, 0)
    this.head.scale.set(parts.headRadius, parts.head, parts.headRadius)
    this.ghostShaft.visible = this.shaft.visible
    this.ghostShaft.scale.copy(this.shaft.scale)
    // Dashes of a steady length on screen, however long the shaft.
    this.ghostMaterial.dashScale = GHOST_DASH * parts.shaft / (GHOST_DASH_PX * unitsPerPixel)
    this.ghostHead.position.copy(this.head.position)
    this.ghostHead.scale.copy(this.head.scale)
    this.tipPosition.copy(direction).multiplyScalar(lengthRender).add(from)
  }

  hide(): void { this.group.visible = false }

  /** Where the arrow points to, or null while it is hidden. */
  tip(): THREE.Vector3 | null { return this.group.visible ? this.tipPosition : null }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.group.removeFromParent()
    this.shaft.geometry.dispose()
    this.ghostShaft.geometry.dispose()
    this.head.geometry.dispose()
    ;(this.head.material as THREE.Material).dispose()
    ;(this.ghostHead.material as THREE.Material).dispose()
    this.unregisterMaterial(this.material)
    this.unregisterMaterial(this.ghostMaterial)
    this.material.dispose()
    this.ghostMaterial.dispose()
  }
}
