import * as THREE from 'three'
import { earthFixedOrientationToRender } from '../core/renderFrame.ts'
import type { EarthOrientation } from '../core/referenceFrames.ts'
import type { Vec3 } from '../core/vec3.ts'
import { ATMOSPHERE_CHAPMAN_K, ATMOSPHERE_MIE, ATMOSPHERE_RAYLEIGH, ATMOSPHERE_SCALE_HEIGHT } from './AtmosphereView.ts'
import { earthFragmentShader, earthVertexShader } from './earthShader.ts'
import { LAB_PALETTE } from './sceneBackdrop.ts'

/** Texture-space longitude alignment, in UV units. Determined by inspection. */
export const EARTH_TEXTURE_U_OFFSET = 0

/**
 * Texture-space latitude flip, 1 = flip, 0 = pass through.
 *
 * WebGL cannot flip compressed texture data at upload, so KTX2 textures arrive
 * with `flipY = false`: their first data row is the top of the image. The v
 * coordinate `SphereGeometry` generates assumes the `flipY = true` convention,
 * which put the south pole at render +Y and rendered Earth upside down.
 *
 * This is a texture alignment correction and belongs in UV space with
 * `EARTH_TEXTURE_U_OFFSET`, never in the mesh transform, which carries physical
 * Earth orientation only.
 */
export const EARTH_TEXTURE_V_FLIP = 1

/**
 * Exposure applied to the direct sunlight term. Earth's albedo is genuinely
 * dark - open ocean sits near 0.03 in linear space - so an unscaled Lambert
 * response against NASA imagery reads as an unlit globe rather than a sunlit
 * one. This is the camera exposure a photograph of Earth would carry, applied
 * once, in linear space, with no change to the imagery's colour.
 */
export const EARTH_DAYLIGHT_EXPOSURE = 1.8

export function createEarth(dayMap: THREE.Texture, nightMask: THREE.Texture): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1, 128, 64)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uDayMap: { value: dayMap },
      uNightMask: { value: nightMask },
      uSunDirRender: { value: new THREE.Vector3(1, 0, 0) },
      uTextureUOffset: { value: EARTH_TEXTURE_U_OFFSET },
      uTextureVFlip: { value: EARTH_TEXTURE_V_FLIP },
      uAmbient: { value: 0.03 },
      uDaylightExposure: { value: EARTH_DAYLIGHT_EXPOSURE },
      uTerminatorSoft: { value: 0.08 },
      uNightIntensity: { value: 1.0 },
      uNightTint: { value: new THREE.Color(1.0, 0.86, 0.62) },
      // The atmosphere's vertical optical depth; see AtmosphereView.
      uSunExtinction: { value: ATMOSPHERE_RAYLEIGH.clone().addScalar(ATMOSPHERE_MIE * 1.1).multiplyScalar(ATMOSPHERE_SCALE_HEIGHT) },
      uChapmanK: { value: ATMOSPHERE_CHAPMAN_K },
      uStyle: { value: 0 },
      uMapTexture: { value: dayMap },
      uMapAmbient: { value: 0.3 },
      uLabColor: { value: new THREE.Color(LAB_PALETTE.earth) },
      uLabEquatorColor: { value: new THREE.Color(LAB_PALETTE.equator) },
    },
    vertexShader: earthVertexShader,
    fragmentShader: earthFragmentShader,
  })
  const earth = new THREE.Mesh(geometry, material)
  earth.name = 'Earth'
  return earth
}

const orientationMatrix = new THREE.Matrix4()
export function setEarthOrientation(earthFixedRoot: THREE.Object3D, orientation: EarthOrientation): void {
  const m = earthFixedOrientationToRender(orientation.projectInertialToEarthFixed)
  orientationMatrix.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1)
  earthFixedRoot.quaternion.setFromRotationMatrix(orientationMatrix)
}
/** Replaces the day map; the caller disposes the previous one. */
export function setEarthDayMap(earth: THREE.Mesh, dayMap: THREE.Texture): THREE.Texture {
  const material = earth.material as THREE.ShaderMaterial
  const previous = material.uniforms.uDayMap.value as THREE.Texture
  material.uniforms.uDayMap.value = dayMap
  return previous
}

export function setEarthSunDirectionRender(earth: THREE.Mesh, sunRender: Vec3): void {
  const material = earth.material as THREE.ShaderMaterial
  material.uniforms.uSunDirRender.value.set(sunRender.x, sunRender.y, sunRender.z)
}

/** How Earth is drawn. `map` needs the rasterized atlas; until one
 *  is given, the imagery stays. */
export type EarthDrawStyle = 'imagery' | 'map' | 'lab'
const STYLE_INDEX: Readonly<Record<EarthDrawStyle, number>> = { imagery: 0, map: 1, lab: 2 }
export function setEarthStyle(earth: THREE.Mesh, style: EarthDrawStyle, mapTexture: THREE.Texture | null): void {
  const material = earth.material as THREE.ShaderMaterial
  const drawn = style === 'map' && !mapTexture ? 'imagery' : style
  material.uniforms.uStyle.value = STYLE_INDEX[drawn]
  if (mapTexture) material.uniforms.uMapTexture.value = mapTexture
}
