import { describe, expect, it } from 'vitest'
import { degToRad } from '../core/angles.ts'
import type { RouteObject, RoutePlannerSetup, RoutePlannerSnapshot } from '../app/RoutePlannerController.ts'
import { setActiveLocale } from '../i18n/active.ts'
import { NO_LIMITS, shortlistRoutes } from '../simulation/route/routeFront.ts'
import { solveRoutes } from '../simulation/route/routeSearch.ts'
import { exampleSatellites, plannedRequest, routeExample, ROUTE_MAX_BUDGET_KM_S, ROUTE_MAX_HORIZON_SECONDS, ROUTE_MIN_BUDGET_KM_S, ROUTE_MIN_LIMIT_SECONDS, type RouteExampleId } from '../simulation/route/routeSetup.ts'
import { orbitValuesAt, planeAngleBetween, routeSeparation } from '../simulation/route/routeObjects.ts'
import type { Sgp4MeanElements } from '../data/sgp4MeanElements.ts'
import type { Route } from '../simulation/route/routeModel.ts'
import { altitudeFromPosition, budgetFromPosition, buildRoutePanelModel, ispFromPosition, limitFromPosition, positionFromAltitude, positionFromBudget, positionFromIsp, positionFromLimit, ROUTE_SLIDER_STEPS } from './routePanelModel.ts'
import { altitudeText, burnChangeLines, burnDirectionText, deltaVText, elementAgeLines, limitText, listNotes, routeNotes, separationLines, sideName, sideTitle, spanText, statusText } from './routeWording.ts'

const START = { unixSeconds: 1_800_000_000 }
const DAY = 86_400

setActiveLocale('en')

const { own: OWN, target: TARGET } = exampleSatellites(routeExample('altitude'), START)
// Searched a day ahead only, to keep the tests quick.
const ONE_DAY_FRONT = solveRoutes({ ...plannedRequest(OWN, TARGET, START).request, horizonSeconds: DAY })
const CHEAPEST = ONE_DAY_FRONT.routes.at(-1)!

function setupFor(exampleId: RouteExampleId): RoutePlannerSetup {
  const satellites = exampleSatellites(routeExample(exampleId), START)
  const object = (side: 'own' | 'target'): RouteObject => ({ source: { kind: 'example', exampleId, side }, satellite: satellites[side], edited: false, circular: true })
  return { own: object('own'), target: object('target'), tryId: exampleId, limitTime: false, limitFuel: false, limitSeconds: DAY, budgetKmPerSecond: 1 }
}

function snapshotOf(setup: RoutePlannerSetup): RoutePlannerSnapshot {
  const state = (object: RouteObject) => ({ object, values: orbitValuesAt(object.satellite, START) })
  return {
    setup, view: 'live', window: 'closed', details: null, live: { instant: START, playing: true, rate: 100 }, instant: START,
    own: state(setup.own), target: state(setup.target), separation: routeSeparation(setup.own.satellite, setup.target.satellite, START),
    blocked: null, status: { kind: 'solving', fraction: 0.5 }, result: null, shortlist: null, hasRoute: false, outOfDate: false, catalogue: 'off',
    search: { text: '', results: [], moreResults: false, pending: null, refusal: null }, pair: null, specificImpulseSeconds: 300, camera: 'free', frameBurns: false,
  }
}

function unsolved(exampleId: RouteExampleId): RoutePlannerSnapshot {
  return snapshotOf(setupFor(exampleId))
}

/** The routes found a day ahead, with the cheapest of them in the details and playing. */
function solved(): RoutePlannerSnapshot {
  const front = ONE_DAY_FRONT
  const setup = setupFor('altitude')
  return {
    ...snapshotOf(setup), view: 'route', hasRoute: true, status: { kind: 'idle' },
    result: { setup, instant: START, front, limitedToSeconds: null }, shortlist: shortlistRoutes(front.routes, NO_LIMITS),
    details: { route: CHEAPEST, fineTuned: null },
  }
}

function showing(route: Route, base = solved()): RoutePlannerSnapshot {
  return { ...base, details: { route, fineTuned: null } }
}

const ISS_ELEMENTS = { catalogId: '25544', epoch: { unixSeconds: START.unixSeconds - 1.5 * DAY } } as Sgp4MeanElements

