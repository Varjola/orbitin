import type { EnvironmentState } from '../simulation/environment.ts'
import type { SunSynchronousStatus } from '../simulation/propagationTransitions.ts'
import type { CatalogueManifestV1, CatalogueRecordV1, CatalogueSnapshotParts } from '../data/catalogueSchema.ts'
import type { CatalogueFacetCounts, CatalogueQuery, CatalogueQueryResult } from '../data/catalogueQuery.ts'
import type { CatalogueSearchResult } from '../data/catalogueSearch.ts'
import type { CatalogueFailure } from '../data/catalogueFailure.ts'
import type { AppState } from '../state/AppState.ts'
import type { ShellState } from '../state/shellState.ts'
import type { CatalogueWorkspaceState } from '../state/catalogueWorkspaceState.ts'
import type { CatalogueComparisonItem } from './catalogueComparison.ts'
import type { CatalogueDiscoveryPresentation } from './catalogueDiscoveryModel.ts'
import type { GroupProvenance } from './sceneObjectsModel.ts'
import type { Insets, Rect } from './shellGeometry.ts'
import type { LayerBudgetSurface, ReadoutValues, ShapeAdjustParameter } from './uiTypes.ts'

export type { Insets, Rect } from './shellGeometry.ts'

/** Where an empty tap happened. */
export type EmptyTapSurface = '3d' | 'map'

/** One official catalogue group offered for a whole-group add on the mobile
 *  Add sheet. Worded by the view. */
export interface OfficialGroupTile {
  readonly groupId: string
  readonly title: string
  /** Ordered present member ids from the loaded index. */
  readonly memberIds: readonly string[]
  readonly state: 'unavailable' | 'ready' | 'in-scene' | 'full'
}

/** A featured pick present in the loaded index. */
export interface FeaturedPickTile {
  readonly id: string
  readonly catalogId: string
  readonly name: string
  readonly inScene: boolean
}

/** A scene change that can be undone. */
export type SceneChangeNotice =
  | { readonly kind: 'added'; readonly name: string }
  | { readonly kind: 'addedGroup'; readonly groupId: string; readonly title: string; readonly count: number }
  | { readonly kind: 'created'; readonly name: string }
  | { readonly kind: 'removed'; readonly names: readonly string[]; readonly all: boolean }

/** The learner's own location, held in memory only. */
export type MyPlaceStatus = 'off' | 'locating' | 'on' | 'failed'

/** Everything `Application` asks of its interface.
 *
 * `UiRoot` (desktop) and `MobileUiRoot` (mobile) implement it. Members that
 * one presentation has no use for are documented no-ops there: the desktop
 * catalogue workspace members on mobile, and the mobile-only members on
 * desktop (`framingInsets` returns null there, so the desktop fit and
 * projection are unchanged). */
export interface ApplicationUi {
  // Lifecycle
  setLoading(loading: boolean): void
  /** Rebuild every view in the active language and replay the held state. */
  rebuild(): void
  dispose(): void

  // Application, shell and catalogue workspace state
  syncShell(shell: ShellState): void
  syncState(state: AppState, lockStatus?: SunSynchronousStatus): void
  syncCatalogueWorkspace(workspace: CatalogueWorkspaceState): void
  updateReadouts(values: ReadoutValues | null, environment: EnvironmentState, simulation: AppState['simulation'], nowMs: number, force?: boolean): void
  setGroupProvenance(provenance: GroupProvenance): void

  // Status and error presenters
  showTleErrors(messages: readonly string[]): void
  clearTleErrors(): void
  setSceneStatus(message: string): void
  showTleRuntimeError(message: string): void
  setLayerBudgetMessage(surface: LayerBudgetSurface, message: string): void

  // Catalogue presenters
  setCatalogueSnapshot(snapshot: CatalogueSnapshotParts, updated?: boolean): void
  showCatalogueDetails(record: CatalogueRecordV1, referenceUnixMs: number): void
  showCatalogueDetailsError(catalogId: string, failure: CatalogueFailure): void
  showCatalogueDetailsLoading(catalogId: string): void
  clearCatalogueDetails(): void
  setCatalogueComparison(items: readonly CatalogueComparisonItem[]): void
  clearCatalogueComparison(): void
  setCatalogueError(failure: CatalogueFailure): void
  setCatalogueNotice(message: string): void
  renderCatalogueDiscovery(presentation: CatalogueDiscoveryPresentation): void
  renderCatalogueQuickSearch(result: CatalogueSearchResult, reason: 'input' | 'snapshot'): void
  renderCatalogueQuery(manifest: CatalogueManifestV1, query: CatalogueQuery, result: CatalogueQueryResult, overviewFacets: CatalogueFacetCounts | null): void
  /** Published by Application when the snapshot or the Real Objects scene changes. */
  renderOfficialGroups(groups: readonly OfficialGroupTile[]): void
  /** Featured picks present in the loaded index; empty while it is not loaded. */
  renderFeaturedPicks(picks: readonly FeaturedPickTile[]): void

  // Focus helpers
  focusGroundTrackMapButton(): void
  focusCatalogueSearch(): void
  focusCatalogueDetails(): void
  focusCatalogueResultsSummary(): void
  captureCatalogueReturnFocus(): void
  focusCatalogueReturnFocus(): void
  focusSceneObjects(): void

  // Geometry
  /** Rectangles of shell regions that cover the canvas (desktop camera fit). */
  getOccludingRects(): DOMRect[]
  /** Insets of the visible region for framing, or null for no framing offset. */
  framingInsets(canvas: Rect): Insets | null
  /** An empty tap on the 3D view or map (from the interaction controller). */
  handleEmptyTap(surface: EmptyTapSurface): void

  // Undo notices and My place (no-ops on desktop)
  /** A scene change was recorded and can be undone. */
  announceSceneChange(change: SceneChangeNotice): void
  /** The recorded change can no longer be undone. */
  withdrawUndo(): void
  setMyPlaceStatus(status: MyPlaceStatus): void
  /** The Shape chip whose guides show on the selected orbit, or null. */
  activeShapeParameter(): ShapeAdjustParameter | null

  // Scene opening
  showSceneOpenConfirmation(confirmation: { readonly message: string; readonly incoming: string }): void
  showSceneOpenProgress(message: string): void
  showSceneOpenNotice(lines: readonly string[]): void
  showSceneOpenError(message: string, retryable: boolean): void
  hideSceneOpenStatus(): void
  setSceneOpening(opening: boolean): void
}
