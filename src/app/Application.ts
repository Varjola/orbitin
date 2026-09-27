import { lengthVec3 } from '../core/vec3.ts'
import { EARTH_RADIUS_KM, MAX_SPEED_MULTIPLIER, SIMULATION_START_INSTANT } from '../core/constants.ts'
import { defaultGroundReachConstraint, defaultSensorDefinition } from '../simulation/sensorFootprint.ts'
import { clamp, degToRad } from '../core/angles.ts'
import type { SimulationInstant } from '../core/time.ts'
import { parseTle } from '../data/tle.ts'
import { parseOmmJson } from '../data/omm.ts'
import { CATALOGUE_DISCOVERY_PAGES } from '../data/catalogueDiscoveryPages.ts'
import { catalogueGroupById, type CatalogueGroupInjection } from '../data/catalogueGroups.ts'
import { officialCatalogueGroupInjection } from '../data/officialGroups/index.ts'
import { groupOrbitFacts, type GroupOrbitFacts } from '../data/groupOrbitFacts.ts'
import { FEATURED_PICKS } from '../data/featuredPicks.ts'
import { SCENE_EXAMPLES } from '../data/sceneExamples.ts'
import { catalogueIdOfSceneObject } from './catalogueToScene.ts'
import type { GroupMembership } from '../ui/sceneObjectsModel.ts'
import { deriveOrbitValues, type EditedGeometryField } from '../orbital/geometry.ts'
import { phaseFromTrueAnomaly } from '../orbital/keplerianPropagator.ts'
import { angleReadoutsFor, classifyElements } from '../orbital/elementConditioning.ts'
import { createPropagator, isSgp4Source, type OrbitalObject, type PropagationModel } from '../simulation/OrbitalObject.ts'
import { orbitSunGeometry } from '../simulation/orbitSunGeometry.ts'
import {
  applyGeometryEdit, reanchorSource, setSunSynchronousLock, switchPropagation,
  type SunSynchronousStatus,
} from '../simulation/propagationTransitions.ts'
import { ORBIT_PRESETS, createObjectFromPreset } from '../simulation/orbitPresets.ts'
import { SimulationClock } from '../simulation/SimulationClock.ts'
import { activeScene, allSceneObjectIds, AppStateStore, withScene, type AppState, type OrbitLabDrawerTab, type ProductMode, type SceneSelection } from '../state/AppState.ts'
import { addObjectToMode, getSelectedObject, isObjectColor, OBJECT_COLORS, setColorForObjects, setLastConstraint, setLayerForObjects, setObjectMinimumGroundElevation, setObjectSensorFieldOfViewHalfAngle, setObjectSensorSteeringLimit, updateObject } from '../state/objectActions.ts'
import type { BudgetedLayer } from '../state/sceneComplexity.ts'
import type { LayerBudgetSurface } from '../ui/uiTypes.ts'
import { createInitialState, createRandomOrbitName } from '../state/initialState.ts'
import { setActiveMode, setOrbitLabDrawerTab } from '../state/modeActions.ts'
import { selectionProjection } from '../state/selectionProjection.ts'
import { clearSelection, removeObjects, remainingCapacity, selectMany, selectOnly, singleSelectedObject, toggleMembership, toggleSelected, setSelection } from '../state/sceneActions.ts'
import type { SceneSelectionIntent } from '../ui/sceneSelectionIntent.ts'
import type { OrbitCreationKind } from '../ui/uiTypes.ts'
import { effectiveBackdrop, setEarthStyle, setGroundTrackMapVisible, setOrbitLabBackdrop } from '../state/viewActions.ts'
import { HIGH_RESOLUTION_TEXTURE_SIZE, loadEarthDayHighResolution, loadRequiredTextures } from '../assets/textureLoader.ts'
import { loadBandDensity, loadStarCatalogue } from '../assets/starfieldLoader.ts'
import { BAND_BRIGHTNESS_SCALE, BAND_MAX_POINT_PX, generateBandField } from '../starfield/bandField.ts'
import { createEarth, setEarthDayMap, setEarthOrientation, setEarthStyle as drawEarthStyle, setEarthSunDirectionRender } from '../scene/Earth.ts'
import { CountryBordersView } from '../scene/CountryBordersView.ts'
import { createEarthMapTexture } from '../scene/earthMapTexture.ts'
import { labBoxHalfSize, labGridSpacing, LAB_BOX_MAX_HALF_SIZE } from '../scene/labGrid.ts'
import { labDisplayColor, LAB_PALETTE, type SceneBackdropKind } from '../scene/sceneBackdrop.ts'
import { BOUNDARIES_ASSET_URL, decodeBoundaryGeoJson, decodePolygonGeoJson, LAKES_ASSET_URL, LAND_ASSET_URL, loadGeography, type BoundaryData } from '../map/geographyData.ts'
import type { Texture } from 'three'
import { environmentAt, type EnvironmentState } from '../simulation/environment.ts'
import { projectInertialToRender } from '../core/renderFrame.ts'
import { daylightViewDirection } from '../scene/daylightView.ts'
import { OrbitalBodyView } from '../scene/OrbitalBodyView.ts'
import { SceneRoot } from '../scene/SceneRoot.ts'
import { StarFieldView } from '../scene/StarFieldView.ts'
import { calculateFitDistance, calculateRegionFit, containmentDistance, orbitCollectionRadius, regionFramingOffset, type ShapeAdjustPhase } from '../scene/cameraFit.ts'
import { UiRoot } from '../ui/UiRoot.ts'
import type { ApplicationUi } from '../ui/applicationUi.ts'
import type { ShapeAdjustParameter, UiCallbacks } from '../ui/uiTypes.ts'
import { MobileUiRoot } from '../mobile/MobileUiRoot.ts'
import { PresentationController, type Presentation } from './PresentationController.ts'
import { officialGroupTiles } from './officialGroupTiles.ts'
import { canUndo, recordSceneChange, undoObjectIds, undoSceneChange, type SceneUndoEntry } from '../state/sceneUndo.ts'
import type { OrbitPresetId } from '../simulation/orbitPresets.ts'
import { geometryControlDefinitions } from '../ui/controlDefinitions.ts'
import { defaultFailureAction, LoadingOverlay, type FailureKind } from './loadingOverlay.ts'
import { objectCountBucket, recordUsage, resultCountBucket, type UsageErrorKind } from './usageEvents.ts'
import { startRenderLoop } from './renderLoop.ts'
import { OrbitalObjectRuntime, type ObjectFrameSample } from './OrbitalObjectRuntime.ts'
import { createPathAdapter } from './createPathAdapter.ts'
import { createGroundTrackAdapter } from './createGroundTrackAdapter.ts'
import { combineGroundTrackViewPorts } from './combineGroundTrackViewPorts.ts'
import { createSensorGeometryAdapter } from './createSensorGeometryAdapter.ts'
import { combineSensorGeometryViewPorts } from './combineSensorGeometryViewPorts.ts'
import type { RuntimeViewOptions, SensorGeometryViewPort } from './OrbitalObjectRuntime.ts'
import { GroundTrackMapView, type GroundTrackMapObjectPort } from '../map/GroundTrackMapView.ts'
import { advanceSimulationFrame, type FrameDependencies } from './advanceSimulationFrame.ts'
import { tleAgeWarning } from '../ui/tleWording.ts'
import { text } from '../i18n/index.ts'
import { LocaleController } from './LocaleController.ts'
import { OMM_OBJECT_NOTE, TLE_OBJECT_NOTE } from '../state/canonicalNotes.ts'
import { CatalogueController } from './CatalogueController.ts'
import { addCatalogueRecordsToScene } from './addCatalogueRecordsToScene.ts'
import type { AddCatalogueRecordsOutcome } from '../state/catalogueAdditionOutcome.ts'
import { sceneStatusMessage } from '../ui/sceneStatusWording.ts'
import { mapCoversScene, openingShellState, NARROW_VIEWPORT_QUERY, setCatalogueWorkspaceOpen, shellAfterMapVisibilityChange, shellAfterModeChange, shellAfterPresentationChange, shellAfterViewportChange, shellForCameraFit, toggleInspector, toggleLeftDrawer, toggleMapMaximized, toggleSceneObjects, toggleTimeDrawer, toggleViewDrawer, type ShellState } from '../state/shellState.ts'
import { occlusionInsets } from '../ui/shellGeometry.ts'
import { layerBudgetMessage, sceneFullForManualAdd } from '../ui/shellWording.ts'
import type { SceneMeasurementTarget } from './sceneMeasurementTarget.ts'
import { SceneInteractionController, type InteractionSurface } from './SceneInteractionController.ts'
import { ScenePicker } from '../scene/scenePicking.ts'
import { SceneLabelLayer } from '../scene/SceneLabelLayer.ts'
import { OrbitGuidesView, type OrbitGuideKind } from '../scene/OrbitGuidesView.ts'
import { MyPlaceMarkerView } from '../scene/MyPlaceMarkerView.ts'
import { elevationAngleRad, observerPositionEarthFixedKm, type ObserverLocation } from '../simulation/observerGeometry.ts'
import { applyMat3 } from '../core/mat3.ts'
import type { MyPlaceStatus } from '../ui/applicationUi.ts'
import { orbitGuideGeometry } from '../orbital/orbitGuides.ts'
import { SceneObjectChooserView } from '../ui/SceneObjectChooserView.ts'
import type { PickHit, PickTolerances } from '../interaction/pickRanking.ts'
import type { ScreenPoint } from '../core/screenGeometry.ts'
import { SceneSharingController } from './SceneSharingController.ts'
import { browserSceneLinkLocation } from './sceneLinkLocation.ts'
import { applySharedSceneToState } from './applySharedScene.ts'
import type { ResolvedSceneDocument } from './resolveSceneDocument.ts'

const ORBIT_CREATION_PALETTES: Readonly<Record<OrbitCreationKind, readonly number[]>> = {
  leo: [0xff9f43, 0xffb347, 0xf57c2b],
  meo: [0x4fd18b, 0x79d66f, 0x2fa96f],
  geo: [0xac86f7, 0xc38cf2, 0x8d6bdb],
  heo: [0x56b4e9, 0x6f8ff2, 0x4ac6df],
}

export interface ApplicationOptions {
  /** The owner of the interface language, resolved before the application
   *  renders. */
  readonly locale?: LocaleController
  /** The owner of the active presentation. */
  readonly presentation?: PresentationController
}

/** Camera distance, in Earth radii, below which a desktop loads the 8K Earth. */
const HIGH_RESOLUTION_EARTH_DISTANCE = 2.4
/** Framing and fit easing, skipped with reduced motion. */
const FRAMING_EASE_MS = 250
/** Easing back in after a Size or Shape drag. */
const CONTAINMENT_EASE_MS = 400

/** A scene and its group provenance, before an undoable change. */
interface UndoBaseline { readonly state: AppState; readonly provenance: ReadonlyMap<string, readonly GroupMembership[]> }

/** The colour family of each mobile example. */
const EXAMPLE_COLOR_FAMILIES: Readonly<Record<OrbitPresetId, OrbitCreationKind>> = {
  leo: 'leo', meo: 'meo', geo: 'geo', polar: 'leo', elliptical: 'heo', sso: 'leo',
}

