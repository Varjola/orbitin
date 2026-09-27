/** Screen-space geometry shared by 3D and map picking.
 *  Pure CSS-pixel arithmetic; no DOM, three.js or map dependency. */

export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

export interface ScreenRect {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export const EMPTY_SCREEN_RECT: ScreenRect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }

export function distanceToSegmentCssPx(point: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

/** Smallest distance from `point` to any segment of the polyline; Infinity
 *  for fewer than two points. */
export function distanceToPolylineCssPx(point: ScreenPoint, polyline: readonly ScreenPoint[]): number {
  let best = Infinity
  for (let index = 1; index < polyline.length; index += 1) {
    const distance = distanceToSegmentCssPx(point, polyline[index - 1], polyline[index])
    if (distance < best) best = distance
  }
  return best
}

/** The same distance over a flat `[x0, y0, x1, y1, ...]` array, with NaN
 *  pairs breaking the line (an occluded or clipped vertex). */
export function distanceToFlatPolylineCssPx(point: ScreenPoint, coordinates: Float32Array | readonly number[], count = coordinates.length / 2): number {
  let best = Infinity
  for (let index = 1; index < count; index += 1) {
    const ax = coordinates[(index - 1) * 2], ay = coordinates[(index - 1) * 2 + 1]
    const bx = coordinates[index * 2], by = coordinates[index * 2 + 1]
    if (Number.isNaN(ax) || Number.isNaN(bx)) continue
    const distance = distanceToSegmentCssPx(point, { x: ax, y: ay }, { x: bx, y: by })
    if (distance < best) best = distance
  }
  return best
}

export function rectOfPoints(points: readonly ScreenPoint[]): ScreenRect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return { minX, minY, maxX, maxY }
}

/** Broad phase: true when `point` lies within `margin` of the rectangle. */
export function pointNearRect(point: ScreenPoint, rect: ScreenRect, margin: number): boolean {
  return point.x >= rect.minX - margin && point.x <= rect.maxX + margin && point.y >= rect.minY - margin && point.y <= rect.maxY + margin
}
