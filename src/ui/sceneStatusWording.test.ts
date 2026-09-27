import { expect, it } from 'vitest'
import { quickSearchSelectionMessage, sceneStatusMessage } from './sceneStatusWording.ts'

it('describes explicit scene outcomes without adding hidden UI state', () => {
  expect(sceneStatusMessage({ kind: 'nothing-requested' })).toBe('')
  expect(sceneStatusMessage({ kind: 'refused-capacity', available: 1, requested: 2 })).toContain('room for 1 more')
  expect(sceneStatusMessage({ kind: 'already-present', objects: [{ name: 'ISS' }] as never[] })).toContain('ISS')
  expect(quickSearchSelectionMessage('ISS')).toBe('Selected ISS in the Real Objects scene.')
})
