import * as THREE from 'three'
import type { Vec3 } from '../core/vec3.ts'

/** How much of the Sun is unobstructed by Earth, from 0 (behind Earth) to 1,
 *  with a short fade at the limb. `earthRadius` in render units, Earth at the
 *  origin; the Sun is a direction at infinity. */
export function sunClearOfEarth(camera: Vec3, sunDirection: Vec3, earthRadius = 1): number {
  const distance = Math.hypot(camera.x, camera.y, camera.z)
  const sunLength = Math.hypot(sunDirection.x, sunDirection.y, sunDirection.z)
  if (distance <= earthRadius || sunLength === 0) return 0
  // Angle between the Sun and the direction to Earth's centre, against
  // Earth's angular radius seen from the camera.
  const cosine = -(camera.x * sunDirection.x + camera.y * sunDirection.y + camera.z * sunDirection.z) / (distance * sunLength)
  const separation = Math.acos(Math.min(1, Math.max(-1, cosine)))
  const earthAngularRadius = Math.asin(earthRadius / distance)
  const t = Math.min(1, Math.max(0, (separation - earthAngularRadius) / 0.03))
  return t * t * (3 - 2 * t)
}

/** Ghosts along the line from the Sun through the screen centre: position
 *  (0 at the Sun, 1 at the centre), size (a fraction of the view height),
 *  colour and strength. Subtle by design. */
const GHOSTS: readonly { readonly at: number; readonly size: number; readonly color: readonly [number, number, number]; readonly strength: number }[] = [
  { at: 0.42, size: 0.035, color: [1.0, 0.78, 0.5], strength: 0.12 },
  { at: 0.7, size: 0.022, color: [0.6, 0.85, 1.0], strength: 0.1 },
  { at: 1.18, size: 0.07, color: [0.55, 1.0, 0.75], strength: 0.05 },
  { at: 1.55, size: 0.03, color: [1.0, 0.6, 0.45], strength: 0.08 },
  { at: 1.95, size: 0.11, color: [0.6, 0.7, 1.0], strength: 0.045 },
]

/** A subtle illustrative lens flare while the Sun is
 *  on screen and not behind Earth. Screen-space ghosts, drawn last and added
 *  to the image; no post-processing. */
export class LensFlareView {
  private readonly group = new THREE.Group()
  private readonly geometry = new THREE.PlaneGeometry(2, 2)
  private readonly materials: THREE.ShaderMaterial[] = []
  private readonly sun = new THREE.Vector3(1, 0, 0)
  private readonly projected = new THREE.Vector4()

  constructor(scene: THREE.Scene) {
    this.group.name = 'Lens flare'
    for (const ghost of GHOSTS) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uCenter: { value: new THREE.Vector2() },
          uSize: { value: new THREE.Vector2() },
          uColor: { value: new THREE.Color(...ghost.color) },
          uOpacity: { value: 0 },
        },
        vertexShader: /* glsl */ `
          uniform vec2 uCenter;
          uniform vec2 uSize;
          varying vec2 vLocal;
          void main() {
            vLocal = position.xy;
            gl_Position = vec4(uCenter + position.xy * uSize, 0.0, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying vec2 vLocal;
          void main() {
            float r = length(vLocal);
            float body = 1.0 - smoothstep(0.55, 1.0, r);
            float rim = smoothstep(0.7, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));
            gl_FragColor = vec4(uColor * (0.55 * body + 0.8 * rim) * uOpacity, 1.0);
          }
        `,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      const mesh = new THREE.Mesh(this.geometry, material)
      mesh.frustumCulled = false
      mesh.renderOrder = 10
      this.materials.push(material)
      this.group.add(mesh)
    }
    scene.add(this.group)
  }

  setSunDirectionRender(v: Vec3): void { this.sun.set(v.x, v.y, v.z) }

  /** Off in the Lab backdrop, which has no Sun to flare. */
  setEnabled(enabled: boolean): void { if (!enabled) this.group.visible = false }

  /** Places the ghosts for this frame's camera. */
  update(camera: THREE.PerspectiveCamera): void {
    // A direction at infinity projects with w = 0.
    this.projected.set(this.sun.x, this.sun.y, this.sun.z, 0).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix)
    const inFront = this.projected.w > 0
    const x = inFront ? this.projected.x / this.projected.w : 0
    const y = inFront ? this.projected.y / this.projected.w : 0
    const onScreen = inFront ? 1 - Math.min(1, Math.max(0, (Math.max(Math.abs(x), Math.abs(y)) - 0.9) / 0.3)) : 0
    const visibility = onScreen * sunClearOfEarth(camera.position, this.sun)
    this.group.visible = visibility > 0.001
    if (!this.group.visible) return
    const aspect = camera.aspect > 0 ? camera.aspect : 1
    GHOSTS.forEach((ghost, index) => {
      const uniforms = this.materials[index].uniforms
      uniforms.uCenter.value.set(x * (1 - ghost.at), y * (1 - ghost.at))
      uniforms.uSize.value.set((ghost.size * 2) / aspect, ghost.size * 2)
      uniforms.uOpacity.value = ghost.strength * visibility
    })
  }

  dispose(): void {
    this.group.removeFromParent()
    this.geometry.dispose()
    for (const material of this.materials) material.dispose()
  }
}
