import type { EnvironmentState } from '../simulation/environment.ts'
import type { SunSynchronousStatus } from '../simulation/propagationTransitions.ts'
import type { CatalogueManifestV1, CatalogueRecordV1, CatalogueSnapshotParts } from '../data/catalogueSchema.ts'
import type { CatalogueFacetCounts, CatalogueQuery, CatalogueQueryResult } from '../data/catalogueQuery.ts'
import type { CatalogueSearchResult } from '../data/catalogueSearch.ts'
import type { CatalogueFailure } from '../data/catalogueFailure.ts'
import type { AddCatalogueRecordsOutcome } from '../state/catalogueAdditionOutcome.ts'
import { activeScene, activeSceneMode, isSceneMode, type AppState, type ProductMode } from '../state/AppState.ts'
import type { ShellState } from '../state/shellState.ts'
import { INITIAL_CATALOGUE_WORKSPACE, type CatalogueWorkspaceState } from '../state/catalogueWorkspaceState.ts'
import { applicationBuildInfo } from '../app/applicationBuildInfo.ts'
import { focusIsLost } from '../ui/focusKeeping.ts'
import { isLiveClock } from '../ui/liveClock.ts'
import type { ApplicationUi, EmptyTapSurface, FeaturedPickTile, Insets, MyPlaceStatus, OfficialGroupTile, Rect, SceneChangeNotice } from '../ui/applicationUi.ts'
import type { CatalogueComparisonItem } from '../ui/catalogueComparison.ts'
import type { CatalogueDiscoveryPresentation } from '../ui/catalogueDiscoveryModel.ts'
import { catalogueAttribution } from '../ui/catalogueWording.ts'
import type { GroupProvenance } from '../ui/sceneObjectsModel.ts'
import { sceneStatusMessage } from '../ui/sceneStatusWording.ts'
import { SceneOpenView } from '../ui/SceneOpenView.ts'
import type { LayerBudgetSurface, ReadoutValues, UiCallbacks } from '../ui/uiTypes.ts'
import type { ManeuverPanelModel } from '../ui/maneuverPanelModel.ts'
import type { RoutePanelModel, RoutePlaybackModel } from '../ui/routePanelModel.ts'
import { MobileGamePanelView, MobileHohmannPanelView, MobileRouteBudgetsPanelView } from './MobileGamePanelView.ts'
import { MobileManeuverBarView } from './MobileManeuverBarView.ts'
import { TurnUprightView } from './TurnUprightView.ts'
import { RouteEditPanelView } from './RouteEditPanelView.ts'
import { RouteChooseSheetView } from './RouteChooseSheetView.ts'
import { RouteViewPanelView } from './RouteViewPanelView.ts'
import { RoutePlanSheetView } from './RoutePlanSheetView.ts'
import { RouteDetailsSheetView } from './RouteDetailsSheetView.ts'
import { RouteExitPanelView } from './RouteExitPanelView.ts'
import { captionBurn, MobileRoutePlaybackBarView } from './MobileRoutePlaybackBarView.ts'
import { MobileRouteSceneView } from './MobileRouteSceneView.ts'
import { routeEditOf, type RouteEditParameter, type RouteSide } from './routeRulerModel.ts'
import type { RouteTryId } from '../simulation/route/routeSources.ts'
import { text } from '../i18n/index.ts'
import {
  afterEmptyTap, afterModeChange, afterSceneChange, closeSurface, INITIAL_MOBILE_SHELL, initialMobileShell, isCompactSurface,
  openSurface, setExpanded, setRouteParameter, setRouteSide, setShapeParameter, toggleImmersive, toggleSurface, type MobileSceneFacts, type MobileShellState, type MobileSurface, type ShapeParameter,
} from './mobileShellState.ts'
import { MobileTopBarView } from './MobileTopBarView.ts'
import { ModesPanelView } from './ModesPanelView.ts'
import { MobileDockView } from './MobileDockView.ts'
import { PanelHost } from './PanelHost.ts'
import { TimePanelView } from './TimePanelView.ts'
import { ObjectChipView } from './ObjectChipView.ts'
import { ObjectCardView, type CardLayer } from './ObjectCardView.ts'
import { ObjectsListView } from './ObjectsListView.ts'
import { ViewToolsView } from './ViewToolsView.ts'
import { LayersPanelView } from './LayersPanelView.ts'
import { AboutPanelView, browserSharePort, ExamplesPanelView, HelpPanelView, MenuView, shareSceneLink } from './MenuView.ts'
import { NoticeView } from './NoticeView.ts'
import { BackGesture } from './backGesture.ts'
import { ShapeStripView } from './ShapeStripView.ts'
import { NewOrbitPanelView } from './NewOrbitPanelView.ts'
import { AddSheetView } from './AddSheetView.ts'
import { altitudeText, colorCss, objectCardModel } from './objectSummaryModel.ts'

/** The media query that places panels in a side column. */
export const MOBILE_LANDSCAPE_QUERY = '(orientation: landscape)'
/** The gesture hint floats until the first gesture or this long. */
export const HINT_DURATION_MS = 8000
/** The panel the objects list's Add button opens in each mode. */
const ADD_SURFACE: Readonly<Record<ProductMode, MobileSurface>> = { orbitLab: 'newOrbit', maneuvers: 'none', routePlanner: 'none', realObjects: 'add' }
type HintKind = 'gesture' | 'realObjects' | 'maneuvers'
const HINT_TEXT: Readonly<Record<HintKind, () => string>> = {
  gesture: () => text().mobile.hint,
  realObjects: () => text().mobile.hintRealObjects,
  maneuvers: () => text().mobile.hintManeuvers,
}

interface MobileViews {
  readonly topBar: MobileTopBarView
  readonly modes: ModesPanelView
  readonly viewTools: ViewToolsView
  readonly hint: HTMLElement
  readonly bottom: HTMLElement
  readonly notice: NoticeView
  readonly chip: ObjectChipView
  readonly panels: PanelHost
  readonly dock: MobileDockView
  readonly burnBar: MobileManeuverBarView
  readonly upright: TurnUprightView
  readonly game: MobileGamePanelView
  readonly shape: ShapeStripView
  readonly newOrbit: NewOrbitPanelView
  readonly add: AddSheetView
  readonly card: ObjectCardView
  readonly list: ObjectsListView
  readonly time: TimePanelView
  readonly layers: LayersPanelView
  readonly menu: MenuView
  readonly sceneOpen: SceneOpenView
  readonly routeEdit: RouteEditPanelView
  readonly routeChoose: RouteChooseSheetView
  readonly routeView: RouteViewPanelView
  readonly routePlan: RoutePlanSheetView
  readonly routeScene: MobileRouteSceneView
  readonly routeBar: MobileRoutePlaybackBarView
  readonly routeDetails: RouteDetailsSheetView
  readonly routeExit: RouteExitPanelView
}

