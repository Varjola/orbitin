import { PRODUCT_MODES, type ProductMode } from '../state/AppState.ts'
import { text } from '../i18n/index.ts'
import { html, trusted } from './markup.ts'

const ICON_PATHS: Readonly<Record<ProductMode, string>> = {
  orbitLab: '<circle class="is-filled" cx="12" cy="12" r="2.4"/><ellipse cx="12" cy="12" rx="9.5" ry="4.2" transform="rotate(-30 12 12)"/><circle class="is-filled" cx="19.6" cy="7.6" r="1.5"/>',
  // An outward spiral of one and a half turns, tilted like its neighbours; the
  // arrowhead follows the curve's tangent at its end.
  maneuvers: '<path d="M10.89 14.82C10.42 14.75 9.97 14.48 9.79 14.05C9.6 13.61 9.69 13.01 10.15 12.44C10.61 11.87 11.44 11.34 12.44 11.09C13.45 10.84 14.62 10.89 15.56 11.3C16.5 11.71 17.2 12.49 17.33 13.47C17.46 14.45 17.01 15.61 15.99 16.6C14.97 17.59 13.39 18.4 11.65 18.7C9.91 19.01 8.03 18.8 6.61 18.04C5.19 17.29 4.24 15.99 4.17 14.48C4.09 12.96 4.9 11.23 6.48 9.82C8.06 8.41 10.4 7.32 12.87 6.96C15.35 6.6 17.93 6.98 19.84 8.07"/><path d="M18.28 5.16 19.84 8.07 16.54 8.2"/>',
  routePlanner: '<circle class="is-filled" cx="5" cy="18.5" r="2"/><circle class="is-filled" cx="19" cy="5.5" r="2"/><path d="M6.6 17c6-1 2.4-7.4 5.4-9.5 1.6-1.1 3.6-1.5 5.2-1.6" stroke-dasharray="2.6 2.2"/>',
  realObjects: '<g transform="rotate(-45 12 12)"><rect x="9.5" y="8.8" width="5" height="6.4" rx="1"/><path d="M2.5 9.5h4.8v5H2.5ZM16.7 9.5h4.8v5h-4.8ZM7.3 12h2.2M14.5 12h2.2"/></g>',
}

/** A mode's decorative icon: its button takes its name from the message catalogue. */
export function modeIcon(mode: ProductMode): string {
  return `<svg class="mode-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_PATHS[mode]}</svg>`
}

/** One card per mode in display order. `names` differ by presentation: the
 *  phone has shorter names. The line saying what a mode is for is shared. */
export function modeCardsMarkup(names: Readonly<Record<ProductMode, string>>, modes: readonly ProductMode[] = PRODUCT_MODES): string {
  const lines = text().shell.modeLines
  return modes.map((mode) => html`<button class="mode-card" type="button" data-mode="${mode}"><span class="mode-card-icon">${trusted(modeIcon(mode))}</span><span class="mode-card-text"><span class="mode-card-name">${names[mode]}</span><span class="mode-card-line">${lines[mode]}</span></span></button>`).join('')
}

/** Marks the current mode's card. */
export function syncModeCards(cards: Iterable<HTMLButtonElement>, mode: ProductMode, disabled: boolean): void {
  for (const card of cards) {
    if (card.dataset.mode === mode) card.setAttribute('aria-current', 'true')
    else card.removeAttribute('aria-current')
    card.disabled = disabled
  }
}

/** The card a key moves focus to, or null when the key does not move focus.
 *  Movement wraps, as the cards form one short list. */
export function modeCardKeyTarget(key: string, from: number, count: number): number | null {
  if (count === 0) return null
  if (key === 'ArrowDown') return (from + 1) % count
  if (key === 'ArrowUp') return (from - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}
