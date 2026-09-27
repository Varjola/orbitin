import * as THREE from 'three'
import { expect, it } from 'vitest'
import { rankPickHits } from '../interaction/pickRanking.ts'
import { occludedByEarth, ScenePicker, type PickSource } from './scenePicking.ts'

const VIEWPORT = { width: 800, height: 600 }

/** Camera on +Z at distance 6, looking at the Earth's centre. */
function camera(): THREE.PerspectiveCamera {
  const result = new THREE.PerspectiveCamera(45, VIEWPORT.width / VIEWPORT.height, 0.05, 200)
  result.position.set(0, 0, 6)
  result.lookAt(0, 0, 0)
  result.updateMatrixWorld()
  return result
}

function source(id: string, options: { position?: THREE.Vector3 | null; radius?: number; polylines?: Float32Array[]; revision?: number; errored?: boolean; bodyVisible?: boolean; orbitPathVisible?: boolean } = {}): PickSource & { revision: number } {
  const state = { revision: options.revision ?? 1 }
  return {
    id,
    errored: options.errored ?? false,
    bodyVisible: options.bodyVisible ?? true,
    orbitPathVisible: options.orbitPathVisible ?? true,
    body: { pickPositionRender: () => options.position ?? null, renderedRadiusRender: () => options.radius ?? 0.02 },
    path: { pickPolylinesRender: () => options.polylines ?? [], pickRevision: () => state.revision },
    get revision() { return state.revision },
    set revision(value) { state.revision = value },
  }
}

/** A circle of radius `r` in the plane z = `z`, as a flat xyz array. */
function circle(r: number, z = 0, points = 64): Float32Array {
  const values = new Float32Array((points + 1) * 3)
  for (let index = 0; index <= points; index += 1) {
    const angle = index / points * Math.PI * 2
    values.set([r * Math.cos(angle), r * Math.sin(angle), z], index * 3)
  }
  return values
}

it('projects a marker to screen space and hits it within the pick radius', () => {
  const picker = new ScenePicker(camera())
  const centre = picker.project({ x: 2, y: 0, z: 0 }, VIEWPORT)!
  expect(centre.x).toBeGreaterThan(400)
  expect(centre.y).toBeCloseTo(300, 5)
  const hits = picker.pick({ x: centre.x + 9, y: centre.y }, VIEWPORT, [source('a', { position: new THREE.Vector3(2, 0, 0) })])
  expect(hits).toEqual([{ objectId: 'a', kind: 'marker', distanceCssPx: expect.closeTo(9, 5), depth: expect.closeTo(Math.hypot(2, 6), 5) }])
  expect(picker.pick({ x: centre.x + 11, y: centre.y }, VIEWPORT, [source('a', { position: new THREE.Vector3(2, 0, 0) })])).toEqual([])
})

it('grows the marker hit radius with the drawn radius', () => {
  const picker = new ScenePicker(camera())
  const centre = picker.project({ x: 2, y: 0, z: 0 }, VIEWPORT)!
  // A 0.3-unit sphere at distance ~6.3 is ~33 px in radius on a 600 px view.
  expect(picker.pick({ x: centre.x + 30, y: centre.y }, VIEWPORT, [source('big', { position: new THREE.Vector3(2, 0, 0), radius: 0.3 })])).toHaveLength(1)
})

it('never picks a marker hidden by the Earth or behind the camera, a hidden body or an errored object', () => {
  const picker = new ScenePicker(camera())
  expect(occludedByEarth({ x: 0, y: 0, z: 6 }, { x: 0, y: 0, z: -2 })).toBe(true)
  expect(occludedByEarth({ x: 0, y: 0, z: 6 }, { x: 0, y: 0, z: 2 })).toBe(false)
  const at = picker.project({ x: 0, y: 0, z: 2 }, VIEWPORT)!
  expect(picker.project({ x: 0, y: 0, z: -2 }, VIEWPORT)).toBeNull()
  expect(picker.project({ x: 0, y: 0, z: 8 }, VIEWPORT)).toBeNull()
  expect(picker.pick(at, VIEWPORT, [source('behind-earth', { position: new THREE.Vector3(0, 0, -2) })])).toEqual([])
  expect(picker.pick(at, VIEWPORT, [source('hidden', { position: new THREE.Vector3(0, 0, 2), bodyVisible: false })])).toEqual([])
  expect(picker.pick(at, VIEWPORT, [source('errored', { position: new THREE.Vector3(0, 0, 2), errored: true })])).toEqual([])
  expect(picker.pick(at, VIEWPORT, [source('visible', { position: new THREE.Vector3(0, 0, 2) })]).map((hit) => hit.objectId)).toEqual(['visible'])
})