export class Application {
  private readonly localeController: LocaleController
  private readonly presentation: PresentationController
  private readonly sceneRoot: SceneRoot
  private readonly overlay: LoadingOverlay
  private readonly clock = new SimulationClock()
  private readonly store = new AppStateStore(createInitialState())
  private readonly appShell: HTMLElement
  private readonly desktopContainer: HTMLElement
  private readonly mobileContainer: HTMLElement
  private readonly callbacks: UiCallbacks
  private ui: ApplicationUi
  private readonly runtime: OrbitalObjectRuntime
  private readonly map: GroundTrackMapView
  private readonly catalogue: CatalogueController
  private readonly sharing: SceneSharingController
  private readonly picker: ScenePicker
  private readonly labels: SceneLabelLayer
  private readonly guides: OrbitGuidesView
  private readonly myPlaceMarker: MyPlaceMarkerView
  /** The learner's location, in memory only. It is never
   *  stored, put into scenes or links, logged or sent anywhere. */
  private observer: ObserverLocation | null = null
  private myPlaceStatus: MyPlaceStatus = 'off'
  private myPlaceRequest = 0
  private readonly chooser: SceneObjectChooserView
  private readonly interaction: SceneInteractionController
  private readonly reducedMotionQuery: MediaQueryList | null
  private hovered3dId: string | null = null
  private readonly pendingCatalogueAdds = new Set<string>()
  // Every build carries the reviewed official groups.
  private readonly groupInjection: CatalogueGroupInjection = officialCatalogueGroupInjection()
  /** Session-only group provenance; never serialized. */
  private readonly groupProvenance = new Map<string, readonly GroupMembership[]>()
  private shell: ShellState
  private readonly narrowViewportQuery: MediaQueryList
  /** The learner turned or zoomed the view. */
  private readonly onControlsStart = (): void => { if (this.shapeAdjustment) this.shapeAdjustment.learnerMovedView = true }
  private readonly onViewportChange = (event: MediaQueryListEvent): void => this.setShell(shellAfterViewportChange(this.shell, event.matches))
  private readonly mapObjectLayers = new Map<string, GroundTrackMapObjectPort>()
  private readonly frameDependencies: FrameDependencies
  private readonly starFieldViews: StarFieldView[] = []
  private stopRenderLoop: (() => void) | undefined
  private disposeEarth: (() => void) | undefined
  private earth: ReturnType<typeof createEarth> | undefined
  private latestEnvironment: EnvironmentState | undefined
  private ready = false
  private disposed = false
  private highResolutionEarth: 'idle' | 'loading' | 'done' = 'idle'
  /** The drawn backdrop, the Map style's atlas and the borders,
   *  each built on first use and kept for the page. */
  private sceneBackdrop: SceneBackdropKind = 'space'
  private earthMapTexture: Texture | null = null
  private earthMapLoad: 'idle' | 'loading' | 'done' = 'idle'
  private countryBorders: { readonly data: BoundaryData; readonly view: CountryBordersView } | null = null
  private countryBordersLoad: 'idle' | 'loading' | 'done' = 'idle'
  /** The result count of the last Quick Search, until it leads somewhere. */
  private lastSearchResults: number | null = null
  /** The catalogue ids of the loaded index, for featured picks. */
  private indexIds: { readonly snapshotId: string; readonly ids: ReadonlySet<string> } | null = null
  /** Whether Real Objects has been shown in this page load. */
  private realObjectsVisited = false
  private failed: FailureKind | null = null
  private contextWatched = false
  private nextObjectSequence = 1
  private fitFrame: number | undefined
  private retryFitOnResize = false
  private fitIds: readonly string[] | null = null
  /** Transient explanation of the last lock or model action. UI status text,
   *  not simulation state and not a per-frame derived value. */
  private lockStatus: SunSynchronousStatus = { kind: 'none' }
  /** The one undoable change, with the provenance of
   *  the objects it touches. Session-only; never serialized. */
  private undo: { readonly entry: SceneUndoEntry; readonly provenance: ReadonlyMap<string, readonly GroupMembership[]> } | null = null
  /** The state just before the last catalogue add committed. */
  private lastAddBefore: UndoBaseline | null = null
  /** A ruler adjustment in progress. */
  private shapeAdjustment: { readonly parameter: ShapeAdjustParameter; learnerMovedView: boolean } | null = null

