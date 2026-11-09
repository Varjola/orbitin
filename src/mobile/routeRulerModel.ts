import { EARTH_RADIUS_KM } from '../core/constants.ts'
import { solveSunSynchronousInclination } from '../orbital/sunSynchronous.ts'
import { ROUTE_MAX_ALTITUDE_KM, ROUTE_MIN_ALTITUDE_KM, type RouteOrbitValues } from '../simulation/route/routeObjects.ts'
import type { RoutePanelModel } from '../ui/routePanelModel.ts'
import { linearSpec, sizeRulerSpec, TILT_PX_PER_DEGREE, TURN_PX_PER_DEGREE, wrapDegrees, type RulerSpec, type SnapPoint } from './shapeRulerModel.ts'

/** The phone's Route Planner Edit ruler. Pure: no DOM, no wording.
 *
 *  One object's height, tilt or node, or how far ahead the target is, on the
 *  Shape strip's ruler. The snap points carry the geometry: each ruler snaps at
 *  the other object's value, and tilt and node read "same plane" where the two
 *  planes become one. Orbits are circular on the phone, so Height is one
 *  value: the ruler holds it as a semi-major axis, as Size does, and the edit
 *  sends it as both perigee and apogee. */

export type RouteEditParameter = 'height' | 'tilt' | 'node' | 'ahead'
/** The interceptor or the target, as the panel model names them. */
export type RouteSide = Extract<keyof RoutePanelModel, 'own' | 'target'>
export const ROUTE_EDIT_PARAMETERS: readonly RouteEditParameter[] = ['height', 'tilt', 'node', 'ahead']

export type RouteSnap =
  | 'spaceStation' | 'gps' | 'geostationary' | 'otherHeight'
  | 'equatorial' | 'polar' | 'retrograde' | 'sunSynchronous' | 'otherTilt' | 'otherNode' | 'samePlane'
  | 'together' | 'opposite'

/** Within these the two planes count as one: the ruler's half-step. */
const SAME_ANGLE_DEG = 0.25
/** A height within this of a fixed snap point leaves that point to the other
 *  object's own, which says more. */
const SAME_HEIGHT_KM = 1

/** The two objects as the ruler reads them: the one being edited and the other. */
export interface RouteRulerPair {
  readonly self: RouteOrbitValues
  readonly other: RouteOrbitValues
}

/** An orbit's one height on the phone: its mean height. */
export function meanAltitudeKm(values: RouteOrbitValues): number {
  return (values.perigeeAltitudeKm + values.apogeeAltitudeKm) / 2
}

function sameAngle(a: number, b: number): boolean {
  const difference = Math.abs(wrapDegrees(a - b))
  return Math.min(difference, 360 - difference) <= SAME_ANGLE_DEG
}

/** The ruler for one chip, for the object being edited. */
export function routeRulerSpec(parameter: RouteEditParameter, pair: RouteRulerPair): RulerSpec<RouteSnap> {
  const { self, other } = pair
  switch (parameter) {
    case 'height': {
      const otherHeight = meanAltitudeKm(other)
      const fixed: readonly (readonly [number, RouteSnap])[] = [[400, 'spaceStation'], [20200, 'gps'], [35786, 'geostationary']]
      const snaps = [...fixed.filter(([km]) => Math.abs(km - otherHeight) > SAME_HEIGHT_KM), [otherHeight, 'otherHeight'] as const].sort((a, b) => a[0] - b[0])
      // Steps land on round heights, which the heading shows, not round semi-major axes.
      return sizeRulerSpec<RouteSnap>(ROUTE_MIN_ALTITUDE_KM + EARTH_RADIUS_KM, ROUTE_MAX_ALTITUDE_KM + EARTH_RADIUS_KM, snaps, EARTH_RADIUS_KM)
    }
    case 'tilt': {
      // Matching the other's tilt makes one plane only where the nodes match too.
      const otherTilt: SnapPoint<RouteSnap> = { value: other.inclinationDeg, label: sameAngle(self.raanDeg, other.raanDeg) ? 'samePlane' : 'otherTilt' }
      const fixed: SnapPoint<RouteSnap>[] = [{ value: 0, label: 'equatorial' }, { value: 90, label: 'polar' }, { value: 180, label: 'retrograde' }]
      // Every route object drifts under J2, so a Sun-synchronous tilt exists below a few thousand km.
      const radius = EARTH_RADIUS_KM + meanAltitudeKm(self)
      const solution = solveSunSynchronousInclination(radius, 0)
      if (solution.kind === 'solved') fixed.push({ value: solution.inclinationRad * 180 / Math.PI, label: 'sunSynchronous' })
      const snaps = [...fixed.filter((snap) => Math.abs(snap.value - otherTilt.value) > SAME_ANGLE_DEG), otherTilt].sort((a, b) => a.value - b.value)
      return linearSpec<RouteSnap>('tilt', 0, 180, 0.5, TILT_PX_PER_DEGREE, 'deg', false, snaps)
    }
    case 'node': {
      const otherNode: SnapPoint<RouteSnap> = { value: wrapDegrees(other.raanDeg), label: Math.abs(self.inclinationDeg - other.inclinationDeg) <= SAME_ANGLE_DEG ? 'samePlane' : 'otherNode' }
      const ticks: SnapPoint<RouteSnap>[] = [0, 90, 180, 270].filter((value) => !sameAngle(value, otherNode.value)).map((value) => ({ value, label: null }))
      return linearSpec<RouteSnap>('node', 0, 360, 0.5, TURN_PX_PER_DEGREE, 'deg', true, [...ticks, otherNode].sort((a, b) => a.value - b.value))
    }
    case 'ahead':
      return linearSpec<RouteSnap>('position', 0, 360, 0.5, TURN_PX_PER_DEGREE, 'deg', true, [{ value: 0, label: 'together' }, { value: 90, label: null }, { value: 180, label: 'opposite' }, { value: 270, label: null }])
  }
}

/** The ruler's value for a chip: a semi-major axis for Height, degrees otherwise.
 *  `aheadDeg` is the target ahead of the interceptor, in (−180°, 180°]. */
export function routeRulerValue(parameter: RouteEditParameter, self: RouteOrbitValues, aheadDeg: number): number {
  switch (parameter) {
    case 'height': return meanAltitudeKm(self) + EARTH_RADIUS_KM
    case 'tilt': return self.inclinationDeg
    case 'node': return wrapDegrees(self.raanDeg)
    case 'ahead': return wrapDegrees(aheadDeg)
  }
}

/** A ruler angle in [0°, 360°) as degrees ahead, in (−180°, 180°]. */
export function signedDegrees(value: number): number {
  const wrapped = wrapDegrees(value)
  return wrapped > 180 ? wrapped - 360 : wrapped
}

/** What a ruler value changes: the object's orbit, or where the target is. */
export type RouteEdit =
  | { readonly kind: 'orbit'; readonly changes: Partial<RouteOrbitValues> }
  | { readonly kind: 'ahead'; readonly aheadDeg: number }

export function routeEditOf(parameter: RouteEditParameter, value: number): RouteEdit {
  switch (parameter) {
    case 'height': {
      const altitude = value - EARTH_RADIUS_KM
      return { kind: 'orbit', changes: { perigeeAltitudeKm: altitude, apogeeAltitudeKm: altitude } }
    }
    case 'tilt': return { kind: 'orbit', changes: { inclinationDeg: value } }
    case 'node': return { kind: 'orbit', changes: { raanDeg: wrapDegrees(value) } }
    case 'ahead': return { kind: 'ahead', aheadDeg: signedDegrees(value) }
  }
}
