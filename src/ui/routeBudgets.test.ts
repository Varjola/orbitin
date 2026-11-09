import { afterEach, expect, it } from 'vitest'
import { setActiveLocale } from '../i18n/active.ts'
import { text } from '../i18n/index.ts'
import { budgetsMarkup } from './routeResultMarkup.ts'

afterEach(() => setActiveLocale('en'))

it('anchors a route’s cost in what real satellites carry, in both languages', () => {
  for (const locale of ['en', 'fi'] as const) {
    setActiveLocale(locale)
    const t = text().routePlanner.budgets
    const markup = budgetsMarkup()
    expect(t.anchors).toHaveLength(5)
    expect(markup.match(/<li>/g)).toHaveLength(5)
    expect(markup).toContain(t.intro)
    expect(markup).toContain(t.outro)
  }
  // The electric-thruster line says both the reach and the catch.
  setActiveLocale('en')
  expect(text().routePlanner.budgets.anchors[1]).toMatch(/several\skm\/s.*months/)
})
