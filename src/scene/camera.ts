import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/**
 * Distance 4.0 render units, 25 degrees north of the equator, 40 degrees west
 * of the prime meridian, expressed in the Y-up render frame.
 *
 * At the default 2026-03-20 12:00 UTC instant the sub-solar point is near
 * 1.9 degrees east, so this framing puts Africa and Europe in daylight, the
 * terminator across the visible disc left of centre, and the night side of the
 * Americas in view. This orientation is visible on
 * first paint rather than only after the learner orbits away from the Sun.
 */
const INITIAL_CAMERA_POSITION_RENDER = new THREE.Vector3(2.777, 1.69, 2.33)

/**
 * Keeps the camera off the rotation axis itself. OrbitControls already clamps
 * the polar angle to [0, PI] so the view can never roll south-up, but sitting
 * exactly on the pole makes the azimuth ill-conditioned and a drag there reads
 * as the globe spinning under the pointer. Both poles stay comfortably in view.
 */
const POLAR_ANGLE_MARGIN_RAD = 0.06

export function createCameraAndControls(domElement: HTMLElement): { camera: THREE.PerspectiveCamera; controls: OrbitControls } {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200)
  camera.position.copy(INITIAL_CAMERA_POSITION_RENDER)
  camera.lookAt(0, 0, 0)
  const controls = new OrbitControls(camera, domElement)
  controls.target.set(0, 0, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.minDistance = 1.15
  controls.maxDistance = 40
  controls.minPolarAngle = POLAR_ANGLE_MARGIN_RAD
  controls.maxPolarAngle = Math.PI - POLAR_ANGLE_MARGIN_RAD
  controls.rotateSpeed = 0.6
  controls.zoomSpeed = 0.8
  controls.touches.ONE = THREE.TOUCH.ROTATE
  controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE
  return { camera, controls }
}
