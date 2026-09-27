import { afterAll, bench, describe } from 'vitest'
import { MAX_SPEED_MULTIPLIER, SIMULATION_START_INSTANT } from '../core/constants.ts'
import { OrbitalObjectRuntime, type RuntimeFactories } from '../app/OrbitalObjectRuntime.ts'
import { sampleSgp4Trajectory } from '../orbital/sampledTrajectory.ts'
import { earthOrientationAt } from '../simulation/earthOrientation.ts'
import { sampleGroundTrack } from '../simulation/groundTrack.ts'
import { createPropagator, type OrbitalObject } from '../simulation/OrbitalObject.ts'
import { createSyntheticScene, type SyntheticLayers } from '../test-fixtures/syntheticScene.ts'
import { measureFreshness } from './sceneFreshness.ts'
import { benchSceneInteraction } from './sceneInteraction.bench-support.ts'

/** Node bench for scene scale (`npm run measure:scene`). Views are no-op
 *  ports, so these are simulation and scheduling costs only; frame timing is
 *  the browser harness's job. */

const SIZES = [8, 25, 50, 100, 150] as const
const options = { time: 0, iterations: 30, warmupIterations: 5 } as const
const samples = new Map<string, number[]>()

const noopFactories: Omit<RuntimeFactories, 'createPropagator'> = {
  createBody: () => ({ update() {}, setVisible() {}, setSize() {}, setZoomScaling() {}, setColor() {}, setOpacity() {}, dispose() {} }),
  createPath: () => ({ kind: 'sampled', rebuildShape() {}, setOrientation() {}, setSegments() {}, setVisible() {}, setColor() {}, setSelected() {}, dispose() {} }),
  createGroundTrack: () => ({ setCurrent() {}, setWindow() {}, setHistory() {}, setVisible() {}, setColor() {}, setSelected() {}, dispose() {} }),
  createSensorGeometry: () => ({ setGeometry() {}, setVisible() {}, setColor() {}, setSelected() {}, dispose() {} }),
}

function measured(name: string, operation: () => void): void {
  bench(name, () => {
    const started = performance.now()
    operation()
    const list = samples.get(name) ?? []
    list.push(performance.now() - started)
    samples.set(name, list)
  }, options)
}

function objects(count: number, layers: SyntheticLayers = {}): OrbitalObject[] { return createSyntheticScene(count, layers).map((item) => item.object) }

/** A runtime that has already run one second of frames, so a measured frame
 *  is a steady-state frame rather than the first fill of every cache. */
function warmRuntime(scene: readonly OrbitalObject[], speed: number): { frame: () => void } {
  const runtime = new OrbitalObjectRuntime({ ...noopFactories, createPropagator })
  runtime.reconcile(scene, null)
  let frame = 0
  const step = (): void => {
    const nowMs = frame * 1000 / 60
    const instant = { unixSeconds: SIMULATION_START_INSTANT.unixSeconds + frame / 60 * speed }
    runtime.updateAt(instant, earthOrientationAt(instant), nowMs)
    frame += 1
  }
  for (let index = 0; index < 60; index += 1) step()
  return { frame: step }
}

for (const size of SIZES) {
  describe(`scene scale N=${size}`, () => {
    const defaults = objects(size)
    measured(`N=${size} reconcile (create all views)`, () => {
      const runtime = new OrbitalObjectRuntime({ ...noopFactories, createPropagator })
      runtime.reconcile(defaults, null)
      runtime.dispose()
    })
    const layerCases: readonly [string, SyntheticLayers][] = [
      ['default layers', {}],
      ['all ground tracks', { groundTrack: true }],
      ['all history recording', { groundTrackHistory: true }],
      ['all sensor geometry', { sensorGeometry: true }],
    ]
    for (const [label, layers] of layerCases) {
      for (const speed of [1, 60, MAX_SPEED_MULTIPLIER]) {
        const runtime = warmRuntime(objects(size, layers), speed)
        measured(`N=${size} updateAt, ${label}, ${speed}x`, runtime.frame)
      }
    }
  })
}

describe('single rebuild costs', () => {
  const [leo] = objects(1)
  const propagator = createPropagator(leo.source, leo.propagation)
  const centreInstant = SIMULATION_START_INSTANT
  const currentState = propagator.stateAt(centreInstant)
  const period = leo.source.kind === 'keplerian' ? 5400 : leo.source.definition.meanElements.nominalPeriodSeconds
  measured('one ground-track window rebuild (LEO, 2 x 257 samples)', () => {
    sampleGroundTrack({ centreInstant, nominalPeriodSeconds: period, currentState, currentOrientation: earthOrientationAt(centreInstant), stateAt: (at) => propagator.stateAt(at), earthOrientationAt })
  })
  measured('one sampled-path rebuild (LEO, 257 samples)', () => {
    sampleSgp4Trajectory({ centreInstant, nominalPeriodSeconds: period, currentState, stateAt: (at) => propagator.stateAt(at) })
  })
})

benchSceneInteraction(measured)

afterAll(() => {
  for (const [name, all] of samples) {
    const sorted = all.slice(-options.iterations).sort((a, b) => a - b)
    const median = sorted[Math.ceil(sorted.length * 0.5) - 1]
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]
    console.log(`[scene samples] ${name}: n=${sorted.length} median=${median.toFixed(3)}ms p95=${p95.toFixed(3)}ms`)
  }
  for (const size of [8, 100]) {
    for (const speed of [1, 60, MAX_SPEED_MULTIPLIER]) {
      const paths = measureFreshness(objects(size), { speed, seconds: 20 })
      const tracks = measureFreshness(objects(size, { orbitPath: false }), { speed, seconds: 20, groundTracks: true })
      console.log(`[scene freshness] N=${size} ${speed}x: path outside ${paths.pathOutside}/${paths.pathObjectFrames} object-frames (worst lag ${paths.worstPathLag.toFixed(2)} half-widths); track outside ${tracks.trackOutside}/${tracks.trackObjectFrames}`)
    }
  }
})
