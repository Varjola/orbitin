import * as THREE from 'three'
import { expect, it } from 'vitest'
import { calculateFitDistance, calculateRegionFit, containmentDistance, orbitCollectionRadius, REGION_FIT_MARGIN, type FitInput } from './cameraFit.ts'
import { ScenePicker } from './scenePicking.ts'
import { createDefaultOrbitLabObject } from '../state/initialState.ts'
import { RENDER_UNITS_PER_KM } from '../core/constants.ts'

const input: FitInput = { radiusRenderUnits: 1, verticalFovRad: Math.PI / 2, viewportWidthCssPx: 1000, viewportHeightCssPx: 1000,
  insetLeftCssPx: 0, insetRightCssPx: 0, insetTopCssPx: 0, insetBottomCssPx: 0, minDistance: 0 }
it('fits a sphere analytically and reserves symmetric overlay room', () => {
  expect(calculateFitDistance(input)).toBeCloseTo(1.1 * Math.sqrt(2))
  expect(calculateFitDistance({ ...input, minDistance: 5 })).toBe(5)
  for (const [width, height] of [[390, 844], [844, 390], [1280, 800]]) {
    const distance = calculateFitDistance({ ...input, radiusRenderUnits: 10, viewportWidthCssPx: width, viewportHeightCssPx: height, insetTopCssPx: 90 })!
    const theta = Math.min(Math.atan(width / height), Math.atan((height - 180) / height))
    expect(distance * Math.sin(theta)).toBeGreaterThanOrEqual(10)
  }
  expect(calculateFitDistance({ ...input, viewportWidthCssPx: 300 })).toBeGreaterThan(calculateFitDistance(input)!)
  expect(calculateFitDistance({ ...input, insetLeftCssPx: 100 })).toBeGreaterThan(calculateFitDistance(input)!)
})
it('rejects unusable measurements instead of changing the camera', () => {
  for (const patch of [{ radiusRenderUnits: 0 }, { viewportWidthCssPx: 0 }, { verticalFovRad: Math.PI }, { verticalFovRad: 0 },
    { insetTopCssPx: 500 }, { insetLeftCssPx: -1 }, { minDistance: -1 }, { viewportHeightCssPx: NaN }, { radiusRenderUnits: Infinity }]) {
    expect(calculateFitDistance({ ...input, ...patch })).toBeNull()
  }
})
it('includes full body-only orbits and Earth but excludes fully hidden objects', () => {
  const object = createDefaultOrbitLabObject('demo-satellite', 0xffc857, { unixSeconds: 0 })
  const radius = 11000 * RENDER_UNITS_PER_KM
  expect(orbitCollectionRadius([object])).toBeCloseTo(radius + 0.02)
  object.display.orbitPathVisible = false
  expect(orbitCollectionRadius([object])).toBeCloseTo(radius + 0.02)
  object.display.bodyVisible = false
  expect(orbitCollectionRadius([object])).toBe(1)
  expect(orbitCollectionRadius([], false)).toBe(1)
  expect(orbitCollectionRadius([object], false)).toBeCloseTo(radius)
})

const FOV_45 = Math.PI / 4
const region: FitInput = { radiusRenderUnits: 1, verticalFovRad: FOV_45, viewportWidthCssPx: 375, viewportHeightCssPx: 812,
  insetLeftCssPx: 0, insetRightCssPx: 0, insetTopCssPx: 0, insetBottomCssPx: 0, minDistance: 0 }

it('equals the symmetric fit with no insets, apart from its tighter margin, and leaves the projection centred', () => {
  for (const [width, height] of [[375, 812], [844, 390], [1280, 720]]) {
    const patch = { viewportWidthCssPx: width, viewportHeightCssPx: height, radiusRenderUnits: 3.2 }
    const fit = calculateRegionFit({ ...region, ...patch })!
    expect(fit.distance).toBeCloseTo(calculateFitDistance({ ...region, ...patch })! * REGION_FIT_MARGIN / 1.1, 10)
    expect(fit.offsetXCssPx).toBe(0)
    expect(fit.offsetYCssPx).toBe(0)
  }
})

it('fits into the space above a bottom panel and moves Earth up into it', () => {
  const fit = calculateRegionFit({ ...region, insetTopCssPx: 56, insetBottomCssPx: 300 })!
  expect(fit.offsetYCssPx).toBe(-122)
  expect(fit.offsetXCssPx).toBe(0)
  // The whole visible height (812 - 356 = 456 px) is used, not twice the larger inset.
  const tangent = Math.tan(FOV_45 / 2)
  const theta = Math.min(Math.atan(tangent * 375 / 812), Math.atan(tangent * 456 / 812))
  expect(fit.distance).toBeCloseTo(REGION_FIT_MARGIN / Math.sin(theta), 10)
})

