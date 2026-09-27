import { EMPTY_CATALOGUE_QUERY, type CatalogueQuery } from '../data/catalogueQuery.ts'
import type { CatalogueFailure } from '../data/catalogueFailure.ts'
export const MAX_COMPARED_RECORDS = 4
export type CatalogueAvailability = { readonly kind: 'not-loaded' } | { readonly kind: 'loading'; readonly snapshotId: string | null } | { readonly kind: 'ready'; readonly snapshotId: string; readonly entryCount: number } | { readonly kind: 'error'; readonly failure: CatalogueFailure; readonly snapshotId: string | null }
export interface CatalogueWorkspaceState {
  readonly availability: CatalogueAvailability
  readonly quickSearchText: string
  readonly query: CatalogueQuery
  readonly activeDiscoveryPageId: string | null
  readonly focusedCatalogId: string | null
  readonly workingSelectionIds: readonly string[]
  readonly comparedCatalogIds: readonly string[]
}
export const INITIAL_CATALOGUE_WORKSPACE: CatalogueWorkspaceState = {
  availability: { kind: 'not-loaded' }, quickSearchText: '', query: EMPTY_CATALOGUE_QUERY,
  activeDiscoveryPageId: null, focusedCatalogId: null, workingSelectionIds: [], comparedCatalogIds: [],
}
export function workspaceSnapshotId(state: CatalogueWorkspaceState): string | null { return state.availability.kind === 'not-loaded' ? null : state.availability.snapshotId }
export function catalogueLoadStarted(state: CatalogueWorkspaceState): CatalogueWorkspaceState { return { ...state, availability: { kind: 'loading', snapshotId: workspaceSnapshotId(state) } } }
export function catalogueLoadSucceeded(state: CatalogueWorkspaceState, snapshotId: string, entryCount: number): CatalogueWorkspaceState {
  const changed = workspaceSnapshotId(state) !== null && workspaceSnapshotId(state) !== snapshotId
  return {
    availability: { kind: 'ready', snapshotId, entryCount }, quickSearchText: state.quickSearchText, query: state.query,
    activeDiscoveryPageId: state.activeDiscoveryPageId, focusedCatalogId: changed ? null : state.focusedCatalogId,
    workingSelectionIds: changed ? [] : state.workingSelectionIds, comparedCatalogIds: changed ? [] : state.comparedCatalogIds,
  }
}
export function catalogueLoadFailed(state: CatalogueWorkspaceState, failure: CatalogueFailure): CatalogueWorkspaceState { return { ...state, availability: { kind: 'error', failure, snapshotId: workspaceSnapshotId(state) } } }
export function setCatalogueQuery(state: CatalogueWorkspaceState, query: CatalogueQuery): CatalogueWorkspaceState { return state.query === query ? state : { ...state, query } }
export function setQuickSearchText(state: CatalogueWorkspaceState, quickSearchText: string): CatalogueWorkspaceState { return state.quickSearchText === quickSearchText ? state : { ...state, quickSearchText } }
export function setActiveDiscoveryPageId(state: CatalogueWorkspaceState, activeDiscoveryPageId: string | null): CatalogueWorkspaceState { return state.activeDiscoveryPageId === activeDiscoveryPageId ? state : { ...state, activeDiscoveryPageId } }
export function openCatalogueDetails(state: CatalogueWorkspaceState, catalogId: string | null): CatalogueWorkspaceState { return state.focusedCatalogId === catalogId ? state : { ...state, focusedCatalogId: catalogId } }
export function toggleWorkingSelection(state: CatalogueWorkspaceState, catalogId: string): CatalogueWorkspaceState {
  if (catalogId === '') return state
  const next = state.workingSelectionIds.includes(catalogId)
    ? state.workingSelectionIds.filter((candidate) => candidate !== catalogId)
    : [...state.workingSelectionIds, catalogId]
  return { ...state, workingSelectionIds: next }
}
export function setWorkingSelectionIds(state: CatalogueWorkspaceState, ids: readonly string[]): CatalogueWorkspaceState {
  const unique: string[] = []
  for (const id of ids) if (id && !unique.includes(id)) unique.push(id)
  return unique.length === state.workingSelectionIds.length && unique.every((id, index) => id === state.workingSelectionIds[index]) ? state : { ...state, workingSelectionIds: unique }
}
export function clearWorkingSelection(state: CatalogueWorkspaceState): CatalogueWorkspaceState { return state.workingSelectionIds.length === 0 ? state : { ...state, workingSelectionIds: [] } }
export function setComparedCatalogIds(state: CatalogueWorkspaceState, ids: readonly string[]): CatalogueWorkspaceState { const unique: string[] = []; for (const id of ids) if (!unique.includes(id)) unique.push(id); const next = unique.slice(0, MAX_COMPARED_RECORDS); return next.length === state.comparedCatalogIds.length && next.every((id, index) => id === state.comparedCatalogIds[index]) ? state : { ...state, comparedCatalogIds: next } }
