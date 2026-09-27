import type { Vec3 } from '../core/vec3.ts'

/** How far the first live view turns from the sub-solar direction towards
 *  the afternoon, so the terminator shows, and how far north it looks from. */
const AFTERNOON_RAD = (38 * Math.PI) / 180
const NORTHWARD = 0.35

/** The direction from Earth's centre to place the
 *  camera so that the sunlit hemisphere faces it, with the terminator in
 *  view. Render frame, +Y up (Earth's north); the Sun is a direction. */
export function daylightViewDirection(sun: Vec3): Vec3 {
  const cos = Math.cos(AFTERNOON_RAD)
  const sin = Math.sin(AFTERNOON_RAD)
  const x = sun.x * cos + sun.z * sin
  const z = -sun.x * sin + sun.z * cos
  const y = sun.y + NORTHWARD
  const length = Math.hypot(x, y, z) || 1
  return { x: x / length, y: y / length, z: z / length }
}
