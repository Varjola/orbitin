import type { Scene } from 'three'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { OrbitPathView } from '../scene/OrbitPathView.ts'
import { SampledTrajectoryView } from '../scene/SampledTrajectoryView.ts'
import { trajectoryVisualizationFor, type OrbitalObject } from '../simulation/OrbitalObject.ts'
import type { PathViewPort } from './OrbitalObjectRuntime.ts'

export function createPathAdapter(
  scene: Scene,
  object: OrbitalObject,
  register: (view: OrbitPathView) => void,
  unregister: (view: OrbitPathView) => void,
  registerMaterial: (material: LineMaterial) => void = () => {},
  unregisterMaterial: (material: LineMaterial) => void = () => {},
): PathViewPort {
  const trajectory = trajectoryVisualizationFor(object)
  if (trajectory.kind === 'sampledWindow') {
    const view = new SampledTrajectoryView(scene, object.style.colorHex, registerMaterial, unregisterMaterial)
    return {
      kind: 'sampled',
      rebuildShape: () => {},
      setOrientation: () => {},
      setSegments: (segments) => view.setSegments(segments),
      setVisible: (visible) => view.setVisible(visible),
      setColor: (colorHex) => view.setColor(colorHex),
      setSelected: (selected) => view.setSelected(selected),
      pickPolylinesRender: () => view.pickPolylinesRender(),
      pickRevision: () => view.pickRevision,
      setHovered: (hovered) => view.setHovered(hovered),
      dispose: () => view.dispose(),
    }
  }
  const elements = trajectory.kind === 'driftingConic' ? trajectory.meanElements : trajectory.geometry
  const view = new OrbitPathView(scene, elements, elements, object.style.colorHex)
  try { register(view) } catch (error) { unregister(view); view.dispose(); throw error }
  let disposed = false
  return {
    kind: 'conic',
    rebuildShape: (shape) => view.rebuildShape(shape),
    setOrientation: (elements) => view.setOrientation(elements),
    setVisible: (visible) => view.setVisible(visible),
    setColor: (color) => view.setColor(color),
    setSelected: (selected) => view.setSelected(selected),
    pickPolylinesRender: () => view.pickPolylinesRender(),
    pickRevision: () => view.pickRevision,
    setHovered: (hovered) => view.setHovered(hovered),
    dispose: () => {
      if (disposed) return
      disposed = true
      unregister(view)
      view.dispose()
    },
  }
}
