import { MIN_SIMULATION_INSTANT, MAX_SIMULATION_INSTANT } from './constants.ts'
import type { SimulationInstant } from './time.ts'

export function clampInstant(instant: SimulationInstant): SimulationInstant {
  if (!Number.isFinite(instant.unixSeconds)) throw new Error('Simulation instant must be finite')
  return { unixSeconds: Math.max(MIN_SIMULATION_INSTANT.unixSeconds, Math.min(MAX_SIMULATION_INSTANT.unixSeconds, instant.unixSeconds)) }
}
export function formatUtcInputValue(instant: SimulationInstant): string {
  return new Date(instant.unixSeconds * 1000).toISOString().slice(0, 19)
}
export function formatUtcDisplay(instant: SimulationInstant): string {
  return formatUtcInputValue(instant).replace('T', ' ') + ' UTC'
}
export function parseUtcInputValue(text: string): SimulationInstant | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (!match) return null
  const [, y, m, d, h, min, s = '00'] = match
  const unixSeconds = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s)) / 1000
  if (!Number.isFinite(unixSeconds)) return null
  const instant = { unixSeconds }
  // Date.UTC normalizes impossible dates; reject those rather than silently jumping.
  return formatUtcInputValue(instant) === `${y}-${m}-${d}T${h}:${min}:${s}` ? instant : null
}
