import type { Object3D } from 'three'
import { GroundTrackView } from '../scene/GroundTrackView.ts'
import type { OrbitalObject } from '../simulation/OrbitalObject.ts'
import type { GroundTrackViewPort } from './OrbitalObjectRuntime.ts'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

export function createGroundTrackAdapter(
  parent: Object3D,
  object: OrbitalObject,
  register: (material: LineMaterial) => void,
  unregister: (material: LineMaterial) => void,
): GroundTrackViewPort {
  const view = new GroundTrackView(parent, object.style.colorHex, register, unregister)
  let disposed = false
  return {
    setCurrent: (point) => view.setCurrent(point),
    setWindow: (window) => view.setWindow(window),
    setHistory: (segments) => view.setHistory(segments),
    setVisible: (visible) => view.setVisible(visible),
    setColor: (colorHex) => view.setColor(colorHex),
    setSelected: (selected) => view.setSelected(selected),
    dispose: () => {
      if (disposed) return
      disposed = true
      view.dispose()
    },
  }
}

