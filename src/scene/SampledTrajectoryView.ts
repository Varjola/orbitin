import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { projectInertialToRender } from '../core/renderFrame.ts'
import { RENDER_UNITS_PER_KM } from '../core/constants.ts'
import type { ProjectInertialVec3 } from '../core/referenceFrames.ts'

interface SampledLine {
  readonly line: Line2
  geometry: LineGeometry
  readonly material: LineMaterial
  source: readonly ProjectInertialVec3[] | null
  /** Render-frame positions, kept for picking. */
  positions: Float32Array
}

export class SampledTrajectoryView {
  private readonly group = new THREE.Group()
  private readonly lines: SampledLine[] = []
  private colorHex: number
  private selected = false
  private hovered = false
  private visible = true
  /** Increases whenever the drawn segments change (picking cache key). */
  pickRevision = 0
  private disposed = false
  private readonly registerMaterial: (material: LineMaterial) => void
  private readonly unregisterMaterial: (material: LineMaterial) => void

  constructor(
    scene: THREE.Scene,
    colorHex: number,
    registerMaterial: (material: LineMaterial) => void,
    unregisterMaterial: (material: LineMaterial) => void,
  ) {
    this.colorHex = colorHex
    this.registerMaterial = registerMaterial
    this.unregisterMaterial = unregisterMaterial
    this.group.name = 'SGP4 sampled trajectory'
    scene.add(this.group)
  }

  setSegments(segments: readonly (readonly ProjectInertialVec3[])[]): void {
    for (let index = 0; index < segments.length; index += 1) {
      const source = segments[index]
      let sampledLine = this.lines[index]
      if (!sampledLine) { sampledLine = this.createLine(); this.lines[index] = sampledLine }
      if (sampledLine.source === source) { sampledLine.line.visible = this.visible; continue }
      const positions: number[] = []
      for (const point of source) {
        const render = projectInertialToRender({ x: point.x * RENDER_UNITS_PER_KM, y: point.y * RENDER_UNITS_PER_KM, z: point.z * RENDER_UNITS_PER_KM })
        positions.push(render.x, render.y, render.z)
      }
      const geometry = new LineGeometry()
      geometry.setPositions(positions)
      sampledLine.positions = Float32Array.from(positions)
      this.pickRevision += 1
      const previous = sampledLine.geometry
      sampledLine.geometry = geometry
      sampledLine.line.geometry = geometry
      sampledLine.line.computeLineDistances()
      previous.dispose()
      sampledLine.source = source
      sampledLine.line.visible = this.visible
    }
    if (this.lines.length > segments.length) this.pickRevision += 1
    while (this.lines.length > segments.length) this.disposeLine(this.lines.pop()!)
  }

  pickPolylinesRender(): readonly Float32Array[] { return this.lines.map((line) => line.positions) }

  setVisible(visible: boolean): void { this.visible = visible; this.group.visible = visible }
  setColor(colorHex: number): void { this.colorHex = colorHex; for (const line of this.lines) line.material.color.setHex(colorHex) }
  setSelected(selected: boolean): void { this.selected = selected; this.applyWidth() }
  /** Hover: brighter and one width step thicker. */
  setHovered(hovered: boolean): void { this.hovered = hovered; this.applyWidth() }
  private applyWidth(): void {
    for (const line of this.lines) {
      line.material.linewidth = (this.selected ? 3 : 2) + (this.hovered ? 1 : 0)
      line.material.opacity = this.hovered ? 1 : 0.8
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.group.removeFromParent()
    while (this.lines.length) this.disposeLine(this.lines.pop()!)
  }

  private createLine(): SampledLine {
    const geometry = new LineGeometry()
    const material = new LineMaterial({ color: this.colorHex, linewidth: (this.selected ? 3 : 2) + (this.hovered ? 1 : 0), transparent: true, opacity: this.hovered ? 1 : 0.8, depthTest: true, depthWrite: false })
    const line = new Line2(geometry, material)
    line.name = 'SGP4 sampled path segment'
    this.group.add(line)
    this.registerMaterial(material)
    return { line, geometry, material, source: null, positions: new Float32Array(0) }
  }

  private disposeLine(sampledLine: SampledLine): void {
    sampledLine.line.removeFromParent()
    this.unregisterMaterial(sampledLine.material)
    sampledLine.geometry.dispose()
    sampledLine.material.dispose()
  }
}
