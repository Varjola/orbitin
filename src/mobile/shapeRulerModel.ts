import { EARTH_RADIUS_KM } from '../core/constants.ts'
import { solveSunSynchronousInclination } from '../orbital/sunSynchronous.ts'
import type { ShapeParameter } from './mobileShellState.ts'

/** The Shape strip's ruler. Pure: no DOM.
 *
 *  Each ruler maps its value to a position in CSS px along the scale; the
 *  scale moves under a fixed centre needle. Values are in the ruler's own
 *  unit: km of semi-major axis for Size, eccentricity for Shape, and degrees
 *  for the angles. The ranges are the existing Orbit Lab control ranges. */

export type RulerParameter = Exclude<ShapeParameter, 'drift'>
export type ShapeSnap = 'spaceStation' | 'earthObservation' | 'gps' | 'geostationary' | 'circular' | 'equatorial' | 'polar' | 'retrograde' | 'critical' | 'sunSynchronous' | 'periapsis' | 'apoapsis'

export interface SnapPoint {
  readonly value: number
  /** A labelled snap point, or null for a plain tick (Node, Periapsis). */
  readonly label: ShapeSnap | null
}

export interface RulerSpec {
  readonly parameter: RulerParameter
  readonly min: number
  readonly max: number
  readonly wraps: boolean
  /** The value grid of a drag. Buttons and keys use `buttonStep`. */
  readonly step: number
  readonly unit: 'km' | '' | 'deg'
  readonly snaps: readonly SnapPoint[]
  valueToPosition(value: number): number
  positionToValue(position: number): number
}

/** The orbit a ruler reads: semi-major axis, eccentricity and whether J2 drift is on. */
export interface RulerOrbit {
  readonly semiMajorAxisKm: number
  readonly eccentricity: number
  readonly j2Drift: boolean
}

/** Scale densities from the phone design kit. */
export const SIZE_PX_PER_E_FOLD = 230
/** Altitude at the start of the Size scale's logarithm. */
export const SIZE_REFERENCE_ALTITUDE_KM = 300
export const SHAPE_PX_PER_UNIT = 1200
export const TILT_PX_PER_DEGREE = 6
export const TURN_PX_PER_DEGREE = 3
export const SNAP_THRESHOLD_PX = 8
/** The critical inclination, where J2 apsidal drift vanishes: acos(1/√5). */
export const CRITICAL_INCLINATION_DEG = Math.acos(1 / Math.sqrt(5)) * 180 / Math.PI

const SIZE_MIN_KM = 6678
const SIZE_MAX_KM = 50000
const DEG = 180 / Math.PI

function sizeSpec(): RulerSpec {
  const altitude = (a: number) => Math.max(1, a - EARTH_RADIUS_KM)
  const snap = (altitudeKm: number, label: ShapeSnap): SnapPoint => ({ value: altitudeKm + EARTH_RADIUS_KM, label })
  return {
    parameter: 'size', min: SIZE_MIN_KM, max: SIZE_MAX_KM, wraps: false, step: 1, unit: 'km',
    snaps: [snap(400, 'spaceStation'), snap(800, 'earthObservation'), snap(20200, 'gps'), snap(35786, 'geostationary')],
    valueToPosition: (value) => SIZE_PX_PER_E_FOLD * Math.log(altitude(value) / SIZE_REFERENCE_ALTITUDE_KM),
    positionToValue: (position) => SIZE_REFERENCE_ALTITUDE_KM * Math.exp(position / SIZE_PX_PER_E_FOLD) + EARTH_RADIUS_KM,
  }
}

function linearSpec(parameter: RulerParameter, min: number, max: number, step: number, pxPerUnit: number, unit: RulerSpec['unit'], wraps: boolean, snaps: readonly SnapPoint[]): RulerSpec {
  return {
    parameter, min, max, wraps, step, unit, snaps,
    valueToPosition: (value) => (value - min) * pxPerUnit,
    positionToValue: (position) => min + position / pxPerUnit,
  }
}

/** The ruler for one chip. Tilt adds the critical and Sun-synchronous
 *  inclinations as snap points while J2 drift is on, the latter only when
 *  one exists for the orbit's current size and shape. */
export function rulerSpec(parameter: RulerParameter, orbit: RulerOrbit): RulerSpec {
  switch (parameter) {
    case 'size': return sizeSpec()
    case 'shape': return linearSpec('shape', 0, 0.8, 0.001, SHAPE_PX_PER_UNIT, '', false, [{ value: 0, label: 'circular' }])
    case 'tilt': {
      const snaps: SnapPoint[] = [{ value: 0, label: 'equatorial' }, { value: 90, label: 'polar' }, { value: 180, label: 'retrograde' }]
      if (orbit.j2Drift) {
        snaps.push({ value: CRITICAL_INCLINATION_DEG, label: 'critical' })
        const solution = solveSunSynchronousInclination(orbit.semiMajorAxisKm, orbit.eccentricity)
        if (solution.kind === 'solved') snaps.push({ value: solution.inclinationRad * DEG, label: 'sunSynchronous' })
      }
      return linearSpec('tilt', 0, 180, 0.5, TILT_PX_PER_DEGREE, 'deg', false, snaps.sort((a, b) => a.value - b.value))
    }
    case 'node':
    case 'periapsis':
      return linearSpec(parameter, 0, 360, 0.5, TURN_PX_PER_DEGREE, 'deg', true, [0, 90, 180, 270].map((value) => ({ value, label: null })))
    case 'position':
      return linearSpec('position', 0, 360, 0.5, TURN_PX_PER_DEGREE, 'deg', true, [{ value: 0, label: 'periapsis' }, { value: 180, label: 'apoapsis' }])
  }
}

