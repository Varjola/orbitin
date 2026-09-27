import type { EnvironmentState } from '../simulation/environment.ts'
import type { SunSynchronousStatus } from '../simulation/propagationTransitions.ts'
import type { CatalogueManifestV1, CatalogueSnapshotParts, CatalogueRecordV1 } from '../data/catalogueSchema.ts'
import type { CatalogueFacetCounts, CatalogueQuery, CatalogueQueryResult } from '../data/catalogueQuery.ts'
import type { CatalogueSearchResult } from '../data/catalogueSearch.ts'
import type { CatalogueFailure } from '../data/catalogueFailure.ts'
import type { OrbitPresetId } from '../simulation/orbitPresets.ts'
import type { AppState } from '../state/AppState.ts'
import { activeScene } from '../state/AppState.ts'
import type { ShellState } from '../state/shellState.ts'
import { INITIAL_CATALOGUE_WORKSPACE, type CatalogueWorkspaceState } from '../state/catalogueWorkspaceState.ts'
import type { CatalogueComparisonItem } from './catalogueComparison.ts'
import type { CatalogueDiscoveryPresentation } from './catalogueDiscoveryModel.ts'
import { AppShellView } from './AppShellView.ts'
import { buildShellModel } from './shellModel.ts'
import { OrbitLabDrawerView } from './OrbitLabDrawerView.ts'
import { RealObjectsDrawerView } from './RealObjectsDrawerView.ts'
import { SceneInspectorView } from './SceneInspectorView.ts'
import { SensorSettingsView } from './SensorSettingsView.ts'
import { TimeControlsView } from './TimeControlsView.ts'
import { ViewControlsView } from './ViewControlsView.ts'
import { CatalogueWorkspaceView } from './CatalogueWorkspaceView.ts'
import { CatalogueLauncherView } from './CatalogueLauncherView.ts'
import { OrbitLabLauncherView } from './OrbitLabLauncherView.ts'
import { SceneObjectsView } from './SceneObjectsView.ts'
import { OptionsMenuView } from './OptionsMenuView.ts'
import { ShareSceneView } from './ShareSceneView.ts'
import { SceneOpenView } from './SceneOpenView.ts'
import { applicationBuildInfo } from '../app/applicationBuildInfo.ts'
import { buildBulkInspectorModel } from './bulkInspectorModel.ts'
import { officialGroupTitle } from './catalogueWording.ts'
import { NO_GROUP_PROVENANCE, type GroupProvenance } from './sceneObjectsModel.ts'
import type { LayerBudgetSurface, ShapeAdjustParameter, UiCallbacks } from './uiTypes.ts'
import type { ApplicationUi, FeaturedPickTile, Insets, MyPlaceStatus, OfficialGroupTile, SceneChangeNotice } from './applicationUi.ts'
import { getSelectedObject } from '../state/objectActions.ts'

export type { ReadoutValues, UiCallbacks } from './uiTypes.ts'

interface Views {
  readonly shellView: AppShellView
  readonly orbitLabView: OrbitLabDrawerView
  readonly realObjectsView: RealObjectsDrawerView
  readonly inspectorView: SceneInspectorView
  readonly sensorView: SensorSettingsView
  readonly timeView: TimeControlsView
  readonly viewControls: ViewControlsView
  readonly catalogueView: CatalogueWorkspaceView
  readonly catalogueLauncher: CatalogueLauncherView
  readonly orbitLabLauncher: OrbitLabLauncherView
  readonly objectList: SceneObjectsView
  readonly optionsMenu: OptionsMenuView
  readonly shareView: ShareSceneView
  readonly sceneOpenView: SceneOpenView
}

/** Composes the interface views and routes application state to them.
 *
 *  Every view takes its words from the active
 *  catalogue when built, so a language change rebuilds them in place. The
 *  structured inputs held here (application, shell and catalogue workspace
 *  state, loading, provenance, the opening flag) are replayed into the new
 *  views; controller-owned content is republished by its controller, and
 *  transient notices are cleared. */
