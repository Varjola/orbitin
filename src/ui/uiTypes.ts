import type { SimulationInstant } from '../core/time.ts'
import type { GroupOrbitFacts } from '../data/groupOrbitFacts.ts'
import type { ElementConstraint, EditedGeometryField, DerivedOrbitValues } from '../orbital/geometry.ts'
import type { AngleReadout, ElementConditioning } from '../orbital/elementConditioning.ts'
import type { AngleRates, PropagationModel } from '../simulation/OrbitalObject.ts'
import type { OrbitSunGeometry } from '../simulation/orbitSunGeometry.ts'
import type { SunSynchronousStatus } from '../simulation/propagationTransitions.ts'
import type { SubSatellitePoint } from '../simulation/groundTrack.ts'
import type { InstantaneousSensorGeometry } from '../simulation/sensorFootprint.ts'
import type { TleDefinition } from '../data/tle.ts'
import type { OmmDefinition } from '../data/omm.ts'
import type { LinkedMode } from '../data/modeLink.ts'
import type { OrbitPropagationError } from '../orbital/propagationError.ts'
import type { SamplingBand } from '../app/samplingPresentation.ts'
import type { EarthStyle, OrbitLabDrawerTab, ProductMode, SceneBackdrop, SceneSelection } from '../state/AppState.ts'
import type { BudgetedLayer } from '../state/sceneComplexity.ts'
import type { CatalogueQuery } from '../data/catalogueQuery.ts'
import type { AddCatalogueRecordsOutcome } from '../state/catalogueAdditionOutcome.ts'
import type { SceneSelectionIntent } from './sceneSelectionIntent.ts'
import type { SharedSceneSummary } from '../data/sharedScene.ts'
import type { RoutePlaybackSpeed } from '../simulation/route/routePlayback.ts'
import type { SceneLinkAvailability, SceneLinkUnavailable } from '../data/sceneLink.ts'
import type { Locale } from '../i18n/index.ts'
import type { OrbitPresetId } from '../simulation/orbitPresets.ts'
import type { BurnDirection } from '../simulation/maneuverGame.ts'
import type { ManeuverDisplay } from './maneuverPanelModel.ts'
import type { RouteTryId } from '../simulation/route/routeSources.ts'
import type { RouteOrbitValues } from '../simulation/route/routeObjects.ts'
import type { RouteCameraView } from '../simulation/route/routeDrawing.ts'
import type { RouteSide } from '../app/RoutePlannerController.ts'

/** Where a layer-budget refusal is explained: beside the control that asked. */
export type LayerBudgetSurface = 'inspector' | 'view' | 'bulk'

export type OrbitCreationKind = 'leo' | 'meo' | 'geo' | 'heo'

