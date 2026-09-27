import type { Object3D } from 'three'
import { SensorFootprintView } from '../scene/SensorFootprintView.ts'
import type { OrbitalObject } from '../simulation/OrbitalObject.ts'
import type { SensorGeometryViewPort } from './OrbitalObjectRuntime.ts'

export function createSensorGeometryAdapter(parent: Object3D, object: OrbitalObject): SensorGeometryViewPort {
  const view = new SensorFootprintView(parent, object.style.colorHex)
  let disposed = false
  return {
    setGeometry: (geometry) => view.setGeometry(geometry),
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