export class UiRoot implements ApplicationUi {
  private readonly container: HTMLElement
  private readonly callbacks: UiCallbacks
  private readonly presets: readonly OrbitPresetId[]
  private views: Views
  private provenance: GroupProvenance = NO_GROUP_PROVENANCE
  private state: AppState | undefined
  private shell: ShellState = { narrowViewport: false, leftDrawerOpen: false, inspectorOpen: false, timeDrawerOpen: false, viewDrawerOpen: false, mapMaximized: false, catalogueWorkspaceOpen: false, sceneObjectsExpanded: true }
  private catalogueWorkspace: CatalogueWorkspaceState = INITIAL_CATALOGUE_WORKSPACE
  private lockStatus: SunSynchronousStatus = { kind: 'none' }
  private loading = true
  private sceneOpening = false
  private lastReadoutUpdate = -Infinity
  private selectedId: string | null = null
  private featuredPicks: readonly FeaturedPickTile[] = []
  /** The Real Objects first-visit hint is done for this page load (dismissed
   *  or acted on). Nothing is stored. Orbit Lab has no hint: desktop opens
   *  in Edit orbit. */
  private realObjectsHintDone = false

  constructor(container: HTMLElement, callbacks: UiCallbacks, presets: readonly OrbitPresetId[]) {
    this.container = container
    this.callbacks = callbacks
    this.presets = presets
    this.views = this.build()
  }

  /** Rebuild every view in the active language and replay the held state.
   *  Open menus and dialogs close, transient notices clear and focus moves
   *  to the Options menu trigger. */
  rebuild(): void {
    this.disposeViews()
    this.views = this.build()
    this.selectedId = null
    this.lastReadoutUpdate = -Infinity
    this.applyLoading()
    if (this.state) this.renderShell()
    this.views.objectList.setProvenance(this.provenance)
    this.views.catalogueLauncher.setFeaturedPicks(this.featuredPicks)
    if (this.state) this.syncState(this.state, this.lockStatus)
    this.setSceneOpening(this.sceneOpening)
    this.views.optionsMenu.focusTrigger()
  }

  setLoading(loading: boolean): void {
    this.loading = loading
    this.applyLoading()
    if (this.state) this.syncState(this.state, this.lockStatus)
  }

  syncShell(shell: ShellState): void {
    this.shell = shell
    this.renderShell()
  }

  syncCatalogueWorkspace(workspace: CatalogueWorkspaceState): void {
    const availabilityChanged = workspace.availability !== this.catalogueWorkspace.availability
    this.catalogueWorkspace = workspace
    // The shell model depends only on catalogue availability. Query, focus and
    // comparison changes sync the catalogue views without re-measuring the shell.
    if (availabilityChanged || !this.state) { this.renderShell(); return }
    const model = buildShellModel({ state: this.state, shell: this.shell, catalogue: workspace.availability, loading: this.loading })
    this.views.catalogueView.sync(workspace, model.catalogueWorkspace.open, this.loading, this.state.realObjects.scene)
    this.views.catalogueLauncher.sync(workspace, this.loading, this.state.realObjects.scene)
  }

