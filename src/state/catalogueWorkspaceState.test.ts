import { expect, it } from 'vitest'
import { INITIAL_CATALOGUE_WORKSPACE, catalogueLoadFailed, catalogueLoadStarted, catalogueLoadSucceeded, setActiveDiscoveryPageId, setComparedCatalogIds, setQuickSearchText, setWorkingSelectionIds, toggleWorkingSelection, workspaceSnapshotId } from './catalogueWorkspaceState.ts'

it('preserves a usable snapshot when refresh fails', () => {
  const loaded = catalogueLoadSucceeded(INITIAL_CATALOGUE_WORKSPACE, 'snapshot-a', 12)
  const refreshing = catalogueLoadStarted(loaded)
  expect(refreshing.availability.kind).toBe('loading')
  const failed = catalogueLoadFailed(refreshing, { kind: 'http', message: 'network', status: 503 })
  expect(workspaceSnapshotId(failed)).toBe('snapshot-a')
  expect(failed.query).toBe(loaded.query)
})

it('clears focused, working and comparison state only when the snapshot changes', () => {
  const loaded = catalogueLoadSucceeded(INITIAL_CATALOGUE_WORKSPACE, 'snapshot-a', 12)
  const working = setWorkingSelectionIds(setQuickSearchText(setActiveDiscoveryPageId({ ...loaded, focusedCatalogId: '1' }, 'low-earth-orbit'), 'leo'), ['3', '2', '3'])
  const compared = setComparedCatalogIds(working, ['1', '2', '3', '4', '5'])
  expect(compared.comparedCatalogIds).toEqual(['1', '2', '3', '4'])
  const refreshed = catalogueLoadSucceeded(compared, 'snapshot-b', 9)
  expect(refreshed.focusedCatalogId).toBeNull()
  expect(refreshed.workingSelectionIds).toEqual([])
  expect(refreshed.comparedCatalogIds).toEqual([])
  expect(refreshed.quickSearchText).toBe('leo')
  expect(refreshed.activeDiscoveryPageId).toBe('low-earth-orbit')
})

it('keeps working-selection insertion order and toggles only that concern', () => {
  const loaded = catalogueLoadSucceeded(INITIAL_CATALOGUE_WORKSPACE, 'snapshot-a', 12)
  const first = toggleWorkingSelection(loaded, '2')
  const second = toggleWorkingSelection(toggleWorkingSelection(first, '1'), '2')
  expect(second.workingSelectionIds).toEqual(['1'])
  expect(second.focusedCatalogId).toBeNull()
  expect(second.comparedCatalogIds).toEqual([])
})
