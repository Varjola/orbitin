import { describe, expect, it } from 'vitest'
import { DEFAULT_GEOMETRY, type OrbitGeometry } from './geometry.ts'
import { sampleKeplerianPathEciKm, samplePerifocalPathKm } from './pathSampling.ts'
import { rotatePerifocalToEci } from './rotation.ts'

describe('Keplerian path sampling', () => {
  it('closes the path and depends only on geometry', () => {
    const first = sampleKeplerianPathEciKm(DEFAULT_GEOMETRY, 64)
    const second = sampleKeplerianPathEciKm(DEFAULT_GEOMETRY, 64)
    expect(first).toEqual(second)
    expect(first[0]).toEqual(first[first.length - 1])
  })
})


describe('perifocal path sampling', () => {
  it('closes the path and depends only on the conic shape', () => {
    const first = samplePerifocalPathKm(DEFAULT_GEOMETRY, 64)
    const reoriented: OrbitGeometry = { ...DEFAULT_GEOMETRY, raanRad: 2, argOfPeriapsisRad: 1, inclinationRad: 0.3 }
    const rotated = samplePerifocalPathKm(reoriented, 64)
    expect(first).toEqual(rotated)
    expect(first[0]).toEqual(first[first.length - 1])
    expect(first.every((point) => point.z === 0)).toBe(true)
  })

  it('is the project-inertial sample set rotated by the perifocal orientation', () => {
    // The two samplers must describe the same curve, which is what lets the
    // path view sample in perifocal coordinates and orient the whole line.
    const perifocal = samplePerifocalPathKm(DEFAULT_GEOMETRY, 64)
    const eci = sampleKeplerianPathEciKm(DEFAULT_GEOMETRY, 64)
    for (let index = 0; index < perifocal.length; index += 1) {
      const rotated = rotatePerifocalToEci(perifocal[index], DEFAULT_GEOMETRY)
      expect(rotated.x).toBeCloseTo(eci[index].x, 9)
      expect(rotated.y).toBeCloseTo(eci[index].y, 9)
      expect(rotated.z).toBeCloseTo(eci[index].z, 9)
    }
  })
})