describe('buildRoutePanelModel', () => {
  it('describes both orbits and how far apart they are before there is any result', () => {
    const model = buildRoutePanelModel(unsolved('oneShell'))
    expect(model.own.values.perigeeAltitudeKm).toBeCloseTo(550, 6)
    expect(model.target.values.apogeeAltitudeKm).toBeCloseTo(550, 6)
    expect(model.own.values.inclinationDeg).toBeCloseTo(53, 9)
    expect(model.own).toMatchObject({ label: { kind: 'example', exampleId: 'oneShell', side: 'own' }, edited: false, circular: true, elementAgeSeconds: null })
    // Plane angle for equal inclinations: 2 asin(sin i sin(Δ/2)).
    expect(model.separation.planeAngleRad).toBeCloseTo(2 * Math.asin(Math.sin(degToRad(53)) * Math.sin(degToRad(30))), 12)
    expect(model).toMatchObject({ view: 'live', hasRoute: false, list: null, shown: null, noRoute: false, catalogue: 'off', limitTime: false, limitFuel: false })
  })

  it('shows a route: its total, its arrival, every burn and every stretch between', () => {
    const model = buildRoutePanelModel(solved())
    const result = model.shown!
    expect(result.totalDeltaVKmPerSecond * 1000).toBeGreaterThan(100)
    expect(result.totalDeltaVKmPerSecond * 1000).toBeLessThan(130)
    expect(result.burns.map((burn) => burn.purpose)).toEqual(['depart', 'arrive'])
    expect(result.burns.map((burn) => burn.number)).toEqual([1, 2])
    expect(result.burns[1]!.atSeconds).toBe(result.arrivalSeconds)
    expect(result.burns[0]!.sizeKmPerSecond + result.burns[1]!.sizeKmPerSecond).toBeCloseTo(result.totalDeltaVKmPerSecond, 12)
    expect(result.alreadyThere).toBe(false)
    expect(result.legs.at(-1)).toMatchObject({ kind: 'transfer', toSeconds: result.arrivalSeconds })
    expect(result.timeline.segments.filter((segment) => segment.kind === 'burn')).toHaveLength(2)
    expect(result.timeline.durationTau).toBeGreaterThan(0)
  })

  it('gives the interceptor’s height and plane along the timeline, for the details as for playback', () => {
    const { timeline, burns } = buildRoutePanelModel(solved()).shown!
    expect(timeline.profile.altitudeKm.length).toBe(timeline.profile.planeAngleRad.length)
    expect(timeline.profile.lowestKm).toBeCloseTo(Math.min(burns[0]!.before.perigeeAltitudeKm, burns[1]!.after.perigeeAltitudeKm), -1)
    expect(timeline.profile.highestKm).toBeGreaterThan(timeline.profile.lowestKm)
    expect(buildRoutePanelModel(solved()).shown!.timeline).toBe(timeline)
  })

  it('gives each burn’s parts, which add up to its size', () => {
    for (const burn of buildRoutePanelModel(solved()).shown!.burns) {
      expect(Math.hypot(burn.progradeKmPerSecond, burn.normalKmPerSecond, burn.outwardKmPerSecond)).toBeCloseTo(burn.sizeKmPerSecond, 9)
    }
  })

  it('gives the orbit after each burn, ending on the target’s', () => {
    const { burns } = buildRoutePanelModel(solved()).shown!
    expect(burns[0]!.after.perigeeAltitudeKm).toBeLessThan(burns[0]!.after.apogeeAltitudeKm)
    expect(burns[0]!.after.perigeeAltitudeKm).toBeCloseTo(400, -1)
    expect(burns[0]!.after.apogeeAltitudeKm).toBeCloseTo(600, -1)
    expect(burns[1]!.after.perigeeAltitudeKm).toBeCloseTo(600, 3)
    expect(burns[1]!.after.apogeeAltitudeKm).toBeCloseTo(600, 3)
    expect(burns[1]!.after.inclinationRad).toBeCloseTo(degToRad(51.6), 9)
  })

  it('gives the propellant share from the rocket equation, at the default engine', () => {
    const { shown } = buildRoutePanelModel(showing({ ...CHEAPEST, burns: [], totalDeltaVKmPerSecond: 7.67 }))
    expect(shown!.specificImpulseSeconds).toBe(300)
    expect(shown!.propellantFraction).toBeCloseTo(0.926, 3)
  })

  it('gives the share at the chosen engine, and how many fuel limits the route needs', () => {
    const model = buildRoutePanelModel({ ...showing({ ...CHEAPEST, totalDeltaVKmPerSecond: 7.4 }), specificImpulseSeconds: 1500 })
    expect(model.specificImpulseSeconds).toBe(1500)
    expect(model.shown!.propellantFraction).toBeCloseTo(1 - Math.exp(-7.4 / (1500 * 0.00980665)), 9)
    expect(model.shown!.tanks).toBeCloseTo(7.4, 9)
  })

  it('sets the route beside changing height alone', () => {
    const { shown } = buildRoutePanelModel(solved())
    // Hohmann from 400 to 600 km.
    expect(shown!.altitudeOnlyKmPerSecond * 1000).toBeCloseTo(110.7, 0)
    expect(shown!.totalDeltaVKmPerSecond).toBeGreaterThanOrEqual(shown!.altitudeOnlyKmPerSecond)
  })

  it('offers a shortlist of the routes found, from the fastest to the cheapest', () => {
    const { list } = buildRoutePanelModel(solved())
    const first = ONE_DAY_FRONT.routes[0]!
    expect(list!.routes.length).toBeGreaterThan(2)
    expect(list!.routes.length).toBeLessThanOrEqual(9)
    expect(list!.routes[0]).toEqual({ deltaVKmPerSecond: first.totalDeltaVKmPerSecond, arrivalSeconds: first.arrivalSeconds, family: first.family, burns: first.burns.length })
    expect(list!.routes.at(-1)!.deltaVKmPerSecond).toBe(CHEAPEST.totalDeltaVKmPerSecond)
    expect(list).toMatchObject({ withinLimits: true, complete: true, outOfDate: false, alreadyThere: false, limits: NO_LIMITS })
  })

  it('offers only routes within the limits, and says when none keep within them', () => {
    const base = solved()
    const limited = { ...base, setup: { ...base.setup, limitTime: true, limitSeconds: 10 * 3600 } }
    const model = buildRoutePanelModel({ ...limited, shortlist: shortlistRoutes(ONE_DAY_FRONT.routes, { timeSeconds: 10 * 3600, deltaVKmPerSecond: null }) })
    expect(model.list!.limits).toEqual({ timeSeconds: 10 * 3600, deltaVKmPerSecond: null })
    for (const route of model.list!.routes) expect(route.arrivalSeconds).toBeLessThanOrEqual(10 * 3600)
    // The cheapest arrives later than ten hours, so the route in the details is beyond the limit.
    expect(model.shown!.withinLimits).toBe(CHEAPEST.arrivalSeconds <= 10 * 3600)
    const none = buildRoutePanelModel({ ...limited, shortlist: shortlistRoutes(ONE_DAY_FRONT.routes, { timeSeconds: 60, deltaVKmPerSecond: null }) })
    expect(none.list!.withinLimits).toBe(false)
  })

  it('says when the route is too small to mean anything', () => {
    const model = buildRoutePanelModel(showing({ ...CHEAPEST, burns: [], totalDeltaVKmPerSecond: 0.012 }))
    expect(model.shown!.alreadyThere).toBe(true)
  })

  it('says when a finished search found nothing', () => {
    const base = solved()
    const model = buildRoutePanelModel({ ...base, details: null, result: { ...base.result!, front: { routes: [], complete: true } }, shortlist: shortlistRoutes([], NO_LIMITS) })
    expect(model.list).toBeNull()
    expect(model.noRoute).toBe(true)
  })

  it('names what the result was planned for, not what has been chosen since', () => {
    const base = solved()
    const model = buildRoutePanelModel({ ...base, setup: setupFor('oneShell'), outOfDate: true })
    expect(model.tryId).toBe('oneShell')
    expect(model.list!.own).toEqual({ kind: 'example', exampleId: 'altitude', side: 'own' })
    expect(model.list!.outOfDate).toBe(true)
  })

  it('gives a catalogue object its name, number and element age', () => {
    const base = unsolved('altitude')
    const object: RouteObject = { ...base.setup.own, source: { kind: 'catalogue', catalogId: '25544', name: 'ISS (ZARYA)', elements: ISS_ELEMENTS }, edited: true, circular: false }
    const model = buildRoutePanelModel({ ...base, own: { ...base.own, object } })
    expect(model.own).toMatchObject({ label: { kind: 'catalogue', catalogId: '25544', name: 'ISS (ZARYA)' }, edited: true, circular: false })
    expect(model.target.edited).toBe(false)
    expect(model.own.elementAgeSeconds).toBeCloseTo(1.5 * DAY, 6)
  })

  it('shows the route in the details fine-tuned, with what that saved', () => {
    const base = solved()
    const route = CHEAPEST
    const fineTuned = { ...route, totalDeltaVKmPerSecond: route.totalDeltaVKmPerSecond - 0.004 }
    const model = buildRoutePanelModel({ ...base, window: 'details', details: { route, fineTuned } })
    expect(model.window).toBe('details')
    expect(model.shown!.totalDeltaVKmPerSecond).toBeCloseTo(route.totalDeltaVKmPerSecond - 0.004, 12)
    expect(model.shown!.fineTunedSavingKmPerSecond).toBeCloseTo(0.004, 12)
    expect(buildRoutePanelModel({ ...base, details: { route, fineTuned: null } }).shown!.fineTunedSavingKmPerSecond).toBeNull()
    expect(buildRoutePanelModel({ ...base, details: null }).shown).toBeNull()
  })

  it('gives each burn the orbit before it and how far it turns the plane', () => {
    const [first, second] = buildRoutePanelModel(solved()).shown!.burns
    expect(first!.before.apogeeAltitudeKm).toBeCloseTo(400, 0)
    // A little turn: the transfer's plane turns with J2 at its own rate.
    expect(first!.turnRad).toBeLessThan(0.01)
    expect(second!.before.apogeeAltitudeKm).toBeCloseTo(600, -1)
  })

  it('says a route can be shown again from the live scene', () => {
    expect(buildRoutePanelModel({ ...solved(), view: 'live' })).toMatchObject({ view: 'live', hasRoute: true })
  })

  it('survives being rebuilt from a route that crossed from a Worker', () => {
    const snapshot = solved()
    const front = structuredClone(snapshot.result!.front)
    const copied = { ...snapshot, result: { ...snapshot.result!, front }, shortlist: shortlistRoutes(front.routes, NO_LIMITS), details: { route: front.routes.at(-1)!, fineTuned: null } }
    expect(buildRoutePanelModel(copied)).toEqual(buildRoutePanelModel(snapshot))
  })
})

