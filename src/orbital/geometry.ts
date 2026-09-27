import { clamp } from '../core/angles.ts'
import {
  EARTH_MU_KM3_S2,
  EARTH_RADIUS_KM,
  MAX_APOAPSIS_RADIUS_KM,
  MIN_PERIAPSIS_RADIUS_KM,
} from '../core/constants.ts'

export interface OrbitGeometry {
  semiMajorAxisKm: number
  eccentricity: number
  inclinationRad: number
  raanRad: number
  argOfPeriapsisRad: number
}

export interface DerivedOrbitValues {
  periodSeconds: number
  meanMotionRadPerSecond: number
  periapsisRadiusKm: number
  apoapsisRadiusKm: number
  periapsisAltitudeKm: number
  apoapsisAltitudeKm: number
}

export type EditedGeometryField =
  | 'semiMajorAxisKm'
  | 'eccentricity'
  | 'inclinationRad'
  | 'raanRad'
  | 'argOfPeriapsisRad'

export type ElementConstraint =
  | { kind: 'none' }
  | {
      kind: 'minimumPeriapsis' | 'maximumApoapsis'
      adjustedField: EditedGeometryField
      boundKm: number
      adjustedValue: number
    }

export const DEFAULT_GEOMETRY: OrbitGeometry = {
  semiMajorAxisKm: 10000,
  eccentricity: 0.1,
  inclinationRad: Math.PI / 4,
  raanRad: 0,
  argOfPeriapsisRad: 0,
}

export function validateGeometry(geometry: OrbitGeometry): void {
  const values = Object.values(geometry)
  if (values.some((value) => !Number.isFinite(value))) throw new Error('Orbit geometry must be finite')
  if (geometry.semiMajorAxisKm <= 0) throw new Error('Semi-major axis must be positive')
  if (geometry.eccentricity < 0 || geometry.eccentricity >= 1) {
    throw new Error('Only elliptical eccentricities in [0, 1) are supported')
  }
}

export function meanMotion(geometry: OrbitGeometry): number {
  validateGeometry(geometry)
  return Math.sqrt(EARTH_MU_KM3_S2 / geometry.semiMajorAxisKm ** 3)
}

export function deriveOrbitValues(geometry: OrbitGeometry): DerivedOrbitValues {
  validateGeometry(geometry)
  const meanMotionRadPerSecond = meanMotion(geometry)
  const periapsisRadiusKm = geometry.semiMajorAxisKm * (1 - geometry.eccentricity)
  const apoapsisRadiusKm = geometry.semiMajorAxisKm * (1 + geometry.eccentricity)
  return {
    periodSeconds: (2 * Math.PI) / meanMotionRadPerSecond,
    meanMotionRadPerSecond,
    periapsisRadiusKm,
    apoapsisRadiusKm,
    periapsisAltitudeKm: periapsisRadiusKm - EARTH_RADIUS_KM,
    apoapsisAltitudeKm: apoapsisRadiusKm - EARTH_RADIUS_KM,
  }
}

export function constrainGeometry(
  geometry: OrbitGeometry,
  editedField: EditedGeometryField,
): { geometry: OrbitGeometry; constraint: ElementConstraint } {
  validateGeometry(geometry)
  if (editedField === 'eccentricity') {
    const maximumEForPeriapsis = 1 - MIN_PERIAPSIS_RADIUS_KM / geometry.semiMajorAxisKm
    const maximumEForApoapsis = MAX_APOAPSIS_RADIUS_KM / geometry.semiMajorAxisKm - 1
    const maximumE = Math.min(
      0.8,
      maximumEForPeriapsis,
      maximumEForApoapsis,
    )
    const adjusted = clamp(geometry.eccentricity, 0, maximumE)
    if (adjusted !== geometry.eccentricity) {
      const kind = maximumEForPeriapsis <= maximumEForApoapsis ? 'minimumPeriapsis' : 'maximumApoapsis'
      const boundKm = kind === 'minimumPeriapsis' ? MIN_PERIAPSIS_RADIUS_KM : MAX_APOAPSIS_RADIUS_KM
      return {
        geometry: { ...geometry, eccentricity: adjusted },
        constraint: { kind, adjustedField: editedField, boundKm, adjustedValue: adjusted },
      }
    }
  }
  if (editedField === 'semiMajorAxisKm') {
    const minimumA = Math.max(1, MIN_PERIAPSIS_RADIUS_KM / (1 - geometry.eccentricity))
    const maximumA = MAX_APOAPSIS_RADIUS_KM / (1 + geometry.eccentricity)
    const adjusted = clamp(geometry.semiMajorAxisKm, minimumA, maximumA)
    if (adjusted !== geometry.semiMajorAxisKm) {
      const kind = geometry.semiMajorAxisKm < adjusted ? 'minimumPeriapsis' : 'maximumApoapsis'
      const boundKm = kind === 'minimumPeriapsis' ? MIN_PERIAPSIS_RADIUS_KM : MAX_APOAPSIS_RADIUS_KM
      return {
        geometry: { ...geometry, semiMajorAxisKm: adjusted },
        constraint: { kind, adjustedField: editedField, boundKm, adjustedValue: adjusted },
      }
    }
  }
  return { geometry: { ...geometry }, constraint: { kind: 'none' } }
}
