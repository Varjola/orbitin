import { text } from '../i18n/index.ts'
import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { MAX_DEVICE_PIXEL_RATIO } from '../core/constants.ts'
import { createCameraAndControls } from './camera.ts'
import type { OrbitPathView } from './OrbitPathView.ts'
import type { StarFieldView } from './StarFieldView.ts'
import { SunView } from './SunView.ts'
import { AtmosphereView } from './AtmosphereView.ts'
import { LensFlareView } from './LensFlareView.ts'
import { LabGridBoxView } from './LabGridBoxView.ts'
import { LAB_PALETTE, type SceneBackdropKind } from './sceneBackdrop.ts'
import { focusCameraPosition } from './cameraFocus.ts'
import type { Vec3 } from '../core/vec3.ts'

/**
 * Neutral black behind the sky keeps faint stars free of a blue pedestal.
 *
 * It is a flat colour and stays one. The Milky Way used to be an
 * equirectangular texture here; it is now geometry, drawn by `StarFieldView`
 * from the population `bandField.ts` generates, for the resolution reasons that
 * module records.
 */
export const FLAT_SKY_COLOR = 0x000000

export class SceneRoot {
  readonly scene = new THREE.Scene()
  /** Earth and Earth-fixed overlays share this one physical orientation. */
  readonly earthFixedRoot = new THREE.Group()
  /** The 3D ground tracks and their histories, hidden together while an
   *  orbit is edited (the map keeps its own). */
  readonly groundTrackRoot = new THREE.Group()
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  readonly controls: ReturnType<typeof createCameraAndControls>['controls']
  private readonly container: HTMLElement
  private readonly lineMaterials = new Set<LineMaterial>()
  private readonly starFieldViews = new Set<StarFieldView>()
  private readonly sunView = new SunView(this.scene)
  /** Illustrative atmosphere rim and lens flare. */
  private readonly atmosphere = new AtmosphereView(this.scene)
  private readonly lensFlare = new LensFlareView(this.scene)
  /** The Lab backdrop's grid box and its scale legend. */
  private readonly labGrid = new LabGridBoxView(this.scene)
  private readonly labLegend: HTMLElement
  private backdrop: SceneBackdropKind = 'space'
  private lastRenderMs = 0
  private pixelRatio = 0
  /** Framebuffer size the line materials are currently sized for. */
  private lineResolutionWidth = 1
  private lineResolutionHeight = 1
  private resizeObserver: ResizeObserver | undefined
  private cameraAnimation: { readonly from: THREE.Vector3; readonly towards: THREE.Vector3; readonly startMs: number; readonly durationMs: number } | null = null
  /** The projection-centre shift in CSS px, as drawn. */
  private framing = { x: 0, y: 0 }
  private framingTarget = { x: 0, y: 0 }
  private framingAnimation: { readonly fromX: number; readonly fromY: number; readonly startMs: number; readonly durationMs: number } | null = null
  private viewWidth = 1
  private viewHeight = 1
  /** The Shape containment zoom, as it eases. */
  private distanceAnimation: { readonly from: number; readonly to: number; readonly startMs: number; readonly durationMs: number } | null = null
  onResize: (() => void) | undefined

  setSunDirectionRender(v: Vec3): void {
    this.sunView.setSunDirectionRender(v)
    this.atmosphere.setSunDirectionRender(v)
    this.lensFlare.setSunDirectionRender(v)
  }

  /** The canvas's accessible name follows the language. */
  applyLocale(): void { this.renderer.domElement.setAttribute('aria-label', text().map.canvas) }

  constructor(container: HTMLElement) {
    this.container = container
    this.earthFixedRoot.name = 'Earth-fixed root'
    this.scene.add(this.earthFixedRoot)
    this.groundTrackRoot.name = 'Ground tracks'
    this.earthFixedRoot.add(this.groundTrackRoot)
    this.scene.background = new THREE.Color(FLAT_SKY_COLOR)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.applyLocale()
    this.renderer.domElement.className = 'scene-canvas'
    container.appendChild(this.renderer.domElement)
    const cameraAndControls = createCameraAndControls(this.renderer.domElement)
    this.camera = cameraAndControls.camera
    this.controls = cameraAndControls.controls
    this.labLegend = container.ownerDocument.createElement('div')
    this.labLegend.className = 'scene-lab-legend'
    this.labLegend.hidden = true
    container.appendChild(this.labLegend)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
  }

  /** Device pixel ratio currently in use by the renderer, already clamped. */
  get currentPixelRatio(): number {
    return this.pixelRatio
  }

  addLineView(view: OrbitPathView): void {
    this.addLineMaterial(view.material)
  }

