import { expect, it } from 'vitest'
import { selectionIntentFromClick } from './sceneSelectionIntent.ts'

it('maps normal and modifier clicks to named selection intent', () => {
  expect(selectionIntentFromClick({ ctrlKey: false, metaKey: false })).toBe('only')
  expect(selectionIntentFromClick({ ctrlKey: true, metaKey: false })).toBe('toggle')
  expect(selectionIntentFromClick({ ctrlKey: false, metaKey: true })).toBe('toggle')
})
