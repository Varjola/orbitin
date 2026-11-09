import { describe, expect, it } from 'vitest'
import { degToRad } from '../core/angles.ts'
import { EARTH_MU_KM3_S2, EARTH_RADIUS_KM } from '../core/constants.ts'
import { addSeconds, secondsBetween, type SimulationInstant } from '../core/time.ts'
import { lengthVec3, subtractVec3 } from '../core/vec3.ts'
import { deriveOrbitValues } from '../orbital/geometry.ts'
import { KeplerianPropagator, phaseFromTrueAnomaly } from '../orbital/keplerianPropagator.ts'
import { hohmannTransfer } from '../orbital/maneuver.ts'
import {
  beginBurn, continueBurn, createGame, createGameFromSetup, drawGameSetup, endBurn, gameScore, goalStatus, MANEUVER_RULES, playerSegmentAt, playerTrail,
  predictionArc, restartGame, segmentState, settleOutcome, tankRemaining, targetTrail, trailSeconds, type BurnDirection, type GameSetup, orbitApsides, type ManeuverGame,
} from './maneuverGame.ts'

const START: SimulationInstant = { unixSeconds: Date.UTC(2026, 10, 3) / 1000 }
const PLANE = { inclinationRad: degToRad(51.6), raanRad: degToRad(40) }

function setup(overrides: Partial<GameSetup> = {}): GameSetup {
  return { seed: null, plane: PLANE, playerAltitudeKm: 400, targetAltitudeKm: 600, playerArgumentOfLatitudeRad: 0.3, targetLeadRad: degToRad(90), ...overrides }
}

/** Holds a burn at a fixed frame rate until `deltaV` is delivered, shortening
 *  the last frame to land on it exactly, then releases. */
function burnFor(game: ManeuverGame, direction: BurnDirection, deltaVKmPerSecond: number, start: SimulationInstant, hz = 60): { game: ManeuverGame; end: SimulationInstant } {
  const seconds = deltaVKmPerSecond / MANEUVER_RULES.thrustKmPerSecond2
  const frames = Math.ceil(seconds * hz - 1e-9)
  let next = beginBurn(game, direction, start)
  for (let frame = 0; frame < frames; frame += 1) next = continueBurn(next, addSeconds(start, frame / hz), addSeconds(start, Math.min((frame + 1) / hz, seconds)))
  const end = addSeconds(start, seconds)
  return { game: endBurn(next, end), end }
}

function altitude(game: ManeuverGame, at: SimulationInstant): number {
  return lengthVec3(segmentState(playerSegmentAt(game, at), at).positionProjectInertialKm) - EARTH_RADIUS_KM
}

