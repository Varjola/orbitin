import { EARTH_MU_KM3_S2 } from '../core/constants.ts'
import type { ProjectInertialVec3 } from '../core/referenceFrames.ts'
import { addVec3, crossVec3, dotVec3, lengthVec3, scaleVec3, subtractVec3 } from '../core/vec3.ts'

/** Which way round the Earth an arc runs. **Short** turns less than 180° and
 *  **long** more than 180°, in opposite senses about the same plane. These are
 *  the only two conic arcs between two points, so a search needs no reference
 *  direction, which a polar or retrograde orbit would make meaningless anyway. */
export type LambertWay = 'short' | 'long'

/** With whole revolutions there are two ellipses for one flight time. */
export type LambertBranch = 'single' | 'left' | 'right'

export interface LambertArc {
  /** Whole revolutions flown before the final partial one. */
  readonly revolutions: number
  readonly branch: LambertBranch
  readonly departureVelocityKmPerSecond: ProjectInertialVec3
  readonly arrivalVelocityKmPerSecond: ProjectInertialVec3
}

/** Below this sine of the transfer angle the two points and the Earth are in a
 *  line, and no one plane is defined for an arc between them. */
const COLLINEAR_SIN_TRANSFER_ANGLE = 1e-10
const SOLVER_TOLERANCE = 1e-8
const MAX_SOLVER_STEPS = 20
const MIN_TIME_TOLERANCE = 1e-13
const MAX_MIN_TIME_STEPS = 12
/** Where the general time equation starts to lose accuracy approaching a
 *  parabola (x = 1), and where it must give way to a series. */
const LAGRANGE_BAND = 0.2
const BATTIN_BAND = 0.01
const BATTIN_TOLERANCE = 1e-11

/** Every conic arc between two points in a given flight time, the way chosen
 *  and from `minRevolutions` to `maxRevolutions` whole revolutions: one arc with
 *  none, and two for each feasible number of revolutions. Empty when the points
 *  are in a line with the Earth, or when the solver does not converge.
 *
 *  This is Izzo's formulation (Revisiting Lambert's problem, Celestial Mechanics
 *  and Dynamical Astronomy, 2015): normalized by the transfer geometry, one
 *  parameter λ remains, and the time of flight is solved for a variable x with
 *  Householder steps. Arcs may be hyperbolic or pass through the Earth: what is
 *  acceptable for a route is the route's decision. */