  constructor(root: HTMLElement, options: ApplicationOptions = {}) {
    this.localeController = options.locale ?? new LocaleController()
    this.presentation = options.presentation ?? new PresentationController()
    // One container per presentation; the inactive one is hidden and empty.
    root.innerHTML = '<main class="app-shell"><div id="scene-container" class="scene-container"></div><div id="map-container" class="map-container"></div><div id="ui-root" class="ui-root"></div><div id="mobile-ui-root" class="mobile-ui-root" hidden></div></main>'
    this.appShell = root.querySelector<HTMLElement>('.app-shell')!
    this.desktopContainer = root.querySelector<HTMLElement>('#ui-root')!
    this.mobileContainer = root.querySelector<HTMLElement>('#mobile-ui-root')!
    this.narrowViewportQuery = window.matchMedia(NARROW_VIEWPORT_QUERY)
    this.shell = openingShellState(this.narrowViewportQuery.matches, this.presentation.presentation)
    this.narrowViewportQuery.addEventListener('change', this.onViewportChange)
    this.overlay = new LoadingOverlay(root)
    this.sceneRoot = new SceneRoot(root.querySelector<HTMLElement>('#scene-container')!)
    this.picker = new ScenePicker(this.sceneRoot.camera)
    this.labels = new SceneLabelLayer(root.querySelector<HTMLElement>('#scene-container')!)
    this.myPlaceMarker = new MyPlaceMarkerView(this.sceneRoot.earthFixedRoot)
    this.guides = new OrbitGuidesView(this.sceneRoot.scene, (material) => this.sceneRoot.addLineMaterial(material), (material) => this.sceneRoot.removeLineMaterial(material))
    this.reducedMotionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    this.map = new GroundTrackMapView(root.querySelector<HTMLElement>('#map-container')!, {
      // The overlay's Close button performs one state write and returns focus
      // to the dedicated action that opened the map.
      onClose: () => {
        this.commitState(setGroundTrackMapVisible(this.store.getState(), false))
        this.setShell(shellAfterMapVisibilityChange(this.shell, false))
        this.ui.focusGroundTrackMapButton()
      },
      onToggleMaximized: () => { if (!this.shell.mapMaximized) recordUsage({ type: 'view', which: 'map-maximized' }); this.setShell(toggleMapMaximized(this.shell)) },
    })
    this.runtime = new OrbitalObjectRuntime({
      createPropagator,
      createBody: (object) => new OrbitalBodyView(this.sceneRoot.scene, object.style.colorHex, object.style.markerSizeRenderUnits),
      createPath: (object) => createPathAdapter(this.sceneRoot.scene, object,
        (view) => this.sceneRoot.addLineView(view), (view) => this.sceneRoot.removeLineView(view),
        (material) => this.sceneRoot.addLineMaterial(material), (material) => this.sceneRoot.removeLineMaterial(material)),
      // One publication, two views. The runtime keeps a single cache and a
      // single window-rebuild queue; the composite only fans the result out.
      createGroundTrack: (object) => combineGroundTrackViewPorts(
        () => createGroundTrackAdapter(this.sceneRoot.groundTrackRoot, object,
          (material) => this.sceneRoot.addLineMaterial(material), (material) => this.sceneRoot.removeLineMaterial(material)),
        () => {
          const mapPort = this.map.createObjectLayer({
          id: object.id,
          name: object.name,
          colorHex: object.style.colorHex,
          visible: object.display.groundTrackVisible,
          sensorVisible: object.display.sensorGeometryVisible,
          bodyVisible: object.display.bodyVisible,
          selected: selectionProjection(this.store.getState()).selectedIds.has(object.id),
          })
          let disposed = false
          const ownedPort: GroundTrackMapObjectPort = {
            setCurrent: (point) => mapPort.setCurrent(point),
            setWindow: (window) => mapPort.setWindow(window),
            setHistory: (segments) => mapPort.setHistory(segments),
            setVisible: (visible) => mapPort.setVisible(visible),
            setColor: (colorHex) => mapPort.setColor(colorHex),
            setSelected: (selected) => mapPort.setSelected(selected),
            setGeometry: (geometry) => mapPort.setGeometry(geometry),
            setSensorVisible: (visible) => mapPort.setSensorVisible(visible),
            setBodyVisible: (visible) => mapPort.setBodyVisible(visible),
            setName: (name) => mapPort.setName(name),
            dispose: () => {
              if (disposed) return
              disposed = true
              mapPort.dispose()
              if (this.mapObjectLayers.get(object.id) === ownedPort) this.mapObjectLayers.delete(object.id)
            },
          }
          this.mapObjectLayers.set(object.id, ownedPort)
          return ownedPort
        },
        (colorHex) => this.sceneColor(colorHex),
      ),
      createSensorGeometry: (object) => combineSensorGeometryViewPorts(
        () => createSensorGeometryAdapter(this.sceneRoot.earthFixedRoot, object),
        () => {
          const mapPort = this.mapObjectLayers.get(object.id)
          if (!mapPort) throw new Error(`Map layer for ${object.id} was not created before its sensor layer.`)
          const sensorPort: SensorGeometryViewPort = {
            setGeometry: (geometry) => mapPort.setGeometry(geometry),
            setVisible: (visible) => mapPort.setSensorVisible(visible),
            setColor: (colorHex) => mapPort.setColor(colorHex),
            setSelected: (selected) => mapPort.setSelected(selected),
            // The ground-track composite owns the shared map layer.
            dispose: () => {},
          }
          return sensorPort
        },
        (colorHex) => this.sceneColor(colorHex),
      ),
    })
    this.clock.playing = this.store.getState().simulation.playing
    this.clock.speedMultiplier = this.store.getState().simulation.speedMultiplier
    this.callbacks = {
      onGeometryChange: (field, value) => this.changeGeometry(field, value),
      onPhaseChange: (value) => this.changePhase(value),
      onInstantChange: (instant) => this.jumpToInstant(instant),
      onNow: () => this.jumpToInstant({ unixSeconds: Date.now() / 1000 }),
      onGoLive: () => this.goLive(false),
      onReset: () => this.jumpToInstant(SIMULATION_START_INSTANT),
      onReversedChange: (reversed) => {
        if (!this.ready || this.disposed) return
        this.clock.reversed = reversed
        this.runtime.clearGroundTrackHistories()
        const state = this.store.getState()
        this.commitState({ ...state, simulation: { ...state.simulation, reversed } })
      },
      onPlayingChange: (playing) => {
        if (!this.ready || this.disposed) return
        this.clock.playing = playing
        const state = this.store.getState()
        this.commitState({ ...state, simulation: { ...state.simulation, playing } })
      },
      onSpeedChange: (value) => {
        if (!this.ready || this.disposed || !Number.isFinite(value)) return
        const speedMultiplier = clamp(value, 1, MAX_SPEED_MULTIPLIER)
        this.clock.speedMultiplier = speedMultiplier
        const state = this.store.getState()
        this.commitState({ ...state, simulation: { ...state.simulation, speedMultiplier } })
      },
      onMarkerSizeChange: (value) => {
        if (Number.isFinite(value)) this.updateSelected((object) => ({ ...object, style: { ...object.style, markerSizeRenderUnits: clamp(value, 0.005, 0.05) } }))
      },
      onEarthStyleChange: (style) => this.commitState(setEarthStyle(this.store.getState(), style)),
      onOrbitLabBackdropChange: (backdrop) => this.commitState(setOrbitLabBackdrop(this.store.getState(), backdrop)),
      onMarkerScalingChange: (scaleMarkersWithZoom) => {
        const state = this.store.getState()
        this.commitState({ ...state, view: { ...state.view, scaleMarkersWithZoom } })
      },
      onOrbitPathVisibilityChange: (visible) => this.changeSelectedLayer('orbitPath', visible),
      // Hiding the track also stops recording (`withLayer`), so re-showing it
      // never reveals a trail that silently kept growing behind an unchecked box.
      onGroundTrackVisibilityChange: (visible) => this.changeSelectedLayer('groundTrack', visible),
      onGroundTrackHistoryChange: (recording) => this.changeSelectedLayer('groundTrackHistory', recording),
      onSensorGeometryVisibilityChange: (visible) => this.changeSelectedLayer('sensorGeometry', visible),
      onSensorFieldOfViewHalfAngleChange: (value) => {
        const state = this.store.getState()
        const object = getSelectedObject(state); if (object) this.commitState(setObjectSensorFieldOfViewHalfAngle(state, object.id, value))
      },
      onSensorSteeringLimitChange: (value) => {
        const state = this.store.getState()
        const object = getSelectedObject(state); if (object) this.commitState(setObjectSensorSteeringLimit(state, object.id, value))
      },
      onMinimumGroundElevationChange: (value) => {
        const state = this.store.getState()
        const object = getSelectedObject(state); if (object) this.commitState(setObjectMinimumGroundElevation(state, object.id, value))
      },
      // Global view intent only: no object display flag, recorded trail or
      // ground-track cache is touched, so no window rebuild is queued.
      onGroundTrackMapChange: (visible) => {
        this.commitState(setGroundTrackMapVisible(this.store.getState(), visible))
        this.setShell(shellAfterMapVisibilityChange(this.shell, visible))
      },
      onModeChange: (mode: ProductMode) => {
        if (!this.ready || this.disposed) return
        // Undo acts on the scene in view: a mode switch ends the offer.
        if (this.undo && mode !== this.store.getState().activeMode) { this.undo = null; this.ui.withdrawUndo() }
        const firstRealObjectsVisit = mode === 'realObjects' && !this.realObjectsVisited
        if (mode === 'realObjects') this.realObjectsVisited = true
        this.commitState(setActiveMode(this.store.getState(), mode))
        this.setShell(shellAfterModeChange(this.shell, mode))
        // Real objects are shown where they are now. The first
        // entry into an empty Real Objects scene moves the one clock to the
        // current time at 1×; Orbit Lab keeps its own start instant.
        if (firstRealObjectsVisit && this.store.getState().realObjects.scene.objects.length === 0) this.goLive(true)
        recordUsage({ type: 'mode', mode })
      },
      onToggleLeftDrawer: () => this.setShell(toggleLeftDrawer(this.shell)),
      onToggleInspector: () => this.setShell(toggleInspector(this.shell)),
      onToggleTimeDrawer: () => this.setShell(toggleTimeDrawer(this.shell)),
      onToggleSceneObjects: () => this.setShell(toggleSceneObjects(this.shell)),
      onToggleViewDrawer: () => this.setShell(toggleViewDrawer(this.shell)),
      onOpenCatalogueWorkspace: () => { this.ui.captureCatalogueReturnFocus(); this.setShell(setCatalogueWorkspaceOpen(this.shell, true)); this.ui.focusCatalogueSearch() },
      onCloseCatalogueWorkspace: () => { this.setShell(setCatalogueWorkspaceOpen(this.shell, false)); this.ui.focusCatalogueReturnFocus() },
      onOrbitLabDrawerTabChange: (tab: OrbitLabDrawerTab) => this.commitState(setOrbitLabDrawerTab(this.store.getState(), tab)),
      onCreateOrbit: (kind) => this.createOrbit(kind),
      onImportTle: (text, jumpToEpoch) => this.addTle(text, jumpToEpoch),
      onImportOmm: (text, jumpToEpoch) => this.addOmm(text, jumpToEpoch),
      onCatalogueLoad: () => { if (this.ready && !this.disposed) void this.catalogue.load() },
      onCatalogueRefresh: () => { if (this.ready && !this.disposed) void this.catalogue.refresh() },
      onCatalogueQuery: (query) => this.catalogue.query(query),
      onOpenCatalogueDiscoveryPage: (pageId) => { this.catalogue.openDiscoveryPage(pageId) },
      onBrowseAllCatalogue: () => this.catalogue.browseAll(),
      onCatalogueQuickSearch: (text) => { if (this.ready && !this.disposed) this.lastSearchResults = text.trim() === '' ? null : this.catalogue.quickSearch(text).totalMatches },
      onOpenCatalogueDetails: (catalogId) => {
        if (!this.ready || this.disposed) return
        this.recordSearchUsed()
        this.ui.captureCatalogueReturnFocus()
        this.setShell(setCatalogueWorkspaceOpen(this.shell, true))
        this.ui.showCatalogueDetailsLoading(catalogId)
        this.ui.focusCatalogueDetails()
        void this.catalogue.changeDetails(catalogId)
      },
      onOpenCatalogueViewAll: () => {
        if (!this.ready || this.disposed) return
        this.ui.captureCatalogueReturnFocus()
        const text = this.catalogue.workspace.quickSearchText
        this.catalogue.setFullQuery({ ...this.catalogue.workspace.query, text })
        this.setShell(setCatalogueWorkspaceOpen(this.shell, true))
        this.ui.focusCatalogueResultsSummary()
      },
      onAddToScene: (catalogIds, jumpToEpoch) => { void this.addCatalogueRecords(catalogIds, jumpToEpoch, { source: 'catalogue' }) },
      // Selecting an object that is already in the scene also reveals it (4.8).
      onQuickSearchAddToScene: async (catalogId) => {
        this.recordSearchUsed()
        const outcome = await this.addCatalogueRecords([catalogId], false, { source: 'quick-search' })
        if (outcome.kind === 'already-present' && this.ready && !this.disposed) this.interaction.reveal(outcome.objects.map((object) => object.sceneId))
        return outcome
      },
      onCatalogueDetailsChange: (catalogId) => { void this.catalogue.changeDetails(catalogId) },
      onCatalogueDetailsRetry: (catalogId) => { void this.catalogue.retryDetails(catalogId) },
      onCatalogueCompareChange: (ids) => { void this.catalogue.changeComparison(ids) },
      onCatalogueCompareRetry: (catalogId) => { void this.catalogue.retryComparison(catalogId) },
      onCatalogueWorkingSelectionToggle: (catalogId) => this.catalogue.changeWorkingSelection(catalogId),
      onCatalogueWorkingSelectionClear: () => this.catalogue.clearWorkingSelection(),
      // A multi-record add never chooses one element epoch.
      onAddCatalogueSelectionToScene: (catalogIds) => this.addCatalogueRecords(catalogIds, false, { source: 'catalogue' }),
      onAddCatalogueGroupToScene: (groupId, catalogIds) => this.addCatalogueGroup(groupId, catalogIds),
      onViewCatalogueScene: () => { this.setShell(setCatalogueWorkspaceOpen(this.shell, false)); this.ui.focusSceneObjects() },
      onSetPreset: (id) => this.setPreset(id),
      onSelectSceneObject: (id, intent) => this.selectSceneObject(id, intent),
      onRemoveSceneObjects: (ids) => this.removeSceneObjects(ids),
      onClearSceneSelection: () => this.clearSceneSelection(),
      onSceneSelectionChange: (selection) => this.setSceneSelection(selection),
      onRevealSceneObjects: (ids) => { if (this.ready && !this.disposed) this.interaction.reveal(ids) },
      onBulkLayerChange: (layer, on) => this.changeLayer('bulk', activeScene(this.store.getState()).selection.ids, layer, on),
      onBulkColorChange: (colorHex) => { const state = this.store.getState(); this.commitState(setColorForObjects(state, activeScene(state).selection.ids, colorHex)) },
      onFitSelected: () => this.requestFit(activeScene(this.store.getState()).selection.ids),
      onFocusSelected: () => this.focusSelected(),
      onAllOrbitPathsVisibilityChange: (visible) => this.changeSceneLayer('orbitPath', visible),
      // Scene-wide histories show and record together, and turn both off together.
      onAllGroundTrackHistoriesChange: (visible) => this.changeSceneLayer(visible ? 'groundTrackHistory' : 'groundTrack', visible),
      onAllSensorGeometriesVisibilityChange: (visible) => this.changeSceneLayer('sensorGeometry', visible),
      onColorChange: (colorHex) => {
        if (isObjectColor(colorHex)) this.updateSelected((object) => ({ ...object, style: { ...object.style, colorHex } }))
      },
      onNameChange: (name) => {
        // Real Objects keep their catalogue names.
        if (this.store.getState().activeMode !== 'orbitLab') return
        const normalized = name.trim().replace(/\s+/g, ' ').slice(0, 80)
        if (normalized) this.updateSelected((object) => ({ ...object, name: normalized }))
        else this.ui.syncState(this.store.getState(), this.lockStatus)
      },
      onFitVisibleOrbits: () => this.requestFit(null),
      onPropagationChange: (kind) => this.changePropagation(kind),
      onSunSynchronousLockChange: (enabled) => this.changeSunSynchronousLock(enabled),
      // Sharing reads the active scene when an action is pressed.
      onShareSceneRequested: () => { this.sharing.dismissNotice(); return this.sharing.shareSummary() },
      onCopySceneLink: async () => {
        const link = await this.sharing.createLink()
        if (link.ok) this.recordShare('link')
        return link
      },
      onSceneFileRequested: () => { this.recordShare('file'); return this.sharing.file(new Date()) },
      onOpenSceneFile: (file) => { if (this.ready && !this.disposed) void this.sharing.openFile(file) },
      onConfirmSceneOpen: () => { void this.sharing.confirmPendingOpen() },
      onCancelSceneOpen: () => this.sharing.cancelPendingOpen(),
      onRetrySceneOpen: () => { void this.sharing.retry() },
      onDismissSceneNotice: () => this.sharing.dismissNotice(),
      onLocaleChange: (locale) => { recordUsage({ type: 'view', which: 'language' }); this.localeController.change(locale) },
      onLoadGroupFacts: (groupId) => this.loadGroupFacts(groupId),
      onAddFeaturedPick: (catalogId) => this.addCatalogueObjectOnMobile(catalogId, 'featured'),
      onOpenExample: (exampleId) => {
        const example = SCENE_EXAMPLES.find((candidate) => candidate.id === exampleId)
        if (!example || !this.ready || this.disposed) return
        recordUsage({ type: 'example_opened', example: example.id })
        this.setShell(setCatalogueWorkspaceOpen(this.shell, false))
        void this.sharing.openExample(example.fragment)
      },
      onTryOrbitLabExample: (presetId) => {
        if (!this.ready || this.disposed) return
        this.setShell(setCatalogueWorkspaceOpen(this.shell, false))
        this.callbacks.onModeChange('orbitLab')
        this.createOrbitFromExample(presetId)
      },
      // The phone presentation.
      onCreateOrbitFromExample: (presetId) => this.createOrbitFromExample(presetId),
      onMapViewChange: (view) => this.changeMapView(view),
      onSceneLayerChange: (layer, on) => this.changeSceneLayer(layer, on),
      onMobileAddGroup: (groupId) => this.addOfficialGroupOnMobile(groupId),
      onMobileAddCatalogueObject: (catalogId) => { this.recordSearchUsed(); return this.addCatalogueObjectOnMobile(catalogId, 'quick-search') },
      onMyPlaceChange: (on) => this.changeMyPlace(on),
      onUndoSceneChange: () => this.undoSceneChange(),
      onShapeAdjust: (phase, parameter) => this.adjustShape(phase, parameter),
      onFramingChange: () => this.applyFraming(),
    }
    this.ui = this.createUi(this.presentation.presentation)
    this.catalogue = new CatalogueController({ presenter: {
      syncWorkspace: (workspace) => this.ui.syncCatalogueWorkspace(workspace),
      setSnapshot: (snapshot, updated) => { this.ui.setCatalogueSnapshot(snapshot, updated); this.publishOfficialGroups() },
      setError: (failure) => this.ui.setCatalogueError(failure),
      setCatalogueNotice: (message) => this.ui.setCatalogueNotice(message),
      renderDiscovery: (presentation) => this.ui.renderCatalogueDiscovery(presentation),
      renderQuickSearch: (result, reason) => this.ui.renderCatalogueQuickSearch(result, reason),
      renderQuery: (manifest, query, result, facets) => this.ui.renderCatalogueQuery(manifest, query, result, facets),
      showDetailsLoading: (id) => this.ui.showCatalogueDetailsLoading(id),
      showDetails: (record, now) => this.ui.showCatalogueDetails(record, now),
      showDetailsError: (id, failure) => this.ui.showCatalogueDetailsError(id, failure),
      clearDetails: () => this.ui.clearCatalogueDetails(),
      setComparison: (items) => this.ui.setCatalogueComparison(items),
      clearComparison: () => this.ui.clearCatalogueComparison(),
    }, discoveryPages: [...CATALOGUE_DISCOVERY_PAGES, ...this.groupInjection.discoveryPages],
    // Official groups need approved membership: development builds carry the
    // reviewed GPS test case and production injects none.
    groupDefinitions: this.groupInjection.groupDefinitions })
    this.sharing = new SceneSharingController({
      getState: () => this.store.getState(),
      catalogueAddPending: () => this.pendingCatalogueAdds.size > 0,
      loadCatalogue: () => this.catalogue.load(),
      resolveRecords: (ids) => this.catalogue.resolveRecords(ids),
      applySharedScene: (mode, resolved) => this.applySharedScene(mode, resolved),
      presenter: {
        showConfirmation: (confirmation) => this.ui.showSceneOpenConfirmation(confirmation),
        showProgress: (message) => this.ui.showSceneOpenProgress(message),
        showNotice: (lines) => this.ui.showSceneOpenNotice(lines),
        showError: (message, retryable) => this.ui.showSceneOpenError(message, retryable),
        hideOpenStatus: () => this.ui.hideSceneOpenStatus(),
        setOpening: (opening) => this.ui.setSceneOpening(opening),
      },
      location: browserSceneLinkLocation(window),
      reportInvalidDocument: import.meta.env.DEV ? (errors) => console.warn('Shared scene validation failed:', errors) : undefined,
    })
    this.chooser = new SceneObjectChooserView(root.querySelector<HTMLElement>('.app-shell')!, {
      onChoose: (id) => this.interaction.choose(id),
      onPreview: (id) => this.interaction.preview(id),
      onDismiss: () => this.interaction.closeChooser(true),
    })
    this.interaction = new SceneInteractionController({
      canvas: this.sceneRoot.renderer.domElement,
      mapFrame: this.map.frameElement,
      chooser: this.chooser,
      pick: (surface, point, tolerances) => this.pickAt(surface, point, tolerances),
      objectInfo: (id) => {
        const scene = activeScene(this.store.getState())
        const object = scene.objects.find((candidate) => candidate.id === id)
        if (!object) return null
        return { name: object.name, colorHex: object.style.colorHex, selection: scene.selection.primaryId === id ? 'primary' : scene.selection.ids.includes(id) ? 'selected' : 'none' }
      },
      select: (id, intent) => this.selectSceneObject(id, intent),
      clearSelection: () => this.clearSceneSelection(),
      surfaceActive: (surface) => surface === '3d' ? !this.mapCoversScene() : this.map.open,
      showHover: (surface, id, label, at) => this.showHover(surface, id, label, at),
      applyReveals: (reveals, nowMs) => this.applyReveals(reveals, nowMs),
      emptyTap: (surface) => this.ui.handleEmptyTap(surface),
      now: () => performance.now(),
    })
    this.chooser.setLayout(this.presentation.presentation === 'mobile' ? 'sheet' : 'anchored')
    this.ui.syncShell(this.shell)
    this.ui.syncState(this.store.getState(), this.lockStatus)
    this.localeController.onChange(() => this.relocalize())
    this.presentation.onChange((next) => this.switchPresentation(next))
    this.sceneRoot.controls.addEventListener('start', this.onControlsStart)
    this.sceneRoot.onResize = () => {
      if (this.retryFitOnResize) this.requestFit()
      this.applyFraming(0)
    }
    this.frameDependencies = {
      clock: this.clock, runtime: this.runtime,
      applyEnvironment: (instant) => this.applyEnvironment(instant),
      publishInstant: (currentInstant) => {
        const stopped = this.store.getState().simulation.playing !== this.clock.playing
        this.store.update((state) => ({ ...state, simulation: { ...state.simulation, currentInstant, playing: this.clock.playing } }))
        if (stopped) this.ui.syncState(this.store.getState(), this.lockStatus)
      },
      updateReadouts: (samples, instant, nowMs) => this.updateReadouts(samples, instant, nowMs),
      render: () => {
        this.interaction.frame(performance.now())
        // The maximized map covers the 3D canvas opaquely; simulation and map
        // drawing continue and 3D drawing resumes on the next frame (4.7).
        if (!this.mapCoversScene()) { this.updateGuides(); this.sceneRoot.render(); this.updatePrimaryLabel(); this.considerHighResolutionEarth() } else this.labels.setPrimary(null, null)
        // A cheap dirty check while the map is closed or unchanged. The map
        // starts no second requestAnimationFrame loop of its own.
        this.map.render()
      },
    }
  }