  syncState(state: AppState, lockStatus: SunSynchronousStatus = { kind: 'none' }): void {
    const views = this.views
    this.state = state
    this.lockStatus = lockStatus
    const model = buildShellModel({ state, shell: this.shell, catalogue: this.catalogueWorkspace.availability, loading: this.loading })
    const active = activeScene(state)
    const selected = getSelectedObject(state)
    const selectedChanged = this.selectedId !== active.selection.primaryId
    this.selectedId = active.selection.primaryId
    views.shellView.sync(model)
    views.orbitLabView.sync(model.orbitLab, state.orbitLab.scene, this.loading, state.orbitLab.scene.selection.primaryId ? state.orbitLab.scene.objects.find((object) => object.id === state.orbitLab.scene.selection.primaryId) : undefined, state.orbitLab.authoring.lastConstraint, lockStatus)
    views.realObjectsView.sync(model.realObjects, state.realObjects.scene, this.loading)
    views.objectList.sync(active, this.loading, state.activeMode)
    views.objectList.setExpanded(this.shell.sceneObjectsExpanded)
    views.shellView.sceneObjectsRoot.hidden = active.objects.length === 0
    views.inspectorView.sync(model.inspector, selected, this.loading, model.inspector.content === 'multiple' ? buildBulkInspectorModel(active) : null, selected ? (this.provenance.get(selected.id) ?? []).map((membership) => officialGroupTitle(membership.groupId, membership.title)) : [])
    views.timeView.sync(state.simulation, this.loading, model.timeDrawer.open, state.activeMode)
    views.viewControls.sync(state.view, active, this.loading, model.viewDrawer.open, state.look, state.activeMode)
    views.sensorView.mountIn(views.inspectorView.sensorHost)
    views.sensorView.sync(selected, this.loading, selectedChanged)
    views.catalogueView.sync(this.catalogueWorkspace, model.catalogueWorkspace.open, this.loading, state.realObjects.scene)
    views.catalogueLauncher.sync(this.catalogueWorkspace, this.loading, state.realObjects.scene)
    views.orbitLabLauncher.sync(this.loading, model.orbitLab.createOrbitEnabled, model.mode === 'orbitLab')
    this.renderHints()
  }

  updateReadouts(values: import('./uiTypes.ts').ReadoutValues | null, environment: EnvironmentState, simulation: AppState['simulation'], nowMs: number, force = false): void {
    if (this.loading || (!force && nowMs - this.lastReadoutUpdate < 90)) return
    this.lastReadoutUpdate = nowMs
    this.views.timeView.updateReadouts(values, environment, simulation)
    this.views.inspectorView.updateReadouts(values)
    if (values) this.views.orbitLabView.authoring.setPhase(values.trueAnomalyRad)
  }

  /** Transient: a rebuild clears manual-record errors and scene status. */
  showTleErrors(messages: readonly string[]): void { this.views.realObjectsView.showTleErrors(messages) }
  clearTleErrors(): void { this.views.realObjectsView.clearTleErrors() }
  setSceneStatus(message: string): void { this.views.realObjectsView.setSceneStatus(message); this.views.orbitLabView.setSceneStatus(message) }
  showTleRuntimeError(message: string): void { this.views.inspectorView.showTleRuntimeError(message) }
  /** Session-only group provenance for Scene Objects search and the inspector. */
  setGroupProvenance(provenance: GroupProvenance): void {
    this.provenance = provenance
    this.views.objectList.setProvenance(provenance)
    if (this.state) this.syncState(this.state, this.lockStatus)
  }

  /** One budget explanation at a time, beside the control that caused it. Transient. */
  setLayerBudgetMessage(surface: LayerBudgetSurface, message: string): void {
    this.views.inspectorView.setLayerBudgetMessage(surface === 'inspector' ? message : '', surface === 'bulk' ? message : '')
    this.views.viewControls.setLayerBudgetMessage(surface === 'view' ? message : '')
  }

  setCatalogueSnapshot(snapshot: CatalogueSnapshotParts, updated = false): void { this.views.catalogueView.setSnapshot(snapshot, updated) }
  showCatalogueDetails(record: CatalogueRecordV1, referenceUnixMs: number): void { this.views.catalogueView.showDetails(record, referenceUnixMs) }
  showCatalogueDetailsError(catalogId: string, failure: CatalogueFailure): void { this.views.catalogueView.showDetailsError(catalogId, failure) }
  clearCatalogueDetails(): void { this.views.catalogueView.clearDetails() }
  setCatalogueComparison(items: readonly CatalogueComparisonItem[]): void { this.views.catalogueView.setComparison(items) }
  clearCatalogueComparison(): void { this.views.catalogueView.clearComparison() }
  setCatalogueError(failure: CatalogueFailure): void { this.views.catalogueView.setError(failure) }
  /** Transient. */
  setCatalogueNotice(message: string): void { this.views.catalogueView.setNotice(message) }
  renderCatalogueDiscovery(presentation: CatalogueDiscoveryPresentation): void { this.views.catalogueView.renderDiscovery(presentation) }
  renderCatalogueQuickSearch(result: CatalogueSearchResult, reason: 'input' | 'snapshot'): void { this.views.catalogueLauncher.renderQuickSearch(result, reason) }
  renderCatalogueQuery(manifest: CatalogueManifestV1, query: CatalogueQuery, result: CatalogueQueryResult, overviewFacets: CatalogueFacetCounts | null): void { this.views.catalogueView.renderQuery(manifest, query, result, overviewFacets) }

