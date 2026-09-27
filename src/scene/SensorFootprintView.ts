import * as THREE from 'three'
import { RENDER_UNITS_PER_KM, SENSOR_BOUNDARY_INTERVALS, SENSOR_SURFACE_LIFT_RENDER_UNITS } from '../core/constants.ts'
import { earthFixedToRenderLocal } from '../core/renderFrame.ts'
import type { EarthFixedVec3, RenderVec3 } from '../core/referenceFrames.ts'
import type { InstantaneousSensorGeometry, SphericalSensorCap } from '../simulation/sensorFootprint.ts'

const RAY_COUNT = 8
const FOOTPRINT_OPACITY = 0.18
const SELECTED_FOOTPRINT_OPACITY = 0.26
const OUTLINE_OPACITY = 0.92
const FOR_OPACITY = 0.52

/** Earth-fixed three.js adapter for one current, instantaneous sensor result.
 * All buffers are allocated once at the presentation budget and updated in
 * place; it never computes orbital or surface geometry. */
export class SensorFootprintView {
  private readonly group = new THREE.Group()
  private readonly footprintFill: THREE.Mesh
  private readonly footprintOutline: THREE.Line
  private readonly regardOutline: THREE.Line
  private readonly boresight: THREE.Line
  private readonly rays: THREE.LineSegments
  private colorHex: number
  private visible = false
  private disposed = false

