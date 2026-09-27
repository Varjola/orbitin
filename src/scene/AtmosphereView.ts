import * as THREE from 'three'
import type { Vec3 } from '../core/vec3.ts'

/** Outer radius of the illustrative atmosphere shell, in Earth radii. The
 *  real scattering layer is far thinner; this is exaggerated so the limb
 *  reads at every zoom, like the enlarged object markers. The camera never
 *  comes this close (its minimum distance is 1.15). */
export const ATMOSPHERE_RADIUS = 1.045

/** Density scale height, in Earth radii: about 57 km, seven times the real
 *  8 km, so the glow is visible at the scene's scale. */
export const ATMOSPHERE_SCALE_HEIGHT = 0.009

/** Scattering coefficients per Earth radius at the surface. Chosen so the
 *  vertical optical depth matches the real atmosphere's (Rayleigh about 0.05,
 *  0.11 and 0.27 in red, green and blue), which keeps the colours true while
 *  the layer is exaggerated in height. */
export const ATMOSPHERE_RAYLEIGH = new THREE.Vector3(0.046, 0.108, 0.265).divideScalar(ATMOSPHERE_SCALE_HEIGHT)
export const ATMOSPHERE_MIE = 0.03 / ATMOSPHERE_SCALE_HEIGHT

/** 1 / (path-length factor at the horizon) for an exponential atmosphere,
 *  used by the Chapman approximation `1 / (k + (1 - k) mu)`. */
export const ATMOSPHERE_CHAPMAN_K = 1 / Math.sqrt(Math.PI / (2 * ATMOSPHERE_SCALE_HEIGHT))

/**
 * An illustrative atmosphere, ray-marched through a
 * thin exponential layer with Rayleigh and Mie single scattering and Earth's
 * shadow. It is not a calibrated model, but because the glow comes from
 * density and sunlight rather than from a painted rim, it fades softly above
 * the limb, lies as a faint haze over the disc, reddens where sunlight has
 * crossed a long path, and ends where Earth's shadow begins - so the
 * terminator looks like a sunset line instead of a coloured band.
 *
 * The shell's front faces are drawn after Earth and before the overlays,
 * premultiplied: the in-scattered light is added and whatever lies behind is
 * dimmed by the view ray's transmittance.
 */
export class AtmosphereView {
  readonly mesh: THREE.Mesh
  private readonly geometry = new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 96, 48)
  private readonly material = new THREE.ShaderMaterial({
    uniforms: {
      uSunDirRender: { value: new THREE.Vector3(1, 0, 0) },
      uAtmosphereRadius: { value: ATMOSPHERE_RADIUS },
      uScaleHeight: { value: ATMOSPHERE_SCALE_HEIGHT },
      uRayleigh: { value: ATMOSPHERE_RAYLEIGH.clone() },
      uMie: { value: ATMOSPHERE_MIE },
      uChapmanK: { value: ATMOSPHERE_CHAPMAN_K },
      uSunIntensity: { value: 4 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDirRender;
      uniform float uAtmosphereRadius;
      uniform float uScaleHeight;
      uniform vec3 uRayleigh;
      uniform float uMie;
      uniform float uChapmanK;
      uniform float uSunIntensity;
      varying vec3 vWorldPosition;

      const int STEPS = 10;
      const float PI = 3.14159265;

      // Entry and exit distances along a ray; empty when x > y.
      vec2 sphereHits(vec3 origin, vec3 dir, float radius) {
        float b = dot(origin, dir);
        float c = dot(origin, origin) - radius * radius;
        float disc = b * b - c;
        if (disc < 0.0) return vec2(1.0, -1.0);
        float s = sqrt(disc);
        return vec2(-b - s, -b + s);
      }

      float chapman(float mu) { return 1.0 / (uChapmanK + (1.0 - uChapmanK) * max(mu, 0.0)); }

      // Density integral from p towards the Sun, in Earth radii at surface
      // density. Below the local horizon the ray passes its lowest point and
      // climbs again; past the limb it meets denser air ever faster, which
      // is what draws Earth's shadow softly.
      float sunColumn(vec3 p, vec3 sun) {
        float r = length(p);
        float mu = dot(p, sun) / r;
        float here = exp(-(r - 1.0) / uScaleHeight) * uScaleHeight;
        if (mu >= 0.0) return here * chapman(mu);
        float lowest = r * sqrt(1.0 - mu * mu);
        float atLowest = exp(min((1.0 - lowest) / uScaleHeight, 30.0)) * uScaleHeight;
        return 2.0 * atLowest * chapman(0.0) - here * chapman(-mu);
      }

      void main() {
        vec3 origin = cameraPosition;
        vec3 dir = normalize(vWorldPosition - cameraPosition);
        vec3 sun = normalize(uSunDirRender);
        vec2 shell = sphereHits(origin, dir, uAtmosphereRadius);
        float start = max(shell.x, 0.0);
        float end = shell.y;
        vec2 ground = sphereHits(origin, dir, 1.0);
        if (ground.x <= ground.y && ground.x > 0.0) end = min(end, ground.x);
        if (end <= start) discard;

        vec3 extinction = uRayleigh + vec3(uMie * 1.1);
        float stepLength = (end - start) / float(STEPS);
        float viewColumn = 0.0;
        vec3 scattered = vec3(0.0);
        for (int i = 0; i < STEPS; i++) {
          vec3 p = origin + dir * (start + (float(i) + 0.5) * stepLength);
          float density = exp(-(length(p) - 1.0) / uScaleHeight) * stepLength;
          vec3 transmittance = exp(-extinction * (viewColumn + 0.5 * density + sunColumn(p, sun)));
          scattered += density * transmittance;
          viewColumn += density;
        }

        float cosAngle = dot(dir, sun);
        float rayleighPhase = 3.0 / (16.0 * PI) * (1.0 + cosAngle * cosAngle);
        const float g = 0.76;
        float miePhase = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * cosAngle, 1.5));
        vec3 light = uSunIntensity * scattered * (uRayleigh * rayleighPhase + uMie * miePhase);
        // Soft saturation instead of clipping where the limb is densest,
        // applied to the brightest channel so the hue stays blue.
        float peak = max(max(light.r, light.g), max(light.b, 1e-4));
        light *= (1.0 - exp(-peak)) / peak;
        vec3 viewTransmittance = exp(-extinction * viewColumn);
        float alpha = 1.0 - dot(viewTransmittance, vec3(1.0 / 3.0));
        gl_FragColor = vec4(light, alpha);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
  })

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.name = 'Atmosphere'
    // First among the transparent objects: ground tracks, footprints and
    // markers draw over the haze and stay crisp.
    this.mesh.renderOrder = -1
    scene.add(this.mesh)
  }

  setSunDirectionRender(v: Vec3): void {
    this.material.uniforms.uSunDirRender.value.set(v.x, v.y, v.z)
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
  }
}