export function lambertArcs(from: ProjectInertialVec3, to: ProjectInertialVec3, flightSeconds: number, way: LambertWay, maxRevolutions: number, minRevolutions = 0): LambertArc[] {
  if (!(flightSeconds > 0) || !Number.isFinite(flightSeconds)) throw new Error('A flight time must be positive and finite')
  if (!Number.isInteger(maxRevolutions) || maxRevolutions < 0 || !Number.isInteger(minRevolutions) || minRevolutions < 0) throw new Error('Revolutions must be a non-negative whole number')
  const fromRadius = lengthVec3(from)
  const toRadius = lengthVec3(to)
  if (!(fromRadius > 0) || !(toRadius > 0)) throw new Error('A point at the centre of the Earth has no arc')
  const fromUnit = scaleVec3(from, 1 / fromRadius)
  const toUnit = scaleVec3(to, 1 / toRadius)
  const shortNormalScaled = crossVec3(fromUnit, toUnit)
  const sinTransferAngle = lengthVec3(shortNormalScaled)
  if (sinTransferAngle < COLLINEAR_SIN_TRANSFER_ANGLE) return []

  const chord = lengthVec3(subtractVec3(to, from))
  const semiPerimeter = (fromRadius + toRadius + chord) / 2
  const shortNormal = scaleVec3(shortNormalScaled, 1 / sinTransferAngle)
  const lambdaSize = Math.sqrt(Math.max(0, 1 - chord / semiPerimeter))
  const lambda = way === 'short' ? lambdaSize : -lambdaSize
  const normal = way === 'short' ? shortNormal : scaleVec3(shortNormal, -1)
  const fromTangent = crossVec3(normal, fromUnit)
  const toTangent = crossVec3(normal, toUnit)
  const time = Math.sqrt((2 * EARTH_MU_KM3_S2) / semiPerimeter ** 3) * flightSeconds

  const gamma = Math.sqrt((EARTH_MU_KM3_S2 * semiPerimeter) / 2)
  const rho = (fromRadius - toRadius) / chord
  const sigma = Math.sqrt(Math.max(0, 1 - rho * rho))
  const arc = (x: number, revolutions: number, branch: LambertBranch): LambertArc => {
    const y = Math.sqrt(1 - lambda * lambda * (1 - x * x))
    const difference = lambda * y - x
    const sum = lambda * y + x
    const tangential = gamma * sigma * (y + lambda * x)
    return {
      revolutions,
      branch,
      departureVelocityKmPerSecond: addVec3(scaleVec3(fromUnit, (gamma * (difference - rho * sum)) / fromRadius), scaleVec3(fromTangent, tangential / fromRadius)),
      arrivalVelocityKmPerSecond: addVec3(scaleVec3(toUnit, (-gamma * (difference + rho * sum)) / toRadius), scaleVec3(toTangent, tangential / toRadius)),
    }
  }

  const arcs: LambertArc[] = []
  if (minRevolutions === 0) {
    const single = solveForX(time, singleArcGuess(time, lambda), 0, lambda)
    if (single !== null) arcs.push(arc(single, 0, 'single'))
  }
  const most = Math.min(maxRevolutions, feasibleRevolutions(time, lambda))
  for (let revolutions = Math.max(1, minRevolutions); revolutions <= most; revolutions += 1) {
    const leftScale = ((revolutions * Math.PI + Math.PI) / (8 * time)) ** (2 / 3)
    const left = solveForX(time, (leftScale - 1) / (leftScale + 1), revolutions, lambda)
    if (left !== null) arcs.push(arc(left, revolutions, 'left'))
    const rightScale = ((8 * time) / (revolutions * Math.PI)) ** (2 / 3)
    const right = solveForX(time, (rightScale - 1) / (rightScale + 1), revolutions, lambda)
    if (right !== null) arcs.push(arc(right, revolutions, 'right'))
  }
  return arcs
}

/** The speed changes of leaving one velocity for an arc and the arc for another. */
export function lambertArcDeltaV(arc: LambertArc, departureVelocity: ProjectInertialVec3, arrivalVelocity: ProjectInertialVec3): { readonly departureKmPerSecond: number; readonly arrivalKmPerSecond: number } {
  const size = (a: ProjectInertialVec3, b: ProjectInertialVec3) => { const d = subtractVec3(a, b); return Math.sqrt(dotVec3(d, d)) }
  return {
    departureKmPerSecond: size(arc.departureVelocityKmPerSecond, departureVelocity),
    arrivalKmPerSecond: size(arrivalVelocity, arc.arrivalVelocityKmPerSecond),
  }
}

function singleArcGuess(time: number, lambda: number): number {
  const timeAtZero = Math.acos(lambda) + lambda * Math.sqrt(1 - lambda * lambda)
  const parabolicTime = (2 / 3) * (1 - lambda ** 3)
  if (time >= timeAtZero) return -(time - timeAtZero) / (time - timeAtZero + 4)
  if (time <= parabolicTime) return (parabolicTime * (parabolicTime - time)) / ((2 / 5) * (1 - lambda ** 5) * time) + 1
  return (time / timeAtZero) ** (Math.LN2 / Math.log(parabolicTime / timeAtZero)) - 1
}

/** The most whole revolutions this flight time allows. Each count has a minimum
 *  time, found only for the highest count that is in doubt. */
function feasibleRevolutions(time: number, lambda: number): number {
  const most = Math.floor(time / Math.PI)
  if (most === 0) return 0
  const timeAtZero = Math.acos(lambda) + lambda * Math.sqrt(1 - lambda * lambda) + most * Math.PI
  if (time >= timeAtZero) return most
  let x = 0
  let minimum = timeAtZero
  for (let step = 0; step <= MAX_MIN_TIME_STEPS; step += 1) {
    const slopes = timeSlopes(x, minimum, lambda)
    const next = slopes.first === 0 ? x : x - (slopes.first * slopes.second) / (slopes.second * slopes.second - (slopes.first * slopes.third) / 2)
    const change = Math.abs(next - x)
    x = next
    if (change < MIN_TIME_TOLERANCE) break
    minimum = normalizedTime(x, most, lambda)
  }
  return minimum > time ? most - 1 : most
}

