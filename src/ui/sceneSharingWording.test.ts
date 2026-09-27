import { expect, it } from 'vitest'
import {
  linkUnavailableReason, openConfirmationMessage, openIncomingLine, openProgressMessage, openResultLines, sceneOpenFailureMessage, shareDialogModel,
} from './sceneSharingWording.ts'
import { text } from '../i18n/index.ts'

const SHARE_CATALOGUE_NOTE = text().sharing.catalogueNote
const SHARE_PRIVACY_NOTE = text().sharing.privacyNote

it('describes what is shared, when it opens and whether catalogue records are involved', () => {
  expect(shareDialogModel({ mode: 'orbitLab', objectCount: 3, manualObjectCount: 0, catalogueObjectCount: 0 }, { ok: true })).toEqual({
    summary: 'Shares your Orbit Lab scene: 3 orbits.',
    timeNote: "The scene opens at Orbitin's start time, 2026-03-20 12:00:00 UTC, with playback paused.",
    catalogueNote: null, privacyNote: SHARE_PRIVACY_NOTE, linkUnavailable: null,
  })
  const real = shareDialogModel({ mode: 'realObjects', objectCount: 1, manualObjectCount: 0, catalogueObjectCount: 1 }, { ok: true })
  expect(real.summary).toBe('Shares your Real Objects scene: 1 object.')
  expect(real.timeNote).toBe('The scene opens at the current time, with playback running.')
  expect(real.catalogueNote).toBe(SHARE_CATALOGUE_NOTE)
  expect(shareDialogModel({ mode: 'orbitLab', objectCount: 0, manualObjectCount: 0, catalogueObjectCount: 0 }, { ok: true }).summary).toBe('Your Orbit Lab scene is empty.')
})

it('explains every link refusal and points to the file', () => {
  expect(linkUnavailableReason({ kind: 'over-limit', mode: 'orbitLab', objectCount: 42, manualObjectCount: 0 })).toBe('Links can hold up to 20 orbits. This scene has 42. Download a scene file instead.')
  expect(linkUnavailableReason({ kind: 'over-limit', mode: 'realObjects', objectCount: 60, manualObjectCount: 14 })).toBe('Links can hold up to 100 objects, including up to 10 entered as TLE or OMM. This scene has 14 entered objects. Download a scene file instead.')
  expect(linkUnavailableReason({ kind: 'over-limit', mode: 'realObjects', objectCount: 101, manualObjectCount: 0 })).toBe('Links can hold up to 100 objects, including up to 10 entered as TLE or OMM. This scene has 101 objects. Download a scene file instead.')
  expect(linkUnavailableReason({ kind: 'outside-bounds' })).toBe('An object in this scene has a name or record too long for a link. Download a scene file instead.')
  expect(shareDialogModel({ mode: 'orbitLab', objectCount: 21, manualObjectCount: 0, catalogueObjectCount: 0 }, { ok: false, reason: { kind: 'outside-bounds' } }).linkUnavailable).toContain('too long for a link')
})

it('names only the target mode in the confirmation, with its clock', () => {
  expect(openConfirmationMessage('realObjects', 12)).toBe('Opening this scene replaces your Real Objects scene (12 objects). Your Orbit Lab scene is kept. The clock moves to the current time and plays.')
  expect(openConfirmationMessage('orbitLab', 1)).toBe("Opening this scene replaces your Orbit Lab scene (1 orbit). Your Real Objects scene is kept. The clock moves to Orbitin's start time and pauses.")
  expect(openIncomingLine('realObjects', 32)).toBe('Real Objects: 32 objects')
  expect(openProgressMessage(32)).toBe('Opening shared scene… Loading catalogue records for 32 objects.')
})

it('summarizes every problem kind with correct plurals', () => {
  expect(openResultLines('realObjects', 32, [])).toEqual(['Opened a shared Real Objects scene: 32 objects.'])
  const missing = ['1', '2', '3', '4', '5', '6', '7'].map((catalogId) => ({ kind: 'catalogue-missing' as const, id: `catalogue-${catalogId}`, catalogId }))
  const lines = openResultLines('realObjects', 20, [
    ...missing,
    { kind: 'element-set-changed', id: 'a', catalogId: '8', savedEpochUnixSeconds: 0, currentEpochUnixSeconds: 1 },
    { kind: 'element-set-changed', id: 'b', catalogId: '9', savedEpochUnixSeconds: 0, currentEpochUnixSeconds: 1 },
    { kind: 'source-invalid', id: 'tle-1', message: 'bad' },
    { kind: 'scene-capacity', mode: 'realObjects', droppedIds: Array.from({ length: 12 }, (_, index) => `x${index}`) },
    { kind: 'layer-budget', mode: 'realObjects', layer: 'sensorGeometry', budget: 75, changedIds: ['a', 'b', 'c', 'd', 'e'] },
    { kind: 'layer-budget', mode: 'realObjects', layer: 'groundTrackHistory', budget: 100, changedIds: ['a'] },
  ])
  expect(lines).toEqual([
    'Opened a shared Real Objects scene: 20 objects.',
    '7 objects are no longer in the catalogue and were left out: NORAD 1, NORAD 2, NORAD 3, NORAD 4, NORAD 5 and 2 more.',
    '2 catalogue objects now use newer element sets than when the scene was shared.',
    '1 object could not be read and was left out.',
    'A scene holds at most 100 objects; 12 were left out.',
    'Sensor geometry can be shown for up to 75 objects; it was turned off for 5.',
    'Ground-track histories can be recorded for up to 100 objects; it was turned off for 1.',
  ])
  expect(openResultLines('realObjects', 1, [missing[0], { kind: 'element-set-changed', id: 'a', catalogId: '8', savedEpochUnixSeconds: 0, currentEpochUnixSeconds: 1 }, { kind: 'source-invalid', id: 'x', message: '' }, { kind: 'source-invalid', id: 'y', message: '' }]).slice(1)).toEqual([
    '1 object is no longer in the catalogue and was left out: NORAD 1.',
    '1 catalogue object now uses a newer element set than when the scene was shared.',
    '2 objects could not be read and were left out.',
  ])
})

it('maps every unreadable input to its message', () => {
  expect(sceneOpenFailureMessage('link', { kind: 'malformed' })).toBe('This link does not contain a valid Orbitin scene.')
  expect(sceneOpenFailureMessage('link', { kind: 'invalid-document', errors: [] })).toBe('This link does not contain a valid Orbitin scene.')
  expect(sceneOpenFailureMessage('link', { kind: 'too-large' })).toBe('This link does not contain a valid Orbitin scene.')
  expect(sceneOpenFailureMessage('link', { kind: 'newer-version' })).toBe('This link was made by a newer version of Orbitin.')
  expect(sceneOpenFailureMessage('link', { kind: 'unsupported-browser' })).toBe('This browser cannot open this scene link. Try a current version of Chrome, Edge, Firefox or Safari.')
  expect(sceneOpenFailureMessage('file', { kind: 'malformed' })).toBe('This file is not a valid Orbitin scene file.')
  expect(sceneOpenFailureMessage('file', { kind: 'invalid-document', errors: [] })).toBe('This file is not a valid Orbitin scene file.')
  expect(sceneOpenFailureMessage('file', { kind: 'too-large' })).toBe('This file is too large to be an Orbitin scene file.')
  expect(sceneOpenFailureMessage('file', { kind: 'newer-version' })).toBe('This file was made by a newer version of Orbitin.')
})
