import type { SensorGeometryViewPort } from './OrbitalObjectRuntime.ts'
import type { InstantaneousSensorGeometry } from '../simulation/sensorFootprint.ts'

/** Fan one immutable sensor publication to the Earth-fixed globe and the
 * synchronized map. Both children receive the same geometry reference. */
export function combineSensorGeometryViewPorts(
  createPrimary: () => SensorGeometryViewPort,
  createSecondary: () => SensorGeometryViewPort,
  /** The colour the 3D child draws with (the Lab backdrop
   *  darkens light colours); the map child keeps the stored colour. */
  primaryColor: (colorHex: number) => number = (colorHex) => colorHex,
): SensorGeometryViewPort {
  const primary = createPrimary()
  let secondary: SensorGeometryViewPort
  try {
    secondary = createSecondary()
  } catch (error) {
    primary.dispose()
    throw error
  }
  let disposed = false
  return {
    setGeometry: (geometry: InstantaneousSensorGeometry | null) => { primary.setGeometry(geometry); secondary.setGeometry(geometry) },
    setVisible: (visible) => { primary.setVisible(visible); secondary.setVisible(visible) },
    setColor: (colorHex) => { primary.setColor(primaryColor(colorHex)); secondary.setColor(colorHex) },
    setSelected: (selected) => { primary.setSelected(selected); secondary.setSelected(selected) },
    dispose: () => {
      if (disposed) return
      disposed = true
      primary.dispose()
      secondary.dispose()
    },
  }
}