  async start(): Promise<void> {
    if (this.ready || this.disposed) return
    this.watchGraphicsContext()
    let textures: Awaited<ReturnType<typeof loadRequiredTextures>>
    try {
      textures = await loadRequiredTextures(this.sceneRoot.renderer, (loaded, total) => {
        if (!this.disposed) this.overlay.setProgress(loaded, total)
      })
    } catch (error) {
      // A failed download offers Retry in place.
      if (!this.disposed) this.fail('textures', error)
      return
    }
    try {
      if (this.disposed) { textures.earthDay.dispose(); textures.earthNightMask.dispose(); return }
      const earth = createEarth(textures.earthDay, textures.earthNightMask)
      this.earth = earth
      this.sceneRoot.earthFixedRoot.add(earth)
      this.disposeEarth = () => {
        earth.removeFromParent(); earth.geometry.dispose()
        const dayMap = setEarthDayMap(earth, textures.earthDay)
        if (dayMap !== textures.earthDay) dayMap.dispose()
        if (Array.isArray(earth.material)) earth.material.forEach((material) => material.dispose())
        else earth.material.dispose()
        textures.earthDay.dispose(); textures.earthNightMask.dispose()
      }
      // Optional sky populations retain their original appearance and loading order.
      void loadStarCatalogue().then((catalogue) => {
        if (!catalogue || this.disposed) return
        this.addStarFieldView(new StarFieldView(this.sceneRoot.scene, catalogue, this.sceneRoot.currentPixelRatio, { name: 'Star field', brightnessScale: 0.8 }))
      })
      void loadBandDensity().then((density) => {
        if (!density || this.disposed) return
        const band = generateBandField(density)
        this.addStarFieldView(new StarFieldView(this.sceneRoot.scene, band, this.sceneRoot.currentPixelRatio, {
          brightnessScale: BAND_BRIGHTNESS_SCALE, maxPointPx: BAND_MAX_POINT_PX, name: 'Milky Way band',
        }))
      })
      const state = this.store.getState()
      this.applyLook(state)
      const scene = activeScene(state); this.runtime.reconcile(scene.objects, selectionProjection(state), this.runtimeView(state))
      this.map.setOpen(state.view.groundTrackMapVisible)
      this.map.setPrimary(scene.selection.primaryId)
      this.ready = true
      this.overlay.hide()
      this.ui.setLoading(false)
      this.publishOfficialGroups()
      if (scene.objects.length > 0) this.requestFit()
      const startInstant = this.clock.currentInstant()
      const startOrientation = this.applyEnvironment(startInstant)
      this.updateReadouts(this.runtime.updateAt(startInstant, startOrientation, performance.now()), startInstant, performance.now(), true)
      this.stopRenderLoop = this.startFrames()
      // A shared link opens only once the application is ready.
      this.sharing.start()
    } catch (error) {
      if (!this.disposed) this.fail('frame', error)
    }
  }

  /** The one render loop; a frame that throws stops it with a message. */
  private startFrames(): () => void {
    return startRenderLoop((deltaSeconds, nowMs, wallNowMs) => advanceSimulationFrame(this.frameDependencies, deltaSeconds, nowMs, wallNowMs), (error) => this.fail('frame', error))
  }

  /** A lost WebGL context stops drawing and offers
   *  Reload; three.js cannot restore every GPU resource by itself. */
  private watchGraphicsContext(): void {
    if (this.contextWatched) return
    this.contextWatched = true
    this.sceneRoot.renderer.domElement.addEventListener('webglcontextlost', () => { if (!this.disposed) this.fail('contextLost', new Error('WebGL context lost')) })
  }

  /** Stops the scene and shows a friendly, translated failure. The technical
   *  detail goes to the console and one anonymous error event. */
  private fail(kind: FailureKind, error: unknown): void {
    if (this.failed === 'contextLost' && kind !== 'contextLost') return
    this.failed = kind
    this.stopRenderLoop?.()
    this.stopRenderLoop = undefined
    console.error(error)
    const usageKind: Readonly<Record<FailureKind, UsageErrorKind>> = { webgl: 'webgl', textures: 'textures', contextLost: 'context-lost', frame: 'frame' }
    recordUsage({ type: 'error', kind: usageKind[kind] })
    this.overlay.showFailure(kind, defaultFailureAction(kind, () => window.location.reload(), () => { this.failed = null; this.overlay.showLoading(); void this.start() }))
  }

  /** Rebuild the interface in the new language. Scenes,
   *  selections, clock, catalogue state and camera are untouched, and nothing
   *  is fetched; the views outside `UiRoot` re-word themselves. */
  private relocalize(): void {
    if (this.disposed) return
    this.overlay.applyLocale()
    this.sceneRoot.applyLocale()
    this.map.applyLocale()
    this.chooser.applyLocale()
    this.interaction.reset()
    this.ui.rebuild()
    this.replayInterface()
    this.applyLook(this.store.getState())
  }

  /** Content owned by the controllers, presented again after the interface
   *  is rebuilt (a language change) or replaced (a presentation switch).
   *  No request is made: the controllers republish what they hold. */
  private replayInterface(): void {
    this.catalogue.republish()
    this.publishOfficialGroups()
    this.sharing.republish()
    if (!this.ready) return
    const instant = this.clock.currentInstant()
    const orientation = this.applyEnvironment(instant)
    this.updateReadouts(this.runtime.updateAt(instant, orientation, performance.now()), instant, performance.now(), true)
  }

  /** The root for one presentation, in its own container. */
  private createUi(presentation: Presentation): ApplicationUi {
    this.appShell.dataset.presentation = presentation
    this.desktopContainer.hidden = presentation !== 'desktop'
    this.mobileContainer.hidden = presentation !== 'mobile'
    return presentation === 'mobile'
      ? new MobileUiRoot(this.mobileContainer, this.callbacks)
      : new UiRoot(this.desktopContainer, this.callbacks, ORBIT_PRESETS.map(({ id }) => id))
  }

  /** Crossing the mobile/desktop boundary rebuilds the interface in
   *  place. Scenes, selection, mode, clock, catalogue state, camera, language
   *  and whether the map is showing are kept; panels, menus, dialogs, the
   *  Catalogue workspace and transient notices close. Nothing is fetched. */
  private switchPresentation(next: Presentation): void {
    if (this.disposed) return
    this.interaction.reset()
    this.ui.dispose()
    this.desktopContainer.textContent = ''
    this.mobileContainer.textContent = ''
    const shell = shellAfterPresentationChange(this.shell, next, this.store.getState().view.groundTrackMapVisible)
    if (shell.mapMaximized !== this.shell.mapMaximized) this.interaction.mapLayoutChanged(shell.mapMaximized)
    this.shell = shell
    this.map.setMaximized(shell.mapMaximized)
    this.chooser.setLayout(next === 'mobile' ? 'sheet' : 'anchored')
    // My place is a mobile switch; desktop has no control to turn it off.
    if (next === 'desktop' && this.myPlaceStatus !== 'off') { this.myPlaceRequest += 1; this.observer = null; this.myPlaceStatus = 'off'; this.myPlaceMarker.set(null); this.map.setObserver(null) }
    this.ui = this.createUi(next)
    this.ui.setLoading(!this.ready)
    this.ui.syncShell(this.shell)
    this.ui.setGroupProvenance(new Map(this.groupProvenance))
    this.ui.syncState(this.store.getState(), this.lockStatus)
    this.ui.setMyPlaceStatus(this.myPlaceStatus)
    this.replayInterface()
    this.applyFraming(0)
    if (activeScene(this.store.getState()).objects.length > 0) this.requestFit()
  }

  /** Moves the projection centre to the centre of the
   *  visible region the interface reports; desktop reports none. Only the
   *  offset changes here; the distance changes only through fits. */
  private applyFraming(durationMs = this.reducedMotion() ? 0 : FRAMING_EASE_MS): void {
    if (this.disposed) return
    const canvas = this.sceneRoot.renderer.domElement.getBoundingClientRect()
    const insets = this.ui.framingInsets(canvas)
    const offset = insets ? regionFramingOffset(insets) : { x: 0, y: 0 }
    this.sceneRoot.setFramingOffset(offset.x, offset.y, durationMs)
  }

  private reducedMotion(): boolean { return this.reducedMotionQuery?.matches ?? false }

  private addStarFieldView(view: StarFieldView): void {
    this.starFieldViews.push(view)
    this.sceneRoot.addStarFieldView(view)
  }

  private commitState(next: AppState): void {
    if (!this.ready || this.disposed || next === this.store.getState()) return
    const previous = this.store.getState()
    this.store.update(() => next)
    this.applyLook(next)
    const scene = activeScene(next); this.runtime.reconcile(scene.objects, selectionProjection(next), this.runtimeView(next))
    if (previous.activeMode !== next.activeMode) this.interaction.reset()
    else this.interaction.sceneChanged(new Set(scene.objects.map((object) => object.id)))
    if (previous.view.groundTrackMapVisible && !next.view.groundTrackMapVisible) this.interaction.mapLayoutChanged(false)
    this.map.setOpen(next.view.groundTrackMapVisible)
    this.map.setPrimary(scene.selection.primaryId)
    this.sceneRoot.ensureFarPlane(orbitCollectionRadius(scene.objects, false))
    // Any other change to the recorded scene makes the undo stale.
    if (this.undo && !canUndo(this.undo.entry, next)) { this.undo = null; this.ui.withdrawUndo() }
    this.ui.syncState(next, this.lockStatus)
    if (previous.realObjects.scene !== next.realObjects.scene) this.publishOfficialGroups()
    const instant = this.clock.currentInstant()
    const orientation = this.applyEnvironment(instant)
    this.updateReadouts(this.runtime.updateAt(instant, orientation, performance.now()), instant, performance.now(), true)
  }

  /** Pick candidates on one surface. Objects in a propagation-error state
   *  are never pickable, on either surface. */
  private pickAt(surface: InteractionSurface, point: ScreenPoint, tolerances: PickTolerances): PickHit[] {
    if (surface === 'map') return this.map.pickAt(point, { markerCssPx: tolerances.mapMarkerCssPx, trackCssPx: tolerances.mapTrackCssPx }).filter((hit) => !this.runtime.errorFor(hit.objectId))
    const canvas = this.sceneRoot.renderer.domElement
    return this.picker.pick(point, { width: canvas.clientWidth, height: canvas.clientHeight }, this.runtime.viewPorts(), tolerances)
  }

  private showHover(surface: InteractionSurface, id: string | null, label: string | null, at: ScreenPoint | null): void {
    if (surface === 'map') { this.map.setHovered(id, label); return }
    if (id !== this.hovered3dId) {
      for (const port of this.runtime.viewPorts()) {
        if (port.id !== this.hovered3dId && port.id !== id) continue
        port.body.setHovered?.(port.id === id)
        port.path.setHovered?.(port.id === id)
      }
      this.hovered3dId = id
    }
    this.labels.setHover(id ? label : null, at)
  }

  private applyReveals(reveals: ReadonlyMap<string, number>, nowMs: number): void {
    const reduced = this.reducedMotionQuery?.matches ?? false
    for (const port of this.runtime.viewPorts()) {
      const start = reveals.get(port.id)
      port.body.setReveal?.(start === undefined ? null : Math.min(1, Math.max(0, (nowMs - start) / 1200)), reduced)
    }
    this.map.setReveals(reveals, reduced)
  }

  /** The persistent primary label, hidden whenever its marker is not
   *  actually visible (occluded, behind the camera, outside the view, hidden
   *  body or propagation error). */
  private updatePrimaryLabel(): void {
    const scene = activeScene(this.store.getState())
    const id = scene.selection.primaryId
    const object = id ? scene.objects.find((candidate) => candidate.id === id) : undefined
    if (!object || !id || !object.display.bodyVisible || this.runtime.errorFor(id)) { this.labels.setPrimary(null, null); return }
    let position: { readonly x: number; readonly y: number; readonly z: number } | null = null
    for (const port of this.runtime.viewPorts()) if (port.id === id) { position = port.body.pickPositionRender?.() ?? null; break }
    const canvas = this.sceneRoot.renderer.domElement
    const viewport = { width: canvas.clientWidth, height: canvas.clientHeight }
    const projected = position ? this.picker.project(position, viewport) : null
    const inside = projected && projected.x >= 0 && projected.y >= 0 && projected.x <= viewport.width && projected.y <= viewport.height
    this.labels.setPrimary(object.name, inside ? projected : null)
  }

