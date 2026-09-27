import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFormatter } from './format.ts'
import { englishUnits } from './messages/en.ts'
import { finnishUnits } from './messages/fi.ts'

const NBSP = ' '
const DEG = Math.PI / 180
const en = createFormatter('en', englishUnits)
const fi = createFormatter('fi', finnishUnits)

afterEach(() => { vi.restoreAllMocks() })

/** One row per kind, in both languages. */
describe('formats every kind of value per language', () => {
  it.each([
    ['decimal', (f: typeof en) => f.number(1234.5, 1), '1,234.5', `1${NBSP}234,5`],
    ['negative', (f: typeof en) => f.signed(-3.2, 1, '°'), '−3.2°', '−3,2°'],
    ['signed rate', (f: typeof en) => f.degreesPerDay(0.99 * DEG / 86_400), '+0.99°/day', '+0,99°/vrk'],
    ['distance', (f: typeof en) => f.km(6916), '6,916 km', `6${NBSP}916 km`],
    ['area', (f: typeof en) => f.km2(12_345), '12,345 km²', `12${NBSP}345 km²`],
    ['percentage', (f: typeof en) => f.percent(0.125, 1), '12.5%', `12,5${NBSP}%`],
    ['long duration', (f: typeof en) => f.duration(5760), '1h 36m', `1${NBSP}h 36${NBSP}min`],
    ['short duration', (f: typeof en) => f.duration(312), '5m 12s', `5${NBSP}min 12${NBSP}s`],
    ['speed multiplier', (f: typeof en) => f.speedMultiplier(60), '60×', '60×'],
    ['latitude', (f: typeof en) => f.latitude(12.3 * DEG, 1), '12.3°N', `12,3°${NBSP}P`],
    ['longitude', (f: typeof en) => f.longitude(45.6 * DEG, 1), '45.6°E', `45,6°${NBSP}I`],
    ['southern latitude', (f: typeof en) => f.latitude(-12.3 * DEG, 1), '12.3°S', `12,3°${NBSP}E`],
    ['western longitude', (f: typeof en) => f.longitude(-45.6 * DEG, 1), '45.6°W', `45,6°${NBSP}L`],
    ['solar time', (f: typeof en) => f.solarTime(10.5), '10:30', '10.30'],
    ['list', (f: typeof en) => f.list(['A', 'B', 'C']), 'A, B and C', 'A, B ja C'],
    ['exact threshold', (f: typeof en) => f.exact(0.001), '0.001', '0,001'],
    ['whole number', (f: typeof en) => f.integer(31_885.7), '31,885', `31${NBSP}885`],
  ])('%s', (_kind, render, english, finnish) => {
    expect(render(en)).toBe(english)
    expect(render(fi)).toBe(finnish)
  })

  it('never shows a negative zero, and rounds at the decimals boundary', () => {
    for (const f of [en, fi]) {
      expect(f.number(-0.04, 1)).toMatch(/^0[.,]0$/)
      expect(f.number(-0, 0)).toBe('0')
      expect(f.signed(-0.004, 2)).toMatch(/^0[.,]00$/)
      expect(f.signedDegrees(-0.0001 * DEG, 1)).toMatch(/^0[.,]0°$/)
      expect(f.latitude(0.00001 * DEG, 1)).toMatch(/^0[.,]0°$/)
    }
    expect(en.number(0.96, 1)).toBe('1.0')
    expect(fi.number(1.25, 1)).toBe('1,3')
  })

  it('shows a missing value instead of NaN or infinity', () => {
    for (const f of [en, fi]) {
      expect(f.number(Number.NaN, 2)).toBe('—')
      expect(f.signed(Number.POSITIVE_INFINITY, 1)).toBe('—')
      expect(f.percent(Number.NaN, 1)).toBe('—')
      expect(f.km(Number.NaN)).toBe('— km')
    }
  })
})

it('chooses plural forms by the language rules at 0, 1, 2, 21 and 1,000', () => {
  const forms = { one: 'one', other: 'other' }
  expect([0, 1, 2, 21, 1000].map((count) => en.plural(count, forms))).toEqual(['other', 'one', 'other', 'other', 'other'])
  expect([0, 1, 2, 21, 1000].map((count) => fi.plural(count, forms))).toEqual(['other', 'one', 'other', 'other', 'other'])
})

it('builds its Intl objects once, so per-frame readouts allocate none', () => {
  const constructor = vi.spyOn(Intl, 'NumberFormat')
  const f = createFormatter('fi', finnishUnits)
  const after = constructor.mock.calls.length
  for (let index = 0; index < 50; index += 1) { f.number(index, 2); f.km(index); f.percent(index / 100, 1) }
  expect(constructor.mock.calls.length - after).toBe(3)
})
