import { expect, it } from 'vitest'
import { projectInertialToEarthFixed, type EarthFixedVec3, type ProjectInertialVec3, type TemeVec3, type EarthOrientation } from './referenceFrames.ts'
import { projectInertialToRender } from './renderFrame.ts'
import type { Vec3 } from './vec3.ts'

function checkFrames(teme: TemeVec3, fixed: EarthFixedVec3, plain: Vec3, orientation: EarthOrientation) {
  // @ts-expect-error TEME is not J2000 project inertial.
  projectInertialToEarthFixed(teme, orientation)
  // @ts-expect-error Earth-fixed vectors cannot enter the inertial render boundary.
  projectInertialToRender(fixed)
  // @ts-expect-error Distinct tagged frames are incompatible.
  const wrong: ProjectInertialVec3 = fixed
  projectInertialToEarthFixed(plain, orientation)
  projectInertialToRender(plain)
  return wrong
}
it('keeps compile-time frame guards in the typecheck', () => { expect(checkFrames).toBeTypeOf('function') })
