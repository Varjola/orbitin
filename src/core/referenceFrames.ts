import { applyMat3, type Mat3 } from './mat3.ts'
import type { Vec3 } from './vec3.ts'
import type { SimulationInstant } from './time.ts'

export type FrameId = 'projectInertial' | 'meanOfDate' | 'earthFixed' | 'render' | 'teme'
/** Optional phantom tag: plain vectors are accepted; distinct tagged frames are not. */
export type InFrame<F extends FrameId> = Vec3 & { readonly frame?: F }
/** Mean equator and equinox of J2000, treated as coincident with GCRF. */
export type ProjectInertialVec3 = InFrame<'projectInertial'>
export type MeanOfDateVec3 = InFrame<'meanOfDate'>
/** Mean-of-date realization, not ITRF: no nutation or polar motion. */
export type EarthFixedVec3 = InFrame<'earthFixed'>
export type RenderVec3 = InFrame<'render'>
/** Reserved for SGP4; no current producer or transform. */
export type TemeVec3 = InFrame<'teme'>
export interface EarthOrientation {
  readonly instant: SimulationInstant
  readonly gmstRad: number
  readonly precessionToMeanOfDate: Mat3
  readonly projectInertialToEarthFixed: Mat3
  readonly earthFixedToProjectInertial: Mat3
}
export function projectInertialToEarthFixed(v: ProjectInertialVec3, orientation: EarthOrientation): EarthFixedVec3 {
  return applyMat3(orientation.projectInertialToEarthFixed, v)
}
export function earthFixedToProjectInertial(v: EarthFixedVec3, orientation: EarthOrientation): ProjectInertialVec3 {
  return applyMat3(orientation.earthFixedToProjectInertial, v)
}
