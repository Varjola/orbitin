import * as THREE from 'three'
import { RENDER_UNITS_PER_KM } from '../core/constants.ts'
import { earthFixedToRenderLocal } from '../core/renderFrame.ts'
import type { EarthFixedVec3 } from '../core/referenceFrames.ts'

const MARKER_COLOR = 0xf2c879
/** Just above the surface, so the marker is never inside the globe. */
const LIFT = 1.004

/** The learner's own location on the globe, a
 *  small marker on the Earth-fixed root so it turns with the Earth. Never
 *  pickable; hidden when My place is off. */
export class MyPlaceMarkerView {
  private readonly group = new THREE.Group()
  private readonly dot: THREE.Mesh
  private readonly ring: THREE.Mesh

  constructor(earthFixedRoot: THREE.Object3D) {
    this.group.name = 'My place'
    this.group.visible = false
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), new THREE.MeshBasicMaterial({ color: MARKER_COLOR }))
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.022, 0.03, 32), new THREE.MeshBasicMaterial({ color: MARKER_COLOR, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }))
    this.group.add(this.dot, this.ring)
    earthFixedRoot.add(this.group)
  }

  /** `positionKm` on the rendered sphere, or null to hide the marker. */
  set(positionKm: EarthFixedVec3 | null): void {
    if (!positionKm) { this.group.visible = false; return }
    const local = earthFixedToRenderLocal({ x: positionKm.x * RENDER_UNITS_PER_KM * LIFT, y: positionKm.y * RENDER_UNITS_PER_KM * LIFT, z: positionKm.z * RENDER_UNITS_PER_KM * LIFT })
    this.group.position.set(local.x, local.y, local.z)
    // The ring lies flat on the surface, facing out along the local vertical.
    this.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(local.x, local.y, local.z).normalize())
    this.group.visible = true
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const mesh of [this.dot, this.ring]) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose() }
  }
}