  /** The active element's guides on the selected
   *  Orbit Lab orbit, following the orientation drawn this frame (J2 drift):
   *  the Shape chip on mobile, the element control in use on desktop. Never
   *  shown for real objects. While an orbit is edited the 3D ground tracks
   *  and histories are hidden, so the guides read clearly. */
  private updateGuides(): void {
    const parameter = this.ui.activeShapeParameter()
    const state = this.store.getState()
    const object = parameter && state.activeMode === 'orbitLab' ? getSelectedObject(state) : undefined
    const editing = object?.source.kind === 'keplerian'
    this.sceneRoot.groundTrackRoot.visible = !editing
    if (!parameter || !object || object.source.kind !== 'keplerian' || this.runtime.errorFor(object.id)) { this.guides.hide(); return }
    const geometry = object.source.geometry
    const circular = geometry.eccentricity === 0
    const kind: OrbitGuideKind | null = parameter === 'tilt' || parameter === 'node' || parameter === 'drift' ? 'plane'
      : parameter === 'shape' || parameter === 'periapsis' ? 'apsides'
        : parameter === 'size' ? circular ? null : 'apsides'
          : 'periapsis'
    if (!kind) { this.guides.hide(); return }
    this.guides.show(kind, orbitGuideGeometry(geometry, this.runtime.drawnOrientation(object.id) ?? geometry))
  }

  private mapCoversScene(): boolean { return mapCoversScene(this.shell, this.store.getState().view.groundTrackMapVisible, this.map.open) }

  private setShell(next: ShellState): void {
    if (next === this.shell || this.disposed) return
    if (next.mapMaximized !== this.shell.mapMaximized) this.interaction.mapLayoutChanged(next.mapMaximized)
    this.shell = next
    this.map.setMaximized(next.mapMaximized)
    this.ui.syncShell(next)
  }

  private jumpToInstant(instant: SimulationInstant): void {
    if (!this.ready || this.disposed) return
    this.clock.setInstant(instant)
    this.runtime.requestGroundTrackRefresh(selectionProjection(this.store.getState()).primaryId)
    this.runtime.clearGroundTrackHistories()
    const state = this.store.getState()
    this.commitState({ ...state, simulation: { ...state.simulation, currentInstant: this.clock.currentInstant() } })
  }

  /** A search counts once, when it leads to an add or details. */
  private recordSearchUsed(): void {
    if (this.lastSearchResults === null) return
    recordUsage({ type: 'search', results: resultCountBucket(this.lastSearchResults) })
    this.lastSearchResults = null
  }

  private recordShare(kind: 'link' | 'file'): void {
    const state = this.store.getState()
    recordUsage({ type: 'share', kind, mode: state.activeMode, objects: objectCountBucket(activeScene(state).objects.length) })
  }

  /** The colour an object is drawn with in the 3D scene. */
  private sceneColor(colorHex: number): number { return this.sceneBackdrop === 'lab' ? labDisplayColor(colorHex) : colorHex }

  private runtimeView(state: AppState): RuntimeViewOptions {
    const lab = effectiveBackdrop(state) === 'lab'
    return { ...state.view, displayColor: lab ? labDisplayColor : undefined, haloColor: lab ? LAB_PALETTE.halo : undefined }
  }

  /** Backdrop, Earth style, borders and the Lab grid, from state.
   *  Data loads on first use; a failure turns the choice off with a notice. */
  private applyLook(state: AppState): void {
    const backdrop = effectiveBackdrop(state)
    this.sceneBackdrop = backdrop
    this.sceneRoot.setBackdrop(backdrop)
    // Chrome that floats straight on the scene restyles itself (styles/ui.css).
    this.appShell.dataset.backdrop = backdrop
    this.guides.setGuideColor(backdrop === 'lab' ? LAB_PALETTE.guide : null)
    const earthStyle = backdrop === 'lab' ? 'lab' : state.look.earthStyle
    if (earthStyle === 'map') this.loadEarthMap()
    if (this.earth) drawEarthStyle(this.earth, earthStyle, this.earthMapTexture)
    // The map style includes country borders, on the globe and the 2D map.
    const bordersOn = state.look.earthStyle === 'map'
    if (bordersOn) this.loadCountryBorders()
    this.countryBorders?.view.setVisible(earthStyle === 'map')
    this.map.setBorders(bordersOn ? this.countryBorders?.data ?? null : null)
    if (backdrop === 'lab') this.updateLabGrid(state)
  }

  /** The grid box around the largest visible Orbit Lab orbit. */
  private updateLabGrid(state: AppState): void {
    let largest = 0
    let beyond = false
    for (const object of state.orbitLab.scene.objects) {
      if (!object.display.orbitPathVisible && !object.display.bodyVisible) continue
      if (object.source.kind !== 'keplerian') continue
      const { semiMajorAxisKm, eccentricity } = object.source.geometry
      const apoapsis = eccentricity < 1 ? (semiMajorAxisKm * (1 + eccentricity)) / EARTH_RADIUS_KM : Number.POSITIVE_INFINITY
      if (apoapsis * 1.15 > LAB_BOX_MAX_HALF_SIZE) beyond = true
      largest = Math.max(largest, Math.min(apoapsis, LAB_BOX_MAX_HALF_SIZE))
    }
    const halfSize = labBoxHalfSize(largest)
    const spacing = labGridSpacing(halfSize)
    const t = text().look
    this.sceneRoot.setLabGrid(halfSize, spacing, beyond ? `${t.gridLegend(spacing)} ${t.gridBeyond}` : t.gridLegend(spacing))
  }

  private loadEarthMap(): void {
    if (this.earthMapLoad !== 'idle') return
    this.earthMapLoad = 'loading'
    void Promise.all([loadGeography(LAND_ASSET_URL, decodePolygonGeoJson), loadGeography(LAKES_ASSET_URL, decodePolygonGeoJson)]).then(([land, lakes]) => {
      if (this.disposed) return
      const renderer = this.sceneRoot.renderer
      const width = this.presentation.presentation === 'desktop' && renderer.capabilities.maxTextureSize >= 4096 ? 4096 : 2048
      const texture = land.ok ? createEarthMapTexture(land.data, lakes.ok ? lakes.data : null, width, renderer.capabilities.getMaxAnisotropy()) : null
      if (!texture) {
        console.warn('Map-style Earth unavailable', land.ok ? 'no 2D canvas' : land.reason)
        this.earthMapLoad = 'idle'
        this.ui.setSceneStatus(text().look.mapUnavailable)
        this.commitState(setEarthStyle(this.store.getState(), 'imagery'))
        return
      }
      this.earthMapTexture = texture
      this.earthMapLoad = 'done'
      this.applyLook(this.store.getState())
    })
  }

  private loadCountryBorders(): void {
    if (this.countryBordersLoad !== 'idle') return
    this.countryBordersLoad = 'loading'
    void loadGeography(BOUNDARIES_ASSET_URL, decodeBoundaryGeoJson).then((result) => {
      if (this.disposed) return
      if (!result.ok) {
        console.warn('Country borders unavailable', result.reason)
        this.countryBordersLoad = 'idle'
        // The map style stays; it simply has no borders this time.
        this.ui.setSceneStatus(text().look.bordersUnavailable)
        return
      }
      const view = new CountryBordersView(this.sceneRoot.earthFixedRoot, result.data,
        (material) => this.sceneRoot.addLineMaterial(material), (material) => this.sceneRoot.removeLineMaterial(material))
      this.countryBorders = { data: result.data, view }
      this.countryBordersLoad = 'done'
      this.applyLook(this.store.getState())
    })
  }

  /** On a desktop whose GPU takes 8K textures, the
   *  first close zoom loads the 8K day map; phones keep 4K. At the default
   *  distance 4K already exceeds the screen's resolution. */
  private considerHighResolutionEarth(): void {
    if (this.highResolutionEarth !== 'idle' || !this.earth || this.presentation.presentation !== 'desktop') return
    if (this.sceneRoot.cameraDistance > HIGH_RESOLUTION_EARTH_DISTANCE) return
    if (this.sceneRoot.renderer.capabilities.maxTextureSize < HIGH_RESOLUTION_TEXTURE_SIZE) { this.highResolutionEarth = 'done'; return }
    this.highResolutionEarth = 'loading'
    const earth = this.earth
    loadEarthDayHighResolution(this.sceneRoot.renderer).then((texture) => {
      if (this.disposed || this.earth !== earth) { texture.dispose(); return }
      const previous = setEarthDayMap(earth, texture)
      previous.dispose()
      this.highResolutionEarth = 'done'
    }, (error: unknown) => {
      // Optional: the 4K Earth stays.
      console.warn('High-resolution Earth unavailable', error)
      this.highResolutionEarth = 'done'
    })
  }

  /** The current time at 1×, playing forward. The first live
   *  view also turns towards the sunlit hemisphere: the
   *  default camera direction suits Orbit Lab's March instant but faces
   *  Earth's night side for half of the year. */
  private goLive(faceDaylight: boolean): void {
    if (!this.ready || this.disposed) return
    this.clock.setInstant({ unixSeconds: Date.now() / 1000 })
    this.clock.speedMultiplier = 1
    this.clock.playing = true
    this.clock.reversed = false
    this.runtime.requestGroundTrackRefresh(selectionProjection(this.store.getState()).primaryId)
    this.runtime.clearGroundTrackHistories()
    const state = this.store.getState()
    this.commitState({ ...state, simulation: { ...state.simulation, currentInstant: this.clock.currentInstant(), speedMultiplier: 1, playing: true, reversed: false } })
    const environment = this.latestEnvironment
    if (faceDaylight && environment) this.sceneRoot.focusDirection(daylightViewDirection(projectInertialToRender(environment.sunDirectionProjectInertial)), this.reducedMotion() ? 0 : 700)
  }

  private applyEnvironment(instant: SimulationInstant): EnvironmentState['orientation'] {
    const env = environmentAt(instant)
    const sunRender = projectInertialToRender(env.sunDirectionProjectInertial)
    if (this.earth) {
      setEarthSunDirectionRender(this.earth, sunRender)
    }
    this.sceneRoot.setSunDirectionRender(sunRender)
    this.map.setSun(env.subSolarPoint)
    this.latestEnvironment = env
    setEarthOrientation(this.sceneRoot.earthFixedRoot, env.orientation)
    return env.orientation
  }

  /** Every value here comes from the frame's own sample and is stored nowhere
   *  (INV-10). No consumer re-derives elements, anomaly or rates from the
   *  object definition. */
  private updateReadouts(samples: ReadonlyMap<string, ObjectFrameSample>, _instant: SimulationInstant, nowMs: number, force = false): void {
    const environment = this.latestEnvironment
    if (!environment) return
    const simulation = this.store.getState().simulation
    const object = getSelectedObject(this.store.getState())
    const sample = object && samples.get(object.id)
    if (!object || !sample) {
      this.ui.updateReadouts(null, environment, simulation, nowMs, force)
      if (object && isSgp4Source(object.source)) {
        const error = this.runtime.errorFor(object.id)
        this.ui.showTleRuntimeError(error ? text().errors.propagation(error.code, error.message) : text().inspector.noSgp4State)
      }
      return
    }
    const conic = sample.conic
    const conditioning = conic ? classifyElements(conic.geometry) : undefined
    if (isSgp4Source(object.source)) {
      const offsetSeconds = _instant.unixSeconds - object.source.definition.meanElements.epoch.unixSeconds
      this.ui.updateReadouts({
        derived: null,
        currentAltitudeKm: lengthVec3(sample.state.positionProjectInertialKm) - EARTH_RADIUS_KM,
        currentSpeedKmPerSecond: lengthVec3(sample.state.velocityProjectInertialKmPerSecond),
        trueAnomalyRad: 0,
        subSatellitePoint: sample.subSatellitePoint,
        groundTrackVisible: object.display.groundTrackVisible,
        groundTrackHistoryRecording: object.display.groundTrackHistoryRecording,
        sensorGeometry: sample.sensorGeometry,
        samplingBand: sample.samplingBand,
        drift: null,
        observerElevationRad: this.observerElevation(sample, environment),
        sgp4: {
          definition: object.source.definition,
          offsetSeconds,
          warning: tleAgeWarning(offsetSeconds),
          error: this.runtime.errorFor(object.id),
          clipped: false,
        },
      }, environment, simulation, nowMs, force)
      return
    }
    this.ui.updateReadouts({
      derived: deriveOrbitValues(object.source.geometry),
      currentAltitudeKm: lengthVec3(sample.state.positionProjectInertialKm) - EARTH_RADIUS_KM,
      currentSpeedKmPerSecond: lengthVec3(sample.state.velocityProjectInertialKmPerSecond),
      trueAnomalyRad: conic ? conic.trueAnomalyRad : 0,
      subSatellitePoint: sample.subSatellitePoint,
      groundTrackVisible: object.display.groundTrackVisible,
      groundTrackHistoryRecording: object.display.groundTrackHistoryRecording,
      sensorGeometry: sample.sensorGeometry,
      samplingBand: sample.samplingBand,
      // Nodal and apsidal drift rows appear only under j2Secular, so a two-body
      // object never shows a 0.00 deg/day drift row implying a perturbation
      // model it does not have.
      drift: conic && conditioning && object.propagation.kind === 'j2Secular' ? {
        angleRates: conic.angleRates,
        readouts: angleReadoutsFor(conic.geometry, conic.meanAnomalyRad, conic.angleRates, conditioning),
        conditioning,
        sun: orbitSunGeometry(conic.geometry, environment, conditioning),
      } : null,
      observerElevationRad: this.observerElevation(sample, environment),
    }, environment, simulation, nowMs, force)
  }

  private updateSelected(update: (object: OrbitalObject) => OrbitalObject): void {
    const state = this.store.getState()
    const object = getSelectedObject(state); if (object) this.commitState(updateObject(state, object.id, update))
  }

