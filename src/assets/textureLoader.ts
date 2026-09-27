import * as THREE from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { textureManifest, type AssetId } from './assetManifest.ts'

export interface LoadedTextures {
  earthDay: THREE.Texture
  earthNightMask: THREE.Texture
}

/**
 * Load every texture the scene needs, reporting progress as each one arrives.
 *
 * All of them are required and all of them are Earth's, so a failure here is
 * fatal and the caller surfaces it. The sky loads separately, later and
 * optionally, through `starfieldLoader.ts`: it is geometry rather than texture,
 * and it must not be able to delay or fail first paint.
 */
/** The optional 8K day texture for close-ups on
 *  capable desktops, loaded after first render only on request. */
export const EARTH_DAY_HIGH_RESOLUTION_PATH = '/assets/textures/earth-day-8k.ktx2'
export const HIGH_RESOLUTION_TEXTURE_SIZE = 8192

export async function loadEarthDayHighResolution(renderer: THREE.WebGLRenderer): Promise<THREE.Texture> {
  const loader = new KTX2Loader()
  loader.detectSupport(renderer)
  try {
    const texture = await loader.loadAsync(EARTH_DAY_HIGH_RESOLUTION_PATH)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    return texture
  } finally {
    loader.dispose()
  }
}

/* The Basis transcoder is the one three.js ships: without a transcoder path
 * KTX2Loader loads its bundled, content-hashed copy from the build output. */
export async function loadRequiredTextures(renderer: THREE.WebGLRenderer, onProgress: (loaded: number, total: number) => void): Promise<LoadedTextures> {
  const loader = new KTX2Loader()
  loader.detectSupport(renderer)
  const loaded = new Map<AssetId, THREE.Texture>()
  let loadedCount = 0
  await Promise.all(textureManifest.map(async (definition) => {
    const texture = await loader.loadAsync(definition.path)
    texture.colorSpace = definition.colorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    loaded.set(definition.id, texture)
    loadedCount += 1
    onProgress(loadedCount, textureManifest.length)
  }))
  const earthDay = loaded.get('earthDay')
  const earthNightMask = loaded.get('earthNightMask')
  if (!earthDay || !earthNightMask) throw new Error('Required Earth textures did not load')
  return { earthDay, earthNightMask }
}
