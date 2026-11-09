import { describe, expect, it } from 'vitest'
import { MAX_SIMULATION_INSTANT } from '../core/constants.ts'
import { addSeconds, type SimulationInstant } from '../core/time.ts'
import { parseOmmRecord } from '../data/omm.ts'
import { catalogueSatellite } from '../simulation/route/routeSources.ts'
import { orbitValuesAt, phaseAheadDeg } from '../simulation/route/routeObjects.ts'
import type { ClockSetting, ManeuverClockPort } from './ManeuverController.ts'
import { rebasedSatellite, RoutePlannerController, type RouteCatalogueEntry, type RouteCataloguePort, type RouteCatalogueRecordResult } from './RoutePlannerController.ts'
import type { RouteSolverCommand, RouteSolverReply } from './routeSolverSession.ts'
import type { RouteSolverFactory, RouteSolverListener } from './routeSolverWorker.ts'
import type { UsageEvent } from './usageEvents.ts'
import type { Route, RouteFront } from '../simulation/route/routeModel.ts'

const START = { unixSeconds: 1_800_000_000 }
/** A route waits half its time, then transfers. */
const route = (deltaV: number, arrivalSeconds: number): Route => ({
  family: 'direct', startInstant: START, totalDeltaVKmPerSecond: deltaV, arrivalSeconds,
  legs: [{ kind: 'wait', fromSeconds: 0, toSeconds: arrivalSeconds / 2 }, { kind: 'transfer', fromSeconds: arrivalSeconds / 2, toSeconds: arrivalSeconds }],
  burns: [{ atSeconds: arrivalSeconds / 2 }, { atSeconds: arrivalSeconds }],
}) as unknown as Route
const front = (complete = true): RouteFront => ({ routes: [route(5, 3600), route(0.2, 80_000)], complete })

/** Rounded elements of the kind each object flies, dated the day before START. */
function elements(catalogId: string, meanMotion: number, inclinationDeg: number, raanDeg: number) {
  const parsed = parseOmmRecord({
    OBJECT_NAME: `OBJECT ${catalogId}`, NORAD_CAT_ID: catalogId, EPOCH: '2027-01-14T08:00:00.000000', EPHEMERIS_TYPE: '0',
    MEAN_MOTION: String(meanMotion), ECCENTRICITY: '0.0004', INCLINATION: String(inclinationDeg), RA_OF_ASC_NODE: String(raanDeg), ARG_OF_PERICENTER: '60', MEAN_ANOMALY: '10',
    BSTAR: '0', MEAN_MOTION_DOT: '0', MEAN_MOTION_DDOT: '0',
  })
  if (!parsed.ok) throw new Error('fixture')
  return parsed.definition.meanElements
}

const RECORDS: Readonly<Record<string, RouteCatalogueRecordResult>> = {
  '25544': { ok: true, catalogId: '25544', name: 'ISS (ZARYA)', elements: elements('25544', 15.5, 51.6, 40) },
  '48274': { ok: true, catalogId: '48274', name: 'CSS (TIANHE)', elements: elements('48274', 15.6, 41.5, 200) },
  '20580': { ok: true, catalogId: '20580', name: 'HST', elements: elements('20580', 15.28, 28.5, 150) },
  // About 150 km up: below the model's floor.
  '90001': { ok: true, catalogId: '90001', name: 'LOW ONE', elements: elements('90001', 16.4, 51.6, 0) },
  '90002': { ok: false, refusal: 'noElements' },
}