  private changeSelectedLayer(layer: BudgetedLayer, on: boolean): void {
    const object = getSelectedObject(this.store.getState())
    if (object) this.changeLayer('inspector', [object.id], layer, on)
  }

  private changeSceneLayer(layer: BudgetedLayer, on: boolean): void {
    this.changeLayer('view', activeScene(this.store.getState()).objects.map((object) => object.id), layer, on)
  }

  /** Every interactive layer change goes through the budget: a refusal
   *  applies nothing, restores the controls and explains itself next to
   *  the control that asked. */
  private changeLayer(surface: LayerBudgetSurface, ids: readonly string[], layer: BudgetedLayer, on: boolean): void {
    if (!this.ready || this.disposed || ids.length === 0) return
    const state = this.store.getState()
    const result = setLayerForObjects(state, ids, layer, on)
    this.ui.setLayerBudgetMessage(surface, layerBudgetMessage(result.check))
    if (!result.check.ok) { this.ui.syncState(state, this.lockStatus); return }
    this.commitState(result.state)
  }

  private selectSceneObject(id: string, intent: SceneSelectionIntent): void {
    const state = this.store.getState()
    const scene = activeScene(state)
    const selection = intent === 'only'
      ? selectOnly(scene, id)
      : intent === 'toggle'
        ? toggleSelected(scene, id)
        : intent === 'membership'
          ? toggleMembership(scene, id)
          : intent === 'include'
          ? selectMany(scene, [...scene.selection.ids, id])
          : setSelection(scene, { ids: scene.selection.ids.filter((candidate) => candidate !== id), primaryId: scene.selection.primaryId })
    let next = withScene(state, state.activeMode, selection)
    if (next !== state && state.activeMode === 'orbitLab') next = { ...next, orbitLab: { ...next.orbitLab, authoring: { ...next.orbitLab.authoring, lastConstraint: { kind: 'none' } } } }
    this.commitState(next)
  }

  private removeSceneObjects(ids: readonly string[]): void {
    const state = this.store.getState()
    const provenance = new Map(this.groupProvenance)
    const scene = activeScene(state)
    const nextScene = removeObjects(scene, ids)
    if (nextScene !== scene && ids.some((id) => this.groupProvenance.delete(id))) this.ui.setGroupProvenance(new Map(this.groupProvenance))
    let next = withScene(state, state.activeMode, nextScene)
    if (next !== state && state.activeMode === 'orbitLab') next = { ...next, orbitLab: { ...next.orbitLab, authoring: { ...next.orbitLab.authoring, lastConstraint: { kind: 'none' } } } }
    this.commitState(next)
    const removed = scene.objects.filter((object) => ids.includes(object.id))
    if (this.recordUndo(state, provenance, state.activeMode)) this.ui.announceSceneChange({ kind: 'removed', names: removed.map((object) => object.name), all: nextScene.objects.length === 0 && removed.length > 1 })
  }

  private setSceneSelection(selection: SceneSelection): void {
    const state = this.store.getState()
    let next = withScene(state, state.activeMode, setSelection(activeScene(state), selection))
    if (next !== state && state.activeMode === 'orbitLab') next = { ...next, orbitLab: { ...next.orbitLab, authoring: { ...next.orbitLab.authoring, lastConstraint: { kind: 'none' } } } }
    this.commitState(next)
  }

  /** One-shot rotation about the Earth's centre that brings the single
   *  selected object to the camera side at the current distance (4.8). */
  private focusSelected(): void {
    if (!this.ready || this.disposed) return
    const object = getSelectedObject(this.store.getState())
    if (!object) return
    let position: { readonly x: number; readonly y: number; readonly z: number } | null = null
    for (const port of this.runtime.viewPorts()) if (port.id === object.id) position = port.body.pickPositionRender?.() ?? null
    if (!position) return
    this.sceneRoot.focusDirection(position, this.reducedMotionQuery?.matches ? 0 : 400)
  }

  private clearSceneSelection(): void {
    const state = this.store.getState()
    this.commitState(withScene(state, state.activeMode, clearSelection(activeScene(state))))
  }

  private addTle(input: string, jumpToEpoch: boolean): void {
    if (!this.ready || this.disposed) return
    const parsed = parseTle(input)
    if (!parsed.ok) {
      this.ui.showTleErrors(parsed.errors.map((item) => text().errors.tle(item)))
      return
    }
    const state = this.store.getState()
    if (remainingCapacity(state.realObjects.scene) === 0) {
      this.ui.showTleErrors([sceneFullForManualAdd('tle')])
      return
    }
    while (allSceneObjectIds(state).has(`tle-${this.nextObjectSequence}`)) this.nextObjectSequence += 1
    const sequence = this.nextObjectSequence++
    const colorHex = OBJECT_COLORS.find((color) => !state.realObjects.scene.objects.some((object) => object.style.colorHex === color)) ?? OBJECT_COLORS[(sequence - 1) % OBJECT_COLORS.length]
    const definition = parsed.definition
    const object: OrbitalObject = {
      id: `tle-${sequence}`,
      name: definition.name ?? `NORAD ${definition.catalogId}`,
      source: { kind: 'tle', definition },
      propagation: { kind: 'sgp4' },
      editingLock: { kind: 'none' },
      style: { colorHex, markerSizeRenderUnits: 0.02 },
      sensor: defaultSensorDefinition(),
      reachConstraint: defaultGroundReachConstraint(),
      display: { bodyVisible: true, orbitPathVisible: true, groundTrackVisible: false, groundTrackHistoryRecording: false, sensorGeometryVisible: false },
      notes: TLE_OBJECT_NOTE,
    }
    let next = addObjectToMode(state, 'realObjects', object)
    if (jumpToEpoch && state.activeMode === 'realObjects') {
      this.clock.setInstant(definition.epoch)
      this.runtime.clearGroundTrackHistories()
      next = { ...next, simulation: { ...next.simulation, currentInstant: this.clock.currentInstant() } }
    }
    this.ui.clearTleErrors()
    this.commitState(next)
    recordUsage({ type: 'object_added', source: 'manual' })
    if (state.activeMode === 'realObjects') this.requestFit()
  }

  private addOmm(input: string, jumpToEpoch: boolean): void {
    if (!this.ready || this.disposed) return
    const parsed = parseOmmJson(input)
    if (!parsed.ok) {
      this.ui.showTleErrors(parsed.errors.map((item) => text().errors.omm(item)))
      return
    }
    this.addOmmDefinition(parsed.definition, jumpToEpoch)
  }

  private addOmmDefinition(definition: import('../data/omm.ts').OmmDefinition, jumpToEpoch: boolean): void {
    const state = this.store.getState()
    if (remainingCapacity(state.realObjects.scene) === 0) { this.ui.showTleErrors([sceneFullForManualAdd('omm')]); return }
    while (allSceneObjectIds(state).has(`omm-${this.nextObjectSequence}`)) this.nextObjectSequence += 1
    const sequence = this.nextObjectSequence++
    const colorHex = OBJECT_COLORS.find((color) => !state.realObjects.scene.objects.some((object) => object.style.colorHex === color)) ?? OBJECT_COLORS[(sequence - 1) % OBJECT_COLORS.length]
    const object: OrbitalObject = { id: `omm-${sequence}`, name: definition.name, source: { kind: 'omm', definition }, propagation: { kind: 'sgp4' }, editingLock: { kind: 'none' }, style: { colorHex, markerSizeRenderUnits: 0.02 }, sensor: defaultSensorDefinition(), reachConstraint: defaultGroundReachConstraint(), display: { bodyVisible: true, orbitPathVisible: true, groundTrackVisible: false, groundTrackHistoryRecording: false, sensorGeometryVisible: false }, notes: OMM_OBJECT_NOTE }
    let next = addObjectToMode(state, 'realObjects', object)
    if (jumpToEpoch && state.activeMode === 'realObjects') { this.clock.setInstant(definition.meanElements.epoch); this.runtime.clearGroundTrackHistories(); next = { ...next, simulation: { ...next.simulation, currentInstant: this.clock.currentInstant() } } }
    this.ui.clearTleErrors(); this.commitState(next); recordUsage({ type: 'object_added', source: 'manual' }); if (state.activeMode === 'realObjects') this.requestFit()
  }

  /** Whole-group Add all to scene: one atomic add with
   *  one shared colour for the newly created members; every member present
   *  afterwards gets the group's provenance and is selected. */
  private async addCatalogueGroup(groupId: string, catalogIds: readonly string[]): Promise<AddCatalogueRecordsOutcome> {
    const group = catalogueGroupById(groupId, this.groupInjection.groupDefinitions)
    if (!group) return { kind: 'failed', reason: { kind: 'group-unavailable' } }
    const outcome = await this.addCatalogueRecords(catalogIds, false, { sharedColor: true, source: 'group' })
    if (outcome.kind === 'added') recordUsage({ type: 'group_added', group: group.id })
    const present = outcome.kind === 'added' ? [...outcome.added, ...outcome.alreadyPresent] : outcome.kind === 'already-present' ? outcome.objects : []
    if (present.length > 0) {
      const membership: GroupMembership = { groupId: group.id, title: group.title, revision: this.groupInjection.groupDefinitions.revision }
      for (const identity of present) {
        const existing = (this.groupProvenance.get(identity.sceneId) ?? []).filter((item) => item.groupId !== group.id)
        this.groupProvenance.set(identity.sceneId, [...existing, membership])
      }
      this.ui.setGroupProvenance(new Map(this.groupProvenance))
    }
    return outcome
  }

  private async addCatalogueRecords(catalogIds: readonly string[], jumpToEpoch: boolean, options: { readonly sharedColor?: boolean; readonly source?: 'quick-search' | 'catalogue' | 'group' | 'featured' } = {}): Promise<AddCatalogueRecordsOutcome> {
    if (!this.ready || this.disposed) return { kind: 'failed', reason: { kind: 'not-ready' } }
    // Catalogue adds wait while a shared scene opens, and replace its result notice.
    if (this.sharing.opening) { const refused: AddCatalogueRecordsOutcome = { kind: 'failed', reason: { kind: 'wait-for-open' } }; this.ui.setSceneStatus(sceneStatusMessage(refused)); return refused }
    this.sharing.dismissNotice()
    this.lastAddBefore = null
    const outcome = await addCatalogueRecordsToScene({
      getState: () => this.store.getState(),
      commit: (next) => {
        this.lastAddBefore = { state: this.store.getState(), provenance: new Map(this.groupProvenance) }
        this.commitState(next)
      },
      resolveRecords: (ids, resolveOptions) => this.catalogue.resolveRecords(ids, resolveOptions),
      pendingIds: this.pendingCatalogueAdds,
    }, catalogIds, options)
    const before = this.addBaseline()
    if (outcome.kind === 'added' && before) this.recordUndo(before.state, before.provenance, 'realObjects')
    // A catalogue object's NORAD id is public data about the
    // object, not the visitor. A whole-group add is one group event instead.
    if (outcome.kind === 'added' && options.source && options.source !== 'group') for (const added of outcome.added) recordUsage({ type: 'object_added', source: options.source, norad: added.catalogId })
    this.ui.setSceneStatus(sceneStatusMessage(outcome))
    if (!jumpToEpoch || outcome.kind !== 'added' || outcome.added.length !== 1 || outcome.alreadyPresent.length !== 0) return outcome
    const ids = outcome.added.map((item) => item.catalogId)
    try {
      const resolved = await this.catalogue.resolveRecords(ids)
      const first = resolved.records[0]
      if (first?.EPOCH && this.store.getState().activeMode === 'realObjects') {
        this.clock.setInstant({ unixSeconds: Date.parse(first.EPOCH) / 1000 })
        this.runtime.clearGroundTrackHistories()
        const state = this.store.getState()
        this.commitState({ ...state, simulation: { ...state.simulation, currentInstant: this.clock.currentInstant() } })
      }
    } catch { /* the add itself has already completed; the epoch jump is optional presentation */ }
    return outcome
  }

  private setPreset(id: string): void {
    if (!this.ready || this.disposed) return
    const state = this.store.getState()
    const preset = ORBIT_PRESETS.find((candidate) => candidate.id === id)
    const current = singleSelectedObject(state.orbitLab.scene)
    if (!preset || !current || current.source.kind !== 'keplerian') return
    const object = createObjectFromPreset(preset, { id: current.id, name: current.name, colorHex: current.style.colorHex }, this.clock.currentInstant())
    this.lockStatus = { kind: 'none' }
    this.commitState(setLastConstraint(updateObject(state, current.id, () => object), { kind: 'none' }))
    if (state.activeMode === 'orbitLab') this.requestFit()
  }

  /** A new Orbit Lab object's id, colour (from the kind's family) and name. */
  private nextOrbitIdentity(state: AppState, kind: OrbitCreationKind): { readonly id: string; readonly name: string; readonly colorHex: number } {
    while (allSceneObjectIds(state).has(`orbit-${this.nextObjectSequence}`)) this.nextObjectSequence += 1
    const sequence = this.nextObjectSequence++
    const palette = ORBIT_CREATION_PALETTES[kind]
    return { id: `orbit-${sequence}`, name: createRandomOrbitName(state.orbitLab.scene.objects.map((object) => object.name)), colorHex: palette[(sequence - 1) % palette.length] }
  }

