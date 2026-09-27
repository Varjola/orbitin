import { SHARED_NOTES_V1 } from '../data/sceneLink.ts'
import { text } from '../i18n/index.ts'
import type { OrbitPresetId } from '../simulation/orbitPresets.ts'
import { CATALOGUE_OBJECT_NOTE, OMM_OBJECT_NOTE, TLE_OBJECT_NOTE } from '../state/canonicalNotes.ts'

/** What each `SHARED_NOTES_V1` entry, by index, says in the interface. The
 *  table is append-only, so this list only ever grows with it. */
export const SHARED_NOTE_MEANINGS: readonly ('default' | OrbitPresetId)[] = ['default', 'leo', 'meo', 'geo', 'polar', 'elliptical', 'sso']

/** A stored note in the active language. Canonical
 *  notes are translated; anything else is learner data, shown as stored. */
export function displayNote(notes: string | null | undefined): string | null {
  if (notes === null || notes === undefined) return null
  const t = text()
  const index = SHARED_NOTES_V1.indexOf(notes)
  if (index >= 0) {
    const meaning = SHARED_NOTE_MEANINGS[index]
    if (meaning === 'default') return t.notes.default
    if (meaning !== undefined) return t.presets[meaning].description
  }
  if (notes === TLE_OBJECT_NOTE) return t.notes.tle
  if (notes === OMM_OBJECT_NOTE) return t.notes.omm
  if (notes === CATALOGUE_OBJECT_NOTE) return t.notes.catalogue
  return notes
}