  focusGroundTrackMapButton(): void { this.views.viewControls.focusMapButton() }
  focusCatalogueSearch(): void { this.views.catalogueView.focusSearch() }
  focusCatalogueDetails(): void { this.views.catalogueView.focusDetails() }
  showCatalogueDetailsLoading(catalogId: string): void { this.views.catalogueView.showDetailsLoading(catalogId) }
  focusCatalogueResultsSummary(): void { this.views.catalogueView.focusResultsSummary() }
  captureCatalogueReturnFocus(): void { this.views.catalogueView.captureReturnFocus() }
  focusCatalogueReturnFocus(): void { if (!this.views.catalogueView.focusReturnFocus()) this.views.catalogueLauncher.focusSettings() }
  focusOpenCatalogueButton(): void { this.views.catalogueLauncher.focusSettings() }
  /** View scene from Catalogue: the scene-object list, else the catalogue launcher. */
  focusSceneObjects(): void { if (!this.views.objectList.focusPrimary()) this.views.catalogueLauncher.focusSettings() }
  getOccludingRects(): DOMRect[] { return this.views.shellView.getOccludingRects() }
  /** Desktop keeps its symmetric fit and a centred projection. */
  framingInsets(): Insets | null { return null }
  /** Desktop offers official groups from the Catalogue workspace instead. */
  renderOfficialGroups(_groups: readonly OfficialGroupTile[]): void {}
  /** Featured picks on the empty Real Objects scene. */
  renderFeaturedPicks(picks: readonly FeaturedPickTile[]): void { this.featuredPicks = picks; this.views.catalogueLauncher.setFeaturedPicks(picks) }
  /** An empty click never changes anything on desktop. */
  handleEmptyTap(): void {}
  /** Desktop keeps its confirmations and offers no undo. */
  announceSceneChange(_change: SceneChangeNotice): void {}
  withdrawUndo(): void {}
  /** My place is a mobile Layers switch. */
  setMyPlaceStatus(_status: MyPlaceStatus): void {}
  /** Orbit guides for the element control in use in the open Edit tab
   *  (shared with the mobile Shape strip). */
  activeShapeParameter(): ShapeAdjustParameter | null {
    const state = this.state
    if (!state || this.loading || state.activeMode !== 'orbitLab' || !this.shell.leftDrawerOpen || state.orbitLab.authoring.drawerTab !== 'edit') return null
    return this.views.orbitLabView.authoring.activeParameter
  }

  /** Scene opening: the controller's presenter. */
  showSceneOpenConfirmation(confirmation: { readonly message: string; readonly incoming: string }): void { this.views.sceneOpenView.showConfirmation(confirmation) }
  showSceneOpenProgress(message: string): void { this.views.sceneOpenView.showProgress(message) }
  showSceneOpenNotice(lines: readonly string[]): void { this.views.sceneOpenView.showNotice(lines) }
  showSceneOpenError(message: string, retryable: boolean): void { this.views.sceneOpenView.showError(message, retryable) }
  hideSceneOpenStatus(): void { this.views.sceneOpenView.hide() }
  setSceneOpening(opening: boolean): void { this.sceneOpening = opening; this.views.shareView.setOpening(opening); this.views.optionsMenu.setOpenSceneFileEnabled(!opening) }

  dispose(): void { this.disposeViews() }

