import { createFormatter } from '../format.ts'
import { english, englishUnits } from './en.ts'
import type { MessageCatalogue } from './types.ts'

/** Development only: English wrapped in `⟦…⟧` and
 *  lengthened by about 40 %, to find text that bypasses the catalogue and
 *  layouts that break with longer words. `main.ts` imports this module only
 *  behind `import.meta.env.DEV`; the build check keeps it out of bundles. */

export const PSEUDO_OPEN = '⟦'
export const PSEUDO_CLOSE = '⟧'

/** Sections that are data rather than messages: units feed the formatter,
 *  generated-name words become learner data, and taught terms are English. */
const RAW_SECTIONS = new Set(['units', 'names', 'terms'])

export function pseudoText(value: string): string {
  if (value === '') return value
  return `${PSEUDO_OPEN}${value}${'~'.repeat(Math.ceil(value.length * 0.4))}${PSEUDO_CLOSE}`
}

function wrap(value: unknown): unknown {
  if (typeof value === 'string') return pseudoText(value)
  if (typeof value === 'function') return (...args: unknown[]) => { const result = (value as (...inner: unknown[]) => unknown)(...args); return typeof result === 'string' ? pseudoText(result) : result }
  if (Array.isArray(value)) return value.map(wrap)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, wrap(inner)]))
  return value
}

export function pseudoCatalogue(): MessageCatalogue {
  const source = english(createFormatter('pseudo', englishUnits))
  return Object.fromEntries(Object.entries(source).map(([key, section]) => [key, RAW_SECTIONS.has(key) ? section : wrap(section)])) as MessageCatalogue
}
