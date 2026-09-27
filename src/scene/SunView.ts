import * as THREE from 'three'
import type { Vec3 } from '../core/vec3.ts'

/** How far the illustrative glare reaches, in Sun disc radii. */
const GLARE_EXTENT = 22

/** The Sun at its true angular radius, with a smooth illustrative glare,
 * aligned with Earth lighting. The disc itself stays true to size; everything around it is glare, as
 * a camera would record it, not a physical corona. A quad avoids hardware
 * point-size limits and scales with FOV and resolution. Like the stars it
 * ignores camera translation and renders before Earth.
 */
export class SunView {
  readonly mesh: THREE.Mesh
  private readonly geometry = new THREE.PlaneGeometry(2, 2)
  private readonly material = new THREE.ShaderMaterial({
    uniforms: {
      uDirection: { value: new THREE.Vector3(1, 0, 0) },
      // Approximate angular radius at 1 AU.
      uRadius: { value: Math.tan(0.266 * Math.PI / 180) },
      uExtent: { value: GLARE_EXTENT },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uDirection;
      uniform float uRadius;
      uniform float uExtent;
      varying vec2 vDisc;
      void main() {
        vDisc = position.xy * uExtent;
        vec3 direction = mat3(viewMatrix) * uDirection;
        vec4 clip = projectionMatrix * vec4(direction, 1.0);
        clip.xy += position.xy * uRadius * uExtent * vec2(projectionMatrix[0][0], projectionMatrix[1][1]);
        gl_Position = clip.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uExtent;
      varying vec2 vDisc;

      void main() {
        float r = length(vDisc);
        float aa = fwidth(r);
        float disc = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
        float outside = max(r - 1.0, 0.0);
        // Glare that falls off as a power of the distance from the disc, as
        // scattered light in a lens or eye does, with no rays or spikes and
        // no ring where one exponential term hands over to the next.
        float core = 1.0 / (1.0 + 2.5 * outside * outside);
        float glow = 0.8 * core + 0.14 / (1.0 + 0.06 * outside * outside);
        float glare = glow * (1.0 - smoothstep(uExtent * 0.5, uExtent, r));
        float alpha = disc + (1.0 - disc) * clamp(glare, 0.0, 1.0);
        vec3 color = mix(vec3(1.0, 0.8, 0.56), vec3(1.0, 0.98, 0.93), clamp(disc + core, 0.0, 1.0));
        gl_FragColor = vec4(color, alpha);
        #include <colorspace_fragment>
      }
    `,
    transparent: false,
    depthTest: false,
    depthWrite: false,
    // Explicit blending keeps this in the opaque sky pass while covering stars
    // with the disc; NormalBlending is disabled for opaque materials by three.
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
  })

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.name = 'Sun'
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -0.5
    scene.add(this.mesh)
  }

  setSunDirectionRender(v: Vec3): void {
    this.material.uniforms.uDirection.value.set(v.x, v.y, v.z)
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
  }
}
