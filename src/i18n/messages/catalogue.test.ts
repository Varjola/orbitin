import { describe, expect, it } from 'vitest'
import { CATALOGUE_DISCOVERY_PAGES } from '../../data/catalogueDiscoveryPages.ts'
import { GPS_OPERATIONAL_GROUP, GPS_OPERATIONAL_PAGE } from '../../data/officialGroups/gpsOperational.ts'
import { ORBIT_PRESETS } from '../../simulation/orbitPresets.ts'
import { CATALOGUE_OBJECT_NOTE, DEFAULT_ORBIT_NOTE, OMM_OBJECT_NOTE, TLE_OBJECT_NOTE } from '../../state/canonicalNotes.ts'
import { FORBIDDEN_CATALOGUE_WORDING } from '../../ui/forbiddenWording.ts'
import { catalogueFor } from '../active.ts'
import { pseudoCatalogue, PSEUDO_CLOSE, PSEUDO_OPEN } from './pseudo.ts'
import workerCatalogues from '../../../workers/catalogue/catalogues.ts?raw'

const en = catalogueFor('en')
const fi = catalogueFor('fi')

/** Finnish strings that are rightly identical to English: product and
 *  provider names, abbreviations, units and formats. */
const SAME_IN_FINNISH = new Set([
  'TLE / 3LE', '1×', '1 min/s', '10 min/s', '1 h/s', 'Space-Track.org', '0 ISS\n1 ...\n2 ...',
  'Indigo', 'Magenta', 'J2', 'periapsis', 'apoapsis', 'LEO', 'MEO', 'GEO', 'HEO',
  // The product mark, view codes and taught terms kept on mobile.
  'Orbitin', '2D', '3D', 'Periapsis', 'Apoapsis', 'GPS',
])

type Leaf = { readonly path: string; readonly value: unknown }
function leaves(value: unknown, path = ''): Leaf[] {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return Object.entries(value).flatMap(([key, inner]) => leaves(inner, path ? `${path}.${key}` : key))
  return [{ path, value }]
}

describe('the Finnish catalogue', () => {
  it('has exactly the English keys, with a message wherever English has one', () => {
    const english = leaves(en)
    const finnish = new Map(leaves(fi).map((leaf) => [leaf.path, leaf.value]))
    expect([...finnish.keys()].sort()).toEqual(english.map((leaf) => leaf.path).sort())
    for (const leaf of english) {
      const other = finnish.get(leaf.path)
      expect(typeof other, leaf.path).toBe(typeof leaf.value)
      expect(Array.isArray(other), leaf.path).toBe(Array.isArray(leaf.value))
    }
  })

  it('leaves no message empty and translates everything that is not on the reviewed allowlist', () => {
    const english = new Map(leaves(en).map((leaf) => [leaf.path, leaf.value]))
    const untranslated: string[] = []
    const identical = new Set<string>()
    for (const { path, value } of leaves(fi)) {
      if (path.startsWith('units.') || path.startsWith('names.')) continue
      if (typeof value === 'string') {
        expect(value.trim(), path).not.toBe('')
        if (value !== english.get(path)) continue
        identical.add(value)
        if (!SAME_IN_FINNISH.has(value)) untranslated.push(`${path}: ${value}`)
      }
    }
    expect(untranslated).toEqual([])
    // The allowlist holds no stale entries.
    expect([...SAME_IN_FINNISH].filter((entry) => !identical.has(entry))).toEqual([])
    for (const list of [fi.names.first, fi.names.second]) {
      expect(list.length).toBeGreaterThanOrEqual(40)
      for (const word of list) expect(word.trim()).not.toBe('')
    }
  })

  it('names only real English taught terms in its (engl. …) glosses', () => {
    const englishTerms = new Set(Object.values(en.terms))
    const glosses = leaves(fi).flatMap(({ value }) => typeof value === 'string' ? [...value.matchAll(/\(engl\. ([^)]+)\)/g)].map((match) => match[1]) : [])
    expect(glosses.length).toBeGreaterThanOrEqual(8)
    for (const gloss of glosses) expect(englishTerms, gloss).toContain(gloss)
  })

  it('uses the glossary terms', () => {
    expect(fi.shell.modes).toEqual({ orbitLab: 'Kiertoradan mekaniikat', realObjects: 'Kiertoratojen kappaleet' })
    expect(fi.scene.noun).toBe('näkymä')
    expect(fi.terms.groundTrack).toBe('maareitti')
    expect(fi.inspector.layers.groundTrack).toBe('Maareitti')
    expect(fi.inspector.layers.orbitPath).toBe('Radan reitti')
    expect(fi.terms.epoch).toBe('epookki')
    expect(fi.elements.raanRad.label).toBe('Nousevan solmun pituus')
    expect(fi.elements.argOfPeriapsisRad.label).toBe('Periapsisin argumentti')
    expect(fi.terms.trueAnomaly).toBe('luonnollinen anomalia')
    expect(fi.terms.periapsis).toBe('periapsis')
  })
})