  private build(): Views {
    const container = this.container
    const callbacks = this.callbacks
    const shellView = new AppShellView(container, { onModeChange: callbacks.onModeChange, onToggleLeftDrawer: callbacks.onToggleLeftDrawer, onToggleInspector: callbacks.onToggleInspector })
    const sensorView = new SensorSettingsView(container.ownerDocument, callbacks)
    const orbitLabView = new OrbitLabDrawerView(shellView.orbitLabRoot, callbacks, this.presets)
    const orbitLabLauncher = new OrbitLabLauncherView(shellView.orbitLabLauncherRoot, callbacks)
    const realObjectsView = new RealObjectsDrawerView(shellView.realObjectsRoot, callbacks)
    const objectList = new SceneObjectsView(shellView.sceneObjectsRoot, callbacks, () => shellView.focusWorkspaceToggle())
    const inspectorView = new SceneInspectorView(shellView.inspectorRoot, callbacks)
    const timeView = new TimeControlsView(shellView.timeRoot, callbacks)
    const viewControls = new ViewControlsView(shellView.viewRoot, callbacks)
    const catalogueView = new CatalogueWorkspaceView(shellView.catalogueRoot, callbacks)
    const catalogueLauncher = new CatalogueLauncherView(shellView.catalogueLauncherRoot, { ...callbacks, onCatalogueLoad: () => { this.finishHint(); callbacks.onCatalogueLoad() } }, () => this.finishHint())
    let sceneOpenView: SceneOpenView | null = null
    const optionsMenu = new OptionsMenuView(shellView.optionsRoot, applicationBuildInfo, { onChooseSceneFile: () => sceneOpenView?.chooseFile(), onLocaleChange: callbacks.onLocaleChange, onOpenExample: callbacks.onOpenExample })
    const shareView = new ShareSceneView(shellView.optionsRoot, callbacks)
    sceneOpenView = new SceneOpenView(container, callbacks, () => optionsMenu.focusTrigger())
    return { shellView, orbitLabView, realObjectsView, inspectorView, sensorView, timeView, viewControls, catalogueView, catalogueLauncher, orbitLabLauncher, objectList, optionsMenu, shareView, sceneOpenView }
  }

  private disposeViews(): void {
    const views = this.views
    views.sensorView.dispose()
    views.sceneOpenView.dispose()
    views.shareView.dispose()
    views.optionsMenu.dispose()
    views.catalogueView.dispose()
    views.catalogueLauncher.dispose()
    views.orbitLabLauncher.dispose()
    views.orbitLabView.dispose()
    views.realObjectsView.dispose()
    views.inspectorView.dispose()
    views.shellView.dispose()
  }

  private finishHint(): void {
    this.realObjectsHintDone = true
    this.renderHints()
  }

  /** The Real Objects hint lasts until the catalogue is enabled or an object
   *  is added. */
  private renderHints(): void {
    const state = this.state
    if (!state) return
    if (state.realObjects.scene.objects.length > 0 || this.catalogueWorkspace.availability.kind === 'ready') this.realObjectsHintDone = true
    this.views.catalogueLauncher.setHintVisible(!this.loading && !this.realObjectsHintDone)
  }

  private applyLoading(): void {
    this.views.shellView.setLoading(this.loading)
    this.views.timeView.setLoading(this.loading)
    this.views.viewControls.setLoading(this.loading)
  }

  private renderShell(): void {
    if (!this.state) return
    const views = this.views
    const model = buildShellModel({ state: this.state, shell: this.shell, catalogue: this.catalogueWorkspace.availability, loading: this.loading })
    views.shellView.sync(model)
    views.objectList.setExpanded(this.shell.sceneObjectsExpanded)
    views.realObjectsView.sync(model.realObjects, this.state.realObjects.scene, this.loading)
    views.timeView.sync(this.state.simulation, this.loading, model.timeDrawer.open, this.state.activeMode)
    views.viewControls.sync(this.state.view, activeScene(this.state), this.loading, model.viewDrawer.open, this.state.look, this.state.activeMode)
    views.catalogueView.sync(this.catalogueWorkspace, model.catalogueWorkspace.open, this.loading, this.state.realObjects.scene)
    views.catalogueLauncher.sync(this.catalogueWorkspace, this.loading, this.state.realObjects.scene)
    views.orbitLabLauncher.sync(this.loading, model.orbitLab.createOrbitEnabled, model.mode === 'orbitLab')
    this.renderHints()
  }
}