describe('game setup', () => {
  it('draws the same game from the same seed', () => {
    expect(createGame(12345, START)).toEqual(createGame(12345, START))
    expect(drawGameSetup(12345)).not.toEqual(drawGameSetup(12346))
  })

  it('keeps every drawn game inside the rules', () => {
    const rules = MANEUVER_RULES
    for (let seed = 1; seed <= 400; seed += 1) {
      const drawn = drawGameSetup(seed)
      expect(drawn.plane.inclinationRad).toBeGreaterThanOrEqual(rules.minInclinationRad)
      expect(drawn.plane.inclinationRad).toBeLessThanOrEqual(rules.maxInclinationRad)
      for (const altitudeKm of [drawn.playerAltitudeKm, drawn.targetAltitudeKm]) {
        expect(altitudeKm).toBeGreaterThanOrEqual(rules.minAltitudeKm - 1e-9)
        expect(altitudeKm).toBeLessThanOrEqual(rules.maxAltitudeKm + 1e-9)
      }
      const gap = Math.abs(drawn.targetAltitudeKm - drawn.playerAltitudeKm)
      expect(gap).toBeGreaterThanOrEqual(rules.minAltitudeGapKm - 1e-9)
      expect(gap).toBeLessThanOrEqual(rules.maxAltitudeGapKm + 1e-9)
      expect(drawn.targetLeadRad).toBeGreaterThanOrEqual(rules.minTargetLeadRad)
      expect(drawn.targetLeadRad).toBeLessThanOrEqual(rules.maxTargetLeadRad)
      const game = createGameFromSetup(drawn, START)
      expect(goalStatus(game, START).distanceKm).toBeGreaterThan(rules.winDistanceKm)
      // A full tank always holds well over the Hohmann minimum.
      expect(game.tankKmPerSecond).toBeGreaterThanOrEqual(rules.minTankKmPerSecond)
      expect(game.tankKmPerSecond).toBeLessThanOrEqual(rules.maxTankKmPerSecond)
      expect(game.referenceKmPerSecond).toBeLessThan(0.33)
    }
  })

  it('scales the tank with the starting altitude gap, in 10 m/s steps', () => {
    const tankForGap = (gapKm: number): number => createGameFromSetup(setup({ playerAltitudeKm: 300, targetAltitudeKm: 300 + gapKm }), START).tankKmPerSecond
    expect(tankForGap(150)).toBe(0.5)
    expect(tankForGap(375)).toBe(0.75)
    expect(tankForGap(600)).toBe(1)
    // 200 km: 555.6 m/s.
    expect(tankForGap(200)).toBe(0.56)
    // A constructed gap outside the drawn range stays inside the tank's range.
    expect(tankForGap(50)).toBe(0.5)
    expect(tankForGap(900)).toBe(1)
  })

  it('sizes the tank by the gap, whichever orbit is higher', () => {
    const up = createGameFromSetup(setup({ playerAltitudeKm: 400, targetAltitudeKm: 800 }), START)
    const down = createGameFromSetup(setup({ playerAltitudeKm: 800, targetAltitudeKm: 400 }), START)
    expect(up.tankKmPerSecond).toBe(down.tankKmPerSecond)
  })

  it('restarts from the same start with a full tank', () => {
    const game = createGameFromSetup(setup(), START)
    const flown = burnFor(game, 'prograde', 0.01, addSeconds(START, 30)).game
    expect(flown.usedKmPerSecond).toBeGreaterThan(0)
    expect(restartGame(flown)).toEqual(game)
  })
})

describe('burns', () => {
  it('reaches the instantaneous-burn apoapsis with a finite burn stepped at 60 Hz', () => {
    const firstBurn = hohmannTransfer(EARTH_RADIUS_KM + 400, EARTH_RADIUS_KM + 600).firstKmPerSecond
    const { game } = burnFor(createGameFromSetup(setup(), START), 'prograde', firstBurn, START)
    expect(game.burns).toHaveLength(1)
    // Instants are POSIX seconds in a double, resolved to about 0.24 µs today,
    // so held time and Δv carry rounding of a few µm/s.
    expect(game.burns[0].deltaVKmPerSecond).toBeCloseTo(firstBurn, 8)
    expect(game.burns[0].periapsisAltitudeKm).toBeCloseTo(400, 1)
    expect(Math.abs(game.burns[0].apoapsisAltitudeKm - 600)).toBeLessThan(0.1)
  })

  it('gives the same Δv and orbit at any frame rate', () => {
    const results = [30, 60, 144].map((hz) => {
      const game = createGameFromSetup(setup(), START)
      let next = beginBurn(game, 'prograde', START)
      for (let frame = 0; frame < 2 * hz; frame += 1) next = continueBurn(next, addSeconds(START, frame / hz), addSeconds(START, (frame + 1) / hz))
      next = endBurn(next, addSeconds(START, 2))
      const later = addSeconds(START, 2000)
      return { used: next.usedKmPerSecond, position: segmentState(playerSegmentAt(next, later), later).positionProjectInertialKm }
    })
    for (const result of results) {
      expect(result.used).toBeCloseTo(0.04, 12)
      expect(lengthVec3(subtractVec3(result.position, results[0].position))).toBeLessThan(1e-3)
    }
  })

  it('delivers at least the minimum burn for a quick tap', () => {
    let game = beginBurn(createGameFromSetup(setup(), START), 'retrograde', START)
    game = continueBurn(game, START, addSeconds(START, 1 / 60))
    game = endBurn(game, addSeconds(START, 1 / 60))
    expect(game.burns[0].deltaVKmPerSecond).toBeCloseTo(MANEUVER_RULES.thrustKmPerSecond2 * MANEUVER_RULES.minimumBurnSeconds, 12)
    expect(game.burns[0].apoapsisAltitudeKm).toBeCloseTo(400, 1)
  })

  it('stops exactly when the tank runs out and refuses further burns', () => {
    const game = createGameFromSetup(setup(), START)
    let next = beginBurn(game, 'prograde', START)
    let frame = 0
    while (next.activeBurn) {
      next = continueBurn(next, addSeconds(START, frame / 60), addSeconds(START, (frame + 1) / 60))
      frame += 1
    }
    expect(next.usedKmPerSecond).toBe(next.tankKmPerSecond)
    expect(tankRemaining(next)).toBe(0)
    expect(next.burns[0].deltaVKmPerSecond).toBeCloseTo(0.56, 12)
    expect(frame).toBe(Math.ceil(0.56 / 0.02 * 60 - 1e-9))
    expect(beginBurn(next, 'retrograde', addSeconds(START, 100))).toBe(next)
  })

  it('runs one burn at a time and none after the game ends', () => {
    const game = beginBurn(createGameFromSetup(setup(), START), 'prograde', START)
    expect(beginBurn(game, 'retrograde', START)).toBe(game)
    const over = { ...createGameFromSetup(setup(), START), outcome: { kind: 'won' as const, at: START } }
    expect(beginBurn(over, 'prograde', START)).toBe(over)
  })
})

