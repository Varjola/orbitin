import * as THREE from 'three'
import { OrbitPathView } from '../scene/OrbitPathView.ts'
import { ScenePicker, type PickSource } from '../scene/scenePicking.ts'
import { rankPickHits, type PickHit } from '../interaction/pickRanking.ts'
import { distanceToPolylineCssPx } from '../core/screenGeometry.ts'

/** Picking costs for the scene-scale bench (hover target:
 *  2 ms p95 per coalesced pointer frame at 100 objects with paths). */
export function benchSceneInteraction(measured: (name: string, operation: () => void) => void): void {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 1440 / 900, 0.05, 200)
  camera.position.set(0, 2, 9)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const viewport = { width: 1440, height: 900 }
  // 100 real conic path views (513 vertices each) at LEO to GEO radii.
  const sources: PickSource[] = Array.from({ length: 100 }, (_, index) => {
    const view = new OrbitPathView(scene, { semiMajorAxisKm: 6878 + index * 360, eccentricity: 0.001 * (index % 7) }, { inclinationRad: (index % 9) * 0.2, raanRad: index * 0.37, argOfPeriapsisRad: 0 }, 0xffffff)
    const position = new THREE.Vector3(Math.cos(index), 0.1 * (index % 5), Math.sin(index)).multiplyScalar(1.1 + index * 0.05)
    return {
      id: `o${index}`, errored: false, bodyVisible: true, orbitPathVisible: true,
      body: { pickPositionRender: () => position, renderedRadiusRender: () => 0.02 },
      path: { pickPolylinesRender: () => view.pickPolylinesRender(), pickRevision: () => view.pickRevision },
    }
  })
  const warm = new ScenePicker(camera)
  warm.pick({ x: 720, y: 450 }, viewport, sources)
  let pointer = 0
  measured('hover pick, 100 markers + paths, projections cached (pointer moves)', () => {
    pointer = (pointer + 7) % 400
    rankPickHits(warm.pick({ x: 520 + pointer, y: 300 + pointer / 2 }, viewport, sources))
  })
  measured('hover pick, 100 markers + paths, after a camera change (cache rebuild)', () => {
    camera.position.x = (camera.position.x + 0.01) % 1
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    rankPickHits(warm.pick({ x: 720, y: 450 }, viewport, sources))
  })
  const hits: PickHit[] = Array.from({ length: 100 }, (_, index) => ({ objectId: `o${index}`, kind: index % 3 === 0 ? 'marker' : 'path', distanceCssPx: (index * 37) % 11, depth: index }))
  measured('rankPickHits over 100 hits', () => { rankPickHits(hits) })
  const polyline = Array.from({ length: 513 }, (_, index) => ({ x: 720 + 300 * Math.cos(index / 512 * Math.PI * 2), y: 450 + 200 * Math.sin(index / 512 * Math.PI * 2) }))
  measured('polyline distance, 100 polylines x 513 points', () => { for (let index = 0; index < 100; index += 1) distanceToPolylineCssPx({ x: 700 + index, y: 450 }, polyline) })
}
