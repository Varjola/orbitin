import type { Vec3 } from '../core/vec3.ts'
import type { OrbitGeometry } from './geometry.ts'

function rotateZ(vector: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return { x: cosine * vector.x - sine * vector.y, y: sine * vector.x + cosine * vector.y, z: vector.z }
}

function rotateX(vector: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return { x: vector.x, y: cosine * vector.y - sine * vector.z, z: sine * vector.y + cosine * vector.z }
}

export function rotatePerifocalToEci(vector: Vec3, geometry: OrbitGeometry): Vec3 {
  return rotateZ(rotateX(rotateZ(vector, geometry.argOfPeriapsisRad), geometry.inclinationRad), geometry.raanRad)
}