/** Facts about the active scene that drive the panel rules. */
export function mobileSceneFacts(state: AppState): MobileSceneFacts {
  const scene = activeScene(state)
  const primary = scene.selection.primaryId ? scene.objects.find((object) => object.id === scene.selection.primaryId) : undefined
  return { mode: state.activeMode, sceneEmpty: scene.objects.length === 0, hasKeplerianSelection: primary?.source.kind === 'keplerian', hasSelection: primary !== undefined }
}

/** The notice for a recorded scene change. */
export function sceneChangeMessage(change: SceneChangeNotice): string {
  const t = text().mobile.notice
  switch (change.kind) {
    case 'added': return t.added(change.name)
    case 'addedGroup': return t.addedGroup(change.count, text().mobile.add.groupCountedTitles[change.groupId] ?? change.title)
    case 'created': return t.created(change.name)
    case 'removed': return change.all || change.names.length !== 1 ? t.removedAll : t.removed(change.names[0])
  }
}

/** The phone presentation of the one
 *  application. It composes the mobile views, owns `MobileShellState`,
 *  implements `ApplicationUi`, rebuilds in place on a language change and
 *  measures the visible region for framing. Desktop-only members of the
 *  port are documented no-ops here. */
export class MobileUiRoot implements ApplicationUi {
  private readonly container: HTMLElement
  private readonly callbacks: UiCallbacks
  private readonly view: (Window & typeof globalThis) | null
  private readonly landscapeQuery: MediaQueryList | null
  private readonly back: BackGesture | null
  private views: MobileViews
  private shell: MobileShellState = INITIAL_MOBILE_SHELL
  private shellInitialized = false
  private state: AppState | undefined
  private desktopShell: ShellState | undefined
  private lockStatus: SunSynchronousStatus = { kind: 'none' }
  private loading = true
  private sceneOpening = false
  private catalogueWorkspace: CatalogueWorkspaceState = INITIAL_CATALOGUE_WORKSPACE
  private searchResult: CatalogueSearchResult | null = null
  private groupTiles: readonly OfficialGroupTile[] = []
  private featuredPicks: readonly FeaturedPickTile[] = []
  private citation = ''
  private myPlace: MyPlaceStatus = 'off'
  private values: ReadoutValues | null = null
  private lastReadoutUpdate = -Infinity
  private opener: HTMLElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private hintTimer: number | null = null
  private hintShown = true
  /** Which hint shows: the gesture hint, then once the Real Objects one. */
  private hintKind: HintKind = 'gesture'
  private realObjectsHinted = false
  private maneuversHinted = false
  private maneuvers: ManeuverPanelModel | null = null
  private lastManeuverUpdate = -Infinity
  /** The last game outcome shown, so a new one opens the game panel once. */
  private lastOutcome: string | null = null
  private typing = false
  private framingPending = false
  private route: RoutePanelModel | null = null
  private routePlayback: RoutePlaybackModel | null = null
  private barHidden = true
  /** What Choose is waiting for: the sheet closes once it has arrived. */
  private routeChoice: { readonly kind: 'try'; readonly id: RouteTryId } | { readonly kind: 'pick'; readonly side: RouteSide; readonly catalogId: string } | null = null
  private readonly onFirstGesture = (event: Event): void => {
    if (event.target instanceof Node && this.views.hint.contains(event.target)) return
    this.dismissHint()
  }
  private readonly onVisualViewport = (): void => this.applyKeyboardInset()
  /** Turning the phone may cover or uncover the mode. */
  private readonly onOrientation = (): void => { this.render(); this.syncManeuvers() }

  constructor(container: HTMLElement, callbacks: UiCallbacks) {
    this.container = container
    this.callbacks = callbacks
    this.view = container.ownerDocument.defaultView
    this.landscapeQuery = this.view && typeof this.view.matchMedia === 'function' ? this.view.matchMedia(MOBILE_LANDSCAPE_QUERY) : null
    this.back = this.view?.history ? new BackGesture(this.view, () => this.onBack(), () => this.historyBlocked()) : null
    this.views = this.build()
    this.landscapeQuery?.addEventListener?.('change', this.onOrientation)
    container.ownerDocument.addEventListener('pointerdown', this.onFirstGesture, true)
    if (this.view) this.hintTimer = this.view.setTimeout(() => this.dismissHint(), HINT_DURATION_MS)
  }

  // Lifecycle

  /** Rebuild every view in the active language and replay the held state.
   *  The panel state survives; transient notices and messages clear. */
  rebuild(): void {
    const surface = this.shell.surface
    this.disposeViews()
    this.views = this.build()
    this.lastReadoutUpdate = -Infinity
    this.views.hint.hidden = !this.hintShown
    this.views.add.setGroups(this.groupTiles)
    this.views.add.setFeatured(this.featuredPicks)
    if (this.searchResult) this.views.add.setResult(this.searchResult)
    this.views.layers.setMyPlaceStatus(this.myPlace)
    this.render()
    this.setSceneOpening(this.sceneOpening)
    if (surface === 'none') this.views.topBar.menuButton.focus({ preventScroll: true })
  }

  setLoading(loading: boolean): void {
    this.loading = loading
    this.render()
  }

  dispose(): void {
    this.landscapeQuery?.removeEventListener?.('change', this.onOrientation)
    this.container.ownerDocument.removeEventListener('pointerdown', this.onFirstGesture, true)
    if (this.hintTimer !== null) this.view?.clearTimeout(this.hintTimer)
    this.stopKeyboardTracking()
    this.back?.dispose()
    this.disposeViews()
    this.container.textContent = ''
  }

  // State

  syncShell(shell: ShellState): void {
    this.desktopShell = shell
    if (this.state) this.render()
  }

  syncState(state: AppState, lockStatus: SunSynchronousStatus = { kind: 'none' }): void {
    const previous = this.state
    this.state = state
    this.lockStatus = lockStatus
    const facts = mobileSceneFacts(state)
    let next = this.shell
    if (!this.shellInitialized) { next = initialMobileShell(facts, this.shell.shapeParameter); this.shellInitialized = true }
    else if (previous && previous.activeMode !== state.activeMode) next = afterModeChange(this.shell, facts)
    else next = afterSceneChange(this.shell, facts)
    if (previous && activeScene(previous).selection.primaryId !== activeScene(state).selection.primaryId) this.views.card.setBudgetMessage('')
    // The first entry into an empty Real Objects scene says where to start.
    if (previous && previous.activeMode !== state.activeMode && state.activeMode === 'realObjects' && !this.realObjectsHinted && state.realObjects.scene.objects.length === 0) {
      this.realObjectsHinted = true
      this.showHint('realObjects')
    }
    if (previous && previous.activeMode !== state.activeMode && state.activeMode === 'maneuvers' && !this.maneuversHinted) {
      this.maneuversHinted = true
      this.showHint('maneuvers')
    }
    this.setShell(next)
    this.render()
  }

  syncCatalogueWorkspace(workspace: CatalogueWorkspaceState): void {
    this.catalogueWorkspace = workspace
    if (this.state) this.views.add.sync(workspace.availability, this.state.realObjects.scene, this.loading)
  }

