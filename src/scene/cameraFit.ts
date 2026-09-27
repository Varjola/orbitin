import { MAX_APOAPSIS_RADIUS_KM, RENDER_UNITS_PER_KM } from '../core/constants.ts'
import type { OrbitalObject } from '../simulation/OrbitalObject.ts'
import { sgp4SemiMajorAxisEstimateKm } from '../simulation/sensorControlRange.ts'

const TLE_FRAME_MARGIN_KM = 250

/** A framing estimate only. TLE mean motion/eccentricity are not current
 * osculating elements and this value is never shown as a physical readout. */
export function approximateOrbitExtentKm(object: OrbitalObject): number {
  if (object.source.kind === 'keplerian') return object.source.geometry.semiMajorAxisKm * (1 + object.source.geometry.eccentricity)
  const definition = object.source.definition.meanElements
  const extent = sgp4SemiMajorAxisEstimateKm(definition) * (1 + definition.eccentricity) + TLE_FRAME_MARGIN_KM
  return Math.min(MAX_APOAPSIS_RADIUS_KM, Math.max(1, Number.isFinite(extent) ? extent : 1))
}

export interface FitInput {
  radiusRenderUnits: number
  verticalFovRad: number
  viewportWidthCssPx: number
  viewportHeightCssPx: number
  insetLeftCssPx: number
  insetRightCssPx: number
  insetTopCssPx: number
  insetBottomCssPx: number
  minDistance: number
}
export function orbitCollectionRadius(objects: readonly OrbitalObject[], visibleOnly = true): number {
  return Math.max(1, ...objects.filter((object) => !visibleOnly || object.display.bodyVisible || object.display.orbitPathVisible).map((object) =>
    approximateOrbitExtentKm(object) * RENDER_UNITS_PER_KM +
    (object.display.bodyVisible ? object.style.markerSizeRenderUnits : 0)))
}
export function calculateFitDistance(input: FitInput): number | null {
  if (Object.values(input).some((value) => !Number.isFinite(value))) return null
  const { radiusRenderUnits: radius, verticalFovRad: fov, viewportWidthCssPx: width, viewportHeightCssPx: height,
    insetLeftCssPx: left, insetRightCssPx: right, insetTopCssPx: top, insetBottomCssPx: bottom, minDistance } = input
  if (radius <= 0 || width <= 0 || height <= 0 || fov <= 0 || fov >= Math.PI || Math.min(left, right, top, bottom, minDistance) < 0) return null
  const safeWidth = width - 2 * Math.max(left, right)
  const safeHeight = height - 2 * Math.max(top, bottom)
  if (safeWidth <= 0 || safeHeight <= 0) return null
  const tangent = Math.tan(fov / 2)
  const theta = Math.min(Math.atan(tangent * safeWidth / height), Math.atan(tangent * safeHeight / height))
  const distance = Math.max(minDistance, 1.1 * radius / Math.sin(theta))
  return Number.isFinite(distance) ? distance : null
}

export interface RegionFit {
  readonly distance: number
  /** Shift of the projection centre that puts Earth's centre at the centre
   *  of the visible region, in CSS px (positive right and down). */
  readonly offsetXCssPx: number
  readonly offsetYCssPx: number
}

/** The framing offset alone: the visible region's centre relative to the
 *  canvas centre. */
export function regionFramingOffset(insets: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }): { readonly x: number; readonly y: number } {
  return { x: (insets.left - insets.right) / 2, y: (insets.top - insets.bottom) / 2 }
}

/** The margin around a region fit. Smaller than the desktop fit's 1.1: on a
 *  phone the visible region is small, and Earth should use as much of it as
 *  the orbit allows. */
export const REGION_FIT_MARGIN = 1.03

/** Fits a sphere of `radius` about Earth's centre into
 *  the visible region, with the projection centre moved to that region's
 *  centre. Unlike `calculateFitDistance` the insets are not made symmetric:
 *  the whole visible rectangle is used. Null for a degenerate region. */
export function calculateRegionFit(input: FitInput): RegionFit | null {
  if (Object.values(input).some((value) => !Number.isFinite(value))) return null
  const { radiusRenderUnits: radius, verticalFovRad: fov, viewportWidthCssPx: width, viewportHeightCssPx: height,
    insetLeftCssPx: left, insetRightCssPx: right, insetTopCssPx: top, insetBottomCssPx: bottom, minDistance } = input
  if (radius <= 0 || width <= 0 || height <= 0 || fov <= 0 || fov >= Math.PI || Math.min(left, right, top, bottom, minDistance) < 0) return null
  const visibleWidth = width - left - right
  const visibleHeight = height - top - bottom
  if (visibleWidth <= 0 || visibleHeight <= 0) return null
  const tangent = Math.tan(fov / 2)
  const theta = Math.min(Math.atan(tangent * visibleWidth / height), Math.atan(tangent * visibleHeight / height))
  const distance = Math.max(minDistance, REGION_FIT_MARGIN * radius / Math.sin(theta))
  if (!Number.isFinite(distance)) return null
  const offset = regionFramingOffset({ left, right, top, bottom })
  return { distance, offsetXCssPx: offset.x, offsetYCssPx: offset.y }
}

export type ShapeAdjustPhase = 'during' | 'end'

/** Below this fraction of the visible region's
 *  shorter side, the orbit is brought back into view when a drag ends. */
export const CONTAINMENT_FILL_FRACTION = 0.4

/** The camera distance while Size or Shape is adjusted, or null to leave the
 *  camera alone. `required` is the region-fit distance of the edited orbit
 *  alone. During the adjustment the camera only moves out, just far enough.
 *  At the end it eases back in when the orbit fills less than 40 % of the
 *  region, unless the learner turned or zoomed the view meanwhile. The fit
 *  distance fills the shorter side, and the fill scales with 1 / distance. */
export function containmentDistance(current: number, required: number, phase: ShapeAdjustPhase, learnerMovedView: boolean): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(required) || current <= 0 || required <= 0) return null
  if (phase === 'during') return required > current ? required : null
  if (learnerMovedView) return null
  return required / current < CONTAINMENT_FILL_FRACTION ? required : null
}