/** Angles wrap into [0°, 360°). */
export function wrapDegrees(value: number): number {
  const wrapped = value % 360
  return wrapped < 0 ? wrapped + 360 : wrapped === 0 ? 0 : wrapped
}

/** A value brought into the ruler's range: wrapped or clamped. */
export function normalizeRulerValue(spec: RulerSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.min
  return spec.wraps ? wrapDegrees(value) : Math.min(spec.max, Math.max(spec.min, value))
}

/** A value on the ruler's step grid, within its range. */
export function stepRulerValue(spec: RulerSpec, value: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(spec.step)))
  const snapped = Number((Math.round(value / spec.step) * spec.step).toFixed(decimals))
  return normalizeRulerValue(spec, snapped)
}

/** The period of a wrapping scale in px, or null. */
function wrapPeriodPx(spec: RulerSpec): number | null {
  return spec.wraps ? spec.valueToPosition(spec.min + 360) - spec.valueToPosition(spec.min) : null
}

/** The snap point within `thresholdPx` of `positionPx`, if any. On a
 *  wrapping scale 0° and 360° are the same point. */
export function applySnap(spec: RulerSpec, positionPx: number, thresholdPx = SNAP_THRESHOLD_PX): SnapPoint | null {
  const period = wrapPeriodPx(spec)
  let best: SnapPoint | null = null
  let bestDistance = Infinity
  for (const snap of spec.snaps) {
    let distance = Math.abs(positionPx - spec.valueToPosition(snap.value))
    if (period) distance = Math.min(distance % period, period - (distance % period))
    if (distance <= thresholdPx && distance < bestDistance) { best = snap; bestDistance = distance }
  }
  return best
}

/** The snap point the value sits on, for labels and value text. */
export function snapAt(spec: RulerSpec, value: number): SnapPoint | null {
  return applySnap(spec, spec.valueToPosition(value), 0.5)
}

/** The value grid step of the − and + buttons and the arrow keys. The fine
 *  `step` grid is for drags; a button step must visibly change the orbit.
 *  Size steps by about 2 % of the current altitude in round values of the
 *  semi-major axis the heading shows (10 km near the space station, 500 km
 *  near GPS). */
export function buttonStep(spec: RulerSpec, value: number): number {
  switch (spec.parameter) {
    case 'size': {
      const target = Math.max(1, value - EARTH_RADIUS_KM) * 0.02
      const decade = 10 ** Math.floor(Math.log10(target))
      const nice = [1, 2, 5, 10].find((multiple) => multiple * decade >= target * 0.75) ?? 10
      return Math.max(10, nice * decade)
    }
    case 'shape': return 0.01
    case 'tilt': return 1
    default: return 5
  }
}

/** `count` button steps from `value`, onto the button grid. A labelled snap point passed on the way stops the step there, so
 *  − and + find Polar or Geostationary as a drag does. */
export function stepBy(spec: RulerSpec, value: number, direction: -1 | 1, count = 1): number {
  let current = normalizeRulerValue(spec, value)
  for (let index = 0; index < count; index += 1) {
    const step = buttonStep(spec, current)
    const onGrid = current / step
    const nextIndex = direction > 0 ? Math.floor(onGrid + 1e-9) + 1 : Math.ceil(onGrid - 1e-9) - 1
    let next = normalizeRulerValue(spec, stepRulerValue(spec, nextIndex * step))
    if (!spec.wraps) {
      const passed = spec.snaps.filter((snap) => snap.label && (direction > 0 ? snap.value > current + 1e-9 && snap.value < next - 1e-9 : snap.value < current - 1e-9 && snap.value > next + 1e-9))
      if (passed.length > 0) next = passed.reduce((best, snap) => (direction > 0 ? snap.value < best.value : snap.value > best.value) ? snap : best).value
    }
    if (next === current) break
    current = next
  }
  return current
}

/** The value a drag reaches: the scale moved by `dxPx` under the needle from
 *  where the drag started, held on a snap point within the threshold. */
export function dragValue(spec: RulerSpec, startValue: number, dxPx: number, thresholdPx = SNAP_THRESHOLD_PX): { readonly value: number; readonly snap: SnapPoint | null } {
  const position = spec.valueToPosition(normalizeRulerValue(spec, startValue)) - dxPx
  const snap = applySnap(spec, position, thresholdPx)
  if (snap) return { value: normalizeRulerValue(spec, snap.value), snap }
  const raw = spec.wraps ? spec.positionToValue(position) : spec.positionToValue(Math.min(spec.valueToPosition(spec.max), Math.max(spec.valueToPosition(spec.min), position)))
  return { value: stepRulerValue(spec, raw), snap: null }
}
