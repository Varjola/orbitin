import type { EnvironmentState } from '../simulation/environment.ts'
import type { SunSynchronousStatus } from '../simulation/propagationTransitions.ts'
import type { CatalogueManifestV1, CatalogueRecordV1, CatalogueSnapshotParts } from '../data/catalogueSchema.ts'
import type { CatalogueFacetCounts, CatalogueQuery, CatalogueQueryResult } from '../data/catalogueQuery.ts'
import type { CatalogueSearchResult } from '../data/catalogueSearch.ts'
import type { CatalogueFailure } from '../data/catalogueFailure.ts'
import type { AddCatalogueRecordsOutcome } from '../state/catalogueAdditionOutcome.ts'
import { activeScene, type AppState } from '../state/AppState.ts'
import type { ShellState } from '../state/shellState.ts'
import { INITIAL_CATALOGUE_WORKSPACE, type CatalogueWorkspaceState } from '../state/catalogueWorkspaceState.ts'
import { applicationBuildInfo } from '../app/applicationBuildInfo.ts'
import { isLiveClock } from '../ui/liveClock.ts'
import type { ApplicationUi, EmptyTapSurface, FeaturedPickTile, Insets, MyPlaceStatus, OfficialGroupTile, Rect, SceneChangeNotice } from '../ui/applicationUi.ts'
import type { CatalogueComparisonItem } from '../ui/catalogueComparison.ts'
import type { CatalogueDiscoveryPresentation } from '../ui/catalogueDiscoveryModel.ts'
import { catalogueAttribution } from '../ui/catalogueWording.ts'
import type { GroupProvenance } from '../ui/sceneObjectsModel.ts'
import { sceneStatusMessage } from '../ui/sceneStatusWording.ts'
import { SceneOpenView } from '../ui/SceneOpenView.ts'
import type { LayerBudgetSurface, ReadoutValues, UiCallbacks } from '../ui/uiTypes.ts'
import { text } from '../i18n/index.ts'
import {
  afterEmptyTap, afterModeChange, afterSceneChange, closeSurface, INITIAL_MOBILE_SHELL, initialMobileShell, isCompactSurface,
  openSurface, setExpanded, setShapeParameter, toggleImmersive, toggleSurface, type MobileSceneFacts, type MobileShellState, type MobileSurface, type ShapeParameter,
} from './mobileShellState.ts'
import { MobileTopBarView } from './MobileTopBarView.ts'
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

interface MobileViews {
  readonly topBar: MobileTopBarView
  readonly viewTools: ViewToolsView
  readonly hint: HTMLElement
  readonly bottom: HTMLElement
  readonly notice: NoticeView
  readonly chip: ObjectChipView
  readonly panels: PanelHost
  readonly dock: MobileDockView
  readonly shape: ShapeStripView
  readonly newOrbit: NewOrbitPanelView
  readonly add: AddSheetView
  readonly card: ObjectCardView
  readonly list: ObjectsListView
  readonly time: TimePanelView
  readonly layers: LayersPanelView
  readonly menu: MenuView
  readonly sceneOpen: SceneOpenView
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
  private hintKind: 'gesture' | 'realObjects' = 'gesture'
  private realObjectsHinted = false
  private typing = false
  private framingPending = false
  private readonly onFirstGesture = (event: Event): void => {
    if (event.target instanceof Node && this.views.hint.contains(event.target)) return
    this.dismissHint()
  }
  private readonly onVisualViewport = (): void => this.applyKeyboardInset()