  updateReadouts(values: ReadoutValues | null, environment: EnvironmentState, simulation: AppState['simulation'], nowMs: number, force = false): void {
    if (this.loading || (!force && nowMs - this.lastReadoutUpdate < 90)) return
    this.lastReadoutUpdate = nowMs
    this.values = values
    const views = this.views
    // The Route Planner's dock shows its live scene's clock, from its model.
    if (this.state?.activeMode !== 'routePlanner') views.dock.updateTime(environment.instant)
    views.dock.setLive(this.state?.activeMode === 'realObjects' && isLiveClock(simulation, environment.instant.unixSeconds, Date.now() / 1000))
    views.time.update(environment.instant, simulation, values?.samplingBand === 'planeOnly')
    views.chip.setValue(altitudeText(values))
    const selected = this.selectedObject()
    if (selected && this.shell.surface === 'object') views.card.update(objectCardModel(selected, values, environment.instant.unixSeconds, this.citation || null))
    if (values && this.shell.surface === 'shape') views.shape.updateReadouts(values.trueAnomalyRad)
  }

  setGroupProvenance(_provenance: GroupProvenance): void {}

  // Status presenters. Manual TLE/OMM input is desktop-only, and add
  // outcomes are shown from their results.

  showTleErrors(_messages: readonly string[]): void {}
  clearTleErrors(): void {}
  setSceneStatus(_message: string): void {}
  showTleRuntimeError(_message: string): void {}

  /** A refusal explained beside the switch that asked. Transient. */
  setLayerBudgetMessage(surface: LayerBudgetSurface, message: string): void {
    if (surface === 'inspector') this.views.card.setBudgetMessage(message)
    if (surface === 'view') this.views.layers.setBudgetMessage(message)
  }

  // Catalogue presenters. The Catalogue workspace is desktop-only.

  setCatalogueSnapshot(snapshot: CatalogueSnapshotParts, _updated?: boolean): void {
    // The card's record facts cite it; the Add sheet does not (About credits the data).
    this.citation = catalogueAttribution(snapshot.manifest)
  }
  showCatalogueDetails(_record: CatalogueRecordV1, _referenceUnixMs: number): void {}
  showCatalogueDetailsError(_catalogId: string, _failure: CatalogueFailure): void {}
  showCatalogueDetailsLoading(_catalogId: string): void {}
  clearCatalogueDetails(): void {}
  setCatalogueComparison(_items: readonly CatalogueComparisonItem[]): void {}
  clearCatalogueComparison(): void {}
  /** The Add sheet reads failures from the workspace availability. */
  setCatalogueError(_failure: CatalogueFailure): void {}
  setCatalogueNotice(_message: string): void {}
  renderCatalogueDiscovery(_presentation: CatalogueDiscoveryPresentation): void {}
  renderCatalogueQuickSearch(result: CatalogueSearchResult, _reason: 'input' | 'snapshot'): void {
    this.searchResult = result
    this.views.add.setResult(result)
  }
  renderCatalogueQuery(_manifest: CatalogueManifestV1, _query: CatalogueQuery, _result: CatalogueQueryResult, _overviewFacets: CatalogueFacetCounts | null): void {}
  renderOfficialGroups(groups: readonly OfficialGroupTile[]): void {
    this.groupTiles = groups
    this.views.add.setGroups(groups)
  }
  renderFeaturedPicks(picks: readonly FeaturedPickTile[]): void {
    this.featuredPicks = picks
    this.views.add.setFeatured(picks)
  }

  // Focus helpers for desktop surfaces: mobile has none of them.

  focusGroundTrackMapButton(): void {}
  focusCatalogueSearch(): void {}
  focusCatalogueDetails(): void {}
  focusCatalogueResultsSummary(): void {}
  captureCatalogueReturnFocus(): void {}
  focusCatalogueReturnFocus(): void {}
  focusSceneObjects(): void {}

  // Geometry

  /** Framing uses `framingInsets`; the desktop occlusion model is not used. */
  getOccludingRects(): DOMRect[] { return [] }

  /** The top bar, and the dock with a compact panel and the
   *  object chip, or in landscape the side column. Expanded panels and the
   *  floating view tools are excluded. Immersive mode frames the whole
   *  canvas. The result is also published as CSS variables for the map. */
  framingInsets(canvas: Rect): Insets | null {
    const insets = this.measureInsets(canvas)
    const shell = this.container.parentElement
    if (shell) {
      shell.style.setProperty('--m-visible-top', `${insets.top}px`)
      shell.style.setProperty('--m-visible-bottom', `${insets.bottom}px`)
      shell.style.setProperty('--m-visible-right', `${insets.right}px`)
    }
    return insets
  }

  handleEmptyTap(_surface: EmptyTapSurface): void {
    if (this.loading) return
    this.dismissHint()
    this.changeShell(afterEmptyTap(this.shell))
  }

  // Undo notices and My place

  announceSceneChange(change: SceneChangeNotice): void {
    this.views.notice.show(sceneChangeMessage(change), () => this.callbacks.onUndoSceneChange())
    // A new orbit is ready to shape at once.
    if (change.kind === 'created' && this.state?.activeMode === 'orbitLab') this.changeShell(openSurface(this.shell, 'shape'))
  }

  withdrawUndo(): void { this.views.notice.withdrawUndo() }

  /** Guides show while the Shape strip is open on an Orbit Lab orbit. */
  activeShapeParameter(): ShapeParameter | null {
    return this.shell.surface === 'shape' && this.state?.activeMode === 'orbitLab' ? this.shell.shapeParameter : null
  }

  setMyPlaceStatus(status: MyPlaceStatus): void {
    this.myPlace = status
    this.views.layers.setMyPlaceStatus(status)
  }

  // Scene opening: the existing view, restyled.

  showSceneOpenConfirmation(confirmation: { readonly message: string; readonly incoming: string }): void { this.endImmersive(); this.views.sceneOpen.showConfirmation(confirmation) }
  showSceneOpenProgress(message: string): void { this.endImmersive(); this.views.sceneOpen.showProgress(message) }
  showSceneOpenNotice(lines: readonly string[]): void { this.endImmersive(); this.views.sceneOpen.showNotice(lines) }
  showSceneOpenError(message: string, retryable: boolean): void { this.endImmersive(); this.views.sceneOpen.showError(message, retryable) }
  hideSceneOpenStatus(): void { this.views.sceneOpen.hide() }
  /** The game panel and thruster bar. A newly decided game opens the panel,
   *  so the result is seen. */
  updateManeuvers(model: ManeuverPanelModel | null, force = false): void {
    const outcome = model?.outcome ?? null
    const decided = outcome !== null && outcome !== this.lastOutcome
    // The view switch also changes the 2D/3D button, which the full render draws.
    const displayChanged = model?.display !== this.maneuvers?.display
    this.lastOutcome = outcome
    this.maneuvers = model
    const nowMs = performance.now()
    if (this.loading || (!force && nowMs - this.lastManeuverUpdate < 90)) return
    this.lastManeuverUpdate = nowMs
    if (decided && this.state?.activeMode === 'maneuvers') this.changeShell(openSurface(this.shell, 'maneuvers'))
    else if (displayChanged) this.render()
    this.syncManeuvers()
  }

