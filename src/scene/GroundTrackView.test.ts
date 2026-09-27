import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { EarthFixedVec3 } from '../core/referenceFrames.ts'
import type { SubSatellitePoint } from '../simulation/groundTrack.ts'
import { GroundTrackView } from './GroundTrackView.ts'

const point = (x: number, y: number, z: number): SubSatellitePoint => ({
  instant: { unixSeconds: 0 },
  directionEarthFixed: { x, y, z } as EarthFixedVec3,
  geocentricLatitudeRad: 0,
  geodeticLatitudeRad: 0,
  longitudeRad: 0,
})

describe('GroundTrackView', () => {
  it('depth-biases surface lines while retaining depth testing and no depth writes', () => {
    const parent = new THREE.Group()
    const registered: THREE.Material[] = []
    const view = new GroundTrackView(parent, 0xffc857, (material) => registered.push(material), vi.fn())

    view.setWindow({
      centreInstant: { unixSeconds: 0 },
      nominalPeriodSeconds: 100,
      current: point(1, 0, 0),
      trailing: [{ points: [point(1, 0, 0), point(0, 1, 0)] }],
      leading: [{ points: [point(1, 0, 0), point(0, 0, 1)] }],
      failedSampleCount: 0,
    })

    expect(registered).toHaveLength(2)
    for (const material of registered) {
      expect(material.depthTest).toBe(true)
      expect(material.depthWrite).toBe(false)
      expect(material.polygonOffset).toBe(true)
      expect(material.polygonOffsetFactor).toBe(-1)
      expect(material.polygonOffsetUnits).toBe(-2)
    }

    view.dispose()
  })

  it('draws every point of a segment that grew since its first upload', () => {
    const parent = new THREE.Group()
    const view = new GroundTrackView(parent, 0xffc857, vi.fn(), vi.fn())
    const window = (points: readonly SubSatellitePoint[]) => ({
      centreInstant: { unixSeconds: 0 },
      nominalPeriodSeconds: 100,
      current: points[0],
      trailing: [{ points }],
      leading: [],
      failedSampleCount: 0,
    })

    view.setWindow(window([point(1, 0, 0), point(0, 1, 0)]))
    const line = parent.getObjectByName('Trailing ground track') as THREE.Mesh
    // three.js latches this from the first instanced buffer a geometry binds
    // and never recomputes it, capping the draw at the original segment count.
    ;(line.geometry as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number })._maxInstanceCount = 1

    view.setWindow(window([point(1, 0, 0), point(0, 1, 0), point(0, 0, 1), point(-1, 0, 0)]))

    const grown = parent.getObjectByName('Trailing ground track') as THREE.Mesh
    const geometry = grown.geometry as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number }
    expect(geometry.instanceCount).toBe(3)
    expect(geometry._maxInstanceCount).toBeUndefined()

    view.dispose()
  })

  it('seats the current marker fully outside the rendered Earth', () => {
    const parent = new THREE.Group()
    const view = new GroundTrackView(parent, 0xffc857, vi.fn(), vi.fn())

    view.setCurrent(point(1, 0, 0))

    const marker = parent.getObjectByName('Sub-satellite point') as THREE.Mesh
    const markerRadius = marker.scale.x
    expect(marker.position.length() - markerRadius).toBeGreaterThan(1)

    view.dispose()
  })
})
