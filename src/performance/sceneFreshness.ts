import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { OrbitalObjectRuntime, type GroundTrackViewPort, type PathViewPort } from '../app/OrbitalObjectRuntime.ts'
import type { GroundTrackWindow } from '../simulation/groundTrack.ts'
import { createPropagator, type OrbitalObject } from '../simulation/OrbitalObject.ts'
import { earthOrientationAt } from '../simulation/earthOrientation.ts'

/** How often a marker is drawn outside its own sampled
 *  path or ground-track window, with the real runtime scheduler and no-op
 *  views. Frames are simulated at a fixed real-time step, so the result is a
 *  deterministic property of the scheduler rather than of the machine. */
export interface FreshnessResult {
  readonly objects: number
  readonly speed: number
  readonly frames: number
  /** Object-frames whose marker instant lay outside the drawn sampled path. */
  readonly pathOutside: number
  readonly pathObjectFrames: number
  /** Object-frames whose marker instant lay outside the drawn track window. */
  readonly trackOutside: number
  readonly trackObjectFrames: number
  /** Worst marker distance from the drawn path centre, in path half-widths. */
  readonly worstPathLag: number
}

export function measureFreshness(objects: readonly OrbitalObject[], options: { readonly speed: number; readonly seconds: number; readonly frameMs?: number; readonly groundTracks?: boolean }): FreshnessResult {
  const frameMs = options.frameMs ?? 1000 / 60
  const drawnPath = new Map<string, { centre: number; halfWidth: number }>()
  const drawnTrack = new Map<string, { centre: number; halfWidth: number }>()
  const periodOf = new Map(objects.map((object) => [object.id, object.source.kind === 'keplerian' ? null : object.source.definition.meanElements.nominalPeriodSeconds]))
  const runtime = new OrbitalObjectRuntime({
    createPropagator,
    createBody: () => ({ update() {}, setVisible() {}, setSize() {}, setZoomScaling() {}, setColor() {}, setOpacity() {}, dispose() {} }),
    createPath: (object): PathViewPort => ({
      kind: 'sampled', rebuildShape() {}, setOrientation() {}, setVisible() {}, setColor() {}, setSelected() {}, dispose() {},
      setSegments: (segments) => {
        const period = periodOf.get(object.id)
        if (segments.length === 0 || !period) { drawnPath.delete(object.id); return }
        drawnPath.set(object.id, { centre: currentUnix, halfWidth: period / 2 })
      },
    }),
    createGroundTrack: (object): GroundTrackViewPort => ({
      setCurrent() {}, setVisible() {}, setColor() {}, setSelected() {}, dispose() {},
      setWindow: (window: GroundTrackWindow | null) => {
        if (!window) { drawnTrack.delete(object.id); return }
        drawnTrack.set(object.id, { centre: window.centreInstant.unixSeconds, halfWidth: window.nominalPeriodSeconds })
      },
    }),
  })
  const scene = options.groundTracks ? objects.map((object) => ({ ...object, display: { ...object.display, groundTrackVisible: true } })) : objects
  runtime.reconcile(scene, null)
  let currentUnix = SIMULATION_START_INSTANT.unixSeconds
  const frames = Math.round(options.seconds * 1000 / frameMs)
  let pathOutside = 0, pathObjectFrames = 0, trackOutside = 0, trackObjectFrames = 0, worstPathLag = 0
  for (let frame = 0; frame < frames; frame += 1) {
    const nowMs = frame * frameMs
    currentUnix = SIMULATION_START_INSTANT.unixSeconds + frame * frameMs / 1000 * options.speed
    const instant = { unixSeconds: currentUnix }
    runtime.updateAt(instant, earthOrientationAt(instant), nowMs)
    // Warm-up: the first second fills every cache once.
    if (nowMs < 1000) continue
    for (const object of scene) {
      if (object.display.orbitPathVisible) {
        pathObjectFrames += 1
        const drawn = drawnPath.get(object.id)
        const lag = drawn ? Math.abs(currentUnix - drawn.centre) / drawn.halfWidth : Infinity
        worstPathLag = Math.max(worstPathLag, lag)
        if (lag > 1) pathOutside += 1
      }
      if (object.display.groundTrackVisible || options.groundTracks) {
        trackObjectFrames += 1
        const drawn = drawnTrack.get(object.id)
        if (!drawn || Math.abs(currentUnix - drawn.centre) > drawn.halfWidth) trackOutside += 1
      }
    }
  }
  runtime.dispose()
  return { objects: objects.length, speed: options.speed, frames, pathOutside, pathObjectFrames, trackOutside, trackObjectFrames, worstPathLag }
}