  /** The Route Planner's panels follow its model; a choice made in Choose closes
   *  the sheet once it has arrived. */
  updateRoutePlanner(model: RoutePanelModel | null): void {
    this.route = model
    if (model && this.settleRouteChoice(model)) return
    // The Plan sheet is the planning window: open while the window is.
    const planning = model !== null && model.window !== 'closed' && this.routeMode()
    if (planning && this.shell.surface !== 'routePlan') { this.changeShell(openSurface(this.shell, 'routePlan')); return }
    if (!planning && this.shell.surface === 'routePlan') { this.changeShell(closeSurface(this.shell)); return }
    this.syncRoute()
  }

  /** Every frame while a route plays: the bar and the caption. Starting or ending
   *  playback changes the dock, the corner and Back, so it renders everything. */
  updateRoutePlayback(model: RoutePlaybackModel | null): void {
    const started = (model !== null) !== (this.routePlayback !== null)
    this.routePlayback = model
    if (started) {
      if (model === null && (this.shell.surface === 'routeDetails' || this.shell.surface === 'routeExit')) this.changeShell(closeSurface(this.shell))
      else this.render()
      // Play, or Exit playback, took away the control that had the focus.
      if (focusIsLost(this.container.ownerDocument)) {
        if (model !== null) this.views.routeBar.focus()
        else if (this.routeMode()) this.views.dock.routePlanButton.focus({ preventScroll: true })
      }
      return
    }
    this.syncRoutePlayback()
  }

  /** A route is playing in the Route Planner. */
  private routePlaying(): boolean { return this.routeMode() && this.routePlayback !== null }

  private syncRoutePlayback(): void {
    const playback = this.routePlaying() ? this.routePlayback : null
    const shown = this.route?.shown ?? null
    this.views.routeBar.sync(playback, shown, this.loading, playback !== null && !this.shell.immersive, this.shell.surface !== 'none')
    this.syncBarHeight()
    this.views.routeExit.sync(this.loading)
    if (this.shell.surface === 'routeDetails') this.views.routeDetails.sync(shown, playback && shown ? captionBurn(playback, shown.burns)?.index ?? null : null)
  }

  /** The playback bar, taller than the dock, takes its place: panels size to the
   *  room above it, so a tall one keeps its header and ✕ on the screen. Measured
   *  only when the bar shows or hides, and on resize. */
  private syncBarHeight(): void {
    const hidden = this.views.routeBar.root.hidden === true
    if (hidden === this.barHidden) return
    this.barHidden = hidden
    this.measureBar()
  }

  private measureBar(): void {
    const bar = this.views.routeBar.root
    if (bar.hidden) this.container.style.removeProperty('--m-dock-height')
    else this.container.style.setProperty('--m-dock-height', `${Math.ceil(bar.getBoundingClientRect().height)}px`)
  }

  private openRouteDetails(burnIndex: number | null): void {
    this.changeShell(openSurface(this.shell, 'routeDetails'))
    this.syncRoutePlayback()
    this.views.routeDetails.openAt(burnIndex)
  }

  /** True when settling the choice re-rendered everything. */
  private settleRouteChoice(model: RoutePanelModel): boolean {
    const choice = this.routeChoice
    if (!choice) return false
    if (choice.kind === 'try') {
      if (model.pair?.kind === 'refused') { this.routeChoice = null; return false }
      if (model.tryId !== choice.id || model.pair !== null) return false
      this.routeChoice = null
      if (this.shell.surface !== 'routeChoose') return false
      this.changeShell(closeSurface(this.shell))
      return true
    }
    if (model.search.pending !== null) return false
    this.routeChoice = null
    const label = model[choice.side].label
    if (label.kind !== 'catalogue' || label.catalogId !== choice.catalogId || this.shell.surface !== 'routeChoose') return false
    // Back to Edit, on the object just chosen.
    this.changeShell(openSurface(setRouteSide(this.shell, choice.side), 'routeEdit'))
    return true
  }

  private routeMode(): boolean { return this.state?.activeMode === 'routePlanner' }

  /** Back closes the open panel; in a route's details it goes back to the routes,
   *  as All routes does, and the sheet keeps its history entry. */
  private onBack(): void {
    if (this.shell.surface === 'routePlan' && this.route?.window === 'details') {
      this.callbacks.onRouteDetailsBack()
      this.back?.panelOpened()
      return
    }
    // With no panel open, a route playing is what Back leaves: Exit playback.
    if (this.shell.surface === 'none' && this.routePlaying()) { this.callbacks.onRouteExit(); return }
    this.changeShell(closeSurface(this.shell))
  }

  /** The Route Planner's views, the dock's clock and the view tools, between full renders. */
  private syncRoute(chrome = true): void {
    if (!this.state) return
    const views = this.views
    const shell = this.shell
    const route = this.route
    const active = this.routeMode()
    views.routeEdit.sync(route, shell.routeSide, shell.routeParameter, this.loading)
    views.routeChoose.sync(route, shell.routeSide, this.loading)
    views.routeView.sync(route?.camera ?? 'free', route?.frameBurns ?? false, this.loading)
    views.routePlan.sync(route, this.loading)
    views.panels.setHeading('routePlan', views.routePlan.heading(route))
    views.routeScene.sync(route, active, active && shell.surface === 'none' && !shell.immersive && route?.view === 'live', this.loading)
    if (!active || !chrome) return
    this.syncDock()
    this.syncViewTools()
  }

  private onRouteValue(parameter: RouteEditParameter, value: number): void {
    const edit = routeEditOf(parameter, value)
    if (edit.kind === 'ahead') { this.callbacks.onRouteTargetAhead(edit.aheadDeg); return }
    const side = this.shell.routeSide
    // Phones edit circular orbits only: a height makes an eccentric orbit circular.
    if (parameter === 'height' && this.route && !this.route[side].circular) this.callbacks.onRouteCircular(side, true)
    this.callbacks.onRouteObjectEdit(side, edit.changes)
  }

  /** The thruster bar shows only while no panel or immersive view covers it. */
  private syncManeuvers(): void {
    const state = this.state
    if (!state) return
    const shown = state.activeMode === 'maneuvers' && !this.shell.immersive && !this.sideways()
    this.views.burnBar.sync(this.maneuvers, this.loading, shown && this.shell.surface === 'none', shown)
    this.views.game.sync(this.maneuvers, this.loading)
    this.views.dock.setLocked(this.maneuvers?.burning != null)
  }

  setSceneOpening(opening: boolean): void {
    this.sceneOpening = opening
    this.views.menu.setOpening(opening)
  }

  // Internals