export interface UiCallbacks {
  onInstantChange: (instant: SimulationInstant) => void
  onNow: () => void
  /** Now, at 1×, playing forward. */
  onGoLive: () => void
  onReset: () => void
  onReversedChange: (reversed: boolean) => void
  onModeChange: (mode: ProductMode) => void
  onToggleLeftDrawer: () => void
  onToggleInspector: () => void
  onToggleTimeDrawer: () => void
  onToggleViewDrawer: () => void
  onToggleSceneObjects: () => void
  onOpenCatalogueWorkspace: () => void
  onCloseCatalogueWorkspace: () => void
  onOrbitLabDrawerTabChange: (tab: OrbitLabDrawerTab) => void
  onCreateOrbit: (kind: OrbitCreationKind) => void
  onImportTle: (text: string, jumpToEpoch: boolean) => void
  onImportOmm: (text: string, jumpToEpoch: boolean) => void
  onCatalogueLoad: () => void
  onCatalogueRefresh: () => void
  onCatalogueQuery: (query: CatalogueQuery) => void
  onOpenCatalogueDiscoveryPage: (pageId: string) => void
  onBrowseAllCatalogue: () => void
  onCatalogueQuickSearch: (text: string) => void
  onOpenCatalogueDetails: (catalogId: string) => void
  onOpenCatalogueViewAll: () => void
  onAddToScene: (catalogIds: readonly string[], jumpToEpoch: boolean) => void
  onQuickSearchAddToScene: (catalogId: string) => Promise<AddCatalogueRecordsOutcome>
  onCatalogueDetailsChange: (catalogId: string | null) => void
  onCatalogueDetailsRetry: (catalogId: string) => void
  onCatalogueCompareChange: (ids: readonly string[]) => void
  onCatalogueCompareRetry: (catalogId: string) => void
  onCatalogueWorkingSelectionToggle: (catalogId: string) => void
  onCatalogueWorkingSelectionClear: () => void
  onAddCatalogueSelectionToScene: (catalogIds: readonly string[]) => Promise<AddCatalogueRecordsOutcome>
  /** Whole-group add: the ordered present member ids of one official group. */
  onAddCatalogueGroupToScene: (groupId: string, catalogIds: readonly string[]) => Promise<AddCatalogueRecordsOutcome>
  onViewCatalogueScene: () => void
  onSetPreset: (id: string) => void
  onSelectSceneObject: (id: string, intent: SceneSelectionIntent) => void
  onRemoveSceneObjects: (ids: readonly string[]) => void
  onClearSceneSelection: () => void
  /** Scene Objects header action and checkbox-driven selection. */
  onSceneSelectionChange: (selection: SceneSelection) => void
  onRevealSceneObjects: (ids: readonly string[]) => void
  onBulkLayerChange: (layer: BudgetedLayer, on: boolean) => void
  onBulkColorChange: (colorHex: number) => void
  onFitSelected: () => void
  onFocusSelected: () => void
  onAllOrbitPathsVisibilityChange: (visible: boolean) => void
  onAllGroundTrackHistoriesChange: (visible: boolean) => void
  onAllSensorGeometriesVisibilityChange: (visible: boolean) => void
  onColorChange: (colorHex: number) => void
  onNameChange: (name: string) => void
  onFitVisibleOrbits: () => void
  onGeometryChange: (field: EditedGeometryField, value: number) => void
  onPhaseChange: (trueAnomalyRad: number) => void
  onPlayingChange: (playing: boolean) => void
  onSpeedChange: (speedMultiplier: number) => void
  onMarkerSizeChange: (sizeRenderUnits: number) => void
  onMarkerScalingChange: (enabled: boolean) => void
  onOrbitPathVisibilityChange: (visible: boolean) => void
  onGroundTrackVisibilityChange: (visible: boolean) => void
  onGroundTrackHistoryChange: (recording: boolean) => void
  onSensorGeometryVisibilityChange: (visible: boolean) => void
  onSensorFieldOfViewHalfAngleChange: (valueRad: number) => void
  onSensorSteeringLimitChange: (valueRad: number) => void
  onMinimumGroundElevationChange: (valueRad: number) => void
  onGroundTrackMapChange: (visible: boolean) => void
  /** The scene's look; never part of a scene file or link. */
  onEarthStyleChange: (style: EarthStyle) => void
  onOrbitLabBackdropChange: (backdrop: SceneBackdrop) => void
  onPropagationChange: (kind: PropagationModel['kind']) => void
  onSunSynchronousLockChange: (enabled: boolean) => void
  /** The active mode's shared scene, summarized for the Share dialog; never touches the catalogue. */
  onShareSceneRequested: () => SharedSceneSummary & { readonly link: SceneLinkAvailability }
  onCopySceneLink: () => Promise<{ readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: SceneLinkUnavailable }>
  /** The link to a mode's starting view; Interception and the Route Planner share nothing else. */
  onModeLinkRequested: (mode: LinkedMode) => string
  onSceneFileRequested: () => { readonly name: string; readonly text: string }
  onOpenSceneFile: (file: File) => void
  onConfirmSceneOpen: () => void
  onCancelSceneOpen: () => void
  onRetrySceneOpen: () => void
  onDismissSceneNotice: () => void
  /** Rebuild the interface in another language. */
  onLocaleChange: (locale: Locale) => void

  // Official group education pages.
  /** The live facts of an official group's members in the loaded catalogue;
   *  loads their records. Null when none is present. */
  onLoadGroupFacts: (groupId: string) => Promise<GroupOrbitFacts | null>
  /** Leaves the catalogue for Orbit Lab and creates an orbit from the example. */
  onTryOrbitLabExample: (presetId: OrbitPresetId) => void
  /** Adds a featured pick (or reveals it when present), then fits the view. */
  onAddFeaturedPick: (catalogId: string) => Promise<AddCatalogueRecordsOutcome>
  /** Opens a curated example like a pasted scene link. */
  onOpenExample: (exampleId: string) => void

