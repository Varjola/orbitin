import { afterEach, expect, it } from 'vitest'
import { setActiveLocale } from '../i18n/active.ts'
import { text } from '../i18n/index.ts'
import { PRODUCT_MODES } from '../state/AppState.ts'
import { modeCardKeyTarget, modeCardsMarkup, modeIcon } from './modeSwitcherModel.ts'
import { modeSwitcherMarkup } from './ModeSwitcherView.ts'

afterEach(() => setActiveLocale('en'))

it('moves focus through the cards, wrapping at both ends', () => {
  expect(modeCardKeyTarget('ArrowDown', 0, 3)).toBe(1)
  expect(modeCardKeyTarget('ArrowDown', 2, 3)).toBe(0)
  expect(modeCardKeyTarget('ArrowUp', 0, 3)).toBe(2)
  expect(modeCardKeyTarget('Home', 2, 3)).toBe(0)
  expect(modeCardKeyTarget('End', 0, 3)).toBe(2)
})

it('leaves other keys alone', () => {
  expect(modeCardKeyTarget('Enter', 0, 3)).toBeNull()
  expect(modeCardKeyTarget('w', 0, 3)).toBeNull()
  expect(modeCardKeyTarget('ArrowDown', 0, 0)).toBeNull()
})

it('lists every mode in display order with its name and line, in both languages', () => {
  for (const locale of ['en', 'fi'] as const) {
    setActiveLocale(locale)
    const t = text().shell
    const markup = modeCardsMarkup(t.modes)
    const positions = PRODUCT_MODES.map((mode) => markup.indexOf(`data-mode="${mode}"`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    for (const mode of PRODUCT_MODES) {
      expect(markup).toContain(`>${t.modes[mode]}</span>`)
      expect(markup).toContain(`>${t.modeLines[mode]}</span>`)
    }
  }
})

it('offers every mode on phones, the Route Planner with its short name', () => {
  const markup = modeCardsMarkup(text().mobile.modes)
  expect(markup).toContain('>Routes</span>')
  for (const mode of PRODUCT_MODES) expect(markup).toContain(`data-mode="${mode}"`)
})

it('gives each mode its own decorative icon', () => {
  const icons = PRODUCT_MODES.map(modeIcon)
  expect(new Set(icons).size).toBe(PRODUCT_MODES.length)
  for (const icon of icons) expect(icon).toContain('aria-hidden="true"')
})

it('shows the current mode on the button, with the window closed and labelled', () => {
  const markup = modeSwitcherMarkup('maneuvers')
  expect(markup).toContain('aria-haspopup="dialog"')
  expect(markup).toContain('aria-expanded="false"')
  expect(markup).toContain('<span class="mode-switcher-name">Interception</span>')
  expect(markup).toContain('role="dialog" aria-label="Choose a mode" hidden')
})