  private build(): MobileViews {
    const container = this.container
    const documentRef = container.ownerDocument
    const callbacks = this.callbacks
    const t = text().mobile
    const timers = {
      setTimeout: (handler: () => void, ms: number) => (this.view ?? globalThis).setTimeout(handler, ms) as unknown as number,
      clearTimeout: (id: number) => (this.view ?? globalThis).clearTimeout(id),
      setInterval: (handler: () => void, ms: number) => (this.view ?? globalThis).setInterval(handler, ms) as unknown as number,
      clearInterval: (id: number) => (this.view ?? globalThis).clearInterval(id),
    }
    const navigatorRef = this.view?.navigator
    const topBar = new MobileTopBarView(container, {
      onModes: () => this.toggle('modes', topBar.modeButton),
      onMenu: () => this.toggle('menu', topBar.menuButton),
    })
    // Closing first lets the chosen mode's own opening panel take the place.
    const modes = new ModesPanelView(documentRef, (mode) => {
      this.changeShell(closeSurface(this.shell))
      if (mode !== this.state?.activeMode) callbacks.onModeChange(mode)
    })
    const viewTools = new ViewToolsView(container, {
      // In Interception the 2D/3D button switches between the altitude view and 3D.
      onMapView: (showMap) => this.state?.activeMode === 'maneuvers' ? callbacks.onManeuverDisplayChange(showMap ? 'altitude' : 'globe') : callbacks.onMapViewChange(showMap ? 'map' : '3d'),
      onLayers: () => this.toggle('layers', viewTools.layersButton),
      // In Interception Fit is desktop's Recentre: the game whole, face on.
      onFit: () => this.state?.activeMode === 'maneuvers' ? callbacks.onManeuverFaceOn() : callbacks.onFitVisibleOrbits(),
      onInfo: () => this.toggle(this.state?.activeMode === 'routePlanner' ? 'routeBudgets' : 'hohmann', viewTools.infoButton),
      onRouteView: () => this.toggle('routeView', viewTools.cameraButton),
      onRoutePlanes: () => callbacks.onRoutePlanesChange(!(this.route?.planesShown ?? false)),
    })
    const hint = documentRef.createElement('p')
    hint.className = 'm-hint'
    hint.setAttribute('aria-hidden', 'true')
    hint.textContent = HINT_TEXT[this.hintKind]()
    container.append(hint)
    const bottom = documentRef.createElement('div')
    bottom.className = 'm-bottom'
    container.append(bottom)
    const notice = new NoticeView(bottom, timers)
    const chip = new ObjectChipView(bottom, {
      onList: () => this.toggle('objects', chip.countButton),
      onOpen: () => this.toggle('object', chip.objectButton),
      onClear: () => callbacks.onClearSceneSelection(),
      onStep: (delta) => this.stepSelection(delta),
    })
    const panels = new PanelHost(bottom, {
      onClose: () => {
        // Escape in the Shape strip: the dock comes back, and focus with it.
        const refocusEdit = this.shell.surface === 'shape' && panels.element.contains(documentRef.activeElement)
        this.changeShell(closeSurface(this.shell))
        if (refocusEdit) this.views.dock.focusEdit()
      },
      onExpandedChange: (expanded) => this.changeShell(setExpanded(this.shell, expanded)),
    })
    const dock = new MobileDockView(bottom, {
      // In the Route Planner play and the speed pill run its live scene's clock.
      onPlayingChange: (playing) => { if (this.routeMode()) callbacks.onRouteLiveToggle(); else callbacks.onPlayingChange(playing) },
      onSpeedChange: (speed) => { if (this.routeMode()) callbacks.onRouteLiveRate(speed); else callbacks.onSpeedChange(speed) },
      onTime: () => this.toggle('time', dock.timeButton),
      onNewOrbit: () => this.toggle('newOrbit', dock.newButton),
      onEdit: () => this.toggle('shape', null),
      onAdd: () => this.toggle('add', dock.addButton),
      onGame: () => this.toggle('maneuvers', dock.gameButton),
      onRouteEdit: () => this.toggle('routeEdit', null),
      // The sheet opens from the model, once the scene is paused and the window open.
      onRoutePlan: () => { this.opener = dock.routePlanButton; callbacks.onRoutePlannerOpen() },
    })
    const burnBar = new MobileManeuverBarView(bottom, container, viewTools.root, callbacks, () => this.toggle('maneuvers', dock.gameButton))
    const upright = new TurnUprightView(container, () => { this.changeShell(closeSurface(this.shell)); callbacks.onModeChange('orbitLab') })
    const game = new MobileGamePanelView(documentRef, callbacks)
    const shape = new ShapeStripView(documentRef, {
      onParameter: (parameter) => this.changeShell(setShapeParameter(this.shell, parameter)),
      onGeometryChange: (field, value) => callbacks.onGeometryChange(field, value),
      onPhaseChange: (value) => callbacks.onPhaseChange(value),
      onPropagationChange: (kind) => { this.ensureSingleSelection(); callbacks.onPropagationChange(kind) },
      onSunSynchronousLockChange: (enabled) => { this.ensureSingleSelection(); callbacks.onSunSynchronousLockChange(enabled) },
      onAdjust: (phase, parameter) => { if (phase === 'start') this.ensureSingleSelection(); callbacks.onShapeAdjust(phase, parameter) },
      onNewOrbit: () => this.changeShell(openSurface(this.shell, 'newOrbit')),
    }, { ...timers, vibrate: navigatorRef && typeof navigatorRef.vibrate === 'function' ? (ms) => { navigatorRef.vibrate(ms) } : undefined })
    const newOrbit = new NewOrbitPanelView(documentRef, {
      onCreateOrbit: (kind) => callbacks.onCreateOrbit(kind),
      onCreateOrbitFromExample: (presetId) => callbacks.onCreateOrbitFromExample(presetId),
    })
    const add = new AddSheetView(documentRef, {
      onLoad: () => callbacks.onCatalogueLoad(),
      onSearch: (query) => callbacks.onCatalogueQuickSearch(query),
      onAdd: (catalogId) => { void callbacks.onMobileAddCatalogueObject(catalogId).then((outcome) => this.afterAdd(catalogId, outcome)) },
      onAddGroup: (groupId) => { void callbacks.onMobileAddGroup(groupId).then((outcome) => this.afterAdd(`group:${groupId}`, outcome)) },
      onAddFeatured: (catalogId) => { void callbacks.onAddFeaturedPick(catalogId).then((outcome) => this.afterAdd(catalogId, outcome)) },
      onSearchFocus: (focused) => this.setTyping(focused),
    })
    const card = new ObjectCardView(documentRef, {
      onLayer: (layer, on) => this.changeCardLayer(layer, on),
      onFocus: () => { this.ensureSingleSelection(); callbacks.onFocusSelected() },
      onEdit: () => this.changeShell(openSurface(this.shell, 'shape')),
      onRemove: () => { const id = this.selectedObject()?.id; if (id) callbacks.onRemoveSceneObjects([id]) },
      onStep: (delta) => this.stepSelection(delta),
      onExpandedChange: (expanded) => this.changeShell(setExpanded(this.shell, expanded)),
    })
    const list = new ObjectsListView(documentRef, {
      onSelect: (id) => {
        callbacks.onSelectSceneObject(id, 'only')
        this.changeShell(closeSurface(this.shell))
        callbacks.onFocusSelected()
      },
      onRemove: (id) => callbacks.onRemoveSceneObjects([id]),
      onRemoveAll: () => { if (this.state) callbacks.onRemoveSceneObjects(activeScene(this.state).objects.map((object) => object.id)) },
      onAdd: () => this.changeShell(openSurface(this.shell, ADD_SURFACE[this.state?.activeMode ?? 'orbitLab'])),
    })
    const time = new TimePanelView(documentRef, callbacks)
    const layers = new LayersPanelView(documentRef, {
      onLayer: (layer, on) => callbacks.onSceneLayerChange(layer, on),
      onMyPlace: (on) => callbacks.onMyPlaceChange(on),
      onEarthStyle: (style) => callbacks.onEarthStyleChange(style),
      onOrbitLabBackdrop: (backdrop) => callbacks.onOrbitLabBackdropChange(backdrop),
    })
    const menu = new MenuView(documentRef, {
      onShare: () => { void this.share() },
      onDownload: () => this.downloadSceneFile(),
      onLocale: (locale) => callbacks.onLocaleChange(locale),
      onHelp: () => this.changeShell(openSurface(this.shell, 'help')),
      onExamples: () => this.changeShell(openSurface(this.shell, 'examples')),
      onAbout: () => this.changeShell(openSurface(this.shell, 'about')),
    })
    const about = new AboutPanelView(documentRef, applicationBuildInfo)
    const help = new HelpPanelView(documentRef)
    const examples = new ExamplesPanelView(documentRef, (exampleId) => { this.changeShell(closeSurface(this.shell)); callbacks.onOpenExample(exampleId) })
    panels.register('modes', modes.root, { heading: t.modeSwitch })
    panels.register('shape', shape.root, { header: false, label: t.shape.region })
    panels.register('newOrbit', newOrbit.root, { heading: t.newOrbit.heading })
    panels.register('add', add.root, { heading: t.add.heading })
    panels.register('object', card.root, { heading: '', expandable: true })
    panels.register('objects', list.root, { heading: t.list.heading })
    panels.register('time', time.root, { heading: t.time.heading })
    panels.register('layers', layers.root, { heading: t.layers.heading })
    panels.register('menu', menu.root, { heading: t.menu.heading })
    panels.register('about', about.root, { heading: t.menu.about })
    panels.register('help', help.root, { heading: t.help.heading })
    panels.register('examples', examples.root, { heading: text().examples.heading })
    panels.register('maneuvers', game.root, { heading: text().shell.workspaceHeading.maneuvers })
    panels.register('hohmann', new MobileHohmannPanelView(documentRef).root, { heading: text().maneuvers.hohmann.heading })
    panels.register('routeBudgets', new MobileRouteBudgetsPanelView(documentRef).root, { heading: text().routePlanner.budgets.heading })
    const routeEdit = new RouteEditPanelView(documentRef, {
      onSide: (side) => this.changeShell(setRouteSide(this.shell, side)),
      onParameter: (parameter) => this.changeShell(setRouteParameter(this.shell, parameter)),
      onSwap: () => callbacks.onRouteSwap(),
      onChoose: () => this.toggle('routeChoose', routeEdit.chooseButton),
      onValue: (parameter, value) => this.onRouteValue(parameter, value),
    }, { ...timers, vibrate: navigatorRef && typeof navigatorRef.vibrate === 'function' ? (ms) => { navigatorRef.vibrate(ms) } : undefined })
    const routeChoose = new RouteChooseSheetView(documentRef, {
      onTry: (id) => { this.routeChoice = { kind: 'try', id }; callbacks.onRouteTry(id) },
      onLoad: () => callbacks.onRouteCatalogueEnable(),
      onSearch: (query) => callbacks.onRouteSearch(query),
      onPick: (catalogId) => { const side = this.shell.routeSide; this.routeChoice = { kind: 'pick', side, catalogId }; callbacks.onRoutePick(side, catalogId) },
      onSearchFocus: (focused) => this.setTyping(focused),
    })
    const routeView = new RouteViewPanelView(documentRef, {
      onView: (view) => callbacks.onRouteCameraView(view),
      onFrameBurns: (frameBurns) => callbacks.onRouteFrameBurns(frameBurns),
    })
    const routePlan = new RoutePlanSheetView(documentRef, {
      onPlan: () => callbacks.onPlanRoute(),
      onCancel: () => callbacks.onCancelRoute(),
      onSelect: (index) => callbacks.onRouteSelect(index),
      onBack: () => callbacks.onRouteDetailsBack(),
      onPlay: () => callbacks.onRoutePlayDetails(),
    })
    const routeScene = new MobileRouteSceneView(container, bottom, {
      onEdit: () => this.changeShell(openSurface(this.shell, 'routeEdit')),
    })
    const routeBar = new MobileRoutePlaybackBarView(bottom, {
      onPlayToggle: () => callbacks.onRoutePlayToggle(),
      onBurnStep: (direction) => callbacks.onRouteBurnStep(direction),
      onSeek: (tau) => callbacks.onRouteSeek(tau),
      onDetails: (burnIndex) => { this.opener = routeBar.detailsButton; this.openRouteDetails(burnIndex) },
      // The stop square sits beside Route: Exit asks first.
      onExit: () => this.toggle('routeExit', routeBar.exitButton),
    })
    const routeExit = new RouteExitPanelView(documentRef, {
      onExit: () => { this.changeShell(closeSurface(this.shell)); callbacks.onRouteExit() },
      onKeep: () => this.changeShell(closeSurface(this.shell)),
    })
    panels.register('routeExit', routeExit.root, { heading: t.route.exitHeading })
    const routeDetails = new RouteDetailsSheetView(documentRef)
    panels.register('routeDetails', routeDetails.root, { heading: t.route.routeName })
    panels.register('routeEdit', routeEdit.root, { header: false, label: t.route.editName })
    panels.register('routeChoose', routeChoose.root, { heading: t.route.chooseHeading })
    panels.register('routeView', routeView.root, { heading: t.route.viewHeading })
    panels.register('routePlan', routePlan.root, { heading: t.route.planHeading })
    const sceneOpen = new SceneOpenView(container, callbacks, () => topBar.menuButton.focus())
    this.observe(bottom, topBar.root, panels.element, routeBar.root)
    return { topBar, modes, viewTools, hint, bottom, notice, chip, panels, dock, burnBar, upright, game, shape, newOrbit, add, card, list, time, layers, menu, sceneOpen, routeEdit, routeChoose, routeView, routePlan, routeScene, routeBar, routeDetails, routeExit }
  }