  private createOrbit(kind: OrbitCreationKind): void {
    if (!this.ready || this.disposed) return
    const state = this.store.getState(); if (remainingCapacity(state.orbitLab.scene) === 0) return
    const presetId = kind === 'heo' ? 'elliptical' : kind
    const preset = ORBIT_PRESETS.find((candidate) => candidate.id === presetId)
    if (!preset) return
    const created = createObjectFromPreset(preset, this.nextOrbitIdentity(state, kind), this.clock.currentInstant())
    recordUsage({ type: 'orbit_created', preset: kind })
    const object = { ...created, display: { ...created.display, groundTrackVisible: false, groundTrackHistoryRecording: false, sensorGeometryVisible: false } }
    this.addCreatedOrbit(state, object, false)
    if (state.activeMode === 'orbitLab') {
      // Creating an orbit is a workspace action. Keep that workspace visible
      // on narrow screens so the learner can immediately edit the new object.
      if (this.shell.narrowViewport && this.presentation.presentation === 'desktop') this.setShell({ ...this.shell, leftDrawerOpen: true, inspectorOpen: false })
    }
  }

  /** A mobile example card creates a new orbit from the
   *  preset instead of replacing the selected one. It carries the preset's
   *  canonical note and display defaults, so it shares exactly like a
   *  desktop preset object. */
  private createOrbitFromExample(presetId: OrbitPresetId): void {
    if (!this.ready || this.disposed) return
    const state = this.store.getState(); if (remainingCapacity(state.orbitLab.scene) === 0) return
    const preset = ORBIT_PRESETS.find((candidate) => candidate.id === presetId)
    if (!preset) return
    // Like Set orbit on desktop, a preset starts without a lock status line.
    recordUsage({ type: 'orbit_created', preset: presetId })
    this.addCreatedOrbit(state, createObjectFromPreset(preset, this.nextOrbitIdentity(state, EXAMPLE_COLOR_FAMILIES[presetId]), this.clock.currentInstant()), true)
  }

  private addCreatedOrbit(state: AppState, object: OrbitalObject, resetLockStatus: boolean): void {
    const provenance = new Map(this.groupProvenance)
    if (resetLockStatus) this.lockStatus = { kind: 'none' }
    this.commitState(setOrbitLabDrawerTab(addObjectToMode(state, 'orbitLab', object), 'edit'))
    if (this.recordUndo(state, provenance, 'orbitLab')) this.ui.announceSceneChange({ kind: 'created', name: object.name })
    if (state.activeMode === 'orbitLab') this.requestFit()
  }

  /** The state just before the last catalogue add committed, if it did. */
  private addBaseline(): UndoBaseline | null { return this.lastAddBefore }

  /** Keeps at most one undoable change, recorded around
   *  adds, removals and orbit creation. True when a change was recorded. */
  private recordUndo(before: AppState, provenanceBefore: ReadonlyMap<string, readonly GroupMembership[]>, mode: ProductMode): boolean {
    const entry = recordSceneChange(before, this.store.getState(), mode)
    if (!entry) return false
    // A group add also gives members already in the scene its provenance, so
    // the provenance of every object in either scene is kept.
    const provenance = new Map<string, readonly GroupMembership[]>()
    for (const id of undoObjectIds(entry)) { const memberships = provenanceBefore.get(id); if (memberships) provenance.set(id, memberships) }
    this.undo = { entry, provenance }
    return true
  }

  /** Restores the recorded scene, selection and group provenance exactly;
   *  removed objects come back from their stored values, with no request. */
  private undoSceneChange(): void {
    const undo = this.undo
    if (!undo || !this.ready || this.disposed) return
    this.undo = null
    const state = this.store.getState()
    if (!canUndo(undo.entry, state)) { this.ui.withdrawUndo(); return }
    for (const id of undoObjectIds(undo.entry)) {
      const memberships = undo.provenance.get(id)
      if (memberships) this.groupProvenance.set(id, memberships)
      else this.groupProvenance.delete(id)
    }
    this.ui.setGroupProvenance(new Map(this.groupProvenance))
    let next = undoSceneChange(undo.entry, state)
    if (undo.entry.mode === 'orbitLab') next = setLastConstraint(next, { kind: 'none' })
    this.lockStatus = { kind: 'none' }
    this.commitState(next)
  }

  /** 2D/3D on mobile: map visibility and maximization together, in one state
   *  commit and one shell change. */
  private changeMapView(view: '3d' | 'map'): void {
    if (!this.ready || this.disposed) return
    const visible = view === 'map'
    if (visible) recordUsage({ type: 'view', which: 'map-maximized' })
    this.commitState(setGroundTrackMapVisible(this.store.getState(), visible))
    this.setShell({ ...this.shell, mapMaximized: visible })
  }

  /** The present members of an official group in the
   *  loaded index, as the desktop whole-group add resolves them. */
  private officialGroupMembers(groupId: string): readonly string[] {
    const page = this.groupInjection.discoveryPages.find((candidate) => candidate.membership.kind === 'official-group' && candidate.membership.groupId === groupId)
    return page ? this.catalogue.discoveryPage(page.id)?.catalogIds ?? [] : []
  }

  /** The featured picks present in the loaded index,
   *  with whether each is already in the Real Objects scene. */
  private publishFeaturedPicks(): void {
    const snapshot = this.catalogue.snapshot
    if (!snapshot) { this.ui.renderFeaturedPicks([]); return }
    if (this.indexIds?.snapshotId !== snapshot.manifest.snapshotId) this.indexIds = { snapshotId: snapshot.manifest.snapshotId, ids: new Set(snapshot.index.entries.map((entry) => entry.catalogId)) }
    const inScene = new Set<string>()
    for (const object of this.store.getState().realObjects.scene.objects) { const id = catalogueIdOfSceneObject(object); if (id) inScene.add(id) }
    const ids = this.indexIds.ids
    this.ui.renderFeaturedPicks(FEATURED_PICKS.filter((pick) => ids.has(pick.catalogId)).map((pick) => ({ ...pick, inScene: inScene.has(pick.catalogId) })))
  }

  /** The education page's live facts, from the
   *  records of the group's members present in the loaded catalogue. */
  private async loadGroupFacts(groupId: string): Promise<GroupOrbitFacts | null> {
    if (!this.ready || this.disposed || !this.catalogue.snapshot) return null
    const members = this.officialGroupMembers(groupId)
    if (members.length === 0) return null
    const resolved = await this.catalogue.resolveRecords(members)
    return groupOrbitFacts(resolved.records)
  }

  private publishOfficialGroups(): void {
    if (this.disposed) return
    this.publishFeaturedPicks()
    if (this.presentation.presentation !== 'mobile') return
    const loaded = this.catalogue.snapshot !== null
    this.ui.renderOfficialGroups(officialGroupTiles(this.groupInjection.groupDefinitions, (groupId) => loaded ? this.officialGroupMembers(groupId) : null, this.store.getState().realObjects.scene))
  }

  /** One tap adds through the existing atomic path.
   *  A new object is selected, revealed and fitted; one already present is
   *  selected and revealed. The clock never jumps to an element epoch. */
  private async addCatalogueObjectOnMobile(catalogId: string, source: 'quick-search' | 'featured'): Promise<AddCatalogueRecordsOutcome> {
    const outcome = await this.addCatalogueRecords([catalogId], false, { source })
    if (!this.ready || this.disposed) return outcome
    if (outcome.kind === 'already-present') this.interaction.reveal(outcome.objects.map((object) => object.sceneId))
    if (outcome.kind === 'added') {
      this.interaction.reveal(outcome.added.map((object) => object.sceneId))
      // Announce only this add's own entry, never an older one.
      if (this.undo?.entry.mode === 'realObjects' && this.undo.entry.after === this.store.getState().realObjects.scene) this.ui.announceSceneChange({ kind: 'added', name: outcome.added[0]?.name ?? catalogId })
      this.requestFit()
    }
    return outcome
  }

  /** A whole-group add with its shared colour and
   *  provenance. Mobile has no multi-selection, so the selection is cleared
   *  and the members are revealed. */
  private async addOfficialGroupOnMobile(groupId: string): Promise<AddCatalogueRecordsOutcome> {
    const group = catalogueGroupById(groupId, this.groupInjection.groupDefinitions)
    const members = this.catalogue.snapshot ? this.officialGroupMembers(groupId) : []
    if (!group || members.length === 0) return { kind: 'failed', reason: { kind: 'group-unavailable' } }
    const outcome = await this.addCatalogueGroup(groupId, members)
    if (!this.ready || this.disposed) return outcome
    const present = outcome.kind === 'added' ? [...outcome.added, ...outcome.alreadyPresent] : outcome.kind === 'already-present' ? outcome.objects : []
    if (present.length === 0) return outcome
    const before = outcome.kind === 'added' ? this.addBaseline() : null
    this.clearSceneSelection()
    this.interaction.reveal(present.map((object) => object.sceneId))
    if (outcome.kind === 'added') {
      if (before && this.recordUndo(before.state, before.provenance, 'realObjects')) this.ui.announceSceneChange({ kind: 'addedGroup', groupId, title: group.title, count: outcome.added.length })
      this.requestFit()
    }
    return outcome
  }

  /** Containment follows the ruler. While Size or
   *  Shape is adjusted the camera moves out just enough to keep the edited
   *  orbit in the visible region; when the adjustment ends a small orbit is
   *  brought back into view, unless the learner turned or zoomed meanwhile. */
  private adjustShape(phase: 'start' | 'end', parameter: ShapeAdjustParameter): void {
    if (!this.ready || this.disposed) return
    if (phase === 'start') { this.shapeAdjustment = { parameter, learnerMovedView: false }; return }
    this.containEditedOrbit('end')
    this.shapeAdjustment = null
  }

  private containEditedOrbit(phase: ShapeAdjustPhase): void {
    const adjustment = this.shapeAdjustment
    if (!adjustment || (adjustment.parameter !== 'size' && adjustment.parameter !== 'shape')) return
    const object = getSelectedObject(this.store.getState())
    if (!object || object.source.kind !== 'keplerian') return
    const canvas = this.sceneRoot.renderer.domElement.getBoundingClientRect()
    const region = this.ui.framingInsets(canvas)
    if (!region) return
    const radius = orbitCollectionRadius([object], false)
    const fit = calculateRegionFit({ radiusRenderUnits: radius, verticalFovRad: degToRad(this.sceneRoot.camera.fov),
      viewportWidthCssPx: canvas.width, viewportHeightCssPx: canvas.height, insetLeftCssPx: region.left, insetRightCssPx: region.right,
      insetTopCssPx: region.top, insetBottomCssPx: region.bottom, minDistance: this.sceneRoot.controls.minDistance })
    if (!fit) return
    const distance = containmentDistance(this.sceneRoot.cameraDistance, fit.distance, phase, adjustment.learnerMovedView)
    if (distance === null) return
    this.sceneRoot.easeDistance(distance, radius, phase === 'during' || this.reducedMotion() ? 0 : CONTAINMENT_EASE_MS)
  }

