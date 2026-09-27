import type { OrbitalObject } from '../simulation/OrbitalObject.ts'

/** The narrow surface the dev-only scale harness drives.
 *
 * The harness module itself is never bundled into a production build; this
 * interface and the small adapter `Application` returns are the only parts
 * that ship, and nothing calls them outside a development build. */
export interface FramePhaseTimes {
  readonly total: number
  /** Clock, environment and runtime propagation/rebuilds. */
  readonly simulation: number
  readonly readouts: number
  readonly scene3d: number
  readonly map: number
}

export interface SceneMeasurementTarget {
  /** Replace the Real Objects scene wholesale, bypassing add-path capacity so
   *  the harness can measure scenes larger than the current cap. */
  replaceRealObjectsScene(objects: readonly OrbitalObject[]): void
  setSpeed(speedMultiplier: number): void
  setMapOpen(open: boolean): void
  setMapMaximized(maximized: boolean): void
  /** One application frame, driven synchronously, timed by phase (ms). */
  stepFrame(deltaSeconds: number, nowMs: number, wallNowMs: number): FramePhaseTimes
  /** Blocks until the GPU has finished queued work (1-pixel read-back). */
  finishGpu(): void
  pauseRenderLoop(): void
  resumeRenderLoop(): void
  rendererInfo(): { readonly calls: number; readonly geometries: number; readonly textures: number }
  mapCanvasStats(): { readonly canvases: number; readonly backingBytes: number }
  /** Selects one scene object as a plain click would, timing the commit. */
  select(id: string): void
  /** Client (viewport) position of an object's 3D or map marker, or null. */
  screenPositionOf(id: string, surface: '3d' | 'map'): { readonly x: number; readonly y: number } | null
  /** Client position of the drawn orbit-path vertex at `fraction` (0..1) of
   *  its first polyline, or null when hidden, occluded or behind the camera. */
  pathScreenPoint(id: string, fraction: number): { readonly x: number; readonly y: number } | null
  /** Selects every scene object and starts Reveal selected on all of them. */
  selectAllAndReveal(): void
  /** Milliseconds of the last coalesced hover pick. */
  lastHoverPickMs(): number
  /** Re-measures the 3D view and the map; resize observers do not fire in a hidden page. */
  syncViewportSize(): void
  viewport(): { readonly width: number; readonly height: number; readonly devicePixelRatio: number }
  /** For browser checks: client position of a render-frame point
   *  (Earth's centre is the origin), or null when hidden or behind the camera. */
  projectRenderPoint(point: { readonly x: number; readonly y: number; readonly z: number }): { readonly x: number; readonly y: number } | null
  /** The visible region the interface reports for framing, in client px, or null on desktop. */
  visibleRegion(): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | null
  /** The camera's distance from Earth's centre, in render units. */
  cameraDistance(): number
}