  /**
   * Sizes the new material from the last measured framebuffer rather than
   * calling `resize()`. Ground-track lines are created and released whenever a
   * resampled window changes its seam-split segment count, and a full resize
   * per line reallocated the drawing buffer and re-ran the fit callback -
   * which could collapse the control panel while the learner was using it.
   */
  addLineMaterial(material: LineMaterial): void {
    this.lineMaterials.add(material)
    material.resolution.set(this.lineResolutionWidth, this.lineResolutionHeight)
  }

  removeLineView(view: OrbitPathView): void { this.removeLineMaterial(view.material) }

  removeLineMaterial(material: LineMaterial): void { this.lineMaterials.delete(material) }

  ensureFarPlane(radius: number): void {
    this.camera.far = Math.max(this.camera.far, this.controls.maxDistance + radius * 1.1)
    this.camera.updateProjectionMatrix()
  }

  fitDistance(distance: number, radius: number): void {
    this.distanceAnimation = null
    const damping = this.controls.enableDamping
    this.controls.enableDamping = false
    this.controls.update()
    this.controls.enableDamping = damping
    const direction = this.camera.position.clone().sub(this.controls.target)
    if (direction.lengthSq() === 0) direction.set(2.777, 1.69, 2.33)
    this.controls.target.set(0, 0, 0)
    this.controls.maxDistance = Math.max(this.controls.maxDistance, distance * 1.1)
    this.ensureFarPlane(radius)
    this.camera.position.copy(direction.normalize().multiplyScalar(distance))
    // A turn in progress keeps turning, now at the fitted distance.
    if (this.cameraAnimation) this.cameraAnimation = { ...this.cameraAnimation, from: this.cameraAnimation.from.clone().setLength(distance) }
    this.controls.update()
  }

  /**
   * A star field sizes its points in framebuffer pixels, so it needs the same
   * device pixel ratio the renderer is using and needs it again whenever the
   * ratio changes - which is what `resize()` already detects for the line
   * materials.
   *
   * There are two of these: the HYG catalogue and the generated Milky Way band.
   * They differ only in the population they were built from, so they are held
   * as a set rather than distinguished here.
   */
  addStarFieldView(view: StarFieldView): void {
    this.starFieldViews.add(view)
    view.setPixelRatio(this.pixelRatio)
    view.setVisible(this.backdrop === 'space')
  }