/** Householder's third-order steps on T(x) = time. Null when they do not
 *  settle, or settle outside the domain |x| < 1 that whole revolutions need. */
function solveForX(time: number, guess: number, revolutions: number, lambda: number): number | null {
  let x = guess
  for (let step = 0; step < MAX_SOLVER_STEPS; step += 1) {
    const current = normalizedTime(x, revolutions, lambda)
    const { first, second, third } = timeSlopes(x, current, lambda)
    const error = current - time
    const firstSquared = first * first
    const next = x - (error * (firstSquared - (error * second) / 2)) / (first * (firstSquared - error * second) + (third * error * error) / 6)
    if (!Number.isFinite(next)) return null
    const change = Math.abs(next - x)
    x = next
    if (change < SOLVER_TOLERANCE) return revolutions > 0 && Math.abs(x) >= 1 ? null : x
  }
  return null
}

function timeSlopes(x: number, time: number, lambda: number): { readonly first: number; readonly second: number; readonly third: number } {
  const lambda2 = lambda * lambda
  const lambda3 = lambda2 * lambda
  const oneMinusX2 = 1 - x * x
  const y = Math.sqrt(1 - lambda2 * oneMinusX2)
  const y3 = y * y * y
  const first = (3 * time * x - 2 + (2 * lambda3 * x) / y) / oneMinusX2
  const second = (3 * time + 5 * x * first + (2 * (1 - lambda2) * lambda3) / y3) / oneMinusX2
  const third = (7 * x * second + 8 * first - (6 * (1 - lambda2) * lambda2 * lambda3 * x) / (y3 * y * y)) / oneMinusX2
  return { first, second, third }
}

/** The normalized time of flight at x, by whichever of three forms is accurate there. */
function normalizedTime(x: number, revolutions: number, lambda: number): number {
  const distance = Math.abs(x - 1)
  if (distance < LAGRANGE_BAND && distance > BATTIN_BAND) return lagrangeTime(x, revolutions, lambda)
  const lambda2 = lambda * lambda
  const e = x * x - 1
  const rho = Math.abs(e)
  const z = Math.sqrt(1 + lambda2 * e)
  if (distance <= BATTIN_BAND) {
    const eta = z - lambda * x
    const s = 0.5 * (1 - lambda - x * eta)
    const q = (4 / 3) * hypergeometric(s)
    return (eta * eta * eta * q + 4 * lambda * eta) / 2 + (revolutions * Math.PI) / rho ** 1.5
  }
  const y = Math.sqrt(rho)
  const g = x * z - lambda * e
  const d = e < 0 ? revolutions * Math.PI + Math.acos(g) : Math.log(y * (z - lambda * x) + g)
  return (x - lambda * z - d / y) / e
}

function lagrangeTime(x: number, revolutions: number, lambda: number): number {
  const a = 1 / (1 - x * x)
  if (a > 0) {
    const alpha = 2 * Math.acos(x)
    const betaSize = 2 * Math.asin(Math.sqrt((lambda * lambda) / a))
    const beta = lambda < 0 ? -betaSize : betaSize
    return (a * Math.sqrt(a) * (alpha - Math.sin(alpha) - (beta - Math.sin(beta)) + 2 * revolutions * Math.PI)) / 2
  }
  const alpha = 2 * Math.acosh(x)
  const betaSize = 2 * Math.asinh(Math.sqrt((-lambda * lambda) / a))
  const beta = lambda < 0 ? -betaSize : betaSize
  return (-a * Math.sqrt(-a) * (beta - Math.sinh(beta) - (alpha - Math.sinh(alpha)))) / 2
}

/** Battin's series 2F1(3, 1, 5/2, z). */
function hypergeometric(z: number): number {
  let sum = 1
  let term = 1
  for (let j = 0; Math.abs(term) > BATTIN_TOLERANCE && j < 200; j += 1) {
    term = (term * (3 + j) * (1 + j) * z) / ((2.5 + j) * (j + 1))
    sum += term
  }
  return sum
}
