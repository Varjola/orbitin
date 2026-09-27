import { expect, it } from 'vitest'
import { createInitialState } from './initialState.ts'
import { selectionProjection } from './selectionProjection.ts'

it('projects the active mode selection without exposing scene internals', () => {
  const state = { ...createInitialState(), realObjects: { scene: { objects: [], selection: { ids: ['real-1'], primaryId: 'real-1' } } }, activeMode: 'realObjects' as const }
  const projection = selectionProjection(state)
  expect(projection.primaryId).toBe('real-1')
  expect(projection.selectedIds).toEqual(new Set(['real-1']))
})
