import { expect, it } from 'vitest'
import { createSyntheticScene, SYNTHETIC_GNSS_PLANES, syntheticClassCounts } from './syntheticScene.ts'

it('rounds the orbit-class mix by largest remainder with LEO, MEO, GEO, HEO tie order', () => {
  expect(syntheticClassCounts(100)).toEqual({ leo: 60, meo: 25, geo: 10, heo: 5 })
  expect(syntheticClassCounts(50)).toEqual({ leo: 30, meo: 13, geo: 5, heo: 2 })
  expect(syntheticClassCounts(25)).toEqual({ leo: 15, meo: 6, geo: 3, heo: 1 })
  expect(syntheticClassCounts(8)).toEqual({ leo: 5, meo: 2, geo: 1, heo: 0 })
  expect(syntheticClassCounts(150)).toEqual({ leo: 90, meo: 38, geo: 15, heo: 7 })
  for (let count = 0; count <= 150; count += 1) {
    const counts = syntheticClassCounts(count)
    expect(counts.leo + counts.meo + counts.geo + counts.heo).toBe(count)
  }
})

it('generates a deterministic scene with unique ids, catalogue ids and the requested class order', () => {
  const first = createSyntheticScene(100)
  const second = createSyntheticScene(100)
  expect(first.map((item) => item.object)).toEqual(second.map((item) => item.object))
  expect(new Set(first.map((item) => item.object.id)).size).toBe(100)
  const catalogIds = first.map((item) => item.object.source.kind === 'omm' ? item.object.source.definition.meanElements.catalogId : '')
  expect(new Set(catalogIds).size).toBe(100)
  expect(first.map((item) => item.orbitClass)).toEqual([
    ...Array(60).fill('leo'), ...Array(25).fill('meo'), ...Array(10).fill('geo'), ...Array(5).fill('heo'),
  ])
  // A smaller scene is not a prefix of a larger one; each N is its own scene.
  expect(createSyntheticScene(8).map((item) => item.orbitClass)).toEqual(['leo', 'leo', 'leo', 'leo', 'leo', 'meo', 'meo', 'geo'])
})

it('deals MEO objects round-robin into six GNSS-like planes', () => {
  const planes = createSyntheticScene(100).filter((item) => item.orbitClass === 'meo').map((item) => item.plane!)
  const perPlane = Array.from({ length: SYNTHETIC_GNSS_PLANES }, (_, plane) => planes.filter((value) => value === plane).length)
  expect(perPlane).toEqual([5, 4, 4, 4, 4, 4])
  const raans = new Set(createSyntheticScene(100).filter((item) => item.orbitClass === 'meo').map((item) => item.object.source.kind === 'omm' ? Math.round(item.object.source.definition.meanElements.raanRad * 180 / Math.PI) : -1))
  expect([...raans].sort((a, b) => a - b)).toEqual([0, 60, 120, 180, 240, 300])
})

it('applies requested layers and keeps history dependent on a visible track', () => {
  const [item] = createSyntheticScene(1, { orbitPath: false, groundTrackHistory: true, sensorGeometry: true })
  expect(item.object.display).toEqual({ bodyVisible: true, orbitPathVisible: false, groundTrackVisible: true, groundTrackHistoryRecording: true, sensorGeometryVisible: true })
  expect(createSyntheticScene(1)[0].object.display).toEqual({ bodyVisible: true, orbitPathVisible: true, groundTrackVisible: false, groundTrackHistoryRecording: false, sensorGeometryVisible: false })
})