it('hits a visible orbit path near its line, ignoring segments with an occluded end', () => {
  const picker = new ScenePicker(camera())
  // An orbit of radius 2 in the image plane: fully visible.
  const orbit = source('orbit', { polylines: [circle(2)] })
  const edge = picker.project({ x: 2, y: 0, z: 0 }, VIEWPORT)!
  expect(picker.pick({ x: edge.x, y: edge.y + 4 }, VIEWPORT, [orbit])).toEqual([{ objectId: 'orbit', kind: 'path', distanceCssPx: expect.any(Number), depth: expect.any(Number) }])
  expect(picker.pick({ x: edge.x + 20, y: edge.y }, VIEWPORT, [orbit])).toEqual([])
  expect(picker.pick({ x: edge.x, y: edge.y }, VIEWPORT, [source('hidden', { polylines: [circle(2)], orbitPathVisible: false })])).toEqual([])
  // An arc behind the Earth projects across the disc's centre but every
  // segment has occluded ends, so it is not pickable; the same arc in front is.
  const arc = (z: number): Float32Array => Float32Array.from([-0.5, 0, z, 0, 0, z, 0.5, 0, z])
  const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }
  expect(picker.pick(centre, VIEWPORT, [source('behind', { polylines: [arc(-1.5)] })])).toEqual([])
  expect(picker.pick(centre, VIEWPORT, [source('front', { polylines: [arc(1.5)] })]).map((hit) => hit.objectId)).toEqual(['front'])
})

it('reuses projected paths until the camera, viewport or path revision changes, with a broad phase', () => {
  const view = camera()
  const picker = new ScenePicker(view)
  // Radii 1.1 to 1.6 stay well inside the view, clear of the top-left corner.
  const orbits = Array.from({ length: 100 }, (_, index) => source(`o${index}`, { polylines: [circle(1.1 + index * 0.005)] }))
  picker.pick({ x: 5, y: 5 }, VIEWPORT, orbits)
  expect(picker.projectionsBuilt).toBe(100)
  // The pointer is in a corner outside every path rectangle: no segment test.
  expect(picker.segmentTests).toBe(0)
  for (let pointerFrame = 0; pointerFrame < 20; pointerFrame += 1) picker.pick({ x: 5 + pointerFrame, y: 5 }, VIEWPORT, orbits)
  expect(picker.projectionsBuilt).toBe(100)
  orbits[3].revision += 1
  picker.pick({ x: 5, y: 5 }, VIEWPORT, orbits)
  expect(picker.projectionsBuilt).toBe(101)
  view.position.set(0, 1, 6); view.lookAt(0, 0, 0); view.updateMatrixWorld()
  picker.pick({ x: 5, y: 5 }, VIEWPORT, orbits)
  expect(picker.projectionsBuilt).toBe(201)
  picker.pick({ x: 5, y: 5 }, { width: 640, height: 480 }, orbits)
  expect(picker.projectionsBuilt).toBe(301)
})

it('makes a click on a shared orbit plane ambiguous so the chooser lists every object on it', () => {
  const picker = new ScenePicker(camera())
  const plane = circle(2)
  const sources = ['gps-a', 'gps-b', 'gps-c'].map((id) => source(id, { polylines: [plane] }))
  const edge = picker.project({ x: 2, y: 0, z: 0 }, VIEWPORT)!
  const ranked = rankPickHits(picker.pick({ x: edge.x + 1, y: edge.y }, VIEWPORT, sources))
  expect(ranked.ambiguous).toBe(true)
  expect(ranked.candidates.map((candidate) => candidate.objectId)).toEqual(['gps-a', 'gps-b', 'gps-c'])
})
