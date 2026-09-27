import { describe, expect, it } from 'vitest'
import { crossVec3, lengthVec3, vec3 } from './vec3.ts'
import { earthFixedToRenderLocal, projectInertialToRender, renderToProjectInertial } from './renderFrame.ts'

describe('ECI/render frames', () => {
  it('maps the basis vectors and preserves handedness', () => {
    expect(projectInertialToRender(vec3(1, 0, 0))).toEqual(vec3(1, 0, 0))
    expect(projectInertialToRender(vec3(0, 1, 0))).toEqual(vec3(0, 0, -1))
    expect(projectInertialToRender(vec3(0, 0, 1))).toEqual(vec3(0, 1, 0))
    const x = projectInertialToRender(vec3(1, 0, 0))
    const y = projectInertialToRender(vec3(0, 1, 0))
    const z = projectInertialToRender(vec3(0, 0, 1))
    const cross = crossVec3(x, y)
    expect(cross.x).toBeCloseTo(z.x, 12)
    expect(cross.y).toBeCloseTo(z.y, 12)
    expect(cross.z).toBeCloseTo(z.z, 12)
  })

  it('preserves length and round-trips both directions', () => {
    const value = vec3(123.4, -987.6, 42)
    expect(lengthVec3(projectInertialToRender(value))).toBeCloseTo(lengthVec3(value), 12)
    expect(renderToProjectInertial(projectInertialToRender(value))).toEqual(value)
    expect(projectInertialToRender(renderToProjectInertial(value))).toEqual(value)
  })

  it('uses the same local axis permutation without relabelling Earth-fixed data', () => {
    expect(earthFixedToRenderLocal({ x: 1, y: 0, z: 0 })).toEqual(vec3(1, 0, 0))
    expect(earthFixedToRenderLocal({ x: 0, y: 1, z: 0 })).toEqual(vec3(0, 0, -1))
    expect(earthFixedToRenderLocal({ x: 0, y: 0, z: 1 })).toEqual(vec3(0, 1, 0))
    expect(earthFixedToRenderLocal({ x: 3, y: -4, z: 5 })).toEqual(projectInertialToRender({ x: 3, y: -4, z: 5 }))
  })
})
