import type { TermId } from './termLabel.ts'

/** Ranges and units of the Orbit Lab element sliders. Labels and help come
 *  from the message catalogue (`elements`), keyed by field. */
export const geometryControlDefinitions = [
  { field: 'semiMajorAxisKm', term: 'semiMajorAxis', min: 6678, max: 50000, step: 1, unit: 'km' },
  { field: 'eccentricity', term: 'eccentricity', min: 0, max: 0.8, step: 0.001, unit: '' },
  { field: 'inclinationRad', term: 'inclination', min: 0, max: 180, step: 0.5, unit: 'deg' },
  { field: 'raanRad', term: 'raan', min: 0, max: 360, step: 0.5, unit: 'deg' },
  { field: 'argOfPeriapsisRad', term: 'argumentOfPeriapsis', min: 0, max: 360, step: 0.5, unit: 'deg' },
] as const satisfies readonly { readonly field: string; readonly term: TermId; readonly min: number; readonly max: number; readonly step: number; readonly unit: string }[]

export type GeometryControlField = (typeof geometryControlDefinitions)[number]['field']
