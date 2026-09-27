/** The Lab backdrop's palette and the display-time colour rule that
 *  keeps object colours legible on it. Pure; the stored colours never change. */

/** Space (stars, Sun, atmosphere) or the light Lab backdrop. */
export type SceneBackdropKind = 'space' | 'lab'

export const LAB_PALETTE = Object.freeze({
  background: 0xeef1f5,
  earth: 0xc6d2de,
  equator: 0x8b9bb0,
  gridLine: 0xc3ccd8,
  gridOutline: 0x8e9db0,
  guide: 0x4a5a70,
  halo: 0x1d2835,
  marker: 0xb7791f,
})

/** Contrast every drawn object colour must reach against the Lab
 *  background: WCAG's 3:1 for graphical objects. */
export const LAB_MINIMUM_CONTRAST = 3

export function relativeLuminance(hex: number): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel((hex >> 16) & 0xff) + 0.7152 * channel((hex >> 8) & 0xff) + 0.0722 * channel(hex & 0xff)
}

export function contrastRatio(a: number, b: number): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The colour to draw on the Lab backdrop: unchanged when it already has
 *  enough contrast, otherwise the same hue and saturation at the highest
 *  lightness that reaches `LAB_MINIMUM_CONTRAST`. */
export function labDisplayColor(hex: number): number {
  if (contrastRatio(hex, LAB_PALETTE.background) >= LAB_MINIMUM_CONTRAST) return hex
  const [h, s, l] = rgbToHsl(hex)
  let low = 0
  let high = l
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2
    if (contrastRatio(hslToRgb(h, s, mid), LAB_PALETTE.background) >= LAB_MINIMUM_CONTRAST) low = mid
    else high = mid
  }
  return hslToRgb(h, s, low)
}

function rgbToHsl(hex: number): [number, number, number] {
  const r = ((hex >> 16) & 0xff) / 255
  const g = ((hex >> 8) & 0xff) / 255
  const b = (hex & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

function hslToRgb(h: number, s: number, l: number): number {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number): number => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    const v = u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p
    return Math.round(Math.min(1, Math.max(0, v)) * 255)
  }
  return (channel(h + 1 / 3) << 16) | (channel(h) << 8) | channel(h - 1 / 3)
}
