import * as THREE from 'three'

export type AssetId = 'earthDay' | 'earthNightMask'

export interface TextureAssetDefinition {
  id: AssetId
  path: string
  colorSpace: THREE.ColorSpace
}

// Only Earth is a texture now, and both of its maps are required: the scene has
// nothing to show without them.
//
// The sky is not here and has no place here. The stars are catalogue geometry
// and the Milky Way band is generated from a density map, both plain binaries
// loaded by `src/assets/starfieldLoader.ts`, with no colour space and no
// transcoder. The band was briefly an equirectangular KTX2 applied as
// `scene.background`; `src/starfield/bandField.ts` records why a raster sky was
// the wrong representation and what replaced it.
export const textureManifest: TextureAssetDefinition[] = [
  { id: 'earthDay', path: '/assets/textures/earth-day-4k.ktx2', colorSpace: THREE.SRGBColorSpace },
  { id: 'earthNightMask', path: '/assets/textures/earth-night-mask-4k.ktx2', colorSpace: THREE.NoColorSpace },
]
