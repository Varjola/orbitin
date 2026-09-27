import { TAU, wrapRadians } from '../core/angles.ts'

export function eccentricFromTrueAnomaly(trueAnomalyRad: number, eccentricity: number): number {
  const sine = Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(trueAnomalyRad)
  const cosine = eccentricity + Math.cos(trueAnomalyRad)
  return wrapRadians(Math.atan2(sine, cosine))
}

export function meanFromEccentricAnomaly(eccentricAnomalyRad: number, eccentricity: number): number {
  return wrapRadians(eccentricAnomalyRad - eccentricity * Math.sin(eccentricAnomalyRad))
}

export function solveEccentricAnomaly(meanAnomalyRad: number, eccentricity: number): number {
  const target = wrapRadians(meanAnomalyRad)
  let eccentricAnomaly = target + eccentricity * Math.sin(target)
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const error = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - target
    const derivative = 1 - eccentricity * Math.cos(eccentricAnomaly)
    const correction = error / derivative
    eccentricAnomaly -= correction
    if (Math.abs(correction) < 1e-12) return wrapRadians(eccentricAnomaly)
  }
  throw new Error(`Kepler solver did not converge for e=${eccentricity}`)
}

export function trueFromEccentricAnomaly(eccentricAnomalyRad: number, eccentricity: number): number {
  const sine = Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(eccentricAnomalyRad)
  const cosine = Math.cos(eccentricAnomalyRad) - eccentricity
  return wrapRadians(Math.atan2(sine, cosine))
}

export function meanFromTrueAnomaly(trueAnomalyRad: number, eccentricity: number): number {
  return meanFromEccentricAnomaly(eccentricFromTrueAnomaly(trueAnomalyRad, eccentricity), eccentricity)
}

export function trueAnomalyAtMean(meanAnomalyRad: number, eccentricity: number): number {
  return trueFromEccentricAnomaly(solveEccentricAnomaly(meanAnomalyRad, eccentricity), eccentricity)
}

export function unwrapAngleDifference(a: number, b: number): number {
  const difference = (a - b + Math.PI) % TAU
  return difference < 0 ? difference + Math.PI : difference - Math.PI
}

