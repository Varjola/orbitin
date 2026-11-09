import { EARTH_RADIUS_KM } from '../core/constants.ts'
import type { ProjectInertialVec3 } from '../core/referenceFrames.ts'
import { dotVec3, lengthVec3 } from '../core/vec3.ts'
import type { OrbitPlaneBasis } from '../orbital/inPlaneState.ts'

/** The orbital plane altitude view: each point keeps its true angle in the
 *  orbital plane, but its distance from the centre shows its altitude, one
 *  view unit per kilometre above a small floor disc. Altitudes and angles are
 *  exact; path lengths and shapes are not to scale. */

/** The floor disc's edge is this altitude: the game's re-entry line. */
export const ALTITUDE_VIEW_FLOOR_KM = 200
/** The floor disc's radius, in view units. */
export const FLOOR_DISC_UNITS = 100

export interface ViewPoint {
  readonly x: number
  readonly y: number
}

/** Distance from the centre for an altitude; below the floor the disc
 *  shrinks to the centre. */
export function altitudeRadius(altitudeKm: number): number {
  return Math.max(0, FLOOR_DISC_UNITS + altitudeKm - ALTITUDE_VIEW_FLOOR_KM)
}

/** Plane coordinates: x towards the ascending node, y 90° on in the
 *  direction of motion, so motion is anticlockwise. */
export function altitudeViewPoint(point: ProjectInertialVec3, basis: OrbitPlaneBasis): ViewPoint {
  const angle = Math.atan2(dotVec3(point, basis.ahead), dotVec3(point, basis.node))
  const radius = altitudeRadius(lengthVec3(point) - EARTH_RADIUS_KM)
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
}

/** Ring altitudes from 300 km up to `maxAltitudeKm`, thinned so labelled
 *  rings stay at least about 28 px apart. */
export function ringAltitudes(maxAltitudeKm: number, pixelsPerUnit: number): number[] {
  const step = [100, 200, 500, 1000, 2000].find((candidate) => candidate * pixelsPerUnit >= 28) ?? 5000
  const rings: number[] = []
  for (let altitude = Math.ceil(300 / step) * step; altitude <= maxAltitudeKm; altitude += step) rings.push(altitude)
  return rings
}

/** Where the view looks: the view point drawn at the centre of the free area,
 *  and pixels per view unit. */
export interface AltitudeCamera {
  readonly centerX: number
  readonly centerY: number
  readonly scale: number
}

export const MIN_ALTITUDE_SCALE = 0.02
export const MAX_ALTITUDE_SCALE = 40

/** Fits rings up to `maxAltitudeKm` (plus a margin) into the free area. */
export function fitAltitudeCamera(maxAltitudeKm: number, freeWidthPx: number, freeHeightPx: number): AltitudeCamera {
  const radius = altitudeRadius(maxAltitudeKm + 80)
  const scale = Math.min(MAX_ALTITUDE_SCALE, Math.max(MIN_ALTITUDE_SCALE, (0.94 * Math.min(freeWidthPx, freeHeightPx)) / (2 * radius)))
  return { centerX: 0, centerY: 0, scale }
}

/** Screen y grows downwards, view y upwards. */
export function toScreen(point: ViewPoint, camera: AltitudeCamera, origin: ViewPoint): ViewPoint {
  return { x: origin.x + (point.x - camera.centerX) * camera.scale, y: origin.y - (point.y - camera.centerY) * camera.scale }
}

export function fromScreen(screen: ViewPoint, camera: AltitudeCamera, origin: ViewPoint): ViewPoint {
  return { x: camera.centerX + (screen.x - origin.x) / camera.scale, y: camera.centerY - (screen.y - origin.y) / camera.scale }
}

/** Drags the view by a screen distance. */
export function panAltitudeCamera(camera: AltitudeCamera, dxPx: number, dyPx: number): AltitudeCamera {
  return { ...camera, centerX: camera.centerX - dxPx / camera.scale, centerY: camera.centerY + dyPx / camera.scale }
}

/** Zooms by `factor`, keeping the view point under `screen` where it is. */
export function zoomAltitudeCamera(camera: AltitudeCamera, origin: ViewPoint, screen: ViewPoint, factor: number): AltitudeCamera {
  const anchor = fromScreen(screen, camera, origin)
  const scale = Math.min(MAX_ALTITUDE_SCALE, Math.max(MIN_ALTITUDE_SCALE, camera.scale * factor))
  return { scale, centerX: anchor.x - (screen.x - origin.x) / scale, centerY: anchor.y + (screen.y - origin.y) / scale }
}
