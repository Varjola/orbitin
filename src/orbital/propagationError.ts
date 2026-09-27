import type { SimulationInstant } from '../core/time.ts'

export type OrbitPropagationErrorCode =
  | 'decayed'
  | 'communityDecayDetected'
  | 'meanMotionNonPositive'
  | 'meanEccentricityOutOfRange'
  | 'perturbedEccentricityOutOfRange'
  | 'semiLatusRectumNegative'
  | 'nonFiniteState'
  | 'adapterEpochMismatch'
  | 'initialization'
  | 'unknown'

export class OrbitPropagationError extends Error {
  readonly name = 'OrbitPropagationError'
  readonly code: OrbitPropagationErrorCode
  readonly instant: SimulationInstant | undefined
  constructor(
    code: OrbitPropagationErrorCode,
    message: string,
    instant?: SimulationInstant,
  ) {
    super(message)
    this.code = code
    this.instant = instant
  }
}

export function isOrbitPropagationError(error: unknown): error is OrbitPropagationError {
  return error instanceof OrbitPropagationError
}