  // Interception.
  /** A burn button or key went down; the burn runs until `onBurnRelease`. */
  onRouteTry: (id: RouteTryId) => void
  onRouteLiveToggle: () => void
  onRouteLiveRate: (rate: number) => void
  /** Exit playback: back to the live scene as it was when the route's search began. */
  onRouteExit: () => void
  /** Plan route: pauses the live scene and opens the planning window. */
  onRoutePlannerOpen: () => void
  /** Closes the planning window; the live scene runs on. */
  onRoutePlannerClose: () => void
  onRouteDetailsBack: () => void
  onRouteCameraView: (view: RouteCameraView) => void
  onRouteFrameBurns: (frameBurns: boolean) => void
  onRoutePlayDetails: () => void
  /** Shows the route found again. */
  onRouteViewRoute: () => void
  onRouteObjectEdit: (side: RouteSide, changes: Partial<RouteOrbitValues>) => void
  onRouteCircular: (side: RouteSide, circular: boolean) => void
  onRouteTargetAhead: (aheadDeg: number) => void
  onRouteCatalogueEnable: () => void
  onRouteSearch: (text: string) => void
  onRoutePick: (side: RouteSide, catalogId: string) => void
  onRouteSwap: () => void
  onRouteLimitTimeChange: (on: boolean) => void
  onRouteLimitFuelChange: (on: boolean) => void
  onRouteLimitChange: (seconds: number) => void
  onRouteBudgetChange: (kmPerSecond: number) => void
  onPlanRoute: () => void
  onCancelRoute: () => void
  onRoutePlayToggle: () => void
  onRouteReverseChange: (reversed: boolean) => void
  onRouteSpeedChange: (speed: RoutePlaybackSpeed) => void
  onRouteAutoplayChange: (autoplay: boolean) => void
  /** Moves playback to a place on the timeline, pausing it. */
  onRouteSeek: (tau: number) => void
  onRouteBurnStep: (direction: 1 | -1) => void
  onRouteBurnSelect: (burnIndex: number) => void
  /** Shows another route of the front. */
  onRouteSelect: (index: number) => void
  onRouteIspChange: (seconds: number) => void
  onRouteFit: () => void
  onRoutePlanesChange: (shown: boolean) => void
  onBurnPress: (direction: BurnDirection) => void
  /** Every way a held burn ends: release, a cancelled pointer, lost focus or a hidden page. */
  onBurnRelease: () => void
  onManeuverAidChange: (shown: boolean) => void
  onNewManeuverGame: () => void
  onRestartManeuverGame: () => void
  /** The altitude view or the 3D view. */
  onManeuverDisplayChange: (display: ManeuverDisplay) => void
  /** Fits the view to the game again: face-on in 3D, recentred in the altitude view. */
  onManeuverFaceOn: () => void

  // The phone presentation. Desktop never calls these.
  /** A mobile example card creates a new orbit from the preset. */
  onCreateOrbitFromExample: (presetId: OrbitPresetId) => void
  /** 2D/3D: map visibility and maximization together, in one commit. */
  onMapViewChange: (view: '3d' | 'map') => void
  /** A scene-wide layer switch, through the existing budget (surface `view`). */
  onSceneLayerChange: (layer: SceneLayer, on: boolean) => void
  /** Adds an official group's present members; the result is also announced. */
  onMobileAddGroup: (groupId: string) => Promise<AddCatalogueRecordsOutcome>
  /** Adds one catalogue object, or reveals it when it is already present. */
  onMobileAddCatalogueObject: (catalogId: string) => Promise<AddCatalogueRecordsOutcome>
  /** Asks for, or forgets, the in-memory device location. */
  onMyPlaceChange: (on: boolean) => void
  onUndoSceneChange: () => void
  /** A ruler adjustment starts or ends (containment and guides). */
  onShapeAdjust: (phase: 'start' | 'end', parameter: ShapeAdjustParameter) => void
  /** The visible region changed: recompute the framing offset. */
  onFramingChange: () => void
}

/** The scene-wide layers the mobile Layers panel switches. */
export type SceneLayer = 'orbitPath' | 'groundTrack' | 'sensorGeometry'

/** The Shape strip's chips. */
export type ShapeAdjustParameter = 'size' | 'shape' | 'tilt' | 'node' | 'periapsis' | 'position' | 'drift'

export interface DriftReadouts {
  angleRates: AngleRates
  readouts: readonly AngleReadout[]
  conditioning: ElementConditioning
  sun: OrbitSunGeometry
}

export interface ReadoutValues {
  derived: DerivedOrbitValues | null
  currentAltitudeKm: number
  currentSpeedKmPerSecond: number
  trueAnomalyRad: number
  subSatellitePoint: SubSatellitePoint | null
  groundTrackVisible: boolean
  groundTrackHistoryRecording: boolean
  sensorGeometry: InstantaneousSensorGeometry | null
  samplingBand: SamplingBand
  drift: DriftReadouts | null
  /** The object's elevation above the learner's horizon, while My place is on. */
  observerElevationRad?: number | null
  sgp4?: {
    definition: TleDefinition | OmmDefinition
    offsetSeconds: number
    warning: string
    error: OrbitPropagationError | null
    clipped: boolean
  }
}

export type UiConstraint = ElementConstraint
export type UiLockStatus = SunSynchronousStatus
