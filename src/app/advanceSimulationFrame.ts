import type { SimulationInstant } from '../core/time.ts'
import type { EarthOrientation } from '../core/referenceFrames.ts'
import type { SimulationClock } from '../simulation/SimulationClock.ts'
import type { ObjectFrameSample, OrbitalObjectRuntime } from './OrbitalObjectRuntime.ts'

export interface FrameDependencies {
  clock: Pick<SimulationClock, 'advance' | 'currentInstant'>
  runtime: Pick<OrbitalObjectRuntime, 'updateAt'>
  publishInstant(instant: SimulationInstant): void
  applyEnvironment(instant: SimulationInstant): EarthOrientation | void
  updateReadouts(samples: ReadonlyMap<string, ObjectFrameSample>, instant: SimulationInstant, nowMs: number): void
  render(): void
}
/** `wallNowMs` lets forward 1× playback follow the wall clock (see `SimulationClock.advance`). */
export function advanceSimulationFrame(dependencies: FrameDependencies, deltaSeconds: number, nowMs: number, wallNowMs?: number): void {
  dependencies.clock.advance(deltaSeconds, wallNowMs)
  const instant = dependencies.clock.currentInstant()
  dependencies.publishInstant(instant)
  const orientation = dependencies.applyEnvironment(instant)
  // Keep the one-argument call shape for lightweight/unit-test dependencies;
  // the application returns the already computed orientation so runtime work
  // never asks the environment model for a second current orientation.
  const samples = orientation ? dependencies.runtime.updateAt(instant, orientation, nowMs) : dependencies.runtime.updateAt(instant)
  dependencies.updateReadouts(samples, instant, nowMs)
  dependencies.render()
}
