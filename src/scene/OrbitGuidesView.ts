import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { RENDER_UNITS_PER_KM } from '../core/constants.ts'
import { projectInertialToRender } from '../core/renderFrame.ts'
import type { Vec3 } from '../core/vec3.ts'
import type { OrbitGuideGeometry } from '../orbital/orbitGuides.ts'

/** Which guides a Shape chip shows. */
export type OrbitGuideKind = 'plane' | 'apsides' | 'periapsis'

const RING_SEGMENTS = 128
const GUIDE_OPACITY = 0.5
/** A light grey for every orbit, so guides never read as another orbit. */
export const GUIDE_COLOR_HEX = 0xd6dee8
const MARKER_RADIUS_RENDER = 0.022

function toRender(v: Vec3): THREE.Vector3 {
  const render = projectInertialToRender({ x: v.x * RENDER_UNITS_PER_KM, y: v.y * RENDER_UNITS_PER_KM, z: v.z * RENDER_UNITS_PER_KM })
  return new THREE.Vector3(render.x, render.y, render.z)
}

/** One reusable set of guide lines and markers for the
 *  selected Orbit Lab orbit: the reference plane as a dashed ring at the
 *  orbit's size, the line of nodes and the ascending node; or the line of
 *  apsides with periapsis and apoapsis markers. They are light grey at
 *  reduced opacity, never pickable, and hidden unless shown. */
export class OrbitGuidesView {
  private readonly group = new THREE.Group()
  private readonly ringMaterial = new LineMaterial({ color: GUIDE_COLOR_HEX, linewidth: 1.2, transparent: true, opacity: GUIDE_OPACITY, dashed: true, dashSize: 0.06, gapSize: 0.05 })
  private readonly lineMaterial = new LineMaterial({ color: GUIDE_COLOR_HEX, linewidth: 1.5, transparent: true, opacity: GUIDE_OPACITY + 0.2 })
  private readonly ring = new Line2(new LineGeometry(), this.ringMaterial)
  private readonly nodes = new Line2(new LineGeometry(), this.lineMaterial)
  private readonly apsides = new Line2(new LineGeometry(), this.lineMaterial)
  private readonly markerGeometry = new THREE.SphereGeometry(MARKER_RADIUS_RENDER, 16, 12)
  private readonly markerMaterial = new THREE.MeshBasicMaterial({ color: GUIDE_COLOR_HEX, transparent: true, opacity: 0.9, depthWrite: false })
  private readonly nodeMarker = new THREE.Mesh(this.markerGeometry, this.markerMaterial)
  private readonly periapsisMarker = new THREE.Mesh(this.markerGeometry, this.markerMaterial)
  private readonly apoapsisMarker = new THREE.Mesh(this.markerGeometry, this.markerMaterial)
  private readonly removeMaterials: () => void
  private key = ''
  /** The ring depends on the orbit's size alone, so drift never rebuilds it. */
  private ringRadiusKm = Number.NaN

  constructor(scene: THREE.Scene, addLineMaterial: (material: LineMaterial) => void, removeLineMaterial: (material: LineMaterial) => void) {
    this.group.name = 'Orbit guides'
    this.group.visible = false
    this.apoapsisMarker.scale.setScalar(0.75)
    this.group.add(this.ring, this.nodes, this.apsides, this.nodeMarker, this.periapsisMarker, this.apoapsisMarker)
    scene.add(this.group)
    addLineMaterial(this.ringMaterial)
    addLineMaterial(this.lineMaterial)
    this.removeMaterials = () => { removeLineMaterial(this.ringMaterial); removeLineMaterial(this.lineMaterial) }
  }

  get visible(): boolean { return this.group.visible }

  /** Dark guides on the Lab backdrop, light ones in space. */
  setGuideColor(colorHex: number | null): void {
    const color = colorHex ?? GUIDE_COLOR_HEX
    for (const material of [this.ringMaterial, this.lineMaterial, this.markerMaterial]) material.color.setHex(color)
  }

  /** Shows one kind of guide for `geometry`; unchanged inputs cost nothing. */
  show(kind: OrbitGuideKind, geometry: OrbitGuideGeometry): void {
    const key = `${kind}|${geometry.ringRadiusKm}|${geometry.periapsisKm.x},${geometry.periapsisKm.y},${geometry.periapsisKm.z}|${geometry.ascendingNode.x},${geometry.ascendingNode.y}|${geometry.ascendingNodeKm.x},${geometry.ascendingNodeKm.y}`
    this.group.visible = true
    if (key === this.key) return
    this.key = key
    const plane = kind === 'plane'
    const apsides = kind === 'apsides' && !geometry.circular
    this.ring.visible = plane
    this.nodes.visible = plane && !geometry.equatorial
    this.nodeMarker.visible = plane && !geometry.equatorial
    this.apsides.visible = apsides
    this.periapsisMarker.visible = apsides || (kind === 'periapsis' && !geometry.circular)
    this.apoapsisMarker.visible = apsides
    if (plane) {
      if (geometry.ringRadiusKm !== this.ringRadiusKm) {
        this.ringRadiusKm = geometry.ringRadiusKm
        const points: number[] = []
        for (let index = 0; index <= RING_SEGMENTS; index += 1) {
          const angle = index / RING_SEGMENTS * Math.PI * 2
          const point = toRender({ x: geometry.ringRadiusKm * Math.cos(angle), y: geometry.ringRadiusKm * Math.sin(angle), z: 0 })
          points.push(point.x, point.y, point.z)
        }
        ;(this.ring.geometry as LineGeometry).setPositions(points)
        this.ring.computeLineDistances()
      }
      const ascending = toRender(geometry.ascendingNodeKm)
      const descending = toRender(geometry.descendingNodeKm)
      ;(this.nodes.geometry as LineGeometry).setPositions([descending.x, descending.y, descending.z, ascending.x, ascending.y, ascending.z])
      this.nodeMarker.position.copy(ascending)
    }
    const periapsis = toRender(geometry.periapsisKm)
    this.periapsisMarker.position.copy(periapsis)
    if (apsides) {
      const apoapsis = toRender(geometry.apoapsisKm)
      ;(this.apsides.geometry as LineGeometry).setPositions([periapsis.x, periapsis.y, periapsis.z, apoapsis.x, apoapsis.y, apoapsis.z])
      this.apoapsisMarker.position.copy(apoapsis)
    }
  }

  hide(): void { this.group.visible = false }

  dispose(): void {
    this.removeMaterials()
    this.group.removeFromParent()
    for (const line of [this.ring, this.nodes, this.apsides]) line.geometry.dispose()
    this.ringMaterial.dispose()
    this.lineMaterial.dispose()
    this.markerGeometry.dispose()
    this.markerMaterial.dispose()
  }
}
