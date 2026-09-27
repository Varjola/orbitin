// Import only the scalar modules. The package root also re-exports its optional
// WASM bulk runtime; importing that root makes Vite bundle a worker with
// top-level await, which is unnecessary for scenes of at most a hundred objects.
import { checkForDecay, SatRecError, sgp4, type SatRec } from '../vendor/satellite-js-scalar.ts'
import { secondsBetween } from '../core/time.ts'
import type { TemeVec3 } from '../core/referenceFrames.ts'
import type { SimulationInstant } from '../core/time.ts'
import type { Sgp4MeanElements } from '../data/sgp4MeanElements.ts'
import { satrecFromMeanElements } from './satelliteJsInitializer.ts'
import { OrbitPropagationError, type OrbitPropagationErrorCode } from './propagationError.ts'

export interface TemeState {
  readonly positionTemeKm: TemeVec3
  readonly velocityTemeKmPerSecond: TemeVec3
}

export const SATREC_EPOCH_TOLERANCE_SECONDS = 0.0005

function codeForSatRecError(error: SatRecError): OrbitPropagationErrorCode {
  switch (error) {
    case SatRecError.Decayed: return 'decayed'
    case SatRecError.MeanMotionBelowZero: return 'meanMotionNonPositive'
    case SatRecError.MeanEccentricityOutOfRange: return 'meanEccentricityOutOfRange'
    case SatRecError.PerturbedEccentricityOutOfRange: return 'perturbedEccentricityOutOfRange'
    case SatRecError.SemiLatusRectumBelowZero: return 'semiLatusRectumNegative'
    default: return 'unknown'
  }
}

function decodedEpochUnixSeconds(record: SatRec): number {
  const fullYear = record.epochyr >= 57 && record.epochyr < 100 ? 1900 + record.epochyr : record.epochyr < 57 ? 2000 + record.epochyr : record.epochyr
  return Date.UTC(fullYear, 0, 1) / 1000 + (record.epochdays - 1) * 86400
}

function finiteTeme(position: { x: number; y: number; z: number }, velocity: { x: number; y: number; z: number }, instant: SimulationInstant): TemeState {
  const values = [position.x, position.y, position.z, velocity.x, velocity.y, velocity.z]
  if (values.some((value) => !Number.isFinite(value))) throw new OrbitPropagationError('nonFiniteState', 'SGP4 returned a non-finite TEME state.', instant)
  return { positionTemeKm: { x: position.x, y: position.y, z: position.z }, velocityTemeKmPerSecond: { x: velocity.x, y: velocity.y, z: velocity.z } }
}

export interface SatelliteJsAdapter {
  readonly source: Sgp4MeanElements
  readonly record: SatRec
  temeStateAt(instant: SimulationInstant): TemeState
}

export function createSatelliteJsAdapter(source: Sgp4MeanElements | { readonly meanElements: Sgp4MeanElements }): SatelliteJsAdapter {
  const meanElements = 'meanElements' in source ? source.meanElements : source
  let record: SatRec
  try {
    record = satrecFromMeanElements(meanElements)
  } catch {
    throw new OrbitPropagationError('initialization', 'The SGP4 source could not initialize the propagation model.')
  }
  const epochDelta = decodedEpochUnixSeconds(record) - meanElements.epoch.unixSeconds
  if (!Number.isFinite(epochDelta) || Math.abs(epochDelta) > SATREC_EPOCH_TOLERANCE_SECONDS) {
    throw new OrbitPropagationError('adapterEpochMismatch', 'The SGP4 record epoch does not match the validated source epoch.')
  }
  return {
    source: meanElements,
    record,
    temeStateAt(instant) {
      const minutesSinceEpoch = secondsBetween(instant, meanElements.epoch) / 60
      let result: ReturnType<typeof sgp4>
      try {
        result = sgp4(record, minutesSinceEpoch)
      } catch {
        throw new OrbitPropagationError('unknown', 'SGP4 failed to propagate this source.', instant)
      }
      if (!result) throw new OrbitPropagationError(codeForSatRecError(record.error), 'SGP4 could not propagate this source.', instant)
      if (checkForDecay(record)) throw new OrbitPropagationError('communityDecayDetected', 'The satellite.js community decay check rejected this state.', instant)
      return finiteTeme(result.position, result.velocity, instant)
    },
  }
}

export function satRecErrorCode(error: SatRecError): OrbitPropagationErrorCode {
  return codeForSatRecError(error)
}