it('words counts with the right plural at 0, 1, 2, 21 and 1,000', () => {
  expect([0, 1, 2, 21, 1000].map((count) => en.catalogue.objectCount(count))).toEqual(['0 objects', '1 object', '2 objects', '21 objects', '1,000 objects'])
  expect([0, 1, 2, 21, 1000].map((count) => fi.catalogue.objectCount(count))).toEqual(['0 kohdetta', '1 kohde', '2 kohdetta', '21 kohdetta', '1 000 kohdetta'])
  expect(en.recordDetails.aboutDays(1)).toBe('About 1 day')
  expect(fi.recordDetails.aboutYears(1)).toBe('Noin 1 vuosi')
  expect(en.sceneObjects.removeConfirmation(1)).toBe('Remove 1 object from this scene?')
  expect(fi.sharing.opened('orbitLab', 1)).toContain('1 rata')
  expect(fi.sharing.opened('orbitLab', 21)).toContain('21 rataa')
})

it('shows the canonical stored notes and bundled copy exactly as the English interface did', () => {
  expect(en.notes).toEqual({ default: DEFAULT_ORBIT_NOTE, tle: TLE_OBJECT_NOTE, omm: OMM_OBJECT_NOTE, catalogue: CATALOGUE_OBJECT_NOTE })
  for (const preset of ORBIT_PRESETS) expect(en.presets[preset.id].description, preset.id).toBe(preset.canonicalNote)
  for (const page of [...CATALOGUE_DISCOVERY_PAGES, GPS_OPERATIONAL_PAGE]) {
    expect(en.discovery[page.id], page.id).toEqual({ title: page.title, summary: page.summary, whyItMatters: page.whyItMatters ?? null })
    expect(fi.discovery[page.id], page.id).toBeDefined()
  }
  expect(en.groups.official[GPS_OPERATIONAL_GROUP.id]).toEqual({ title: GPS_OPERATIONAL_GROUP.title, sourceDescription: GPS_OPERATIONAL_GROUP.provenance.sourceDescription })
  const published = Object.fromEntries([...workerCatalogues.matchAll(/id: '([a-z-]+)',\s*title: '([^']+)'/g)].map((match) => [match[1], match[2]]))
  expect(Object.keys(published).length).toBeGreaterThan(0)
  expect(en.groups.legacy).toEqual(published)
  expect(Object.keys(fi.groups.legacy).sort()).toEqual(Object.keys(published).sort())
})

it('keeps discovery copy free of numbers and of scene actions, in both languages', () => {
  for (const catalogue of [en, fi]) {
    for (const [id, page] of Object.entries(catalogue.discovery)) for (const copy of [page.title, page.summary, page.whyItMatters ?? '']) expect(copy, id).not.toMatch(/\d/)
    for (const label of [catalogue.catalogue.exploreHeading, catalogue.catalogue.browseAll]) expect(label).not.toMatch(catalogue === en ? /Add|scene|select all/i : /Lisää|näkymä|valitse kaikki/i)
  }
  // The whole-word check for the Finnish status word never matches the scene word.
  expect(FORBIDDEN_CATALOGUE_WORDING.fi.test('näkymä')).toBe(false)
  expect(FORBIDDEN_CATALOGUE_WORDING.fi.test('tilanne')).toBe(false)
  expect(FORBIDDEN_CATALOGUE_WORDING.fi.test('Tila')).toBe(true)
})

it('wraps and lengthens every pseudo-locale message but leaves data sections raw', () => {
  const pseudo = pseudoCatalogue()
  expect(pseudo.shell.inspector.startsWith(PSEUDO_OPEN)).toBe(true)
  expect(pseudo.shell.inspector.endsWith(PSEUDO_CLOSE)).toBe(true)
  expect(pseudo.shell.inspector.length).toBeGreaterThan(en.shell.inspector.length * 1.3)
  expect(pseudo.catalogue.objectCount(2)).toBe(`${PSEUDO_OPEN}2 objects${'~'.repeat(4)}${PSEUDO_CLOSE}`)
  expect(pseudo.units).toEqual(en.units)
  expect(pseudo.names.first).toEqual(en.names.first)
  expect(pseudo.terms).toEqual(en.terms)
  for (const { path, value } of leaves(pseudo)) if (typeof value === 'string' && value !== '' && !/^(units|names|terms)\./.test(path)) expect(value.startsWith(PSEUDO_OPEN), path).toBe(true)
})