it('fits left of a side column in landscape', () => {
  const fit = calculateRegionFit({ ...region, viewportWidthCssPx: 844, viewportHeightCssPx: 390, insetRightCssPx: 380, insetTopCssPx: 40, insetBottomCssPx: 56 })!
  expect(fit.offsetXCssPx).toBe(-190)
  expect(fit.offsetYCssPx).toBe(-8)
  const tangent = Math.tan(FOV_45 / 2)
  const theta = Math.min(Math.atan(tangent * 464 / 390), Math.atan(tangent * 294 / 390))
  expect(fit.distance).toBeCloseTo(REGION_FIT_MARGIN / Math.sin(theta), 10)
})

it('rejects degenerate regions and unusable measurements', () => {
  for (const patch of [{ insetTopCssPx: 500, insetBottomCssPx: 312 }, { insetLeftCssPx: 200, insetRightCssPx: 175 }, { insetLeftCssPx: -1 },
    { radiusRenderUnits: 0 }, { viewportHeightCssPx: Number.NaN }, { verticalFovRad: Math.PI }, { minDistance: -1 }]) {
    expect(calculateRegionFit({ ...region, ...patch })).toBeNull()
  }
  expect(calculateRegionFit({ ...region, minDistance: 50 })!.distance).toBe(50)
})

it('only moves out during a Size or Shape adjustment and eases in afterwards when the orbit is small', () => {
  expect(containmentDistance(4, 6, 'during', false)).toBe(6)
  expect(containmentDistance(6, 4, 'during', false)).toBeNull()
  expect(containmentDistance(6, 4, 'during', true)).toBeNull()
  // At the end the orbit fills 2/10 of the region, less than 40 %.
  expect(containmentDistance(10, 2, 'end', false)).toBe(2)
  expect(containmentDistance(10, 2, 'end', true)).toBeNull()
  expect(containmentDistance(10, 5, 'end', false)).toBeNull()
  expect(containmentDistance(Number.NaN, 5, 'during', false)).toBeNull()
})

it('projects Earth to the visible region centre under the framing offset', () => {
  const fit = calculateRegionFit({ ...region, radiusRenderUnits: 2, insetTopCssPx: 56, insetBottomCssPx: 300 })!
  const camera = new THREE.PerspectiveCamera(45, 375 / 812, 0.05, 200)
  camera.position.set(0, 0, fit.distance)
  camera.lookAt(0, 0, 0)
  camera.setViewOffset(375, 812, -fit.offsetXCssPx, -fit.offsetYCssPx, 375, 812)
  camera.updateMatrixWorld()
  const picker = new ScenePicker(camera)
  const viewport = { width: 375, height: 812 }
  const centre = picker.project({ x: 0, y: 0, z: 1 }, viewport)!
  expect(centre.x).toBeCloseTo(187.5, 6)
  expect(centre.y).toBeCloseTo(56 + 456 / 2, 6)
  // The fitted sphere stays inside the visible region.
  const top = picker.project({ x: 0, y: 2, z: 0 }, viewport)!
  const bottom = picker.project({ x: 0, y: -2, z: 0 }, viewport)!
  expect(top.y).toBeGreaterThan(56)
  expect(bottom.y).toBeLessThan(812 - 300)
})

it('translates marker projections without changing their pick radius', () => {
  const plain = new THREE.PerspectiveCamera(45, 375 / 812, 0.05, 200)
  plain.position.set(0, 0, 6); plain.lookAt(0, 0, 0); plain.updateMatrixWorld()
  const shifted = plain.clone()
  shifted.setViewOffset(375, 812, 0, 122, 375, 812); shifted.updateMatrixWorld()
  const viewport = { width: 375, height: 812 }
  const marker = { x: 1.5, y: 0.4, z: 0.2 }
  const before = new ScenePicker(plain).project(marker, viewport)!
  const after = new ScenePicker(shifted).project(marker, viewport)!
  expect(after.x).toBeCloseTo(before.x, 6)
  expect(after.y).toBeCloseTo(before.y - 122, 6)
  expect(after.depth).toBeCloseTo(before.depth, 10)
  const source = (position: typeof marker) => ({ id: 'a', errored: false, bodyVisible: true, orbitPathVisible: false,
    body: { pickPositionRender: () => position, renderedRadiusRender: () => 0.02 }, path: {} })
  // The same offset from the projected marker hits at both framings.
  expect(new ScenePicker(plain).pick({ x: before.x + 9, y: before.y }, viewport, [source(marker)])).toHaveLength(1)
  expect(new ScenePicker(shifted).pick({ x: after.x + 9, y: after.y }, viewport, [source(marker)])).toHaveLength(1)
  expect(new ScenePicker(shifted).pick({ x: after.x + 11, y: after.y }, viewport, [source(marker)])).toHaveLength(0)
})
