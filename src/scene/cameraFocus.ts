import * as THREE from 'three'

/** Focus: a one-shot rotation about the Earth's centre
 *  from the camera's current direction to `towards`, at constant distance.
 *  `t` runs 0..1 and is eased so the turn starts and ends gently. */
export function focusCameraPosition(from: THREE.Vector3, towards: { readonly x: number; readonly y: number; readonly z: number }, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const distance = from.length()
  const start = from.clone().normalize()
  const end = new THREE.Vector3(towards.x, towards.y, towards.z)
  if (distance === 0 || end.lengthSq() === 0) return out.copy(from)
  const clamped = Math.min(1, Math.max(0, t))
  const eased = clamped * clamped * (3 - 2 * clamped)
  const rotation = new THREE.Quaternion().setFromUnitVectors(start, end.normalize())
  return out.copy(start).applyQuaternion(new THREE.Quaternion().slerp(rotation, eased)).multiplyScalar(distance)
}
