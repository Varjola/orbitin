import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { RENDER_UNITS_PER_KM } from '../core/constants.ts'
import { samplePerifocalPathKm } from '../orbital/pathSampling.ts'
import {
  perifocalToRenderOrientation,
  sameOrientationAngles,
  type OrbitOrientationAngles,
} from '../orbital/perifocalOrientation.ts'

export interface ConicShape {
  semiMajorAxisKm: number
  eccentricity: number
}

const orientationMatrix = new THREE.Matrix4()

/** The conic is sampled once in perifocal coordinates and oriented by the
 *  object's world rotation. A drifting plane therefore costs one orientation
 *  write per frame rather than 513 resampled vertices and a fresh interleaved
 *  GPU buffer. Dragging RAAN or argument of periapsis on
 *  a static orbit gets the same saving. */
export class OrbitPathView {
  readonly line: Line2
  readonly material: LineMaterial
  private readonly geometry = new LineGeometry()
  rebuildCount = 0
  orientationWriteCount = 0
  private lastOrientation: OrbitOrientationAngles | undefined
  private disposed = false
  private localPositions = new Float32Array(0)
  private worldPositions: Float32Array | null = null
  private selected = false
  private hovered = false
  /** Increases whenever the drawn shape or orientation changes (picking cache key). */
  pickRevision = 0

  constructor(scene: THREE.Scene, shape: ConicShape, orientation: OrbitOrientationAngles, colorHex: number) {
    this.material = new LineMaterial({ color: colorHex, linewidth: 2, transparent: true, opacity: 0.9 })
    this.line = new Line2(this.geometry, this.material)
    this.line.name = 'Orbit path'
    this.rebuildShape(shape)
    this.setOrientation(orientation)
    scene.add(this.line)
  }

  /** Resamples. Needed only when a or e changes. */
  rebuildShape(shape: ConicShape): void {
    const path = samplePerifocalPathKm(shape, 512)
    const positions: number[] = []
    for (const perifocalKm of path) {
      positions.push(perifocalKm.x * RENDER_UNITS_PER_KM, perifocalKm.y * RENDER_UNITS_PER_KM, perifocalKm.z * RENDER_UNITS_PER_KM)
    }
    this.geometry.setPositions(positions)
    this.line.computeLineDistances()
    this.localPositions = Float32Array.from(positions)
    this.worldPositions = null
    this.pickRevision += 1
    this.rebuildCount += 1
  }

  /** Writes the perifocal-to-render rotation, early-returning when the three
   *  angles are unchanged so a static object costs one equality check a frame. */
  setOrientation(elements: OrbitOrientationAngles): void {
    if (this.lastOrientation && sameOrientationAngles(this.lastOrientation, elements)) return
    const m = perifocalToRenderOrientation(elements)
    orientationMatrix.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1)
    this.line.quaternion.setFromRotationMatrix(orientationMatrix)
    this.lastOrientation = {
      inclinationRad: elements.inclinationRad,
      raanRad: elements.raanRad,
      argOfPeriapsisRad: elements.argOfPeriapsisRad,
    }
    this.orientationWriteCount += 1
    this.worldPositions = null
    this.pickRevision += 1
  }

  /** The drawn conic in world render units, rebuilt only after a shape or
   *  orientation change. */
  pickPolylinesRender(): readonly Float32Array[] {
    if (!this.worldPositions) {
      const world = new Float32Array(this.localPositions.length)
      const quaternion = this.line.quaternion
      const vector = new THREE.Vector3()
      for (let index = 0; index < world.length; index += 3) {
        vector.set(this.localPositions[index], this.localPositions[index + 1], this.localPositions[index + 2]).applyQuaternion(quaternion)
        world[index] = vector.x; world[index + 1] = vector.y; world[index + 2] = vector.z
      }
      this.worldPositions = world
    }
    return [this.worldPositions]
  }

  setVisible(visible: boolean): void {
    this.line.visible = visible
  }

  setResolution(width: number, height: number): void {
    this.material.resolution.set(width, height)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.line.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
  }

  setColor(colorHex: number): void { this.material.color.setHex(colorHex) }

  setSelected(selected: boolean): void { this.selected = selected; this.applyWidth() }

  /** Hover: brighter and one width step thicker. */
  setHovered(hovered: boolean): void { this.hovered = hovered; this.applyWidth() }

  private applyWidth(): void {
    this.material.linewidth = (this.selected ? 3 : 2) + (this.hovered ? 1 : 0)
    this.material.opacity = this.hovered ? 1 : 0.9
  }
}