  constructor(parent: THREE.Object3D, colorHex: number) {
    this.colorHex = colorHex
    const fillGeometry = new THREE.BufferGeometry()
    fillGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SENSOR_BOUNDARY_INTERVALS * 9), 3))
    this.footprintFill = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: FOOTPRINT_OPACITY, depthTest: true, depthWrite: false, side: THREE.DoubleSide }))
    this.footprintFill.name = 'Current sensor footprint'
    this.footprintOutline = this.createLine('Sensor footprint boundary', OUTLINE_OPACITY)
    this.regardOutline = this.createLine('Field-of-regard boundary', FOR_OPACITY)
    this.boresight = this.createLine('Nadir boresight', 0.8, 2)
    const rayGeometry = new THREE.BufferGeometry()
    rayGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(RAY_COUNT * 6), 3))
    this.rays = new THREE.LineSegments(rayGeometry, new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.48, depthTest: true, depthWrite: false }))
    this.rays.name = 'Sensor explanatory rays'
    this.group.name = 'Sensor geometry'
    this.group.add(this.footprintFill, this.footprintOutline, this.regardOutline, this.boresight, this.rays)
    parent.add(this.group)
  }

  setGeometry(geometry: InstantaneousSensorGeometry | null): void {
    if (this.disposed) return
    if (!geometry) {
      this.group.visible = false
      return
    }
    this.uploadCap(this.footprintFill.geometry, geometry.footprint, true, geometry.centre.directionEarthFixed)
    this.uploadCap(this.footprintOutline.geometry, geometry.footprint, false)
    this.uploadCap(this.regardOutline.geometry, geometry.fieldOfRegard, false)
    this.regardOutline.visible = geometry.fieldOfRegard !== geometry.footprint
    this.uploadLine(this.boresight.geometry, [
      scaleRender(geometry.spacecraftPositionEarthFixedKm),
      surfaceRender(geometry.centre.directionEarthFixed),
    ])
    this.uploadRays(geometry)
    this.group.visible = this.visible
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.group.visible = visible && this.footprintOutline.geometry.drawRange.count > 0
  }

  setColor(colorHex: number): void {
    this.colorHex = colorHex
    ;(this.footprintFill.material as THREE.MeshBasicMaterial).color.setHex(colorHex)
    for (const material of [this.footprintOutline.material, this.regardOutline.material, this.boresight.material, this.rays.material]) (material as THREE.LineBasicMaterial).color.setHex(colorHex)
  }

  setSelected(selected: boolean): void {
    const fill = this.footprintFill.material as THREE.MeshBasicMaterial
    fill.opacity = selected ? SELECTED_FOOTPRINT_OPACITY : FOOTPRINT_OPACITY
    ;(this.footprintOutline.material as THREE.LineBasicMaterial).opacity = selected ? 1 : OUTLINE_OPACITY
    ;(this.regardOutline.material as THREE.LineBasicMaterial).opacity = selected ? 0.68 : FOR_OPACITY
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.group.removeFromParent()
    this.footprintFill.geometry.dispose()
    ;(this.footprintFill.material as THREE.Material).dispose()
    for (const line of [this.footprintOutline, this.regardOutline, this.boresight, this.rays]) {
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    }
  }

  private createLine(name: string, opacity: number, linewidth?: number): THREE.Line {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((SENSOR_BOUNDARY_INTERVALS + 1) * 3), 3))
    const material = new THREE.LineBasicMaterial({ color: this.colorHex, transparent: true, opacity, depthTest: true, depthWrite: false })
    if (linewidth !== undefined) material.linewidth = linewidth
    const line = new THREE.Line(geometry, material)
    line.name = name
    return line
  }

  private uploadCap(geometry: THREE.BufferGeometry, cap: SphericalSensorCap, fill: boolean, centreDirection?: { x: number; y: number; z: number }): void {
    if (fill) {
      const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
      const boundary = cap.boundary
      const centre = centreDirection ? surfaceRender(centreDirection) : { x: 0, y: 0, z: 0 }
      for (let index = 0; index < SENSOR_BOUNDARY_INTERVALS; index += 1) {
        const first = boundary[index]
        const second = boundary[index + 1]
        const offset = index * 9
        writeRender(attribute, offset, centre)
        writeRender(attribute, offset + 3, first ? surfaceRender(first.directionEarthFixed) : centre)
        writeRender(attribute, offset + 6, second ? surfaceRender(second.directionEarthFixed) : centre)
      }
      attribute.needsUpdate = true
      geometry.setDrawRange(0, Math.max(0, Math.min(SENSOR_BOUNDARY_INTERVALS, boundary.length - 1) * 3))
      return
    }
    this.uploadLine(geometry, cap.boundary.map((point) => surfaceRender(point.directionEarthFixed)))
  }

  private uploadLine(geometry: THREE.BufferGeometry, points: readonly RenderVec3[]): void {
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index <= SENSOR_BOUNDARY_INTERVALS; index += 1) writeRender(attribute, index * 3, points[index] ?? { x: 0, y: 0, z: 0 })
    attribute.needsUpdate = true
    geometry.setDrawRange(0, Math.min(points.length, SENSOR_BOUNDARY_INTERVALS + 1))
  }

  private uploadRays(geometry: InstantaneousSensorGeometry): void {
    const attribute = this.rays.geometry.getAttribute('position') as THREE.BufferAttribute
    const boundary = geometry.footprint.boundary
    const apex = scaleRender(geometry.spacecraftPositionEarthFixedKm)
    for (let index = 0; index < RAY_COUNT; index += 1) {
      const point = boundary.length > 0 ? boundary[Math.floor(index / RAY_COUNT * boundary.length) % boundary.length] : undefined
      writeRender(attribute, index * 6, apex)
      writeRender(attribute, index * 6 + 3, point ? surfaceRender(point.directionEarthFixed) : apex)
    }
    attribute.needsUpdate = true
    this.rays.geometry.setDrawRange(0, boundary.length > 0 ? RAY_COUNT * 2 : 0)
  }
}

function scaleRender(positionKm: { x: number; y: number; z: number }): RenderVec3 {
  const direction: RenderVec3 = earthFixedToRenderLocal(positionKm as EarthFixedVec3)
  return { x: direction.x * RENDER_UNITS_PER_KM, y: direction.y * RENDER_UNITS_PER_KM, z: direction.z * RENDER_UNITS_PER_KM }
}

function surfaceRender(directionEarthFixed: { x: number; y: number; z: number }): RenderVec3 {
  const direction = earthFixedToRenderLocal(directionEarthFixed as EarthFixedVec3)
  const radius = 1 + SENSOR_SURFACE_LIFT_RENDER_UNITS
  return { x: direction.x * radius, y: direction.y * radius, z: direction.z * radius }
}

function writeRender(attribute: THREE.BufferAttribute, offset: number, value: RenderVec3): void {
  attribute.setXYZ(offset / 3, value.x, value.y, value.z)
}
