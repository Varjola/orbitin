import { expect, it } from 'vitest'
import { setActiveLocale } from '../i18n/active.ts'
import { tleAgeWarning } from './tleWording.ts'

it('keeps TLE age tiers qualitative and symmetric in time', () => {
  expect(tleAgeWarning(3 * 86400)).toMatch(/^Near epoch/)
  expect(tleAgeWarning(-3 * 86400)).toMatch(/^Near epoch/)
  expect(tleAgeWarning(14 * 86400)).toMatch(/^Caution/)
  expect(tleAgeWarning(-14 * 86400)).toMatch(/^Caution/)
  expect(tleAgeWarning(14 * 86400 + 1)).toMatch(/^Strong age warning/)
})

it('gives a curated member supplemented at 10 to 30 days the strong warning in English and Finnish', () => {
  for (const days of [20, 29]) {
    expect(tleAgeWarning(days * 86400)).toMatch(/^Strong age warning: the selected instant is more than fourteen days from the element epoch/)
    setActiveLocale('fi')
    expect(tleAgeWarning(days * 86400)).toMatch(/^Vahva ikävaroitus: valittu hetki on yli neljäntoista päivän päässä/)
    setActiveLocale('en')
  }
})