  private disposeViews(): void {
    const views = this.views
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.barHidden = true
    this.container.style.removeProperty('--m-dock-height')
    // First: ending a held burn updates the whole interface, which must still be there.
    views.burnBar.dispose()
    views.upright.dispose()
    views.shape.dispose()
    views.routeEdit.dispose()
    views.routeScene.dispose()
    views.routeBar.dispose()
    views.notice.dispose()
    views.sceneOpen.dispose()
    views.panels.dispose()
    views.dock.dispose()
    views.game.dispose()
    views.chip.dispose()
    views.viewTools.dispose()
    views.topBar.dispose()
    views.hint.remove()
    views.bottom.remove()
  }

  /** The visible region changes size with the panels' own content, so a
   *  resize of the framing elements asks for new framing. */
  private observe(...elements: HTMLElement[]): void {
    const view = this.view
    if (!view || typeof view.ResizeObserver !== 'function') return
    this.resizeObserver = new view.ResizeObserver(() => { this.measureBar(); this.callbacks.onFramingChange() })
    for (const element of elements) this.resizeObserver.observe(element)
  }

  private measureInsets(canvas: Rect): Insets {
    if (this.shell.immersive) return { left: 0, right: 0, top: 0, bottom: 0 }
    const views = this.views
    const top = Math.max(0, views.topBar.root.getBoundingClientRect().bottom - canvas.top)
    // The dock is hidden while the Shape strip is open.
    const dock = views.dock.root.getBoundingClientRect()
    let bottomEdge = dock.height > 0 ? dock.top : canvas.bottom
    for (const element of views.bottom.querySelectorAll<HTMLElement>('[data-frames]')) {
      if (element.hidden || element.closest('[hidden]')) continue
      // One placed elsewhere (the landscape burn caption, at the top right) does not frame from below.
      if (this.view?.getComputedStyle(element).position === 'fixed') continue
      const rect = element.getBoundingClientRect()
      if (rect.height > 0) bottomEdge = Math.min(bottomEdge, rect.top)
    }
    let right = 0
    if (isCompactSurface(this.shell) && !views.panels.element.hidden) {
      const rect = views.panels.element.getBoundingClientRect()
      if (this.isLandscape()) right = Math.max(0, canvas.right - rect.left)
      else if (rect.height > 0) bottomEdge = Math.min(bottomEdge, rect.top)
    }
    return { left: 0, right, top, bottom: Math.max(0, canvas.bottom - bottomEdge) }
  }

