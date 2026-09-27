import { afterEach, expect, it } from 'vitest'
import { setActiveLocale } from '../i18n/active.ts'
import { catalogueFor } from '../i18n/index.ts'
import { SHARED_NOTES_V1 } from '../data/sceneLink.ts'
import { ORBIT_PRESETS } from '../simulation/orbitPresets.ts'
import { CATALOGUE_OBJECT_NOTE, OMM_OBJECT_NOTE, TLE_OBJECT_NOTE } from '../state/canonicalNotes.ts'
import { escapeHtml, html, trusted } from './markup.ts'
import { displayNote, SHARED_NOTE_MEANINGS } from './noteText.ts'
import { englishTerm, termAccessibleName, termLabelMarkup } from './termLabel.ts'

afterEach(() => setActiveLocale('en'))

it('shows only the label in English, and the label with its English term in Finnish', () => {
  expect(termLabelMarkup('Inclination', 'inclination')).toBe('Inclination')
  expect(termAccessibleName('Inclination', 'inclination')).toBe('Inclination')
  setActiveLocale('fi')
  expect(termLabelMarkup('Radan kaltevuus', 'inclination')).toBe('<span class="term"><span class="term-label">Radan kaltevuus</span> <span class="term-en" lang="en">inclination</span></span>')
  expect(termAccessibleName('Radan kaltevuus', 'inclination')).toBe('Radan kaltevuus (inclination)')
  expect(termLabelMarkup('<b>&', 'orbit')).toContain('&lt;b&gt;&amp;')
})

it('takes the English term from the English catalogue for every taught term', () => {
  setActiveLocale('fi')
  const english = catalogueFor('en').terms
  for (const id of Object.keys(english) as (keyof typeof english)[]) {
    expect(englishTerm(id)).toBe(english[id])
    expect(catalogueFor('fi').terms[id], id).toBeTruthy()
    const term = english[id]
    // Lowercase unless an abbreviation or a proper noun.
    if (!/^[A-Z0-9]+$/.test(term) && !term.startsWith('Sun')) expect(term, id).toBe(term.toLocaleLowerCase('en'))
  }
})

it('escapes interpolated text and keeps trusted markup', () => {
  expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  expect(html`<p title="${'"quoted"'}">${'<b>'}${trusted('<i>ok</i>')}</p>`).toBe('<p title="&quot;quoted&quot;">&lt;b&gt;<i>ok</i></p>')
})

it('translates canonical stored notes for display only, and shows learner notes as stored', () => {
  expect(SHARED_NOTE_MEANINGS).toHaveLength(SHARED_NOTES_V1.length)
  for (const note of SHARED_NOTES_V1) expect(displayNote(note)).toBe(note)
  for (const preset of ORBIT_PRESETS) expect(SHARED_NOTES_V1[SHARED_NOTE_MEANINGS.indexOf(preset.id)]).toBe(preset.canonicalNote)
  expect(displayNote('My own note')).toBe('My own note')
  expect(displayNote(null)).toBeNull()
  expect(displayNote(undefined)).toBeNull()
  setActiveLocale('fi')
  const fi = catalogueFor('fi')
  expect(displayNote(SHARED_NOTES_V1[0])).toBe(fi.notes.default)
  for (const preset of ORBIT_PRESETS) expect(displayNote(preset.canonicalNote)).toBe(fi.presets[preset.id].description)
  expect(displayNote(TLE_OBJECT_NOTE)).toBe(fi.notes.tle)
  expect(displayNote(OMM_OBJECT_NOTE)).toBe(fi.notes.omm)
  expect(displayNote(CATALOGUE_OBJECT_NOTE)).toBe(fi.notes.catalogue)
  expect(displayNote('My own note')).toBe('My own note')
})
