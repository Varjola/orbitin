import * as THREE from 'three'
import { RENDER_UNITS_PER_KM } from '../core/constants.ts'
import { projectInertialToRender } from '../core/renderFrame.ts'
import type { OrbitalState } from '../orbital/propagator.ts'
import { markerScaleRenderUnits } from './markerScaling.ts'

const viewportSize = new THREE.Vector2()
const markerWorldPosition = new THREE.Vector3()
const cameraWorldPosition = new THREE.Vector3()

const HALO_COLOR = 0xe7fbff
/** Halo radius as a multiple of the drawn marker radius. */
const HALO_SCALE = { selected: 1.8, hovered: 2.2, primary: 2.5 } as const
const REVEAL_START_SCALE = 1.8
const REVEAL_GROWTH_SCALE = 3.2

export class OrbitalBodyView {
  readonly mesh: THREE.Mesh
  /** Selection, primary and hover emphasis; shares the marker's geometry. */
  private readonly halo: THREE.Mesh
  private readonly reveal: THREE.Mesh
  private disposed = false
  private baseSizeRenderUnits: number
  private zoomScaling = true
  private selected = false
  private primary = false
  private hovered = false

  constructor(scene: THREE.Scene, colorHex: number, markerSizeRenderUnits: number) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      // transparent is required up front so the sampling bands can fade the
      // marker without rebuilding the material.
      new THREE.MeshBasicMaterial({ color: colorHex, depthTest: true, transparent: true, opacity: 1 }),
    )
    this.mesh.name = 'Orbital body'
    this.baseSizeRenderUnits = markerSizeRenderUnits
    this.mesh.scale.setScalar(markerSizeRenderUnits)
    // three.js computes the model-view matrix after this hook, so the scale
    // chosen here is the one the marker is drawn with this frame.
    this.mesh.onBeforeRender = (renderer, _scene, camera) => this.applyZoomScale(renderer, camera)
    // Children inherit the zoom-aware marker scale, so a halo stays a fixed
    // multiple of what is actually drawn at any distance.
    this.halo = new THREE.Mesh(this.mesh.geometry, new THREE.MeshBasicMaterial({ color: HALO_COLOR, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.BackSide }))
    this.halo.name = 'Selection halo'
    this.halo.visible = false
    this.reveal = new THREE.Mesh(this.mesh.geometry, new THREE.MeshBasicMaterial({ color: HALO_COLOR, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.BackSide }))
    this.reveal.name = 'Reveal pulse'
    this.reveal.visible = false
    this.mesh.add(this.halo, this.reveal)
    scene.add(this.mesh)
  }

  /** World (render-frame) marker centre, or null when nothing is drawn. */
  pickPositionRender(): THREE.Vector3 | null { return this.mesh.visible ? this.mesh.position : null }

  /** The sphere radius the marker was last drawn with, in render units:
   *  `mesh.scale.x`, which already includes the zoom-floor scaling. */
  renderedRadiusRender(): number { return this.mesh.scale.x }

  setSelectionEmphasis(selected: boolean, primary: boolean): void {
    if (selected === this.selected && primary === this.primary) return
    this.selected = selected
    this.primary = primary
    this.applyHalo()
  }

  setHovered(hovered: boolean): void {
    if (hovered === this.hovered) return
    this.hovered = hovered
    this.applyHalo()
  }

  /** `progress` in 0..1 while a reveal runs, else null. Reduced motion shows
   *  a steady ring instead of an expanding one. */
  setReveal(progress: number | null, reducedMotion: boolean): void {
    this.reveal.visible = progress !== null
    if (progress === null) return
    const material = this.reveal.material as THREE.MeshBasicMaterial
    this.reveal.scale.setScalar(reducedMotion ? REVEAL_START_SCALE + REVEAL_GROWTH_SCALE / 2 : REVEAL_START_SCALE + progress * REVEAL_GROWTH_SCALE)
    material.opacity = reducedMotion ? 0.5 : 0.6 * (1 - progress)
  }

  private applyHalo(): void {
    this.halo.visible = this.selected || this.primary || this.hovered
    this.halo.scale.setScalar(this.primary ? HALO_SCALE.primary : this.hovered ? HALO_SCALE.hovered : HALO_SCALE.selected)
    ;(this.halo.material as THREE.MeshBasicMaterial).opacity = this.primary || this.hovered ? 0.42 : 0.28
  }

  update(state: OrbitalState): void {
    const positionKm = state.positionProjectInertialKm
    const render = projectInertialToRender({
      x: positionKm.x * RENDER_UNITS_PER_KM,
      y: positionKm.y * RENDER_UNITS_PER_KM,
      z: positionKm.z * RENDER_UNITS_PER_KM,
    })
    this.mesh.position.set(render.x, render.y, render.z)
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible
  }

  setSize(sizeRenderUnits: number): void {
    this.baseSizeRenderUnits = sizeRenderUnits
    this.mesh.scale.setScalar(sizeRenderUnits)
  }

  /** Zoom-aware sizing keeps a distant marker above a pixel floor; see `markerScaling.ts`. */
  setZoomScaling(enabled: boolean): void {
    if (this.zoomScaling === enabled) return
    this.zoomScaling = enabled
    if (!enabled) this.mesh.scale.setScalar(this.baseSizeRenderUnits)
  }

  private applyZoomScale(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (this.disposed) return
    const perspective = camera as THREE.PerspectiveCamera
    if (!this.zoomScaling || !perspective.isPerspectiveCamera) return
    renderer.getSize(viewportSize)
    const size = markerScaleRenderUnits({
      baseSizeRenderUnits: this.baseSizeRenderUnits,
      distanceToCameraRenderUnits: this.mesh.getWorldPosition(markerWorldPosition)
        .distanceTo(perspective.getWorldPosition(cameraWorldPosition)),
      verticalFovRad: THREE.MathUtils.degToRad(perspective.fov),
      viewportHeightCssPx: viewportSize.y,
    })
    if (size === this.mesh.scale.x) return
    this.mesh.scale.setScalar(size)
    this.mesh.updateMatrixWorld(true)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.mesh.onBeforeRender = () => {}
    this.mesh.removeFromParent()
    ;(this.halo.material as THREE.Material).dispose()
    ;(this.reveal.material as THREE.Material).dispose()
    this.mesh.geometry.dispose()
    if (Array.isArray(this.mesh.material)) this.mesh.material.forEach((material) => material.dispose())
    else this.mesh.material.dispose()
  }

  /** A dark halo on the Lab backdrop; null restores the default. */
  setHaloColor(colorHex: number | null): void {
    const color = colorHex ?? HALO_COLOR
    ;(this.halo.material as THREE.MeshBasicMaterial).color.setHex(color)
    ;(this.reveal.material as THREE.MeshBasicMaterial).color.setHex(color)
  }

  setColor(colorHex: number): void {
    (this.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex)
  }

  /** Presentation only: the position drawn is always the one the simulation
   *  evaluated for this instant (INV-8). See app/samplingPresentation.ts. */
  setOpacity(opacity: number): void {
    const material = this.mesh.material as THREE.MeshBasicMaterial
    if (material.opacity !== opacity) material.opacity = opacity
  }
}