describe('outcome', () => {
  it('wins a scripted Hohmann rendezvous at the minimum Δv', () => {
    const fromRadiusKm = EARTH_RADIUS_KM + 400
    const toRadiusKm = EARTH_RADIUS_KM + 600
    const transfer = hohmannTransfer(fromRadiusKm, toRadiusKm)
    const leadRad = Math.PI - Math.sqrt(EARTH_MU_KM3_S2 / toRadiusKm ** 3) * transfer.transferSeconds
    expect(leadRad).toBeCloseTo(degToRad(3.855), 4)
    let game = createGameFromSetup(setup({ targetLeadRad: leadRad }), START)
    const first = burnFor(game, 'prograde', transfer.firstKmPerSecond, START)
    game = first.game
    const segment = playerSegmentAt(game, first.end)
    const meanAnomaly = new KeplerianPropagator(segment.geometry, segment.phase).meanAnomalyAt(first.end)
    const apoapsis = addSeconds(first.end, (Math.PI - meanAnomaly) / deriveOrbitValues(segment.geometry).meanMotionRadPerSecond)
    const secondSeconds = transfer.secondKmPerSecond / MANEUVER_RULES.thrustKmPerSecond2
    const second = burnFor(game, 'prograde', transfer.secondKmPerSecond, addSeconds(apoapsis, -secondSeconds / 2))
    game = settleOutcome(second.game, second.end, second.end)
    const goals = goalStatus(game, second.end)
    expect(goals.distanceKm).toBeLessThan(20)
    expect(Math.abs(goals.eccentricityDifference)).toBeLessThan(1e-4)
    expect(Math.abs(goals.periodDifferenceSeconds)).toBeLessThan(1)
    expect(game.outcome).toEqual({ kind: 'won', at: second.end })
    const score = gameScore(game)
    expect(score.efficiency).toBeCloseTo(1, 6)
    expect(score.burnCount).toBe(2)
    expect(score.elapsedSeconds).toBeCloseTo(secondsBetween(second.end, START), 9)
  })

  it('wins on a matched orbit within reach', () => {
    const game = createGameFromSetup(setup({ playerAltitudeKm: 600, targetLeadRad: 50 / (EARTH_RADIUS_KM + 600) }), START)
    expect(settleOutcome(game, START, START).outcome?.kind).toBe('won')
  })

  it('does not win on a circular orbit 90 km below, drifting past', () => {
    const game = createGameFromSetup(setup({ playerAltitudeKm: 510, targetLeadRad: 0 }), START)
    const goals = goalStatus(game, START)
    expect(goals.distanceKm).toBeCloseTo(90, 6)
    expect(goals.distanceMet && goals.shapeMet).toBe(true)
    expect(goals.periodMet).toBe(false)
    expect(goals.periodDifferenceSeconds).toBeLessThan(-100)
    expect(settleOutcome(game, START, START).outcome).toBeNull()
  })

  it('does not win with the right period but the wrong shape', () => {
    const base = createGameFromSetup(setup({ playerAltitudeKm: 600, targetLeadRad: 0 }), START)
    const eccentricity = 0.01
    // On this ellipse r = a where cos ν = -e; put that point on the target.
    const trueAnomalyRad = Math.acos(-eccentricity)
    const geometry = { ...base.target.geometry, eccentricity, argOfPeriapsisRad: base.setup.playerArgumentOfLatitudeRad - trueAnomalyRad }
    const game = { ...base, playerHistory: [{ geometry, phase: phaseFromTrueAnomaly(eccentricity, trueAnomalyRad, START), validFrom: START }] }
    const goals = goalStatus(game, START)
    expect(goals.distanceKm).toBeLessThan(1e-6)
    expect(goals.periodMet).toBe(true)
    expect(goals.shapeMet).toBe(false)
    expect(settleOutcome(game, START, START).outcome).toBeNull()
  })

  it('ends at the exact re-entry instant even at 3600× warp', () => {
    let game = burnFor(createGameFromSetup(setup({ playerAltitudeKm: 300 }), START), 'retrograde', 0.04, START).game
    expect(game.burns[0].periapsisAltitudeKm).toBeLessThan(MANEUVER_RULES.reentryAltitudeKm)
    let from = game.burns[0].end
    while (!game.outcome) {
      const to = addSeconds(from, 60)
      game = settleOutcome(game, from, to)
      if (game.outcome) {
        expect(secondsBetween(game.outcome.at, from)).toBeGreaterThanOrEqual(0)
        expect(secondsBetween(to, game.outcome.at)).toBeGreaterThanOrEqual(0)
      }
      from = to
    }
    expect(game.outcome.kind).toBe('reentered')
    expect(altitude(game, game.outcome.at)).toBeCloseTo(MANEUVER_RULES.reentryAltitudeKm, 3)
    expect(beginBurn(game, 'prograde', game.outcome.at)).toBe(game)
  })

  it('ends a burn in progress with the game', () => {
    const game = beginBurn(createGameFromSetup(setup({ playerAltitudeKm: 600, targetLeadRad: 0.001 }), START), 'prograde', START)
    const settled = settleOutcome(game, START, START)
    expect(settled.outcome?.kind).toBe('won')
    expect(settled.activeBurn).toBeNull()
    expect(settled.burns).toHaveLength(1)
  })
})

