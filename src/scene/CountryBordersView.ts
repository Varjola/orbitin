import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { earthFixedToRenderLocal } from '../core/renderFrame.ts'
import type { BoundaryData } from '../map/geographyData.ts'

/** Just above the surface, like the ground tracks, so Earth's depth hides the
 *  far side while the near side never sinks into the sphere. */
const BORDER_RADIUS = 1.0008
const LINE_WIDTH = 1.2

/** Border colour and opacity on the Map-style Earth. */
const BORDER_COLOR = 0x8a7a68
const BORDER_OPACITY = 0.9

/** Longitude/latitude in degrees to an Earth-fixed render-local position. */
export function borderPoint(longitudeDeg: number, latitudeDeg: number, radius = BORDER_RADIUS): THREE.Vector3 {
  const lon = (longitudeDeg * Math.PI) / 180
  const lat = (latitudeDeg * Math.PI) / 180
  const p = earthFixedToRenderLocal({ x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) })
  return new THREE.Vector3(p.x, p.y, p.z).multiplyScalar(radius)
}

/** Natural Earth admin-0 land boundaries on the globe. Agreed
 *  boundaries are solid; disputed, indefinite and line-of-control segments
 *  are dashed. One draw call for each. */
export class CountryBordersView {
  readonly group = new THREE.Group()
  private readonly materials: LineMaterial[] = []
  private readonly geometries: LineSegmentsGeometry[] = []
  private readonly unregister: (material: LineMaterial) => void

  constructor(parent: THREE.Object3D, data: BoundaryData, register: (material: LineMaterial) => void, unregister: (material: LineMaterial) => void) {
    this.unregister = unregister
    this.group.name = 'Country borders'
    this.group.visible = false
    for (const disputed of [false, true]) {
      const positions: number[] = []
      for (const line of data.lines) {
        if (line.disputed !== disputed) continue
        for (let i = 1; i < line.points.length; i++) {
          const a = borderPoint(line.points[i - 1][0], line.points[i - 1][1])
          const b = borderPoint(line.points[i][0], line.points[i][1])
          positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
        }
      }
      if (positions.length === 0) continue
      const geometry = new LineSegmentsGeometry()
      geometry.setPositions(positions)
      const material = new LineMaterial({
        color: BORDER_COLOR,
        linewidth: LINE_WIDTH,
        transparent: true,
        opacity: BORDER_OPACITY,
        dashed: disputed,
        dashSize: 0.012,
        gapSize: 0.009,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      })
      const lines = new LineSegments2(geometry, material)
      lines.name = disputed ? 'Disputed borders' : 'Borders'
      if (disputed) lines.computeLineDistances()
      this.group.add(lines)
      this.materials.push(material)
      this.geometries.push(geometry)
      register(material)
    }
    parent.add(this.group)
  }

  setVisible(visible: boolean): void { this.group.visible = visible }

  dispose(): void {
    this.group.removeFromParent()
    for (const material of this.materials) { this.unregister(material); material.dispose() }
    for (const geometry of this.geometries) geometry.dispose()
  }
}