  resize(): void {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    const nextPixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO)
    this.pixelRatio = nextPixelRatio
    this.viewWidth = width
    this.viewHeight = height
    this.camera.aspect = width / height
    // The view offset is sized in the canvas's own CSS px, so a resize must
    // re-apply it; otherwise the framing drifts with every rotation.
    this.applyFraming()
    this.renderer.setPixelRatio(nextPixelRatio)
    this.renderer.setSize(width, height, false)
    this.lineResolutionWidth = width * nextPixelRatio
    this.lineResolutionHeight = height * nextPixelRatio
    for (const material of this.lineMaterials) material.resolution.set(this.lineResolutionWidth, this.lineResolutionHeight)
    for (const view of this.starFieldViews) view.setPixelRatio(nextPixelRatio)
    this.onResize?.()
  }

  /** Moves the projection centre by (x, y) CSS px, so
   *  Earth's centre appears at the centre of the visible region. The camera
   *  still looks at Earth's centre, so rotation and zoom stay about it and
   *  picking, labels and marker scaling follow through the projection
   *  matrix. Eased over `durationMs` (0 applies at once); zero clears it. */
  setFramingOffset(x: number, y: number, durationMs: number, nowMs = performance.now()): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x === this.framingTarget.x && y === this.framingTarget.y) return
    this.framingTarget = { x, y }
    this.framingAnimation = { fromX: this.framing.x, fromY: this.framing.y, startMs: nowMs, durationMs }
    this.advanceFraming(nowMs)
  }

  /** The offset being eased towards. */
  get framingOffset(): { readonly x: number; readonly y: number } { return this.framingTarget }

  /** The camera's distance from Earth's centre, in render units. */
  get cameraDistance(): number { return this.camera.position.distanceTo(this.controls.target) }

  /** Moves the camera along its current direction to
   *  `distance`, eased over `durationMs` (0 at once). Used by the Shape
   *  containment rule; like a fit, it raises the zoom-out limit if needed. */
  easeDistance(distance: number, radius: number, durationMs: number, nowMs = performance.now()): void {
    if (!Number.isFinite(distance) || distance <= 0) return
    this.controls.maxDistance = Math.max(this.controls.maxDistance, distance * 1.1)
    this.ensureFarPlane(radius)
    this.distanceAnimation = { from: this.cameraDistance, to: distance, startMs: nowMs, durationMs }
    this.advanceDistance(nowMs)
  }

  private advanceDistance(nowMs: number): void {
    const animation = this.distanceAnimation
    if (!animation) return
    const linear = animation.durationMs <= 0 ? 1 : Math.min(1, Math.max(0, (nowMs - animation.startMs) / animation.durationMs))
    const t = linear * linear * (3 - 2 * linear)
    const distance = animation.from + (animation.to - animation.from) * t
    if (this.camera.position.lengthSq() > 0) this.camera.position.setLength(distance)
    if (linear >= 1) this.distanceAnimation = null
  }

  private advanceFraming(nowMs: number): void {
    const animation = this.framingAnimation
    if (!animation) return
    const linear = animation.durationMs <= 0 ? 1 : Math.min(1, Math.max(0, (nowMs - animation.startMs) / animation.durationMs))
    const t = linear * linear * (3 - 2 * linear)
    this.framing = { x: animation.fromX + (this.framingTarget.x - animation.fromX) * t, y: animation.fromY + (this.framingTarget.y - animation.fromY) * t }
    if (linear >= 1) { this.framing = this.framingTarget; this.framingAnimation = null }
    this.applyFraming()
  }

  private applyFraming(): void {
    const { x, y } = this.framing
    if (x === 0 && y === 0) this.camera.clearViewOffset()
    else this.camera.setViewOffset(this.viewWidth, this.viewHeight, -x, -y, this.viewWidth, this.viewHeight)
    this.camera.updateProjectionMatrix()
  }

  /** Rotates the camera about the Earth's centre until it looks along
   *  `towards` (a render-frame position), keeping its distance. One-shot: the
   *  camera does not follow afterwards. A zero duration moves at once. */
  focusDirection(towards: { readonly x: number; readonly y: number; readonly z: number }, durationMs: number, nowMs = performance.now()): void {
    if (towards.x === 0 && towards.y === 0 && towards.z === 0) return
    this.controls.target.set(0, 0, 0)
    this.cameraAnimation = { from: this.camera.position.clone(), towards: new THREE.Vector3(towards.x, towards.y, towards.z), startMs: nowMs, durationMs }
    if (durationMs <= 0) this.advanceCameraAnimation(nowMs)
  }

  private advanceCameraAnimation(nowMs: number): void {
    const animation = this.cameraAnimation
    if (!animation) return
    const t = animation.durationMs <= 0 ? 1 : Math.min(1, Math.max(0, (nowMs - animation.startMs) / animation.durationMs))
    focusCameraPosition(animation.from, animation.towards, t, this.camera.position)
    this.camera.lookAt(0, 0, 0)
    if (t >= 1) this.cameraAnimation = null
  }

  render(): void {
    const currentPixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO)
    if (currentPixelRatio !== this.pixelRatio) this.resize()
    const nowMs = performance.now()
    this.advanceFraming(nowMs)
    this.advanceDistance(nowMs)
    this.advanceCameraAnimation(nowMs)
    this.controls.update()
    this.camera.updateMatrixWorld()
    if (this.backdrop === 'space') this.lensFlare.update(this.camera)
    this.labGrid.update(this.camera.position, this.lastRenderMs === 0 ? 0 : nowMs - this.lastRenderMs)
    this.lastRenderMs = nowMs
    this.renderer.render(this.scene, this.camera)
  }

  /** Space (stars, Sun, flare, atmosphere) or the light
   *  Lab backdrop with its grid box. Earth's own style is set on the Earth. */
  setBackdrop(backdrop: SceneBackdropKind): void {
    if (backdrop === this.backdrop) return
    this.backdrop = backdrop
    const space = backdrop === 'space'
    this.scene.background = new THREE.Color(space ? FLAT_SKY_COLOR : LAB_PALETTE.background)
    for (const view of this.starFieldViews) view.setVisible(space)
    this.sunView.mesh.visible = space
    this.atmosphere.mesh.visible = space
    this.lensFlare.setEnabled(space)
    this.labGrid.setVisible(!space)
    this.labLegend.hidden = space || this.labLegend.textContent === ''
    this.container.classList.toggle('scene-backdrop-lab', !space)
  }

  get currentBackdrop(): SceneBackdropKind { return this.backdrop }

  /** Half-size and grid spacing in Earth radii, with the legend's words. */
  setLabGrid(halfSize: number, spacing: number, legend: string): void {
    this.labGrid.setExtent(halfSize, spacing)
    if (this.labLegend.textContent !== legend) this.labLegend.textContent = legend
    this.labLegend.hidden = this.backdrop === 'space' || legend === ''
  }

  dispose(): void {
    this.onResize = undefined
    this.lineMaterials.clear()
    this.starFieldViews.clear()
    this.resizeObserver?.disconnect()
    this.controls.dispose()
    this.sunView.dispose()
    this.atmosphere.dispose()
    this.lensFlare.dispose()
    this.labGrid.dispose()
    this.labLegend.remove()
    this.renderer.dispose()
  }
}
