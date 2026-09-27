import { describe, expect, it } from 'vitest'
import { degToRad } from '../core/angles.ts'
import { applyMat3, multiplyMat3, transposeMat3 } from '../core/mat3.ts'
import { projectInertialToRender } from '../core/renderFrame.ts'
import { perifocalToRenderOrientation, sameConicShape, sameOrientationAngles } from './perifocalOrientation.ts'
import { rotatePerifocalToEci } from './rotation.ts'
import type { OrbitGeometry } from './geometry.ts'

const geometry = (inclinationDeg: number, raanDeg: number, argDeg: number): OrbitGeometry =>
  ({ semiMajorAxisKm: 26600, eccentricity: 0.74, inclinationRad: degToRad(inclinationDeg), raanRad: degToRad(raanDeg), argOfPeriapsisRad: degToRad(argDeg) })

const samples = [
  { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 },
  { x: 0.3, y: -0.9, z: 0 }, { x: -1.7, y: 0.2, z: 0 },
]

describe('perifocal orientation', () => {
  // A numerical tolerance, not bit identity: composing the
  // rotations reassociates the same products and projectInertialToRender
  // normalises signed zeros.
  it('agrees with the sequential rotation across all four angle quadrants', () => {
    for (const inclinationDeg of [0, 30, 51.5, 90, 98.6, 180]) {
      for (const raanDeg of [10, 100, 190, 280]) {
        for (const argDeg of [20, 110, 200, 290]) {
          const elements = geometry(inclinationDeg, raanDeg, argDeg)
          const orientation = perifocalToRenderOrientation(elements)
          for (const sample of samples) {
            const composed = applyMat3(orientation, sample)
            const sequential = projectInertialToRender(rotatePerifocalToEci(sample, elements))
            expect(Math.abs(composed.x - sequential.x)).toBeLessThan(1e-12)
            expect(Math.abs(composed.y - sequential.y)).toBeLessThan(1e-12)
            expect(Math.abs(composed.z - sequential.z)).toBeLessThan(1e-12)
          }
        }
      }
    }
  })

  // Orthonormal with determinant +1, so it can be applied to
  // a Line2 as a quaternion and computeLineDistances stays valid.
  it('is orthonormal with determinant +1', () => {
    for (const inclinationDeg of [0, 63.5, 98.6, 180]) {
      const m = perifocalToRenderOrientation(geometry(inclinationDeg, 175, 290))
      const product = multiplyMat3(m, transposeMat3(m))
      const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1]
      for (let index = 0; index < 9; index += 1) expect(Math.abs(product[index] - identity[index])).toBeLessThan(1e-15)
      const determinant =
        m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
      expect(Math.abs(determinant - 1)).toBeLessThan(1e-15)
    }
  })

  it('separates shape equality from orientation equality', () => {
    const a = geometry(51.5, 10, 20)
    expect(sameOrientationAngles(a, { ...a })).toBe(true)
    expect(sameOrientationAngles(a, { ...a, raanRad: a.raanRad + 1e-9 })).toBe(false)
    const reoriented: OrbitGeometry = { ...a, raanRad: 3 }
    const reshaped: OrbitGeometry = { ...a, eccentricity: 0.5 }
    expect(sameConicShape(a, reoriented)).toBe(true)
    expect(sameConicShape(a, reshaped)).toBe(false)
  })
})
