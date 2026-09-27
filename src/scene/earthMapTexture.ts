import * as THREE from 'three'
import type { GeographyRing, PolygonData } from '../map/geographyData.ts'

/** The Map Earth style's atlas colours. */
export const EARTH_MAP_COLORS = Object.freeze({
  ocean: '#8fb5d9',
  land: '#e6dbbd',
  shore: '#56789a',
})

/** The drawing surface the rasterizer needs; a canvas in the browser, a stub
 *  in tests. */
export interface MapCanvas {
  readonly width: number
  readonly height: number
  getContext(kind: '2d'): Pick<CanvasRenderingContext2D, 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'lineJoin' | 'fillRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'fill' | 'stroke'> | null
}

/**
 * Draws ocean, land, lakes and their shores into an equirectangular canvas:
 * longitude -180 at the left edge, north at the top, which is the layout the
 * sphere's uv expects with the canvas texture's default `flipY`. Natural Earth
 * splits land at the antimeridian and closes Antarctica along the south edge;
 * those artificial edges are filled but never drawn as shore.
 */
export function drawEarthMap(canvas: MapCanvas, land: PolygonData, lakes: PolygonData | null): boolean {
  const context = canvas.getContext('2d')
  if (!context) return false
  const { width, height } = canvas
  const x = (longitude: number): number => ((longitude + 180) / 360) * width
  const y = (latitude: number): number => ((90 - latitude) / 180) * height
  context.fillStyle = EARTH_MAP_COLORS.ocean
  context.fillRect(0, 0, width, height)

  const fillPolygons = (data: PolygonData, color: string): void => {
    context.fillStyle = color
    for (const polygon of data.polygons) {
      context.beginPath()
      for (const ring of polygon) {
        ring.forEach(([longitude, latitude], index) => (index === 0 ? context.moveTo(x(longitude), y(latitude)) : context.lineTo(x(longitude), y(latitude))))
        context.closePath()
      }
      context.fill('evenodd' as never)
    }
  }
  const strokeShores = (data: PolygonData): void => {
    context.beginPath()
    for (const polygon of data.polygons) for (const ring of polygon) traceShore(ring, x, y, context)
    context.stroke()
  }

  fillPolygons(land, EARTH_MAP_COLORS.land)
  if (lakes) fillPolygons(lakes, EARTH_MAP_COLORS.ocean)
  context.strokeStyle = EARTH_MAP_COLORS.shore
  context.lineWidth = Math.max(1, width / 3200)
  context.lineJoin = 'round'
  strokeShores(land)
  if (lakes) strokeShores(lakes)
  return true
}

/** Artificial edges: along the antimeridian, or along the map's south edge. */
function isArtificialEdge(a: readonly [number, number], b: readonly [number, number]): boolean {
  const onAntimeridian = Math.abs(a[0]) >= 179.999 && Math.abs(b[0]) >= 179.999
  const onSouthEdge = a[1] <= -89.99 && b[1] <= -89.99
  return onAntimeridian || onSouthEdge
}

function traceShore(ring: GeographyRing, x: (longitude: number) => number, y: (latitude: number) => number, context: Pick<CanvasRenderingContext2D, 'moveTo' | 'lineTo'>): void {
  let drawing = false
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]
    const b = ring[i]
    if (isArtificialEdge(a, b)) { drawing = false; continue }
    if (!drawing) { context.moveTo(x(a[0]), y(a[1])); drawing = true }
    context.lineTo(x(b[0]), y(b[1]))
  }
}

/** The Map style's texture, 4096 x 2048 on desktop and 2048 x 1024 on phones. */
export function createEarthMapTexture(land: PolygonData, lakes: PolygonData | null, width: number, anisotropy: number): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = width / 2
  if (!drawEarthMap(canvas, land, lakes)) return null
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.anisotropy = anisotropy
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.needsUpdate = true
  return texture
}