  private isLandscape(): boolean { return this.landscapeQuery?.matches ?? false }

  /** Held sideways in a mode that needs the phone upright (all but Orbit Lab). */
  private sideways(): boolean { return this.isLandscape() && this.state !== undefined && this.state.activeMode !== 'orbitLab' }

  private selectedObject() {
    const state = this.state
    if (!state) return undefined
    const scene = activeScene(state)
    return scene.selection.primaryId ? scene.objects.find((object) => object.id === scene.selection.primaryId) : undefined
  }

  /** Mobile has no multi-selection: an action on the selected object acts on
   *  the primary one alone. */
  private ensureSingleSelection(): void {
    const state = this.state
    if (!state) return
    const selection = activeScene(state).selection
    if (selection.ids.length > 1 && selection.primaryId) this.callbacks.onSelectSceneObject(selection.primaryId, 'only')
  }

  private stepSelection(delta: -1 | 1): void {
    const state = this.state
    if (!state) return
    const scene = activeScene(state)
    if (scene.objects.length === 0) return
    const index = scene.objects.findIndex((object) => object.id === scene.selection.primaryId)
    const next = scene.objects[((index < 0 ? (delta > 0 ? -1 : 0) : index) + delta + scene.objects.length) % scene.objects.length]
    this.callbacks.onSelectSceneObject(next.id, 'only')
  }

  private changeCardLayer(layer: CardLayer, on: boolean): void {
    this.ensureSingleSelection()
    if (layer === 'orbit') this.callbacks.onOrbitPathVisibilityChange(on)
    else this.callbacks.onGroundTrackVisibilityChange(on)
  }

  /** After an add the sheet closes (the application fits,
   *  selects and announces); a refusal or failure shows its outcome. */
  private afterAdd(key: string, outcome: AddCatalogueRecordsOutcome): void {
    this.views.add.settle(key)
    // The sheet stays open after an add, for the next one; a tap on
    // something already in the scene closes it to show that object.
    if (outcome.kind === 'added') return
    if (outcome.kind === 'already-present') {
      if (this.shell.surface === 'add') this.changeShell(closeSurface(this.shell))
      return
    }
    const message = sceneStatusMessage(outcome)
    if (message) this.views.notice.show(message)
  }

  /** The system share sheet where it exists, else a copied link. Interception
   *  and the Route Planner share a link to their starting view. */
  private async share(): Promise<void> {
    const mode = this.state?.activeMode
    let createLink = this.callbacks.onCopySceneLink
    if (mode !== undefined && !isSceneMode(mode)) {
      const url = this.callbacks.onModeLinkRequested(mode)
      createLink = async () => ({ ok: true as const, url })
    } else this.callbacks.onShareSceneRequested()
    const result = await shareSceneLink(createLink, browserSharePort(this.view))
    this.views.menu.showShareResult(result === 'shared' || result === 'cancelled' ? null : result)
  }

  /** The existing scene-file path, as the fallback for a scene over the link limits. */
  private downloadSceneFile(): void {
    const documentRef = this.container.ownerDocument
    const saved = this.callbacks.onSceneFileRequested()
    const url = URL.createObjectURL(new Blob([saved.text], { type: 'application/json' }))
    const anchor = documentRef.createElement('a')
    anchor.href = url
    anchor.download = saved.name
    anchor.hidden = true
    documentRef.body.append(anchor)
    anchor.click()
    anchor.remove()
    this.view?.setTimeout(() => URL.revokeObjectURL(url), 1000)
    this.views.menu.showShareResult('downloaded')
  }

  private showHint(kind: HintKind): void {
    this.hintKind = kind
    this.hintShown = true
    this.views.hint.textContent = HINT_TEXT[kind]()
    this.views.hint.hidden = false
    if (this.hintTimer !== null) this.view?.clearTimeout(this.hintTimer)
    if (this.view) this.hintTimer = this.view.setTimeout(() => this.dismissHint(), HINT_DURATION_MS)
  }

  private dismissHint(): void {
    if (!this.hintShown) return
    this.hintShown = false
    this.views.hint.hidden = true
    if (this.hintTimer !== null) { this.view?.clearTimeout(this.hintTimer); this.hintTimer = null }
  }

  /** While the search field has focus the sheet follows the
   *  visible viewport, so results stay above the on-screen keyboard. */
  private setTyping(typing: boolean): void {
    if (typing === this.typing) return
    this.typing = typing
    this.container.classList.toggle('is-typing', typing)
    const visual = this.view?.visualViewport
    if (typing && visual) {
      visual.addEventListener('resize', this.onVisualViewport)
      visual.addEventListener('scroll', this.onVisualViewport)
      this.applyKeyboardInset()
    } else this.stopKeyboardTracking()
  }

  private stopKeyboardTracking(): void {
    const visual = this.view?.visualViewport
    visual?.removeEventListener('resize', this.onVisualViewport)
    visual?.removeEventListener('scroll', this.onVisualViewport)
    this.container.style.removeProperty('--m-keyboard-inset')
    this.container.style.removeProperty('--m-visual-height')
  }