describe('planeAngleBetween', () => {
  const orbit = (inclinationDeg: number, raanDeg: number) => ({ semiMajorAxisKm: 7000, eccentricity: 0, inclinationRad: degToRad(inclinationDeg), raanRad: degToRad(raanDeg), argOfPeriapsisRad: 0 })

  it('is zero for one plane and the inclination difference at a shared node', () => {
    expect(planeAngleBetween(orbit(51.6, 10), orbit(51.6, 10))).toBeCloseTo(0, 6)
    expect(planeAngleBetween(orbit(28.5, 10), orbit(51.6, 10))).toBeCloseTo(degToRad(23.1), 12)
  })

  it('is over 90° for a target going the other way', () => {
    expect(planeAngleBetween(orbit(51.6, 0), orbit(128.4, 0))).toBeCloseTo(degToRad(76.8), 12)
    expect(planeAngleBetween(orbit(20, 0), orbit(160, 180))).toBeCloseTo(degToRad(180), 6)
  })
})

describe('the limit sliders', () => {
  it('cover the whole range of time limits and of budgets', () => {
    expect(limitFromPosition(0)).toBe(ROUTE_MIN_LIMIT_SECONDS)
    expect(limitFromPosition(ROUTE_SLIDER_STEPS)).toBe(ROUTE_MAX_HORIZON_SECONDS)
    expect(budgetFromPosition(0)).toBe(ROUTE_MIN_BUDGET_KM_S)
    expect(budgetFromPosition(ROUTE_SLIDER_STEPS)).toBe(ROUTE_MAX_BUDGET_KM_S)
  })

  it('land on whole hours, then whole days', () => {
    for (let position = 0; position <= ROUTE_SLIDER_STEPS; position += 7) {
      const seconds = limitFromPosition(position)
      expect(seconds % (seconds < 2 * DAY ? 3600 : DAY)).toBe(0)
    }
  })

  it('land on budgets of two significant figures', () => {
    for (let position = 0; position <= ROUTE_SLIDER_STEPS; position += 7) {
      const metres = budgetFromPosition(position) * 1000
      expect(Number(metres.toPrecision(2))).toBeCloseTo(metres, 6)
    }
  })

  it('only ever move one way', () => {
    for (let position = 1; position <= ROUTE_SLIDER_STEPS; position += 1) {
      expect(limitFromPosition(position)).toBeGreaterThanOrEqual(limitFromPosition(position - 1))
      expect(budgetFromPosition(position)).toBeGreaterThanOrEqual(budgetFromPosition(position - 1))
    }
  })

  it('put a value back where it came from, within a step of the slider', () => {
    for (const seconds of [3600, DAY, 7 * DAY]) expect(limitFromPosition(positionFromLimit(seconds))).toBe(seconds)
    expect(limitFromPosition(positionFromLimit(120 * DAY)) / (120 * DAY)).toBeCloseTo(1, 1)
    for (const kmPerSecond of [0.1, 1, 5]) expect(budgetFromPosition(positionFromBudget(kmPerSecond))).toBeCloseTo(kmPerSecond, 9)
  })
})