describe('trails and prediction', () => {
  it('covers 0.75 of the shorter period for both satellites', () => {
    const game = createGameFromSetup(setup(), START)
    const shorter = deriveOrbitValues(game.playerHistory[0].geometry).periodSeconds
    expect(trailSeconds(game, START)).toBeCloseTo(0.75 * shorter, 9)
    const span = trailSeconds(game, START)
    const target = targetTrail(game, START)
    expect(lengthVec3(subtractVec3(target[0], segmentState(game.target, addSeconds(START, -span)).positionProjectInertialKm))).toBeLessThan(1e-9)
    expect(lengthVec3(subtractVec3(target[target.length - 1], segmentState(game.target, START).positionProjectInertialKm))).toBeLessThan(1e-9)
    for (const point of target) expect(lengthVec3(point)).toBeCloseTo(EARTH_RADIUS_KM + 600, 9)
    // The higher target covers less angle in the same time.
    const player = playerTrail(game, START)
    const sweep = (points: readonly { x: number; y: number; z: number }[]) => points.slice(1).reduce((sum, point, index) => sum + Math.acos(Math.min(1, (point.x * points[index].x + point.y * points[index].y + point.z * points[index].z) / (lengthVec3(point) * lengthVec3(points[index])))), 0)
    expect(sweep(player)).toBeCloseTo(degToRad(270), 6)
    expect(sweep(target)).toBeLessThan(degToRad(270))
  })

  it('draws the flown path through each burn', () => {
    const burnStart = addSeconds(START, 600)
    const { game, end } = burnFor(createGameFromSetup(setup(), START), 'prograde', 0.05, burnStart)
    const now = addSeconds(end, 1200)
    const trail = playerTrail(game, now)
    const before = segmentState(game.playerHistory[0], burnStart).positionProjectInertialKm
    const after = segmentState(game.playerHistory[1], end).positionProjectInertialKm
    expect(trail.some((point) => lengthVec3(subtractVec3(point, before)) < 1e-9)).toBe(true)
    expect(trail.some((point) => lengthVec3(subtractVec3(point, after)) < 1e-9)).toBe(true)
    expect(lengthVec3(subtractVec3(trail[trail.length - 1], segmentState(playerSegmentAt(game, now), now).positionProjectInertialKm))).toBeLessThan(1e-9)
    const radii = trail.map((point) => lengthVec3(point) - EARTH_RADIUS_KM)
    const beforeIndex = trail.findIndex((point) => lengthVec3(subtractVec3(point, before)) < 1e-9)
    for (const radius of radii.slice(0, beforeIndex + 1)) expect(radius).toBeCloseTo(400, 6)
    expect(Math.max(...radii.slice(beforeIndex + 1))).toBeGreaterThan(450)
  })

  it('draws the aim line to the far side of the orbit during a burn', () => {
    let game = beginBurn(createGameFromSetup(setup(), START), 'prograde', START)
    game = continueBurn(game, START, addSeconds(START, 1))
    const arc = predictionArc(game, addSeconds(START, 1))!
    expect(arc).toHaveLength(129)
    const values = deriveOrbitValues(playerSegmentAt(game, addSeconds(START, 1)).geometry)
    expect(lengthVec3(arc[arc.length - 1])).toBeCloseTo(values.apoapsisRadiusKm, 3)
    expect(lengthVec3(subtractVec3(arc[0], segmentState(playerSegmentAt(game, addSeconds(START, 1)), addSeconds(START, 1)).positionProjectInertialKm))).toBeLessThan(1e-6)
  })

  it('has no aim line before the first burn', () => {
    expect(predictionArc(createGameFromSetup(setup(), START), addSeconds(START, 600))).toBeNull()
  })

  describe('after the burn', () => {
    const firstBurn = hohmannTransfer(EARTH_RADIUS_KM + 400, EARTH_RADIUS_KM + 600).firstKmPerSecond
    const { game, end } = burnFor(createGameFromSetup(setup(), START), 'prograde', firstBurn, START)
    const segment = playerSegmentAt(game, end)
    const period = deriveOrbitValues(segment.geometry).periodSeconds

    it('keeps the line, with its far end at the opposite apsis', () => {
      const line = predictionArc(game, end)!
      expect(line).toHaveLength(129)
      expect(lengthVec3(subtractVec3(line[0], segmentState(segment, end).positionProjectInertialKm))).toBeLessThan(1e-6)
      expect(lengthVec3(line[line.length - 1]) - EARTH_RADIUS_KM).toBeCloseTo(600, 0)
    })

    it('shrinks ahead of the satellite while the far end stays put', () => {
      const line = predictionArc(game, end)!
      const farEnd = line[line.length - 1]
      for (const fraction of [0.1, 0.25, 0.4]) {
        const at = addSeconds(end, fraction * period)
        const later = predictionArc(game, at)!
        expect(later.length).toBeLessThan(line.length)
        expect(lengthVec3(subtractVec3(later[0], segmentState(segment, at).positionProjectInertialKm))).toBeLessThan(1e-6)
        expect(lengthVec3(subtractVec3(later[later.length - 1], farEnd))).toBeLessThan(1e-6)
      }
    })

    it('ends when the satellite reaches the far end and does not come back on later orbits', () => {
      for (const fraction of [0.51, 0.75, 1.1, 1.25, 2.3]) expect(predictionArc(game, addSeconds(end, fraction * period))).toBeNull()
    })

    it('times the far end on an eccentric orbit after a burn away from the apsides', () => {
      // Here half the angle is not half the period.
      const flown = burnFor(game, 'prograde', 0.2, addSeconds(end, period / 4))
      const orbit = playerSegmentAt(flown.game, flown.end)
      const line = predictionArc(flown.game, flown.end)!
      const farEnd = line[line.length - 1]
      let at = flown.end
      while (predictionArc(flown.game, at)) at = addSeconds(at, 1)
      expect(lengthVec3(subtractVec3(segmentState(orbit, at).positionProjectInertialKm, farEnd))).toBeLessThan(20)
    })

    it('is replaced by the next burn', () => {
      const pressed = beginBurn(game, 'retrograde', addSeconds(end, 600))
      const next = predictionArc(continueBurn(pressed, addSeconds(end, 600), addSeconds(end, 601)), addSeconds(end, 601))!
      expect(next).toHaveLength(129)
      const released = burnFor(game, 'retrograde', 0.002, addSeconds(end, 600))
      expect(predictionArc(released.game, released.end)).toHaveLength(129)
    })

    it('is gone once the game ends', () => {
      const over = { ...game, outcome: { kind: 'won' as const, at: end } }
      expect(predictionArc(over, end)).toBeNull()
    })
  })
})