  private applyKeyboardInset(): void {
    const view = this.view
    const visual = view?.visualViewport
    if (!view || !visual) return
    const inset = Math.max(0, view.innerHeight - (visual.height + visual.offsetTop))
    this.container.style.setProperty('--m-keyboard-inset', `${Math.round(inset)}px`)
    this.container.style.setProperty('--m-visual-height', `${Math.round(visual.height)}px`)
  }

  private toggle(surface: MobileSurface, opener: HTMLElement | null): void {
    this.opener = opener
    this.changeShell(toggleSurface(this.shell, surface))
  }

  private endImmersive(): void { if (this.shell.immersive) this.changeShell(toggleImmersive(this.shell)) }

  /** No history entry until the page is ready and a shared link in the
   *  address has been opened and its fragment removed, so Back can never
   *  return to the link and open it again. */
  private historyBlocked(): boolean {
    return this.loading || this.sceneOpening || /[#&]scene=/.test(this.view?.location.hash ?? '')
  }

  /** A learner-driven shell change: re-render and reframe. */
  private changeShell(next: MobileShellState): void {
    if (next === this.shell) return
    this.setShell(next)
    this.render()
  }

  private setShell(next: MobileShellState): void {
    const previous = this.shell
    this.shell = next
    if (previous.surface !== next.surface && (previous.surface === 'add' || previous.surface === 'routeChoose')) this.setTyping(false)
    // Closing the Plan sheet closes the planning window, and the scene runs on.
    if (previous.surface === 'routePlan' && next.surface !== 'routePlan' && this.route !== null && this.route.window !== 'closed') this.callbacks.onRoutePlannerClose()
  }

  private render(): void {
    const views = this.views
    const shell = this.shell
    this.container.classList.toggle('is-immersive', shell.immersive)
    // Editing gives the scene the dock's and the object chip's room (an
    // empty tap, Back or Escape closes the strip; the orbit's label names it).
    const editingRoute = shell.surface === 'routeEdit' && this.state?.activeMode === 'routePlanner'
    this.container.classList.toggle('is-editing', editingRoute || (shell.surface === 'shape' && this.state !== undefined && mobileSceneFacts(this.state).hasKeplerianSelection && this.state.activeMode === 'orbitLab'))
    this.container.dataset.mode = this.state?.activeMode ?? ''
    // In playback the bar takes the dock's place.
    this.container.classList.toggle('is-route-playback', this.routePlaying())
    this.container.toggleAttribute('aria-busy', this.loading)
    const state = this.state
    if (!state) return
    const sideways = this.sideways()
    this.container.classList.toggle('is-sideways', sideways)
    views.upright.sync(sideways ? state.activeMode : null, this.loading)
    const scene = activeScene(state)
    const selected = this.selectedObject()
    const loading = this.loading
    const showingMap = state.view.groundTrackMapVisible && (this.desktopShell?.mapMaximized ?? false)
    views.topBar.sync(state.activeMode, shell.surface === 'modes', shell.surface === 'menu', loading)
    views.modes.sync(state.activeMode, loading)
    this.syncViewTools()
    views.chip.sync({ count: scene.objects.length, selected: selected ? { name: selected.name, color: colorCss(selected.style.colorHex) } : null, loading, cardOpen: shell.surface === 'object', listOpen: shell.surface === 'objects' })
    this.syncDock()
    this.syncRoute(false)
    this.syncRoutePlayback()
    views.time.sync(state.simulation, loading, state.activeMode)
    views.menu.setTarget(isSceneMode(state.activeMode) ? 'scene' : state.activeMode)
    this.syncManeuvers()
    views.layers.sync(scene, showingMap, loading, state.look, state.activeMode)
    views.list.sync(scene, activeSceneMode(state) ?? 'orbitLab', loading)
    views.newOrbit.sync(state.orbitLab.scene.objects.length, loading)
    views.add.sync(this.catalogueWorkspace.availability, state.realObjects.scene, loading)
    const labObject = state.activeMode === 'orbitLab' ? selected ?? null : null
    views.shape.sync({ object: labObject, sceneEmpty: state.orbitLab.scene.objects.length === 0, parameter: shell.shapeParameter, constraint: state.orbitLab.authoring.lastConstraint, lockStatus: this.lockStatus, loading })
    if (selected) {
      views.card.sync(objectCardModel(selected, this.values, state.simulation.currentInstant.unixSeconds, this.citation || null), shell.expanded, loading, scene.objects.length > 1)
      views.panels.setHeading('object', selected.name)
    }
    views.panels.show(shell.surface, shell.expanded, isCompactSurface(shell), this.opener)
    this.opener = null
    // The history entry follows the open panel, once history may be written.
    // A route playing counts as an open panel: Back exits playback.
    if (shell.surface === 'none' && !this.routePlaying()) this.back?.panelClosed()
    else this.back?.panelOpened()
    this.requestFraming()
  }

  private syncDock(): void {
    const state = this.state
    if (!state) return
    const shell = this.shell
    this.views.dock.sync({
      simulation: state.simulation, mode: state.activeMode, loading: this.loading,
      timeOpen: shell.surface === 'time', shapeOpen: shell.surface === 'shape', newOrbitOpen: shell.surface === 'newOrbit', addOpen: shell.surface === 'add', gameOpen: shell.surface === 'maneuvers',
      route: this.route?.live ?? null, routeBlocked: (this.route?.blocked ?? null) !== null, routeEditOpen: shell.surface === 'routeEdit',
    })
  }

  /** Interception swaps the map for its altitude view; the Route Planner has
   *  neither, and offers View and Planes. */
  private syncViewTools(): void {
    const state = this.state
    if (!state) return
    const shell = this.shell
    const scene = activeScene(state)
    const showingMap = state.view.groundTrackMapVisible && (this.desktopShell?.mapMaximized ?? false)
    const game = state.activeMode === 'maneuvers'
    const words = text().maneuvers
    if (state.activeMode === 'routePlanner') {
      this.views.viewTools.sync(false, false, this.route === null, this.loading, undefined, { viewOpen: shell.surface === 'routeView', planesShown: this.route?.planesShown ?? false, infoOpen: shell.surface === 'routeBudgets' })
      return
    }
    this.views.viewTools.sync(game ? this.maneuvers?.display === 'altitude' : showingMap, shell.surface === 'layers', game ? this.maneuvers === null : scene.objects.length === 0, this.loading, game ? { flat: words.altitudeView, globe: words.globeView, recentre: words.recentre, infoOpen: shell.surface === 'hohmann' } : undefined)
  }

  /** The panels' heights follow their content, so every render may move the
   *  visible region; the application re-measures once, after the render
   *  (resize observers also report later content changes). */
  private requestFraming(): void {
    if (this.framingPending) return
    this.framingPending = true
    queueMicrotask(() => { this.framingPending = false; this.callbacks.onFramingChange() })
  }
}
