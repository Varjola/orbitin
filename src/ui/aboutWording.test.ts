import { expect, it } from 'vitest'
import { ABOUT_CREDITS, aboutVersionParts } from './aboutWording.ts'
import { text } from '../i18n/index.ts'

it('states the displayed version, linked to the changelog, with its revision and build environment', () => {
  expect(aboutVersionParts({ version: '0.23.2', revision: 'abc1234', environment: 'development' })).toEqual({ label: 'BETA 0.23.2', details: 'revision abc1234 · development', href: '/changelog' })
  expect(aboutVersionParts({ version: '1.0.0', revision: 'abc1234', environment: 'production' })).toEqual({ label: 'Version 1.0.0', details: 'revision abc1234 · production', href: '/changelog' })
})

it('carries the required orbital-data citation and the third-party credits', () => {
  const subjects = ABOUT_CREDITS.map((credit) => text().about.creditSubjects[credit.subject])
  expect(subjects).toEqual(['Orbital data', 'Earth imagery', 'Milky Way', 'Stars', 'Coastlines', 'SGP4 propagation'])
  expect(ABOUT_CREDITS[0].text).toBe('USSPACECOM / 18th Space Defense Squadron, accessed via Space-Track.org')
  // The citation names the provider without linking to it from the browser.
  expect(ABOUT_CREDITS[0].href).toBeUndefined()
  expect(ABOUT_CREDITS.find((credit) => credit.subject === 'stars')!.text).toContain('CC BY-SA 4.0')
})