function fakeCatalogue(options: { readonly available?: boolean; readonly loaded?: boolean } = {}) {
  let available = options.available ?? true
  let loaded = options.loaded ?? false
  const pending: (() => void)[] = []
  let loads = 0
  const searched: string[] = []
  const port: RouteCataloguePort = {
    load: () => { loads += 1; return new Promise((resolve) => pending.push(() => { loaded ||= available; resolve(available) })) },
    loaded: () => loaded,
    search: (text, limit) => {
      searched.push(text)
      const entries: RouteCatalogueEntry[] = Object.entries(RECORDS).flatMap(([catalogId, found]) => found.ok && found.name.toLowerCase().includes(text.toLowerCase()) ? [{ catalogId, name: found.name }] : [])
      return { entries: entries.slice(0, limit), hasMore: entries.length > limit }
    },
    record: (catalogId) => new Promise((resolve) => pending.push(() => resolve(RECORDS[catalogId] ?? { ok: false, refusal: 'missing' }))),
  }
  return {
    port,
    loads: () => loads,
    searched,
    setAvailable: (value: boolean) => { available = value },
    /** Answers everything asked of the catalogue so far, and what those answers lead to. */
    settle: async () => {
      for (let round = 0; round < 5; round += 1) {
        while (pending.length > 0) pending.shift()!()
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    },
  }
}

function harness(options: { readonly workerless?: boolean; readonly catalogueAvailable?: boolean; readonly catalogueLoaded?: boolean } = {}) {
  const commands: RouteSolverCommand[] = []
  let listener: RouteSolverListener | null = null
  let started = 0
  let disposed = 0
  const events: UsageEvent[] = []
  let changes = 0
  let instant: SimulationInstant = START
  let setting: ClockSetting = { speedMultiplier: 60, playing: true }
  const clock: ManeuverClockPort = {
    instant: () => instant,
    setting: () => setting,
    set: (next, at) => { setting = next; if (at) instant = at },
  }
  const factory: RouteSolverFactory = (given) => {
    if (options.workerless) throw new Error('no Worker')
    started += 1
    listener = given
    return { post: (command) => commands.push(command), dispose: () => { disposed += 1 } }
  }
  const catalogue = fakeCatalogue({ available: options.catalogueAvailable, loaded: options.catalogueLoaded })
  // A fine-tuned route saves 0.05 km/s on the slow one, and nothing on the others.
  const fineTune = (route: Route): Route | null => route.arrivalSeconds === 80_000 ? { ...route, totalDeltaVKmPerSecond: route.totalDeltaVKmPerSecond - 0.05 } : null
  const controller = new RoutePlannerController(clock, factory, catalogue.port, (event) => events.push(event), () => { changes += 1 }, fineTune)
  const planIds = () => commands.filter((command) => command.kind === 'plan').map((command) => command.id)
  const lastPlan = () => planIds().at(-1)!
  const reply = (message: RouteSolverReply) => listener!.reply(message)
  return {
    controller, commands, events, planIds, lastPlan, reply, catalogue,
    fail: () => listener!.failure(),
    moveClock: (at: SimulationInstant) => { instant = at },
    instant: () => instant,
    playing: () => setting.playing,
    speed: () => setting.speedMultiplier,
    started: () => started,
    disposed: () => disposed,
    changes: () => changes,
  }
}

const DAY = 86_400

/** Planned from the live scene as it opens, with the routes found. */
function planned(h = harness()) {
  h.controller.enter()
  h.controller.openPlanner()
  h.reply({ kind: 'done', id: h.lastPlan(), front: front() })
  return h
}

/** The cheaper route, chosen in the window and playing. */
function played(h = harness()) {
  planned(h)
  h.controller.selectRoute(1)
  h.controller.playDetails()
  return h
}

async function picked(h: ReturnType<typeof harness>, side: 'own' | 'target', catalogId: string) {
  h.controller.enableCatalogue()
  await h.catalogue.settle()
  h.controller.pick(side, catalogId)
  await h.catalogue.settle()
}

describe('RoutePlannerController', () => {
  describe('the live scene', () => {
    it('opens on a low and a medium orbit in one plane, running, without planning', () => {
      const h = harness()
      h.controller.enter()
      const snapshot = h.controller.snapshot()
      expect(snapshot.view).toBe('live')
      expect(snapshot.live).toEqual({ instant: START, playing: true, rate: 60 })
      expect(snapshot.setup.tryId).toBe('lowAndMedium')
      expect(snapshot.own.values.perigeeAltitudeKm).toBeCloseTo(550, 6)
      expect(snapshot.target.values.apogeeAltitudeKm).toBeCloseTo(20_200, 6)
      expect(snapshot.separation.planeAngleRad).toBeCloseTo(0, 6)
      expect(snapshot.separation.phaseAheadRad).toBeCloseTo(Math.PI / 2, 9)
      expect(h.planIds()).toEqual([])
      expect(h.started()).toBe(0)
      expect(h.controller.playbackSnapshot()).toBeNull()
    })

    it('pauses the shared clock and runs its own instant at its own rate', () => {
      const h = harness()
      h.controller.enter()
      expect(h.playing()).toBe(false)
      expect(h.speed()).toBe(60)
      expect(h.controller.frame(0.5)).toEqual(addSeconds(START, 30))
      h.controller.setLiveRate(3600)
      expect(h.controller.frame(0.5)).toEqual(addSeconds(START, 1830))
      h.controller.setLiveRate(7)
      expect(h.controller.snapshot().live.rate).toBe(3600)
      h.controller.toggleLive()
      expect(h.controller.frame(0.5)).toEqual(addSeconds(START, 1830))
      expect(h.controller.liveRunning()).toBe(false)
    })

    it('stops at the clock’s end', () => {
      const h = harness()
      h.moveClock({ unixSeconds: Date.UTC(2050, 0, 1) / 1000 - 10 })
      h.controller.enter()
      h.controller.frame(1)
      expect(h.controller.snapshot().live).toMatchObject({ instant: { unixSeconds: Date.UTC(2050, 0, 1) / 1000 }, playing: false })
    })

    it('leaving pauses it where it is, and returning shows it there', () => {
      const h = harness()
      h.controller.enter()
      const at = h.controller.frame(1)
      h.controller.leave()
      h.moveClock(addSeconds(START, 1e6))
      h.controller.enter()
      expect(h.instant()).toEqual(at)
      expect(h.controller.snapshot().live.playing).toBe(false)
    })
  })

  describe('editing the objects', () => {
    it('changes an orbit where the object is now, keeping its place along it', () => {
      const h = harness()
      h.controller.enter()
      const now = h.controller.frame(30)
      const before = h.controller.snapshot().own.values
      h.controller.editObject('own', { inclinationDeg: 60, raanDeg: 40 })
      const after = h.controller.snapshot()
      expect(after.own.values).toMatchObject({ inclinationDeg: expect.closeTo(60, 9), raanDeg: expect.closeTo(40, 9) })
      expect(after.own.values.argumentOfLatitudeDeg).toBeCloseTo(before.argumentOfLatitudeDeg, 6)
      expect(after.own.object.satellite.phase.referenceInstant).toEqual(now)
      expect(after.own.object.edited).toBe(true)
      expect(after.setup.tryId).toBeNull()
    })

    it('sets both heights of a circular orbit, and each of an elliptical one', () => {
      const h = harness()
      h.controller.enter()
      h.controller.editObject('own', { perigeeAltitudeKm: 800 })
      expect(h.controller.snapshot().own.values).toMatchObject({ perigeeAltitudeKm: expect.closeTo(800, 6), apogeeAltitudeKm: expect.closeTo(800, 6) })
      h.controller.setCircular('own', false)
      h.controller.editObject('own', { apogeeAltitudeKm: 3000 })
      expect(h.controller.snapshot().own.values).toMatchObject({ perigeeAltitudeKm: expect.closeTo(800, 6), apogeeAltitudeKm: expect.closeTo(3000, 6) })
      h.controller.setCircular('own', true)
      expect(h.controller.snapshot().own.values).toMatchObject({ perigeeAltitudeKm: expect.closeTo(1900, 6), apogeeAltitudeKm: expect.closeTo(1900, 6) })
    })

    it('keeps heights within the model’s limits', () => {
      const h = harness()
      h.controller.enter()
      h.controller.editObject('own', { perigeeAltitudeKm: 50 })
      expect(h.controller.snapshot().own.values.perigeeAltitudeKm).toBeCloseTo(200, 6)
      h.controller.editObject('target', { apogeeAltitudeKm: 500_000 })
      expect(h.controller.snapshot().target.values.apogeeAltitudeKm).toBeCloseTo(100_000, 6)
    })

    it('places the target ahead of you by an angle', () => {
      const h = harness()
      h.controller.enter()
      h.controller.editObject('target', { inclinationDeg: 30, raanDeg: 20 })
      h.controller.setTargetAhead(-45)
      const { setup, instant } = h.controller.snapshot()
      expect(phaseAheadDeg(setup.own.satellite, setup.target.satellite, instant)).toBeCloseTo(-45, 4)
    })

    it('swaps the two objects', () => {
      const h = harness()
      h.controller.enter()
      const { own, target } = h.controller.snapshot().setup
      h.controller.swap()
      expect(h.controller.snapshot().setup).toMatchObject({ own: target, target: own })
    })

    it('a Try these card sets both objects where the scene is, leaving the limits, without planning', () => {
      const h = harness()
      h.controller.enter()
      const now = h.controller.frame(10)
      h.controller.setLimitFuel(true)
      h.controller.selectTry('waitForPlanes')
      const { setup, own } = h.controller.snapshot()
      expect(setup).toMatchObject({ tryId: 'waitForPlanes', limitTime: false, limitFuel: true })
      expect(own.object.satellite.phase.referenceInstant).toEqual(now)
      expect(h.planIds()).toEqual([])
    })
  })

  describe('the catalogue', () => {
    it('is off until switched on, and then loads once and searches', async () => {
      const h = harness()
      h.controller.enter()
      expect(h.controller.snapshot().catalogue).toBe('off')
      h.controller.searchCatalogue('iss')
      expect(h.catalogue.searched).toEqual([])
      h.controller.enableCatalogue()
      expect(h.controller.snapshot().catalogue).toBe('loading')
      h.controller.enableCatalogue()
      await h.catalogue.settle()
      expect(h.controller.snapshot()).toMatchObject({ catalogue: 'ready', search: { text: 'iss', results: [{ catalogId: '25544', name: 'ISS (ZARYA)' }] } })
      expect(h.catalogue.loads()).toBe(1)
    })

    it('is on already when another mode loaded it', () => {
      const h = harness({ catalogueLoaded: true })
      expect(h.controller.snapshot().catalogue).toBe('ready')
      h.controller.enableCatalogue()
      expect(h.catalogue.loads()).toBe(0)
    })

    it('says when it cannot be loaded, and can be tried again', async () => {
      const h = harness({ catalogueAvailable: false })
      h.controller.enableCatalogue()
      await h.catalogue.settle()
      expect(h.controller.snapshot().catalogue).toBe('unavailable')
      h.catalogue.setAvailable(true)
      h.controller.enableCatalogue()
      await h.catalogue.settle()
      expect(h.controller.snapshot().catalogue).toBe('ready')
    })

    it('takes a found object for either side, where SGP4 has it in the live scene', async () => {
      const h = harness()
      h.controller.enter()
      const now = h.controller.frame(60)
      await picked(h, 'target', '48274')
      const { setup } = h.controller.snapshot()
      const expected = catalogueSatellite('48274', (RECORDS['48274'] as Extract<RouteCatalogueRecordResult, { ok: true }>).elements, now)
      expect(setup.target).toMatchObject({ source: { kind: 'catalogue', catalogId: '48274', name: 'CSS (TIANHE)' }, edited: false, circular: false })
      expect(setup.target.satellite).toEqual(expected.ok && expected.satellite)
      expect(setup.tryId).toBeNull()
      await picked(h, 'own', '25544')
      expect(h.controller.snapshot().setup.own.source).toMatchObject({ catalogId: '25544' })
    })

    it('refuses an object that cannot be planned with, and says why', async () => {
      const h = harness()
      h.controller.enter()
      const before = h.controller.snapshot().setup
      for (const [catalogId, refusal] of [['90001', 'tooLow'], ['90002', 'noElements'], ['12345', 'missing']] as const) {
        await picked(h, 'target', catalogId)
        expect(h.controller.snapshot().search).toMatchObject({ pending: null, refusal })
      }
      expect(h.controller.snapshot().setup).toBe(before)
    })

    it('will not plan from an object to itself until one is changed', async () => {
      const h = harness()
      h.controller.enter()
      await picked(h, 'own', '25544')
      await picked(h, 'target', '25544')
      expect(h.controller.snapshot().blocked).toBe('sameObject')
      h.controller.plan()
      expect(h.planIds()).toEqual([])
      h.controller.editObject('own', { inclinationDeg: 52 })
      expect(h.controller.snapshot().blocked).toBeNull()
      h.controller.plan()
      expect(h.planIds()).toHaveLength(1)
    })

    it('a real pair fetches its two objects', async () => {
      const h = harness()
      h.controller.enter()
      h.controller.selectTry('issToTiangong')
      expect(h.controller.snapshot().pair).toEqual({ kind: 'loading', id: 'issToTiangong' })
      await h.catalogue.settle()
      const snapshot = h.controller.snapshot()
      expect(snapshot.pair).toBeNull()
      expect(snapshot.catalogue).toBe('ready')
      expect(snapshot.setup).toMatchObject({ own: { source: { catalogId: '25544' } }, target: { source: { catalogId: '48274' } }, tryId: 'issToTiangong' })
      expect(h.planIds()).toEqual([])
      h.controller.plan()
      h.reply({ kind: 'done', id: h.lastPlan(), front: front() })
      h.controller.selectRoute(0)
      h.controller.playDetails()
      expect(h.events.at(-1)).toMatchObject({ type: 'route_planned', sources: 'catalogue' })
    })

    it('says why a real pair cannot be planned, and keeps the setup', async () => {
      const h = harness({ catalogueAvailable: false })
      h.controller.enter()
      const before = h.controller.snapshot().setup
      h.controller.selectTry('hubbleToIss')
      await h.catalogue.settle()
      expect(h.controller.snapshot().pair).toEqual({ kind: 'refused', id: 'hubbleToIss', name: null, refusal: 'unavailable' })
      expect(h.controller.snapshot().setup).toBe(before)
      h.controller.selectTry('altitude')
      expect(h.controller.snapshot().pair).toBeNull()
    })

    it('a swap drops a real pair still loading, so it cannot replace the objects later', async () => {
      const h = harness()
      h.controller.enter()
      const { own, target } = h.controller.snapshot().setup
      h.controller.selectTry('issToTiangong')
      h.controller.swap()
      expect(h.controller.snapshot().pair).toBeNull()
      await h.catalogue.settle()
      expect(h.controller.snapshot()).toMatchObject({ pair: null, setup: { own: target, target: own, tryId: null } })
    })

    it('an edit drops a pick still loading for either side', async () => {
      const h = harness()
      h.controller.enter()
      h.controller.enableCatalogue()
      await h.catalogue.settle()
      h.controller.pick('target', '25544')
      h.controller.editObject('target', { inclinationDeg: 30 })
      expect(h.controller.snapshot().search.pending).toBeNull()
      await h.catalogue.settle()
      const { setup } = h.controller.snapshot()
      expect(setup.target.source.kind).not.toBe('catalogue')
      expect(orbitValuesAt(setup.target.satellite, h.controller.snapshot().live.instant).inclinationDeg).toBeCloseTo(30, 6)
    })

    it('counts a route between an example orbit and a catalogue object as mixed', async () => {
      const h = harness()
      h.controller.enter()
      await picked(h, 'target', '25544')
      h.controller.plan()
      h.reply({ kind: 'done', id: h.lastPlan(), front: front() })
      h.controller.selectRoute(1)
      h.controller.playDetails()
      expect(h.events.at(-1)).toMatchObject({ sources: 'mixed' })
    })
  })

  describe('planning', () => {
    it('plans from the live scene as it is, which pauses', () => {
      const h = harness()
      h.controller.enter()
      const now = h.controller.frame(12)
      const { setup } = h.controller.snapshot()
      h.controller.plan()
      const command = h.commands.at(-1)!
      expect(command.kind === 'plan' && command.request).toMatchObject({ startInstant: now, own: rebasedSatellite(setup.own.satellite, now), target: rebasedSatellite(setup.target.satellite, now) })
      expect(h.controller.snapshot().live.playing).toBe(false)
      expect(h.controller.snapshot().status).toEqual({ kind: 'solving', fraction: 0 })
    })

    it('rebases an object’s elements to another instant without moving it', () => {
      const h = harness()
      const { own } = h.controller.snapshot().setup
      const later = addSeconds(START, 5000)
      const rebased = rebasedSatellite(own.satellite, later)
      expect(rebased.phase.referenceInstant).toEqual(later)
      expect(orbitValuesAt(rebased, later).argumentOfLatitudeDeg).toBeCloseTo(orbitValuesAt(own.satellite, later).argumentOfLatitudeDeg, 9)
    })

    it('reports progress, then the routes found, while the scene waits', () => {
      const h = harness()
      h.controller.enter()
      h.controller.plan()
      h.reply({ kind: 'progress', id: h.lastPlan(), fraction: 0.4, front: null })
      expect(h.controller.snapshot()).toMatchObject({ status: { kind: 'solving', fraction: 0.4 }, result: null, view: 'live' })
      h.reply({ kind: 'done', id: h.lastPlan(), front: front() })
      const snapshot = h.controller.snapshot()
      expect(snapshot.status).toEqual({ kind: 'idle' })
      expect(snapshot.view).toBe('live')
      expect(h.controller.playbackSnapshot()).toBeNull()
      expect(snapshot.shortlist).toMatchObject({ withinLimits: true, points: [{ totalDeltaVKmPerSecond: 5 }, { totalDeltaVKmPerSecond: 0.2 }] })
      expect(snapshot.hasRoute).toBe(false)
    })

    it('shows a first front while still searching', () => {
      const h = harness()
      h.controller.enter()
      h.controller.plan()
      h.reply({ kind: 'progress', id: h.lastPlan(), fraction: 0.3, front: front(false) })
      expect(h.controller.snapshot().status.kind).toBe('solving')
      expect(h.controller.snapshot().result?.front.complete).toBe(false)
    })

    it('cancels the running search when asked for a new one, and ignores its replies', () => {
      const h = harness()
      h.controller.enter()
      h.controller.plan()
      const first = h.lastPlan()
      h.controller.plan()
      expect(h.commands).toContainEqual({ kind: 'cancel', id: first })
      h.reply({ kind: 'done', id: first, front: front() })
      expect(h.controller.snapshot().result).toBeNull()
      expect(h.controller.snapshot().status.kind).toBe('solving')
    })

    it('a cancelled or failed search leaves the previous result in place', () => {
      const h = planned()
      const kept = h.controller.snapshot().result
      h.controller.plan()
      const second = h.lastPlan()
      h.controller.cancel()
      expect(h.commands).toContainEqual({ kind: 'cancel', id: second })
      expect(h.controller.snapshot()).toMatchObject({ status: { kind: 'cancelled' }, result: kept })
      h.reply({ kind: 'done', id: second, front: front() })
      expect(h.controller.snapshot().result).toBe(kept)
      h.controller.plan()
      h.reply({ kind: 'failed', id: h.lastPlan() })
      expect(h.controller.snapshot()).toMatchObject({ status: { kind: 'failed' }, result: kept })
    })

    it('marks a result out of date when an object or the scene changes, but not the limits, without planning again', () => {
      const h = planned()
      expect(h.controller.snapshot().outOfDate).toBe(false)
      h.controller.setLimitTime(true)
      h.controller.setLimit(7200)
      expect(h.controller.snapshot().outOfDate).toBe(false)
      h.controller.exitRoute()
      expect(h.controller.snapshot().outOfDate).toBe(false)
      h.controller.setTargetAhead(10)
      expect(h.controller.snapshot().outOfDate).toBe(true)
      expect(h.planIds()).toHaveLength(1)
    })

    it('a scene run on since planning is out of date', () => {
      const h = planned()
      h.controller.closePlanner()
      h.controller.frame(1)
      expect(h.controller.snapshot().outOfDate).toBe(true)
    })

    it('a search answers the objects it was asked for, even if they have changed since', () => {
      const h = harness()
      h.controller.enter()
      h.controller.plan()
      const asked = h.controller.snapshot().setup.target
      h.controller.setTargetAhead(30)
      h.reply({ kind: 'done', id: h.lastPlan(), front: front() })
      expect(h.controller.snapshot().result?.setup.target).toBe(asked)
      expect(h.controller.snapshot().outOfDate).toBe(true)
    })

    it('looks a year ahead whatever the limits, which only choose among the routes found', () => {
      const h = harness()
      h.controller.enter()
      h.controller.setLimitTime(true)
      h.controller.setLimit(7200)
      h.controller.plan()
      const command = h.commands.at(-1)!
      expect(command.kind === 'plan' && command.request.horizonSeconds).toBe(365 * DAY)
      h.reply({ kind: 'done', id: h.lastPlan(), front: front() })
      expect(h.controller.snapshot().shortlist).toMatchObject({ withinLimits: true, points: [{ arrivalSeconds: 3600 }] })
      h.controller.setLimitFuel(true)
      h.controller.setBudget(0.1)
      expect(h.controller.snapshot().shortlist?.withinLimits).toBe(false)
      h.controller.setLimitTime(false)
      h.controller.setLimitFuel(false)
      expect(h.controller.snapshot().shortlist?.points).toHaveLength(2)
    })

    it('says the clock’s end shortened the search', () => {
      const h = harness()
      h.moveClock({ unixSeconds: Date.UTC(2050, 0, 1) / 1000 - 3 * 3600 })
      h.controller.enter()
      h.controller.toggleLive()
      planned(h)
      expect(h.controller.snapshot().result?.limitedToSeconds).toBe(3 * 3600)
    })

    it('reports a browser without Workers rather than searching on the page', () => {
      const h = harness({ workerless: true })
      h.controller.enter()
      h.controller.plan()
      expect(h.controller.snapshot().status).toEqual({ kind: 'unavailable' })
    })

    it('a Worker that stops is reported, and the next plan starts a new one', () => {
      const h = harness()
      h.controller.enter()
      h.controller.plan()
      h.fail()
      expect(h.controller.snapshot().status).toEqual({ kind: 'unavailable' })
      expect(h.disposed()).toBe(1)
      h.controller.plan()
      expect(h.started()).toBe(2)
    })

    it('counts every route played, with the limits that chose it', () => {
      const h = planned()
      expect(h.events).toEqual([])
      h.controller.setLimitTime(true)
      h.controller.selectRoute(0)
      h.controller.playDetails()
      expect(h.events).toEqual([{ type: 'route_planned', limits: 'time', family: 'direct', deltaV: '3000-6000', duration: 'under-6h', sources: 'example' }])
    })

    it('tells its owner about every change', () => {
      const h = harness()
      h.controller.enter()
      h.controller.plan()
      const before = h.changes()
      h.reply({ kind: 'progress', id: h.lastPlan(), fraction: 0.5, front: null })
      h.controller.setLimit(7200)
      h.controller.cancel()
      expect(h.changes()).toBe(before + 3)
    })

    it('keeps the camera view and Turn to each burn, telling its owner of a change', () => {
      const h = harness()
      expect(h.controller.cameraSettings()).toEqual({ camera: 'free', frameBurns: false })
      const before = h.changes()
      h.controller.setCameraView('edgeOn')
      h.controller.setCameraView('edgeOn')
      h.controller.setFrameBurns(true)
      expect(h.controller.snapshot()).toMatchObject({ camera: 'edgeOn', frameBurns: true })
      expect(h.changes()).toBe(before + 2)
    })

    it('changes the engine without making the route out of date, within its range', () => {
      const h = planned()
      expect(h.controller.snapshot().specificImpulseSeconds).toBe(300)
      h.controller.setSpecificImpulse(1500)
      expect(h.controller.snapshot()).toMatchObject({ specificImpulseSeconds: 1500, outOfDate: false })
      h.controller.setSpecificImpulse(50)
      expect(h.controller.snapshot().specificImpulseSeconds).toBe(200)
      h.controller.setSpecificImpulse(Number.NaN)
      expect(h.controller.snapshot().specificImpulseSeconds).toBe(200)
    })

    it('stops the Worker when disposed', () => {
      const h = planned()
      h.controller.dispose()
      expect(h.disposed()).toBe(1)
    })
  })

  describe('the planning window', () => {
    it('stays closed, and the scene running, while the setup cannot be planned', async () => {
      const h = harness()
      h.controller.enter()
      await picked(h, 'own', '25544')
      await picked(h, 'target', '25544')
      h.controller.openPlanner()
      expect(h.controller.snapshot()).toMatchObject({ window: 'closed', blocked: 'sameObject', live: { playing: true } })
      expect(h.planIds()).toEqual([])
    })

    it('will not plan within the shortest time limit of the clock’s end', () => {
      const h = harness()
      h.moveClock(addSeconds(MAX_SIMULATION_INSTANT, -1800))
      h.controller.enter()
      expect(h.controller.snapshot().blocked).toBe('clockEnds')
      h.controller.openPlanner()
      h.controller.plan()
      expect(h.planIds()).toEqual([])
      expect(h.controller.snapshot().window).toBe('closed')
    })

    it('opens over the scene, pausing it, and plans from that moment', () => {
      const h = harness()
      h.controller.enter()
      const now = h.controller.frame(3)
      h.controller.openPlanner()
      expect(h.controller.snapshot()).toMatchObject({ window: 'routes', view: 'live', live: { instant: now, playing: false } })
      expect(h.planIds()).toHaveLength(1)
    })

    it('opens on the routes already found for this moment without planning again', () => {
      const h = planned()
      h.controller.closePlanner()
      h.controller.toggleLive()
      h.controller.openPlanner()
      expect(h.planIds()).toHaveLength(1)
      expect(h.controller.snapshot().outOfDate).toBe(false)
    })

    it('plans again once the scene has moved on', () => {
      const h = planned()
      h.controller.closePlanner()
      h.controller.frame(1)
      h.controller.openPlanner()
      expect(h.planIds()).toHaveLength(2)
    })

    it('closing stops the search and lets the scene run on as it was', () => {
      const h = harness()
      h.controller.enter()
      h.controller.openPlanner()
      const running = h.lastPlan()
      h.controller.closePlanner()
      expect(h.commands).toContainEqual({ kind: 'cancel', id: running })
      expect(h.controller.snapshot()).toMatchObject({ window: 'closed', live: { playing: true } })
      h.controller.toggleLive()
      h.controller.openPlanner()
      h.controller.closePlanner()
      expect(h.controller.snapshot().live.playing).toBe(false)
    })

    it('shows a pressed route’s details, fine-tuned when that saves something', () => {
      const h = planned()
      h.controller.selectRoute(0)
      expect(h.controller.snapshot()).toMatchObject({ window: 'details', details: { route: { arrivalSeconds: 3600 }, fineTuned: null } })
      h.controller.backToRoutes()
      expect(h.controller.snapshot().window).toBe('routes')
      h.controller.selectRoute(1)
      const { details } = h.controller.snapshot()
      expect(details?.fineTuned?.totalDeltaVKmPerSecond).toBeCloseTo(0.15, 12)
      expect(details?.route.arrivalSeconds).toBe(80_000)
      h.controller.selectRoute(7)
      expect(h.controller.snapshot().details?.route.arrivalSeconds).toBe(80_000)
    })

    it('plays the fine-tuned route in place of the scene, closing the window', () => {
      const h = played()
      expect(h.controller.snapshot()).toMatchObject({ window: 'closed', view: 'route' })
      expect(h.controller.playbackSnapshot()!.route.totalDeltaVKmPerSecond).toBeCloseTo(0.15, 12)
    })
  })

  describe('playback', () => {
    it('starts a found route at its beginning, paused, with the clock at its start', () => {
      const h = played()
      const playback = h.controller.playbackSnapshot()!
      expect(playback.route.arrivalSeconds).toBe(80_000)
      expect(playback.state).toMatchObject({ tau: 0, playing: false })
      expect(h.controller.frame(0.5)).toEqual(START)
    })

    it('moves the route’s instant while playing, and pauses at the end', () => {
      const h = played()
      h.controller.togglePlaying()
      expect(h.controller.frame(0.1).unixSeconds).toBeGreaterThan(START.unixSeconds)
      for (let frame = 0; frame < 700; frame += 1) h.controller.frame(0.1)
      expect(h.controller.playbackSnapshot()!.state.playing).toBe(false)
      expect(h.controller.frame(0.1)).toEqual(addSeconds(START, 80_000))
    })

    it('exits to the live scene as it was when planned, paused, and can show the route again', () => {
      const h = played()
      h.controller.togglePlaying()
      const at = h.controller.frame(2)
      h.controller.exitRoute()
      expect(h.controller.snapshot()).toMatchObject({ view: 'live', live: { instant: START, playing: false } })
      expect(h.controller.playbackSnapshot()).toBeNull()
      expect(h.controller.frame(1)).toEqual(START)
      h.controller.viewRoute()
      expect(h.controller.snapshot().view).toBe('route')
      expect(h.controller.frame(0)).toEqual(at)
    })

    it('editing an object leaves the route for the live scene', () => {
      const h = played()
      h.controller.editObject('target', { raanDeg: 10 })
      expect(h.controller.snapshot()).toMatchObject({ view: 'live', outOfDate: true })
    })

    it('a new route starts again from its beginning, paused, keeping speed and direction', () => {
      const h = played()
      h.controller.seek(20)
      h.controller.setPlaybackSpeed({ kind: 'constant', rate: 1000 })
      h.controller.setReversed(true)
      h.controller.exitRoute()
      h.controller.setLimit(2 * DAY)
      h.controller.openPlanner()
      h.reply({ kind: 'done', id: h.lastPlan(), front: front() })
      h.controller.selectRoute(0)
      h.controller.playDetails()
      expect(h.controller.playbackSnapshot()!.state).toMatchObject({ tau: 0, playing: false, reversed: true, speed: { kind: 'constant', rate: 1000 } })
    })

    it('playing the same route again starts it from its beginning', () => {
      const h = planned()
      h.controller.selectRoute(0)
      h.controller.playDetails()
      const first = h.controller.playbackSnapshot()!.route
      h.controller.togglePlaying()
      h.controller.frame(2)
      expect(h.controller.playbackSnapshot()!.state.tau).toBeGreaterThan(0)
      h.controller.exitRoute()
      h.controller.openPlanner()
      expect(h.planIds()).toHaveLength(1)
      h.controller.selectRoute(0)
      h.controller.playDetails()
      const again = h.controller.playbackSnapshot()!
      expect(again.route).toBe(first)
      expect(again.state).toMatchObject({ tau: 0, playing: false })
    })

    it('a new search puts away the route that was played', () => {
      const h = played()
      h.controller.exitRoute()
      h.controller.plan()
      expect(h.controller.snapshot().view).toBe('live')
      h.controller.viewRoute()
      expect(h.controller.playbackSnapshot()).toBeNull()
    })

    it('scrubbing pauses, and a burn can be shown or stepped to', () => {
      const h = played()
      h.controller.togglePlaying()
      h.controller.seek(1)
      expect(h.controller.playbackSnapshot()!.state).toMatchObject({ tau: 1, playing: false })
      h.controller.stepBurn(1)
      expect(h.controller.playbackSnapshot()!.point.burnIndex).toBe(0)
      h.controller.showBurn(1)
      expect(h.controller.playbackSnapshot()!.point.burnIndex).toBe(1)
      h.controller.stepBurn(-1)
      expect(h.controller.playbackSnapshot()!.point.burnIndex).toBe(0)
    })

    it('leaving pauses playback, and returning shows the route where it was', () => {
      const h = played()
      h.controller.togglePlaying()
      const at = h.controller.frame(2)
      h.controller.leave()
      expect(h.controller.playbackSnapshot()!.state.playing).toBe(false)
      h.moveClock(addSeconds(START, 1e6))
      h.controller.enter()
      expect(h.instant()).toEqual(at)
      expect(h.playing()).toBe(false)
    })

  })
})
