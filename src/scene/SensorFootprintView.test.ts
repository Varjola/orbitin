import { expect, it } from 'vitest'
import { Scene } from 'three'
import { EARTH_RADIUS_KM, SIMULATION_START_INSTANT } from '../core/constants.ts'
import { subSatellitePointFromEarthFixed } from '../simulation/groundTrack.ts'
import { createInstantaneousSensorGeometry } from '../simulation/sensorFootprint.ts'
import { SensorFootprintView } from './SensorFootprintView.ts'

it('reuses one Earth-fixed resource group and disposes it idempotently', () => {
  const scene = new Scene()
  const view = new SensorFootprintView(scene, 0xffc857)
  const position = { x: EARTH_RADIUS_KM + 500, y: 0, z: 0 }
  const centre = subSatellitePointFromEarthFixed(position, SIMULATION_START_INSTANT)!
  const result = createInstantaneousSensorGeometry({ instant: SIMULATION_START_INSTANT, positionEarthFixedKm: position, centre, sensor: { fieldOfViewHalfAngleRad: 10 * Math.PI / 180, maxOffNadirSteeringRad: 0 } })
  if (result.kind !== 'valid') throw new Error(result.message)
  view.setVisible(true)
  view.setGeometry(result.geometry)
  expect(scene.children).toHaveLength(1)
  const group = scene.children[0]
  expect(group.children).toHaveLength(5)
  view.setGeometry(result.geometry)
  view.setColor(0x56b4e9)
  view.setSelected(true)
  view.dispose()
  view.dispose()
  expect(scene.children).toHaveLength(0)
})
