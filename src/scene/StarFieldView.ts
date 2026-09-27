import * as THREE from 'three'
import { projectInertialToRender } from '../core/renderFrame.ts'
import {
  STAR_MAX_POINT_PX,
  brightnessFromMagnitude,
  pointSizePxFromBrightness,
  starLinearRgbFromColorIndex,
} from '../starfield/photometry.ts'
import type { StarPointSource } from '../starfield/starBinary.ts'

/**
 * The sky must behave as if infinitely distant. Placing it on a large sphere
 * does not achieve that: the camera orbits the origin out to 40 render units,
 * so even a radius of 150 would swing the sky by roughly 15 degrees during a
 * zoom-out.
 *
 * Instead each vertex carries a unit direction. `mat3(viewMatrix)` discards the
 * camera translation, so camera position cannot influence the sky by
 * construction rather than by choosing a large enough radius, and writing
 * `clip.xyww` puts z = w, pinning every point to the far plane and removing any
 * dependence on the near and far values in `camera.ts`.
 */
const starVertexShader = /* glsl */ `
  attribute float aBrightness;
  attribute float aSizePx;
  attribute vec3 aColorLinear;

  uniform float uPixelRatio;

  varying float vBrightness;
  varying vec3 vColorLinear;

  void main() {
    vBrightness = aBrightness;
    vColorLinear = aColorLinear;
    vec3 viewDirection = mat3(viewMatrix) * position;
    vec4 clip = projectionMatrix * vec4(viewDirection, 1.0);
    gl_Position = clip.xyww;
    // gl_PointSize is in framebuffer pixels, so the CSS-pixel size baked into
    // the attribute has to be scaled by the device pixel ratio here.
    gl_PointSize = aSizePx * uPixelRatio;
  }
`

/**
 * A soft radial falloff rather than a hard disc. A square point with a cut edge
 * reads as a tile at the larger sizes, and the smooth edge is also what keeps
 * a faint star from popping as it crosses a pixel boundary during a drag.
 */
const starFragmentShader = /* glsl */ `
  varying float vBrightness;
  varying vec3 vColorLinear;

  void main() {
    vec2 offset = gl_PointCoord - vec2(0.5);
    float radius = length(offset) * 2.0;
    if (radius > 1.0) discard;
    float falloff = 1.0 - smoothstep(0.25, 1.0, radius);
    // Brightness belongs on alpha only. Additive blending contributes
    // rgb * alpha, so scaling the colour by brightness as well squares it, and
    // a magnitude 6 star lands at 0.008 rather than 0.09 - which is the
    // difference between a visible sky and an empty one.
    gl_FragColor = vec4(vColorLinear, vBrightness * falloff);
    #include <colorspace_fragment>
  }
`

/**
 * The catalogue star field: one `THREE.Points` object, one draw call, drawn
 * before everything else and writing no depth, so Earth, the orbit path and the
 * body all draw over it naturally.
 */
/**
 * Per-population appearance. Both defaults are the catalogue's own values, so
 * omitting the argument draws a population exactly as before this existed.
 *
 * The generated Milky Way band in `bandField.ts` is the second population, and
 * it needs both knobs: it is drawn from a distribution rather than a catalogue,
 * so its magnitudes carry no calibration that could balance it against the real
 * stars, and its two hundred thousand points read as haze rather than as a band
 * unless they are held at the size floor.
 */
export interface StarFieldViewOptions {
  /** Multiplies the brightness the photometry derives from magnitude. */
  brightnessScale?: number
  /** Upper bound on point size, in CSS pixels before the device pixel ratio. */
  maxPointPx?: number
  /** Object name in the scene graph, for debugging tools. */
  name?: string
}

export class StarFieldView {
  readonly points: THREE.Points
  readonly starCount: number
  private readonly geometry = new THREE.BufferGeometry()
  private readonly material: THREE.ShaderMaterial

  constructor(scene: THREE.Scene, catalogue: StarPointSource, pixelRatio: number, options: StarFieldViewOptions = {}) {
    const brightnessScale = options.brightnessScale ?? 1
    const maxPointPx = options.maxPointPx ?? STAR_MAX_POINT_PX
    this.starCount = catalogue.starCount
    const positions = new Float32Array(catalogue.starCount * 3)
    const brightness = new Float32Array(catalogue.starCount)
    const sizePx = new Float32Array(catalogue.starCount)
    const colors = new Float32Array(catalogue.starCount * 3)
    for (let index = 0; index < catalogue.starCount; index += 1) {
      const render = projectInertialToRender({
        x: catalogue.directionEci[index * 3]!,
        y: catalogue.directionEci[index * 3 + 1]!,
        z: catalogue.directionEci[index * 3 + 2]!,
      })
      positions[index * 3] = render.x
      positions[index * 3 + 1] = render.y
      positions[index * 3 + 2] = render.z
      const starBrightness = brightnessFromMagnitude(catalogue.visualMagnitude[index]!)
      // Size follows the unscaled brightness and alpha carries the scale: a
      // dimmed population should stay the same shape, not shrink.
      brightness[index] = starBrightness * brightnessScale
      sizePx[index] = Math.min(pointSizePxFromBrightness(starBrightness), maxPointPx)
      const rgb = starLinearRgbFromColorIndex(catalogue.colorIndexBv[index]!)
      colors[index * 3] = rgb.r
      colors[index * 3 + 1] = rgb.g
      colors[index * 3 + 2] = rgb.b
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1))
    this.geometry.setAttribute('aSizePx', new THREE.BufferAttribute(sizePx, 1))
    this.geometry.setAttribute('aColorLinear', new THREE.BufferAttribute(colors, 3))
    this.material = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: pixelRatio } },
      vertexShader: starVertexShader,
      fragmentShader: starFragmentShader,
      // Deliberately NOT transparent, despite the additive blending. An earlier
      // design specified `transparent: true` with `renderOrder = -1` and
      // expected Earth to draw over the sky. It does not: three.js puts a
      // transparent material in the transparent pass, which runs after every
      // opaque object, and `renderOrder` only sorts within a pass. Combined
      // with `depthTest: false` that painted the stars over Earth's night side.
      //
      // In the opaque pass the negative `renderOrder` does put the sky first,
      // and `blending` is applied from the material either way, so additive
      // blending survives the change.
      transparent: false,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.points = new THREE.Points(this.geometry, this.material)
    this.points.name = options.name ?? 'Star field'
    this.points.renderOrder = -1
    // The sky has no meaningful bounding sphere: the vertex shader ignores the
    // camera translation, so a frustum test against unit-sphere geometry at the
    // origin would cull it the moment the camera dollies out.
    this.points.frustumCulled = false
    scene.add(this.points)
  }

  setPixelRatio(pixelRatio: number): void {
    this.material.uniforms.uPixelRatio!.value = pixelRatio
  }

  setVisible(visible: boolean): void {
    this.points.visible = visible
  }

  dispose(): void {
    this.points.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
  }
}
