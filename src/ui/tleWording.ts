import { text } from '../i18n/index.ts'

export function sgp4ElementAgeWarning(offsetSeconds: number): string {
  const days = Math.abs(offsetSeconds) / 86400
  const age = text().inspector.elementAge
  if (days <= 3) return age.near
  if (days <= 14) return age.caution
  return age.strong
}

/** Compatibility export for the UI tests and public callers. */
export const tleAgeWarning = sgp4ElementAgeWarning