describe('route wording', () => {
  it('words small and large speeds and times', () => {
    expect(deltaVText(0.1125)).toBe('112.5 m/s')
    expect(deltaVText(6.0578)).toBe('6,058 m/s')
    expect(limitText(3600)).toBe('1 hour')
    expect(limitText(36 * 3600)).toBe('36 hours')
    expect(limitText(7 * DAY)).toBe('7 days')
    expect(spanText(3 * DAY + 4 * 3600 + 120)).toBe('3 d 4 h')
    expect(spanText(5400)).toBe('1h 30m')
  })

  it('words a circular and an elliptical orbit', () => {
    expect(altitudeText({ perigeeAltitudeKm: 400, apogeeAltitudeKm: 400, inclinationRad: 0 })).toBe('400 km')
    expect(altitudeText({ perigeeAltitudeKm: 400, apogeeAltitudeKm: 600, inclinationRad: 0 })).toBe('400 × 600 km')
  })

  it('has nothing to add about a complete search, nor a route within the limits', () => {
    const model = buildRoutePanelModel(solved())
    expect(listNotes(model.list!, false)).toEqual([])
    expect(routeNotes(model.shown!)).toEqual([])
  })

  it('warns about routes that may not be the ones wanted', () => {
    const { list } = buildRoutePanelModel(solved())
    expect(listNotes({ ...list!, outOfDate: true }, false)[0]).toContain('Out of date')
    expect(listNotes({ ...list!, complete: false }, true)[0]).toContain('Still searching')
    expect(listNotes({ ...list!, complete: false }, false)[0]).toContain('stopped early')
    expect(listNotes({ ...list!, limitedToSeconds: 7200 }, false)[0]).toContain('2050')
    expect(listNotes({ ...list!, alreadyThere: true }, false)[0]).toContain('20 m/s')
    expect(listNotes({ ...list!, withinLimits: false }, false)[0]).toContain('limits')
  })

  it('states plainly which limit a route goes beyond', () => {
    const { shown } = buildRoutePanelModel(solved())
    const [fuel] = routeNotes({ ...shown!, limits: { timeSeconds: null, deltaVKmPerSecond: 0.05 }, totalDeltaVKmPerSecond: 0.11 })
    expect(fuel).toContain('50.0 m/s')
    const [time] = routeNotes({ ...shown!, limits: { timeSeconds: 3600, deltaVKmPerSecond: null }, arrivalSeconds: 7200 })
    expect(time).toContain('1 hour')
  })

  it('says what became of the search', () => {
    const model = buildRoutePanelModel(solved())
    expect(statusText(model)).toBe('')
    expect(statusText({ ...model, status: { kind: 'solving', fraction: 0.1 } })).toContain('Searching')
    expect(statusText({ ...model, status: { kind: 'cancelled' } })).toContain('cancelled')
    expect(statusText({ ...model, status: { kind: 'failed' } })).toContain('failed')
    expect(statusText({ ...model, status: { kind: 'unavailable' } })).toContain('browser')
    expect(statusText({ ...model, noRoute: true })).toContain('No route')
  })

  it('says why a setup cannot be planned, and what a real pair is doing', () => {
    const model = buildRoutePanelModel(solved())
    expect(statusText({ ...model, blocked: 'sameObject' })).toContain('same object')
    expect(statusText({ ...model, pair: { kind: 'loading', id: 'issToTiangong' } })).toContain('Loading')
    expect(statusText({ ...model, pair: { kind: 'refused', id: 'issToTiangong', name: null, refusal: 'unavailable' } })).toContain('could not be reached')
    expect(statusText({ ...model, pair: { kind: 'refused', id: 'issToTiangong', name: 'CSS (TIANHE)', refusal: 'missing' } })).toContain('CSS (TIANHE)')
  })

  it('names satellites, and says when one has been edited', () => {
    const iss = { kind: 'catalogue', catalogId: '25544', name: 'ISS (ZARYA)' } as const
    expect(sideName({ kind: 'example', exampleId: 'altitude', side: 'target' })).toBe('Higher orbit')
    expect(sideTitle({ label: iss, edited: false })).toBe('ISS (ZARYA)')
    expect(sideTitle({ label: iss, edited: true })).toBe('ISS (ZARYA) (edited)')
  })

  it('words how far apart two objects are', () => {
    const lines = (exampleId: RouteExampleId) => Object.fromEntries(separationLines(buildRoutePanelModel(unsolved(exampleId)).separation).map((line) => [line.label, line.value]))
    expect(lines('lowAndMedium')).toEqual({ Height: 'Target 19,650 km higher', 'Angle between the orbit planes': '0.0°', 'Earth turns the planes apart by': '4.24° a day', 'Changing height alone costs': '3,351 m/s' })
    const drift = lines('driftPlanes')
    expect(drift.Height).toBe('The same')
    expect(drift['Earth turns the planes apart by']).toBe('Nothing')
    const waiting = lines('waitForPlanes')
    expect(waiting['The planes line up by themselves in']).toMatch(/^\d+ d \d+ h$/)
  })

  it('words a burn as seen riding along, and what it changes', () => {
    const [first, second] = buildRoutePanelModel(solved()).shown!.burns
    expect(burnDirectionText(first!)).toMatch(/^[\d.]+ m\/s forward, /)
    expect(burnChangeLines(first!)[0]).toMatch(/^Apogee 400 → 6\d\d km$/)
    expect(burnChangeLines(second!)[0]).toMatch(/^Perigee 4\d\d → 6\d\d km$/)
    const turn = { ...first!, progradeKmPerSecond: -0.02, normalKmPerSecond: 0.2, outwardKmPerSecond: 0.001, sizeKmPerSecond: 0.201, turnRad: Math.PI / 90 }
    expect(burnDirectionText(turn)).toBe('200.0 m/s left, 20.0 m/s back')
    expect(burnChangeLines(turn)).toContain('Plane turns 2.00°')
  })

  it('gives element age, with the Real Objects warning once it is old', () => {
    expect(elementAgeLines(null)).toEqual([])
    expect(elementAgeLines(1.5 * DAY)).toEqual(['Elements 1.5 days old'])
    expect(elementAgeLines(-2 * DAY)).toEqual(['Elements dated 2.0 days ahead'])
    const old = elementAgeLines(20 * DAY)
    expect(old).toHaveLength(2)
    expect(old[1]).toMatch(/^Strong age warning/)
  })
})

describe('the altitude slider', () => {
  it('runs from the model’s floor to its ceiling on three significant figures', () => {
    expect(altitudeFromPosition(0)).toBe(200)
    expect(altitudeFromPosition(ROUTE_SLIDER_STEPS)).toBe(100_000)
    for (let position = 0; position <= ROUTE_SLIDER_STEPS; position += 13) {
      const km = altitudeFromPosition(position)
      expect(Number(km.toPrecision(3))).toBeCloseTo(km, 6)
    }
    for (const km of [400, 550, 20_200, 35_800]) expect(altitudeFromPosition(positionFromAltitude(km)) / km).toBeCloseTo(1, 2)
  })
})

describe('the engine slider', () => {
  it('lands on tens of seconds, keeps within its range and finds both presets', () => {
    expect(ispFromPosition(0)).toBe(200)
    expect(ispFromPosition(ROUTE_SLIDER_STEPS)).toBe(4000)
    for (const isp of [300, 1500]) expect(ispFromPosition(positionFromIsp(isp))).toBeCloseTo(isp, -1)
    for (let position = 0; position <= ROUTE_SLIDER_STEPS; position += 37) expect(ispFromPosition(position) % 10).toBe(0)
  })
})