describe('orbit apsides', () => {
  it('marks no apsis on a circle', () => {
    expect(orbitApsides(createGameFromSetup(setup(), START), START)).toEqual([])
  })

  it('marks the highest and lowest points and when the satellite reaches them', () => {
    const firstBurn = hohmannTransfer(EARTH_RADIUS_KM + 400, EARTH_RADIUS_KM + 600).firstKmPerSecond
    const { game, end } = burnFor(createGameFromSetup(setup(), START), 'prograde', firstBurn, START)
    const segment = playerSegmentAt(game, end)
    const values = deriveOrbitValues(segment.geometry)
    const [apoapsis, periapsis] = orbitApsides(game, end)
    expect(apoapsis.kind).toBe('apoapsis')
    expect(periapsis.kind).toBe('periapsis')
    expect(lengthVec3(apoapsis.state.positionProjectInertialKm) - EARTH_RADIUS_KM).toBeCloseTo(values.apoapsisAltitudeKm, 6)
    expect(lengthVec3(periapsis.state.positionProjectInertialKm) - EARTH_RADIUS_KM).toBeCloseTo(values.periapsisAltitudeKm, 6)
    // The burn just left the lowest point behind: half an orbit to the top, a whole one back.
    expect(apoapsis.secondsUntil).toBeCloseTo(values.periodSeconds / 2, -1)
    expect(periapsis.secondsUntil).toBeCloseTo(values.periodSeconds, -1)
    for (const apsis of [apoapsis, periapsis]) {
      const arrival = segmentState(segment, addSeconds(end, apsis.secondsUntil)).positionProjectInertialKm
      expect(lengthVec3(subtractVec3(arrival, apsis.state.positionProjectInertialKm))).toBeLessThan(1e-2)
    }
    // The next pass counts down, then starts over.
    const later = orbitApsides(game, addSeconds(end, apoapsis.secondsUntil + 60))[0]
    expect(later.secondsUntil).toBeCloseTo(values.periodSeconds - 60, 3)
  })

  it('marks even the orbit a single tap leaves', () => {
    let game = beginBurn(createGameFromSetup(setup(), START), 'prograde', START)
    game = endBurn(game, START)
    expect(game.burns[0].deltaVKmPerSecond).toBeCloseTo(0.002, 12)
    expect(orbitApsides(game, START)).toHaveLength(2)
  })
})