  constructor(container: HTMLElement, callbacks: UiCallbacks) {
    this.container = container
    this.callbacks = callbacks
    this.view = container.ownerDocument.defaultView
    this.landscapeQuery = this.view && typeof this.view.matchMedia === 'function' ? this.view.matchMedia(MOBILE_LANDSCAPE_QUERY) : null
    this.back = this.view?.history ? new BackGesture(this.view, () => this.changeShell(closeSurface(this.shell)), () => this.historyBlocked()) : null
    this.views = this.build()
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
    views.dock.updateTime(environment.instant)
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
      onModeChange: (mode) => callbacks.onModeChange(mode),
      onMenu: () => this.toggle('menu', topBar.menuButton),
    })
    const viewTools = new ViewToolsView(container, {
      onMapView: (showMap) => callbacks.onMapViewChange(showMap ? 'map' : '3d'),
      onLayers: () => this.toggle('layers', viewTools.layersButton),
      onFit: () => callbacks.onFitVisibleOrbits(),
    })
    const hint = documentRef.createElement('p')
    hint.className = 'm-hint'
    hint.setAttribute('aria-hidden', 'true')
    hint.textContent = this.hintKind === 'realObjects' ? t.hintRealObjects : t.hint
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
      onPlayingChange: (playing) => callbacks.onPlayingChange(playing),
      onSpeedChange: (speed) => callbacks.onSpeedChange(speed),
      onTime: () => this.toggle('time', dock.timeButton),
      onNewOrbit: () => this.toggle('newOrbit', dock.newButton),
      onEdit: () => this.toggle('shape', null),
      onAdd: () => this.toggle('add', dock.addButton),
    })
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
      onAdd: () => this.changeShell(openSurface(this.shell, this.state?.activeMode === 'realObjects' ? 'add' : 'newOrbit')),
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
    const sceneOpen = new SceneOpenView(container, callbacks, () => topBar.menuButton.focus())
    this.observe(bottom, topBar.root, panels.element)
    return { topBar, viewTools, hint, bottom, notice, chip, panels, dock, shape, newOrbit, add, card, list, time, layers, menu, sceneOpen }
  }

  private disposeViews(): void {
    const views = this.views
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    views.shape.dispose()
    views.notice.dispose()
    views.sceneOpen.dispose()
    views.panels.dispose()
    views.dock.dispose()
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
    this.resizeObserver = new view.ResizeObserver(() => this.callbacks.onFramingChange())
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

  /** The system share sheet where it exists, else a copied link. */
  private async share(): Promise<void> {
    this.callbacks.onShareSceneRequested()
    const result = await shareSceneLink(this.callbacks.onCopySceneLink, browserSharePort(this.view))
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

  private showHint(kind: 'gesture' | 'realObjects'): void {
    this.hintKind = kind
    this.hintShown = true
    this.views.hint.textContent = kind === 'realObjects' ? text().mobile.hintRealObjects : text().mobile.hint
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
    if (previous.surface !== next.surface && previous.surface === 'add') this.setTyping(false)
  }

  private render(): void {
    const views = this.views
    const shell = this.shell
    this.container.classList.toggle('is-immersive', shell.immersive)
    // Editing gives the scene the dock's and the object chip's room (an
    // empty tap, Back or Escape closes the strip; the orbit's label names it).
    this.container.classList.toggle('is-editing', shell.surface === 'shape' && this.state !== undefined && mobileSceneFacts(this.state).hasKeplerianSelection && this.state.activeMode === 'orbitLab')
    this.container.toggleAttribute('aria-busy', this.loading)
    const state = this.state
    if (!state) return
    const scene = activeScene(state)
    const selected = this.selectedObject()
    const loading = this.loading
    const showingMap = state.view.groundTrackMapVisible && (this.desktopShell?.mapMaximized ?? false)
    views.topBar.sync(state.activeMode, shell.surface === 'menu', loading)
    views.viewTools.sync(showingMap, shell.surface === 'layers', scene.objects.length === 0, loading)
    views.chip.sync({ count: scene.objects.length, selected: selected ? { name: selected.name, color: colorCss(selected.style.colorHex) } : null, loading, cardOpen: shell.surface === 'object', listOpen: shell.surface === 'objects' })
    views.dock.sync({
      simulation: state.simulation, mode: state.activeMode, loading,
      timeOpen: shell.surface === 'time', shapeOpen: shell.surface === 'shape', newOrbitOpen: shell.surface === 'newOrbit', addOpen: shell.surface === 'add',
    })
    views.time.sync(state.simulation, loading)
    views.layers.sync(scene, showingMap, loading, state.look, state.activeMode)
    views.list.sync(scene, state.activeMode, loading)
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
    if (shell.surface === 'none') this.back?.panelClosed()
    else this.back?.panelOpened()
    this.requestFraming()
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
