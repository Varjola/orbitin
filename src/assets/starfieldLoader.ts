import { decodeBandDensity, type BandDensityMap } from '../starfield/bandDensity.ts'
import { decodeStarBinary, type StarCatalogueData } from '../starfield/starBinary.ts'

export const STARFIELD_ASSET_PATH = '/assets/starfield/stars.bin'
export const BAND_DENSITY_ASSET_PATH = '/assets/starfield/band-density.bin'

/**
 * Fetch and decode the baked star catalogue.
 *
 * This deliberately does not go through `textureManifest`, which is typed for
 * KTX2 textures and `THREE.ColorSpace`. The catalogue is a plain binary with no
 * colour space and no transcoder.
 *
 * The load is optional and non-fatal, exactly as the star texture it replaces
 * was: a failure logs a warning and leaves the flat dark background, which is
 * the same degraded state the application already had.
 */
export async function loadStarCatalogue(path = STARFIELD_ASSET_PATH): Promise<StarCatalogueData | undefined> {
  try {
    const response = await fetch(path)
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return decodeStarBinary(await response.arrayBuffer())
  } catch (error: unknown) {
    console.warn('Optional star catalogue failed to load; continuing with a dark background.', error)
    return undefined
  }
}

/**
 * Fetch and decode the Milky Way band's density map.
 *
 * Optional and non-fatal on the same terms as the catalogue: without it the sky
 * keeps the catalogue points and loses only the band. It is about 128 KiB, and
 * `generateBandField` turns it into the points themselves at load time - see
 * `bandField.ts` for why the points are generated rather than downloaded.
 */
export async function loadBandDensity(path = BAND_DENSITY_ASSET_PATH): Promise<BandDensityMap | undefined> {
  try {
    const response = await fetch(path)
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return decodeBandDensity(await response.arrayBuffer())
  } catch (error: unknown) {
    console.warn('Optional Milky Way density map failed to load; continuing without the band.', error)
    return undefined
  }
}
