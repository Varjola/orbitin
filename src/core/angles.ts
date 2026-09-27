export const TAU = Math.PI * 2

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

export function wrapRadians(rad: number): number {
  const wrapped = rad % TAU
  return wrapped < 0 ? wrapped + TAU : wrapped
}

export function wrapDegrees(deg: number): number {
  const wrapped = deg % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

/** Wrap to (-PI, PI], east-positive for longitude. */
export function wrapRadiansSigned(rad: number): number {
  const wrapped = wrapRadians(rad)
  return wrapped > Math.PI ? wrapped - TAU : wrapped
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