  /** Asks for the device location only on the
   *  learner's own tap, and forgets it when switched off. Approximate
   *  accuracy is enough; a denied or failed request shows one line. */
  private changeMyPlace(on: boolean): void {
    if (!this.ready || this.disposed) return
    const request = ++this.myPlaceRequest
    this.observer = null
    if (!on) { this.setMyPlace('off'); return }
    const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation
    if (!geolocation) { this.setMyPlace('failed'); return }
    this.setMyPlace('locating')
    geolocation.getCurrentPosition((position) => {
      if (request !== this.myPlaceRequest || this.disposed) return
      const { latitude, longitude } = position.coords
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) { this.setMyPlace('failed'); return }
      this.observer = { geodeticLatitudeRad: degToRad(latitude), longitudeRad: degToRad(longitude) }
      this.setMyPlace('on')
    }, () => {
      if (request !== this.myPlaceRequest || this.disposed) return
      this.setMyPlace('failed')
    }, { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 20_000 })
  }

  private setMyPlace(status: MyPlaceStatus): void {
    this.myPlaceStatus = status
    this.myPlaceMarker.set(this.observer ? observerPositionEarthFixedKm(this.observer) : null)
    this.map.setObserver(this.observer)
    this.ui.setMyPlaceStatus(status)
    if (!this.ready) return
    const instant = this.clock.currentInstant()
    const orientation = this.applyEnvironment(instant)
    this.updateReadouts(this.runtime.updateAt(instant, orientation, performance.now()), instant, performance.now(), true)
  }

  /** The selected object's elevation above the learner's horizon, while My place is on. */
  private observerElevation(sample: ObjectFrameSample, environment: EnvironmentState): number | null {
    if (!this.observer) return null
    return elevationAngleRad(this.observer, applyMat3(environment.orientation.projectInertialToEarthFixed, sample.state.positionProjectInertialKm))
  }

  /** Editing any element re-anchors the epoch first, so the drawn orbit does not
   *  jump after simulated days of drift, and the Sun-synchronous lock is
   *  resolved in one place rather than per control. */
  private changeGeometry(field: EditedGeometryField, value: number): void {
    if (!Number.isFinite(value)) return
    const state = this.store.getState()
    const current = getSelectedObject(state)
    const definition = geometryControlDefinitions.find((candidate) => candidate.field === field)
    if (!current || current.source.kind !== 'keplerian' || !definition) return
    const min = definition.unit === 'deg' ? degToRad(definition.min) : definition.min
    const max = definition.unit === 'deg' ? degToRad(definition.max) : definition.max
    const result = applyGeometryEdit(current, field, value, { min, max }, this.clock.currentInstant())
    this.lockStatus = result.status
    this.commitState(setLastConstraint(updateObject(state, current.id, () => result.object), result.constraint))
    this.containEditedOrbit('during')
  }

  private changePropagation(kind: PropagationModel['kind']): void {
    const state = this.store.getState()
    const current = getSelectedObject(state)
    if (!current || current.propagation.kind === kind) return
    if (current.source.kind === 'keplerian' && kind === 'sgp4') return
    if (isSgp4Source(current.source) && kind !== 'sgp4') return
    const next = kind === 'idealTwoBody' ? { kind: 'idealTwoBody' as const }
      : kind === 'j2Secular' ? { kind: 'j2Secular' as const }
        : { kind: 'sgp4' as const }
    const result = switchPropagation(current, next, this.clock.currentInstant())
    this.lockStatus = result.status
    this.commitState(setLastConstraint(updateObject(state, current.id, () => result.object), { kind: 'none' }))
  }

  private changeSunSynchronousLock(enabled: boolean): void {
    const state = this.store.getState()
    const current = getSelectedObject(state)
    if (!current || current.source.kind !== 'keplerian' || current.propagation.kind === 'sgp4') return
    const result = setSunSynchronousLock(current, enabled, this.clock.currentInstant())
    this.lockStatus = result.status
    this.commitState(setLastConstraint(updateObject(state, current.id, () => result.object), { kind: 'none' }))
  }

  private changePhase(value: number): void {
    if (!Number.isFinite(value)) return
    const state = this.store.getState()
    const current = getSelectedObject(state)
    if (!current || current.source.kind !== 'keplerian') return
    const instant = this.clock.currentInstant()
    // Re-anchor the elements first, so moving the body along a drifting orbit
    // keeps the plane where it is now instead of rewinding it to the epoch.
    const source = reanchorSource(current.source, current.propagation, instant)
    if (source.kind !== 'keplerian') return
    const phase = phaseFromTrueAnomaly(source.geometry.eccentricity, clamp(value, 0, Math.PI * 2), instant)
    const next = updateObject(state, current.id, (object) => ({ ...object, source: { ...source, phase } }))
    this.commitState(setLastConstraint(next, { kind: 'none' }))
  }

  /** Replaces only `mode`'s scene in one commit, sets
   *  the opening clock and resets everything that belonged to the old scene. */
  private applySharedScene(mode: ProductMode, resolved: ResolvedSceneDocument): void {
    if (!this.ready || this.disposed) return
    // A link can be the first entry into Real Objects; like any
    // first entry it then follows real time at 1×. Later opens keep the speed.
    const firstRealObjectsVisit = mode === 'realObjects' && !this.realObjectsVisited
    if (mode === 'realObjects') this.realObjectsVisited = true
    const opened = applySharedSceneToState(this.store.getState(), mode, resolved, Date.now())
    this.clock.setInstant(opened.simulation.currentInstant)
    this.clock.playing = opened.simulation.playing
    const next: AppState = { ...opened, simulation: { ...opened.simulation, currentInstant: this.clock.currentInstant() } }
    // The clock jumps, so recorded trails restart.
    this.runtime.clearGroundTrackHistories()
    if (mode === 'realObjects' && this.groupProvenance.size > 0) { this.groupProvenance.clear(); this.ui.setGroupProvenance(new Map()) }
    this.lockStatus = { kind: 'none' }
    const openedShell = shellAfterMapVisibilityChange(setCatalogueWorkspaceOpen(this.shell, false), next.view.groundTrackMapVisible)
    // On mobile the map is only ever the full-screen alternative view.
    this.setShell(this.presentation.presentation === 'mobile' ? { ...openedShell, mapMaximized: next.view.groundTrackMapVisible } : openedShell)
    this.commitState(next)
    this.interaction.reset()
    const scene = activeScene(next)
    this.runtime.requestGroundTrackRefresh(scene.selection.primaryId)
    if (scene.objects.length > 0) this.requestFit()
    if (firstRealObjectsVisit) this.goLive(true)
  }

  /** Fits the camera to the scene, or to `ids` (Fit selected, 4.8). */
  private requestFit(ids: readonly string[] | null = null): void {
    if (!this.ready || this.disposed) return
    // On mobile a fit never closes a panel: framing already accounts for it.
    if (this.presentation.presentation === 'desktop') this.setShell(shellForCameraFit(this.shell))
    this.retryFitOnResize = false
    this.fitIds = ids
    if (this.fitFrame !== undefined) return
    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = undefined
      if (this.disposed) return
      const objects = activeScene(this.store.getState()).objects
      const chosen = this.fitIds === null ? objects : objects.filter((object) => this.fitIds!.includes(object.id))
      if (!this.fitNow(chosen.length > 0 ? chosen : objects)) this.retryFitOnResize = true
    })
  }

  /** Fits the camera to `objects` immediately; false when the view has no usable size. */
  private fitNow(objects: readonly OrbitalObject[]): boolean {
    const canvas = this.sceneRoot.renderer.domElement.getBoundingClientRect()
    const radius = orbitCollectionRadius(objects)
    // Mobile fits into the visible region it reports.
    const region = this.ui.framingInsets(canvas)
    if (region) {
      const fit = calculateRegionFit({ radiusRenderUnits: radius, verticalFovRad: degToRad(this.sceneRoot.camera.fov),
        viewportWidthCssPx: canvas.width, viewportHeightCssPx: canvas.height, insetLeftCssPx: region.left, insetRightCssPx: region.right,
        insetTopCssPx: region.top, insetBottomCssPx: region.bottom, minDistance: this.sceneRoot.controls.minDistance })
      if (fit === null) return false
      this.sceneRoot.setFramingOffset(fit.offsetXCssPx, fit.offsetYCssPx, this.reducedMotion() ? 0 : FRAMING_EASE_MS)
      this.sceneRoot.fitDistance(fit.distance, radius)
      return true
    }
    const insets = occlusionInsets(canvas, this.ui.getOccludingRects())
    const distance = calculateFitDistance({ radiusRenderUnits: radius, verticalFovRad: degToRad(this.sceneRoot.camera.fov),
      viewportWidthCssPx: canvas.width, viewportHeightCssPx: canvas.height, insetLeftCssPx: insets.left, insetRightCssPx: insets.right,
      insetTopCssPx: insets.top, insetBottomCssPx: insets.bottom,
      minDistance: this.sceneRoot.controls.minDistance })
    if (distance === null) return false
    this.sceneRoot.fitDistance(distance, radius)
    return true
  }

  /** Dev-only scale harness surface. Production code
   *  never calls this; the harness module that does is not bundled there. */
  measurementTarget(): SceneMeasurementTarget {
    const readBack = new Uint8Array(4)
    return {
      replaceRealObjectsScene: (objects) => {
        let state = this.store.getState()
        if (state.activeMode !== 'realObjects') state = setActiveMode(state, 'realObjects')
        this.commitState(withScene(state, 'realObjects', { objects, selection: { ids: [], primaryId: null } }))
        this.fitNow(objects)
      },
      setSpeed: (speedMultiplier) => {
        this.clock.speedMultiplier = speedMultiplier
        this.clock.playing = true
        const state = this.store.getState()
        this.commitState({ ...state, simulation: { ...state.simulation, speedMultiplier, playing: true } })
      },
      setMapOpen: (open) => {
        this.commitState(setGroundTrackMapVisible(this.store.getState(), open))
        this.setShell(shellAfterMapVisibilityChange(this.shell, open))
      },
      setMapMaximized: (maximized) => { if (this.shell.mapMaximized !== maximized) this.setShell(toggleMapMaximized(this.shell)) },
      // The same steps as advanceSimulationFrame, timed by phase.
      stepFrame: (deltaSeconds, nowMs, wallNowMs) => {
        const t0 = performance.now()
        this.clock.advance(deltaSeconds, wallNowMs)
        const instant = this.clock.currentInstant()
        this.frameDependencies.publishInstant(instant)
        const orientation = this.applyEnvironment(instant)
        const samples = this.runtime.updateAt(instant, orientation, nowMs)
        const t1 = performance.now()
        this.updateReadouts(samples, instant, nowMs)
        const t2 = performance.now()
        this.interaction.frame(performance.now())
        if (!this.mapCoversScene()) { this.updateGuides(); this.sceneRoot.render(); this.updatePrimaryLabel() }
        const t3 = performance.now()
        this.map.render()
        const t4 = performance.now()
        return { total: t4 - t0, simulation: t1 - t0, readouts: t2 - t1, scene3d: t3 - t2, map: t4 - t3 }
      },
      finishGpu: () => {
        const gl = this.sceneRoot.renderer.getContext()
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, readBack)
      },
      pauseRenderLoop: () => { this.stopRenderLoop?.(); this.stopRenderLoop = undefined },
      resumeRenderLoop: () => {
        if (this.stopRenderLoop || this.disposed) return
        this.stopRenderLoop = this.startFrames()
      },
      rendererInfo: () => {
        const info = this.sceneRoot.renderer.info
        return { calls: info.render.calls, geometries: info.memory.geometries, textures: info.memory.textures }
      },
      mapCanvasStats: () => this.map.canvasStats(),
      select: (id) => this.selectSceneObject(id, 'only'),
      syncViewportSize: () => { this.sceneRoot.resize(); this.map.invalidateLayout() },
      screenPositionOf: (id, surface) => {
        if (surface === 'map') {
          const local = this.map.markerPosition(id)
          const rect = this.map.frameElement.getBoundingClientRect()
          return local ? { x: rect.left + local.x, y: rect.top + local.y } : null
        }
        let position: { readonly x: number; readonly y: number; readonly z: number } | null = null
        for (const port of this.runtime.viewPorts()) if (port.id === id) position = port.body.pickPositionRender?.() ?? null
        const canvas = this.sceneRoot.renderer.domElement
        const projected = position ? this.picker.project(position, { width: canvas.clientWidth, height: canvas.clientHeight }) : null
        const rect = canvas.getBoundingClientRect()
        return projected ? { x: rect.left + projected.x, y: rect.top + projected.y } : null
      },
      lastHoverPickMs: () => this.interaction.lastHoverPickMs,
      selectAllAndReveal: () => {
        const ids = activeScene(this.store.getState()).objects.map((object) => object.id)
        this.setSceneSelection({ ids, primaryId: ids[0] ?? null })
        this.interaction.reveal(ids)
      },
      pathScreenPoint: (id, fraction) => {
        let polyline: Float32Array | undefined
        for (const port of this.runtime.viewPorts()) if (port.id === id) polyline = port.path.pickPolylinesRender?.()[0]
        if (!polyline || polyline.length < 3) return null
        const index = Math.min(polyline.length / 3 - 1, Math.max(0, Math.round(fraction * (polyline.length / 3 - 1))))
        const canvas = this.sceneRoot.renderer.domElement
        const projected = this.picker.project({ x: polyline[index * 3], y: polyline[index * 3 + 1], z: polyline[index * 3 + 2] }, { width: canvas.clientWidth, height: canvas.clientHeight })
        const rect = canvas.getBoundingClientRect()
        return projected ? { x: rect.left + projected.x, y: rect.top + projected.y } : null
      },
      viewport: () => {
        const canvas = this.sceneRoot.renderer.domElement
        return { width: canvas.clientWidth, height: canvas.clientHeight, devicePixelRatio: window.devicePixelRatio || 1 }
      },
      projectRenderPoint: (point) => {
        const canvas = this.sceneRoot.renderer.domElement
        const projected = this.picker.project(point, { width: canvas.clientWidth, height: canvas.clientHeight }, false, false)
        const rect = canvas.getBoundingClientRect()
        return projected ? { x: rect.left + projected.x, y: rect.top + projected.y } : null
      },
      cameraDistance: () => this.sceneRoot.cameraDistance,
      visibleRegion: () => {
        const canvas = this.sceneRoot.renderer.domElement.getBoundingClientRect()
        const insets = this.ui.framingInsets(canvas)
        return insets ? { left: canvas.left + insets.left, top: canvas.top + insets.top, right: canvas.right - insets.right, bottom: canvas.bottom - insets.bottom } : null
      },
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.ready = false
    this.narrowViewportQuery.removeEventListener('change', this.onViewportChange)
    this.stopRenderLoop?.()
    this.sceneRoot.controls.removeEventListener('start', this.onControlsStart)
    this.presentation.dispose()
    this.interaction.dispose()
    this.chooser.dispose()
    this.labels.dispose()
    this.guides.dispose()
    this.myPlaceMarker.dispose()
    this.myPlaceRequest += 1
    this.observer = null
    if (this.fitFrame !== undefined) cancelAnimationFrame(this.fitFrame)
    this.retryFitOnResize = false
    this.runtime.dispose()
    this.sharing.dispose()
    this.catalogue.dispose()
    this.map.dispose()
    for (const view of this.starFieldViews) view.dispose()
    this.disposeEarth?.()
    this.countryBorders?.view.dispose()
    this.earthMapTexture?.dispose()
    this.sceneRoot.dispose()
    this.ui.dispose()
  }
}
