import { expect, it, vi } from 'vitest'
import { Scene } from 'three'
import { degToRad, TAU } from '../core/angles.ts'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { SECONDS_PER_DAY } from '../core/julianDate.ts'
import { lengthVec3, subtractVec3 } from '../core/vec3.ts'
import { meanMotion } from '../orbital/geometry.ts'
import { stateVectorEci } from '../orbital/keplerian.ts'
import { sampleKeplerianPathEciKm } from '../orbital/pathSampling.ts'
import { OrbitalObjectRuntime, type RuntimeSchedulingOptions, type BodyViewPort, type GroundTrackViewPort, type PathViewPort, type SensorGeometryViewPort } from './OrbitalObjectRuntime.ts'
import { createDefaultOrbitLabObject, createInitialState } from '../state/initialState.ts'
import { createPropagator, type KeplerianOrbitalObject, type OrbitalObject } from '../simulation/OrbitalObject.ts'
import { ORBIT_PRESETS, createObjectFromPreset } from '../simulation/orbitPresets.ts'
import { nominalOrbitalPeriodSeconds } from '../simulation/groundTrack.ts'
import { earthOrientationAt } from '../simulation/earthOrientation.ts'
import { groundTrackHistoryStepSeconds } from '../simulation/groundTrackHistory.ts'
import { OrbitPropagationError } from '../orbital/propagationError.ts'
import { combineGroundTrackViewPorts } from './combineGroundTrackViewPorts.ts'
import { createPathAdapter } from './createPathAdapter.ts'
import { OrbitalBodyView } from '../scene/OrbitalBodyView.ts'
import type { OrbitPathView } from '../scene/OrbitPathView.ts'

const initialKeplerian = (): KeplerianOrbitalObject => createDefaultOrbitLabObject('demo-satellite', 0xffc857, SIMULATION_START_INSTANT)

const stubBody = (): BodyViewPort => ({ update: vi.fn(), setVisible: vi.fn(), setSize: vi.fn(), setZoomScaling: vi.fn(), setColor: vi.fn(), setOpacity: vi.fn(), dispose: vi.fn() })
const stubPath = (): PathViewPort => ({ rebuildShape: vi.fn(), setOrientation: vi.fn(), setVisible: vi.fn(), setColor: vi.fn(), setSelected: vi.fn(), dispose: vi.fn() })
const stubSensor = (): SensorGeometryViewPort => ({ setGeometry: vi.fn(), setVisible: vi.fn(), setColor: vi.fn(), setSelected: vi.fn(), dispose: vi.fn() })

it('highlights every selected object while retaining one primary priority id', () => {
  const paths = new Map<string, PathViewPort>()
  const runtime = new OrbitalObjectRuntime({
    createBody: stubBody,
    createPath: (object) => { const path = stubPath(); paths.set(object.id, path); return path },
    createPropagator,
  })
  const a = initialKeplerian()
  const b = { ...initialKeplerian(), id: 'b' }
  runtime.reconcile([a, b], { primaryId: a.id, selectedIds: new Set([a.id, b.id]) })
  expect(paths.get(a.id)!.setSelected).toHaveBeenLastCalledWith(true)
  expect(paths.get(b.id)!.setSelected).toHaveBeenLastCalledWith(true)
  runtime.reconcile([a, b], { primaryId: b.id, selectedIds: new Set([b.id]) })
  expect(paths.get(a.id)!.setSelected).toHaveBeenLastCalledWith(false)
  expect(paths.get(b.id)!.setSelected).toHaveBeenLastCalledWith(true)
  runtime.dispose()
})

it('isolates changes, shares instants, retains hidden propagation and releases once', () => {
  const bodies = new Map<string, BodyViewPort>()
  const paths = new Map<string, PathViewPort>()
  const propagators: ReturnType<typeof createPropagator>[] = []
  const runtime = new OrbitalObjectRuntime({
    createBody: (object) => { const view = stubBody(); bodies.set(object.id, view); return view },
    createPath: (object) => { const view = stubPath(); paths.set(object.id, view); return view },
    createPropagator: (source, propagation) => { const propagator = createPropagator(source, propagation); vi.spyOn(propagator, 'stateAt'); propagators.push(propagator); return propagator },
  })
  let a = initialKeplerian()
  const b = { ...initialKeplerian(), id: 'b' }
  runtime.reconcile([a, b], a.id)
  expect(paths.size).toBe(2)
  expect(paths.get(a.id)!.rebuildShape).not.toHaveBeenCalled()
  const instant = { unixSeconds: 12345 }
  const before = runtime.updateAt(instant).get('b')
  // An orientation-only change must not resample the conic.
  a = { ...a, source: { ...a.source, geometry: { ...a.source.geometry, inclinationRad: 1 } } }
  runtime.reconcile([a, b], a.id)
  expect(paths.get(a.id)!.rebuildShape).not.toHaveBeenCalled()
  a = { ...a, source: { ...a.source, geometry: { ...a.source.geometry, semiMajorAxisKm: 11000 } } }
  runtime.reconcile([a, b], a.id)
  expect(paths.get(a.id)!.rebuildShape).toHaveBeenCalledTimes(1)
  expect(paths.get('b')!.rebuildShape).not.toHaveBeenCalled()
  a = { ...a, source: { ...a.source, phase: { ...a.source.phase, meanAnomalyAtReferenceRad: 2 } }, style: { ...a.style, colorHex: 1 }, display: { ...a.display, bodyVisible: false, orbitPathVisible: false } }
  runtime.reconcile([a, b], 'b')
  runtime.reconcile([{ ...a, source: structuredClone(a.source) }, b], 'b')
  expect(paths.get(a.id)!.rebuildShape).toHaveBeenCalledTimes(1)
  const samples = runtime.updateAt(instant)
  expect(samples.get('b')!.state).toEqual(before!.state)
  expect(samples.get(a.id)!.state).toEqual(createPropagator(a.source, a.propagation).stateAt(instant))
  for (const propagator of propagators.filter((p) => vi.mocked(p.stateAt).mock.calls.length)) expect(propagator.stateAt).toHaveBeenLastCalledWith(instant)
  expect(bodies.get(a.id)!.update).toHaveBeenCalledTimes(2)
  runtime.reconcile([b], 'b')
  runtime.reconcile([b], 'b')
  runtime.dispose(); runtime.dispose()
  for (const view of [...bodies.values(), ...paths.values()]) expect(view.dispose).toHaveBeenCalledTimes(1)
})

it('recreates a propagator when propagation changes but never when the editing lock does', () => {
  let created = 0
  const runtime = new OrbitalObjectRuntime({
    createBody: stubBody, createPath: stubPath,
    createPropagator: (source, propagation) => { created += 1; return createPropagator(source, propagation) },
  })
  const object = initialKeplerian()
  runtime.reconcile([object], object.id)
  expect(created).toBe(1)

  const locked: OrbitalObject = { ...object, editingLock: { kind: 'sunSynchronous' } }
  runtime.reconcile([locked], object.id)
  runtime.reconcile([{ ...locked, editingLock: { kind: 'none' } }], object.id)
  expect(created).toBe(1)

  runtime.reconcile([{ ...object, propagation: { kind: 'j2Secular' } }], object.id)
  expect(created).toBe(2)
})

it('publishes a coherent frame sample whose body sits on its own drawn path', () => {
  const runtime = new OrbitalObjectRuntime({ createBody: stubBody, createPath: stubPath, createPropagator })
  const base = initialKeplerian()
  const drifting: OrbitalObject = {
    ...base, id: 'drifting', propagation: { kind: 'j2Secular' },
    source: {
      kind: 'keplerian',
      geometry: { semiMajorAxisKm: 7178.137, eccentricity: 0.01, inclinationRad: degToRad(98.6), raanRad: degToRad(155), argOfPeriapsisRad: degToRad(40) },
      phase: { referenceInstant: { ...SIMULATION_START_INSTANT }, meanAnomalyAtReferenceRad: 0.9 },
    },
  }
  runtime.reconcile([drifting], drifting.id)

  for (const days of [0, 1, 90, 200, 365]) {
    const instant = { unixSeconds: SIMULATION_START_INSTANT.unixSeconds + days * SECONDS_PER_DAY }
    const sample = runtime.updateAt(instant).get('drifting')!
    const conic = sample.conic!

    // Both paths call the same pure functions with the same
    // arguments, so this is bit-identical rather than approximate.
    expect(stateVectorEci(conic.geometry, conic.trueAnomalyRad)).toEqual(sample.state)

    // The revolution counting is self-consistent.
    const revolutions = (conic.unwrappedTrueAnomalyRad - conic.trueAnomalyRad) / TAU
    expect(Number.isInteger(Math.round(revolutions))).toBe(true)
    expect(Math.abs(revolutions - Math.round(revolutions))).toBeLessThan(1e-9)
    for (const angle of [conic.trueAnomalyRad, conic.meanAnomalyRad]) {
      expect(angle).toBeGreaterThanOrEqual(0)
      expect(angle).toBeLessThan(TAU)
    }
    // True and mean anomaly lie in the same half of the revolution.
    expect(conic.trueAnomalyRad < Math.PI).toBe(conic.meanAnomalyRad < Math.PI)

    // The body lies on the conic the same frame published,
    // within the 512-sample chord tolerance.
    const path = sampleKeplerianPathEciKm(conic.geometry, 512)
    let nearest = Infinity
    for (const point of path) nearest = Math.min(nearest, lengthVec3(subtractVec3(point, sample.state.positionProjectInertialKm)))
    const chordKm = (TAU / 512) * conic.geometry.semiMajorAxisKm * (1 + conic.geometry.eccentricity)
    expect(nearest).toBeLessThan(chordKm)
  }
})

it('gives a two-body object the exact two-body rates and its stored geometry', () => {
  const runtime = new OrbitalObjectRuntime({ createBody: stubBody, createPath: stubPath, createPropagator })
  const object = initialKeplerian()
  runtime.reconcile([object], object.id)
  for (const days of [0, 10, 400]) {
    const instant = { unixSeconds: SIMULATION_START_INSTANT.unixSeconds + days * SECONDS_PER_DAY }
    const conic = runtime.updateAt(instant).get(object.id)!.conic!
    expect(conic.angleRates.raanRadPerSecond).toBe(0)
    expect(conic.angleRates.argOfPeriapsisRadPerSecond).toBe(0)
    expect(conic.angleRates.meanAnomalyRadPerSecond / meanMotion(object.source.geometry)).toBeCloseTo(1, 15)
    expect(conic.geometry).toEqual(object.source.geometry)
  }
})

it('publishes one sensor result to the sample and dedicated view without extra propagation', () => {
  const sensor = stubSensor()
  let stateCalls = 0
  const base = initialKeplerian()
  const object = { ...base, display: { ...base.display, sensorGeometryVisible: true } }
  const runtime = new OrbitalObjectRuntime({
    createBody: stubBody,
    createPath: stubPath,
    createSensorGeometry: () => sensor,
    createPropagator: (source, propagation) => {
      const propagator = createPropagator(source, propagation)
      return { kind: propagator.kind, stateAt: (instant) => { stateCalls += 1; return propagator.stateAt(instant) } }
    },
  })
  runtime.reconcile([object], object.id)
  const orientation = earthOrientationAt(SIMULATION_START_INSTANT)
  const sample = runtime.updateAt(SIMULATION_START_INSTANT, orientation).get(object.id)!
  expect(sample.sensorGeometry).not.toBeNull()
  // The view and the readout hold the very same immutable result.
  expect(vi.mocked(sensor.setGeometry).mock.lastCall![0]).toBe(sample.sensorGeometry)
  expect(sample.sensorGeometry!.fieldOfViewHalfAngleRad).toBe(object.sensor.fieldOfViewHalfAngleRad)
  expect(stateCalls).toBe(1)
  // A reach-constraint edit reaches the next ordinary frame through the same
  // single propagation, and leaves the authored sensor angle untouched.
  const constrained = {
    ...object,
    sensor: { ...object.sensor, fieldOfViewHalfAngleRad: degToRad(80) },
    reachConstraint: { minimumGroundElevationRad: degToRad(20) },
  }
  runtime.reconcile([constrained], object.id)
  const next = runtime.updateAt(SIMULATION_START_INSTANT, orientation).get(object.id)!.sensorGeometry!
  expect(stateCalls).toBe(2)
  expect(next.fieldOfViewHalfAngleRad).toBe(degToRad(80))
  expect(next.minimumGroundElevationRad).toBe(degToRad(20))
  expect(next.footprint.limitedBy).toBe('elevation')
  expect(next.footprint.edgeElevationRad).toBeCloseTo(degToRad(20), 10)
  runtime.reconcile([{ ...constrained, display: { ...constrained.display, sensorGeometryVisible: false } }], object.id)
  expect(sensor.setGeometry).toHaveBeenLastCalledWith(null)
  runtime.updateAt(SIMULATION_START_INSTANT, orientation)
  expect(sensor.setGeometry).toHaveBeenCalledTimes(3)
})

it('cleans an allocated body when path creation fails', () => {
  const dispose = vi.fn()
  const runtime = new OrbitalObjectRuntime({ createPropagator,
    createBody: () => ({ ...stubBody(), dispose }),
    createPath: () => { throw Error('allocation') },
  })
  expect(() => runtime.reconcile([createDefaultOrbitLabObject('demo-satellite', 0xffc857, SIMULATION_START_INSTANT)], null)).toThrow('allocation')
  runtime.dispose()
  expect(dispose).toHaveBeenCalledTimes(1)
})

it('real views detach and release geometry/material and unregister exactly once', () => {
  const scene = new Scene()
  const object = initialKeplerian()
  let path: OrbitPathView
  const unregister = vi.fn()
  const adapter = createPathAdapter(scene, object, (view) => { path = view }, unregister)
  const pathGeometry = vi.spyOn(path!.line.geometry, 'dispose')
  const pathMaterial = vi.spyOn(path!.material, 'dispose')
  const body = new OrbitalBodyView(scene, 1, 0.02)
  const bodyGeometry = vi.spyOn(body.mesh.geometry, 'dispose')
  const bodyMaterial = vi.spyOn(body.mesh.material as import('three').Material, 'dispose')
  adapter.setSelected(true)
  expect(path!.material.linewidth).toBe(3)
  expect(path!.material.depthTest).toBe(true)
  // An orientation write with unchanged angles is skipped, so a static object
  // costs one equality check per frame and nothing else.
  const writes = path!.orientationWriteCount
  adapter.setOrientation(object.source.geometry)
  expect(path!.orientationWriteCount).toBe(writes)
  adapter.setOrientation({ ...object.source.geometry, raanRad: 1 })
  expect(path!.orientationWriteCount).toBe(writes + 1)
  // An orientation write must not
  // touch the interleaved vertex buffer. LineGeometry.setPositions allocates a
  // new one on every call, so a per-frame orientation that called it would be a
  // continuous allocate-and-delete cycle at 60 fps.
  const setPositions = vi.spyOn(path!.line.geometry, 'setPositions')
  for (let frame = 0; frame < 100; frame += 1) {
    adapter.setOrientation({ ...object.source.geometry, raanRad: frame * 0.01 })
  }
  expect(path!.orientationWriteCount).toBe(writes + 101)
  expect(setPositions).not.toHaveBeenCalled()
  // Only a shape change resamples.
  adapter.rebuildShape({ semiMajorAxisKm: 12000, eccentricity: 0.2 })
  expect(setPositions).toHaveBeenCalledTimes(1)
  setPositions.mockRestore()
  adapter.dispose(); adapter.dispose(); body.dispose(); body.dispose()
  expect(scene.children).toHaveLength(0)
  for (const release of [unregister, pathGeometry, pathMaterial, bodyGeometry, bodyMaterial]) expect(release).toHaveBeenCalledTimes(1)
})

// The ground-track cache, queue and resource contract.
const stubTrack = (): GroundTrackViewPort => ({ setCurrent: vi.fn(), setWindow: vi.fn(), setHistory: vi.fn(), setVisible: vi.fn(), setColor: vi.fn(), setSelected: vi.fn(), dispose: vi.fn() })

function trackedRuntime(scheduling: RuntimeSchedulingOptions = {}) {
  const tracks = new Map<string, GroundTrackViewPort>()
  const propagators: ReturnType<typeof createPropagator>[] = []
  const byId = new Map<string, ReturnType<typeof createPropagator>>()
  const runtime = new OrbitalObjectRuntime({
    // reconcile creates the propagator immediately before the body, so the
    // body factory is where a spied propagator can be keyed by object id.
    createBody: (object) => { byId.set(object.id, propagators.at(-1)!); return stubBody() },
    createPath: () => stubPath(),
    createGroundTrack: (object) => { const view = stubTrack(); tracks.set(object.id, view); return view },
    createPropagator: (source, propagation) => {
      const propagator = createPropagator(source, propagation)
      vi.spyOn(propagator, 'stateAt')
      propagators.push(propagator)
      return propagator
    },
  }, scheduling)
  const base = initialKeplerian()
  const withTrack = (id: string, groundTrackVisible: boolean, semiMajorAxisKm = base.source.geometry.semiMajorAxisKm): KeplerianOrbitalObject =>
    ({ ...base, id, display: { ...base.display, groundTrackVisible },
      source: { ...base.source, geometry: { ...base.source.geometry, semiMajorAxisKm } } })
  const recording = (object: KeplerianOrbitalObject, groundTrackHistoryRecording: boolean): KeplerianOrbitalObject =>
    ({ ...object, display: { ...object.display, groundTrackHistoryRecording } })
  const historyCalls = (id: string) => vi.mocked(tracks.get(id)!.setHistory!).mock.calls
  return {
    runtime, tracks, withTrack, recording, historyCalls,
    propagatorFor: (id: string) => byId.get(id)!,
    windowCalls: (id: string) => vi.mocked(tracks.get(id)!.setWindow).mock.calls.length,
    currentCalls: (id: string) => vi.mocked(tracks.get(id)!.setCurrent).mock.calls.length,
    lastHistory: (id: string) => historyCalls(id).at(-1)?.[0] ?? null,
  }
}

it('starts the initial object with its track off and newly added presets with it on', () => {
  expect(initialKeplerian().display.groundTrackVisible).toBe(false)
  const preset = createObjectFromPreset(ORBIT_PRESETS[0], { id: 'p', name: 'p', colorHex: 0 }, SIMULATION_START_INSTANT)
  expect(preset.display.groundTrackVisible).toBe(true)
})

it('updates the current point every frame while the cached window stays put', () => {
  const { runtime, windowCalls, currentCalls, withTrack } = trackedRuntime()
  const object = withTrack('a', true)
  runtime.reconcile([object], 'a')
  const period = nominalOrbitalPeriodSeconds(object.source)!
  runtime.updateAt({ unixSeconds: 0 }, undefined, 0)
  expect(windowCalls('a')).toBe(1)
  // Well inside period / 128, and past the real-time floor: still no resample.
  for (let frame = 1; frame <= 5; frame += 1) runtime.updateAt({ unixSeconds: frame }, undefined, frame * 1000)
  expect(currentCalls('a')).toBe(6)
  expect(windowCalls('a')).toBe(1)
  // Crossing the recentre threshold rebuilds once.
  runtime.updateAt({ unixSeconds: period / 128 + 1 }, undefined, 10_000)
  expect(windowCalls('a')).toBe(2)
})

it('leaves hidden tracks unsampled while body and path keep updating', () => {
  const { runtime, propagatorFor, windowCalls, withTrack } = trackedRuntime()
  const hidden = withTrack('a', false)
  runtime.reconcile([hidden], 'a')
  for (let frame = 0; frame < 5; frame += 1) runtime.updateAt({ unixSeconds: frame * 10_000 }, undefined, frame * 1000)
  expect(windowCalls('a')).toBe(0)
  // One propagation per frame for the body and its current point, and not one
  // of the 512 off-centre window samples.
  expect(vi.mocked(propagatorFor('a').stateAt).mock.calls).toHaveLength(5)
  // Turning it on dirties exactly that object and bypasses the floor once.
  runtime.reconcile([{ ...hidden, display: { ...hidden.display, groundTrackVisible: true } }], 'a')
  runtime.updateAt({ unixSeconds: 50_000 }, undefined, 5000)
  expect(windowCalls('a')).toBe(1)
})

it('does not resample geometry for colour, selection or body and path visibility', () => {
  const { runtime, windowCalls, withTrack } = trackedRuntime()
  let object = withTrack('a', true)
  const other = withTrack('b', false)
  runtime.reconcile([object, other], 'a')
  runtime.updateAt({ unixSeconds: 0 }, undefined, 0)
  expect(windowCalls('a')).toBe(1)
  object = { ...object, style: { ...object.style, colorHex: 0x00ff00 },
    display: { ...object.display, bodyVisible: false, orbitPathVisible: false } }
  runtime.reconcile([object, other], 'b')
  runtime.updateAt({ unixSeconds: 1 }, undefined, 10_000)
  expect(windowCalls('a')).toBe(1)
})

it('rebuilds at most one track per frame when the frame budget is spent, and never starves a second visible track', () => {
  const { runtime, windowCalls, withTrack } = trackedRuntime({ rebuildFrameBudgetMs: 0 })
  // A LEO recentres every period / 128; a GEO-scale orbit recentres far less
  // often. At high playback speed the LEO is dirty on every single frame.
  const fast = withTrack('fast', true, 6878.137)
  const slow = withTrack('slow', true, 42164.17)
  runtime.reconcile([fast, slow], 'fast')
  runtime.updateAt({ unixSeconds: 0 }, undefined, 0)
  // The forced first pass builds the selected track only: one rebuild a frame.
  expect(windowCalls('fast')).toBe(1)
  expect(windowCalls('slow')).toBe(0)
  let simSeconds = 0
  for (let frame = 1; frame <= 600; frame += 1) {
    simSeconds += 200_000 * (16.7 / 1000)
    runtime.updateAt({ unixSeconds: simSeconds }, undefined, frame * 16.7)
  }
  // Ten real seconds at the maximum speed multiplier: the floor still bounds
  // the fast track, and the slow one is not locked out behind it.
  expect(windowCalls('fast')).toBeLessThanOrEqual(Math.ceil(600 * 16.7 / 250) + 1)
  expect(windowCalls('slow')).toBeGreaterThan(0)
})

it('continues rebuilding within the frame budget, selected first and then oldest', () => {
  // Every clock read advances 2 ms: after the guaranteed first rebuild one
  // more fits under the 3 ms budget, and the next check ends the frame.
  let clock = 0
  const { runtime, windowCalls, withTrack } = trackedRuntime({ rebuildFrameBudgetMs: 3, measureMs: () => (clock += 2) })
  runtime.reconcile([withTrack('a', true), withTrack('b', true), withTrack('c', true)], 'b')
  runtime.updateAt({ unixSeconds: 0 }, undefined, 0)
  expect([windowCalls('a'), windowCalls('b'), windowCalls('c')]).toEqual([1, 1, 0])
  runtime.updateAt({ unixSeconds: 1 }, undefined, 16)
  expect([windowCalls('a'), windowCalls('b'), windowCalls('c')]).toEqual([1, 1, 1])
})

it('lets a forced selected refresh bypass the real-time floor exactly once', () => {
  const { runtime, windowCalls, withTrack } = trackedRuntime()
  runtime.reconcile([withTrack('a', true)], 'a')
  runtime.updateAt({ unixSeconds: 0 }, undefined, 1000)
  expect(windowCalls('a')).toBe(1)
  // Inside the floor, an ordinary recentre waits.
  runtime.updateAt({ unixSeconds: 10_000 }, undefined, 1100)
  expect(windowCalls('a')).toBe(1)
  // A jump asks for the paused scene to refresh now.
  runtime.requestGroundTrackRefresh('a')
  runtime.updateAt({ unixSeconds: 10_000 }, undefined, 1150)
  expect(windowCalls('a')).toBe(2)
  runtime.updateAt({ unixSeconds: 20_000 }, undefined, 1200)
  expect(windowCalls('a')).toBe(2)
})

it('releases every ground-track resource exactly once on removal and disposal', () => {
  const { runtime, tracks, withTrack } = trackedRuntime()
  runtime.reconcile([withTrack('a', true), withTrack('b', true)], 'a')
  runtime.reconcile([withTrack('b', true)], 'b')
  expect(tracks.get('a')!.dispose).toHaveBeenCalledTimes(1)
  expect(tracks.get('b')!.dispose).not.toHaveBeenCalled()
  runtime.dispose(); runtime.dispose()
  for (const view of tracks.values()) expect(view.dispose).toHaveBeenCalledTimes(1)
})

// Recorded ground-track history.
it('records a trail instead of a computed window and clears it when recording stops', () => {
  const { runtime, withTrack, recording, windowCalls, lastHistory, historyCalls } = trackedRuntime()
  const object = withTrack('a', true)
  runtime.reconcile([object], 'a')
  runtime.updateAt({ unixSeconds: 0 }, undefined, 0)
  expect(windowCalls('a')).toBe(1)

  runtime.reconcile([recording(object, true)], 'a')
  // Entering recording releases the computed window immediately.
  expect(windowCalls('a')).toBe(2)
  expect(historyCalls('a')).toHaveLength(0)
  const step = groundTrackHistoryStepSeconds(nominalOrbitalPeriodSeconds(object.source))
  for (let index = 1; index <= 20; index += 1) {
    runtime.updateAt({ unixSeconds: index * step }, undefined, index * 1000)
  }
  const segments = lastHistory('a')!
  expect(segments.length).toBeGreaterThan(0)
  expect(segments.flatMap((segment) => segment.points).length).toBeGreaterThan(10)
  // The window is never rebuilt while a trail is being recorded.
  expect(windowCalls('a')).toBe(2)

  const beforeStop = historyCalls('a').length
  runtime.reconcile([recording(object, false)], 'a')
  expect(historyCalls('a').length).toBe(beforeStop + 1)
  expect(lastHistory('a')).toBeNull()
  // Leaving recording restores the computed window.
  runtime.updateAt({ unixSeconds: 21 * step }, undefined, 30_000)
  expect(windowCalls('a')).toBe(3)
})

it('publishes history only on the frames that actually record a point', () => {
  const { runtime, withTrack, recording, historyCalls } = trackedRuntime()
  const object = recording(withTrack('a', true), true)
  runtime.reconcile([object], 'a')
  const step = groundTrackHistoryStepSeconds(nominalOrbitalPeriodSeconds(object.source))
  runtime.updateAt({ unixSeconds: 0 }, undefined, 0)
  runtime.updateAt({ unixSeconds: step * 3 }, undefined, 1000)
  const published = historyCalls('a').length
  // Four frames inside one grid step record nothing, so nothing is re-uploaded.
  for (let index = 1; index <= 4; index += 1) {
    runtime.updateAt({ unixSeconds: step * 3 + index }, undefined, 1000 + index * 300)
  }
  expect(historyCalls('a').length).toBe(published)
})

it('discards a trail when the orbit it was recorded from changes', () => {
  const { runtime, withTrack, recording, lastHistory } = trackedRuntime()
  const object = recording(withTrack('a', true), true)
  runtime.reconcile([object], 'a')
  const step = groundTrackHistoryStepSeconds(nominalOrbitalPeriodSeconds(object.source))
  for (let index = 0; index <= 10; index += 1) runtime.updateAt({ unixSeconds: index * step }, undefined, index * 1000)
  expect(lastHistory('a')!.length).toBeGreaterThan(0)
  runtime.reconcile([{ ...object, source: { ...object.source, geometry: { ...object.source.geometry, semiMajorAxisKm: 12000 } } }], 'a')
  expect(lastHistory('a')).toBeNull()
})

it('clears every trail on a date jump or a playback reversal', () => {
  const { runtime, withTrack, recording, lastHistory } = trackedRuntime()
  const a = recording(withTrack('a', true), true)
  const b = recording(withTrack('b', true), true)
  runtime.reconcile([a, b], 'a')
  const step = groundTrackHistoryStepSeconds(nominalOrbitalPeriodSeconds(a.source))
  for (let index = 0; index <= 10; index += 1) runtime.updateAt({ unixSeconds: index * step }, undefined, index * 1000)
  expect(lastHistory('a')!.length).toBeGreaterThan(0)
  expect(lastHistory('b')!.length).toBeGreaterThan(0)
  runtime.clearGroundTrackHistories()
  expect(lastHistory('a')).toBeNull()
  expect(lastHistory('b')).toBeNull()
})

it('stops recording when the track itself is hidden', () => {
  const { runtime, withTrack, recording, lastHistory } = trackedRuntime()
  const object = recording(withTrack('a', true), true)
  runtime.reconcile([object], 'a')
  const step = groundTrackHistoryStepSeconds(nominalOrbitalPeriodSeconds(object.source))
  for (let index = 0; index <= 10; index += 1) runtime.updateAt({ unixSeconds: index * step }, undefined, index * 1000)
  expect(lastHistory('a')!.length).toBeGreaterThan(0)
  runtime.reconcile([recording(withTrack('a', false), true)], 'a')
  expect(lastHistory('a')).toBeNull()
})


// The map is a second consumer of the same publication,
// so the runtime must gain no cache, no queue entry and no propagation call.

/** A runtime whose ground-track factory returns the shipped composite port, so
 *  these tests exercise the real fan-out rather than a stand-in. */
function dualViewRuntime() {
  const globe = new Map<string, GroundTrackViewPort>()
  const map = new Map<string, GroundTrackViewPort>()
  const propagators = new Map<string, ReturnType<typeof createPropagator>>()
  const runtime = new OrbitalObjectRuntime({
    createBody: (object) => { propagators.set(object.id, latest!); return stubBody() },
    createPath: () => stubPath(),
    createGroundTrack: (object) => combineGroundTrackViewPorts(
      () => { const view = stubTrack(); globe.set(object.id, view); return view },
      () => { const view = stubTrack(); map.set(object.id, view); return view },
    ),
    createPropagator: (source, propagation) => {
      const propagator = createPropagator(source, propagation)
      vi.spyOn(propagator, 'stateAt')
      latest = propagator
      return propagator
    },
  })
  let latest: ReturnType<typeof createPropagator> | undefined
  const base = initialKeplerian()
  const withTrack = (id: string, groundTrackVisible: boolean, groundTrackHistoryRecording = false): KeplerianOrbitalObject =>
    ({ ...base, id, display: { ...base.display, groundTrackVisible, groundTrackHistoryRecording } })
  return {
    runtime, globe, map, withTrack,
    stateCalls: (id: string) => vi.mocked(propagators.get(id)!.stateAt).mock.calls.length,
    lastOf: (views: Map<string, GroundTrackViewPort>, id: string, method: 'setCurrent' | 'setWindow' | 'setHistory') =>
      vi.mocked(views.get(id)![method] as (value: unknown) => void).mock.calls.at(-1)?.[0] ?? null,
    callsOf: (views: Map<string, GroundTrackViewPort>, id: string, method: 'setCurrent' | 'setWindow' | 'setHistory') =>
      vi.mocked(views.get(id)![method] as (value: unknown) => void).mock.calls.length,
  }
}

it('publishes one current point and one window to both views with no extra propagation', () => {
  const dual = dualViewRuntime()
  const single = trackedRuntime()
  const object = dual.withTrack('a', true)
  dual.runtime.reconcile([object], 'a')
  single.runtime.reconcile([single.withTrack('a', true)], 'a')
  for (let frame = 0; frame < 4; frame += 1) {
    dual.runtime.updateAt({ unixSeconds: frame * 60 }, undefined, frame * 1000)
    single.runtime.updateAt({ unixSeconds: frame * 60 }, undefined, frame * 1000)
  }
  // Adding the map changed neither the propagation budget nor the queue.
  expect(dual.stateCalls('a')).toBe(vi.mocked(single.propagatorFor('a').stateAt).mock.calls.length)
  expect(dual.callsOf(dual.globe, 'a', 'setWindow')).toBe(single.windowCalls('a'))
  expect(dual.callsOf(dual.map, 'a', 'setWindow')).toBe(single.windowCalls('a'))
  expect(dual.callsOf(dual.map, 'a', 'setCurrent')).toBe(4)
  // The cached window is one object, shared by identity, not two samplings.
  expect(dual.lastOf(dual.map, 'a', 'setWindow')).toBe(dual.lastOf(dual.globe, 'a', 'setWindow'))
  expect(dual.lastOf(dual.map, 'a', 'setCurrent')).toBe(dual.lastOf(dual.globe, 'a', 'setCurrent'))
})

it('keeps the map toggle out of the runtime, so opening it dirties no track', () => {
  const dual = dualViewRuntime()
  const object = dual.withTrack('a', true)
  // The runtime's view options carry marker scaling only; map visibility is a
  // global preference the application applies to the map view directly.
  const viewOptions = { scaleMarkersWithZoom: true }
  dual.runtime.reconcile([object], 'a', viewOptions)
  dual.runtime.updateAt({ unixSeconds: 0 }, undefined, 0)
  const windows = dual.callsOf(dual.globe, 'a', 'setWindow')
  const states = dual.stateCalls('a')

  // Whatever the application does with `view.groundTrackMapVisible`, the object
  // definitions and runtime view options it commits are unchanged.
  dual.runtime.reconcile([object], 'a', viewOptions)
  dual.runtime.updateAt({ unixSeconds: 0 }, undefined, 1)
  expect(dual.callsOf(dual.globe, 'a', 'setWindow')).toBe(windows)
  expect(dual.callsOf(dual.map, 'a', 'setWindow')).toBe(windows)
  // One current point per update, and no window resample.
  expect(dual.stateCalls('a')).toBe(states + 1)
  expect(Object.keys(createInitialState().view).sort()).toEqual(['groundTrackMapVisible', 'scaleMarkersWithZoom'])
  expect(createInitialState().view.groundTrackMapVisible).toBe(false)
})

it('gives both views the same recorded segment identities and suppresses the window in both', () => {
  const dual = dualViewRuntime()
  const object = dual.withTrack('a', true, true)
  dual.runtime.reconcile([object], 'a')
  const step = groundTrackHistoryStepSeconds(nominalOrbitalPeriodSeconds(object.source))
  for (let index = 0; index <= 12; index += 1) dual.runtime.updateAt({ unixSeconds: index * step }, undefined, index * 1000)
  const globeHistory = dual.lastOf(dual.globe, 'a', 'setHistory') as readonly { points: unknown[] }[]
  const mapHistory = dual.lastOf(dual.map, 'a', 'setHistory') as readonly { points: unknown[] }[]
  expect(globeHistory.length).toBeGreaterThan(0)
  // Same segment objects and same growing point arrays: the map's incremental
  // append and the globe's upload skip both key off these identities.
  expect(mapHistory).toBe(globeHistory)
  expect(mapHistory[0].points).toBe(globeHistory[0].points)
  // A recording object draws its trail instead of a computed window in both.
  expect(dual.lastOf(dual.map, 'a', 'setWindow')).toBeNull()
  expect(dual.lastOf(dual.globe, 'a', 'setWindow')).toBeNull()
})

it('clears the current point and window in both views on a propagation failure', () => {
  const failure = new OrbitPropagationError('unknown', 'no state', { unixSeconds: 0 })
  const globe = stubTrack()
  const map = stubTrack()
  let failing = false
  const base = initialKeplerian()
  const object: KeplerianOrbitalObject = { ...base, display: { ...base.display, groundTrackVisible: true, groundTrackHistoryRecording: true } }
  const runtime = new OrbitalObjectRuntime({
    createBody: stubBody,
    createPath: stubPath,
    createGroundTrack: () => combineGroundTrackViewPorts(() => globe, () => map),
    createPropagator: (source, propagation) => {
      const propagator = createPropagator(source, propagation)
      return { kind: propagator.kind, stateAt: (instant) => { if (failing) throw failure; return propagator.stateAt(instant) } }
    },
  })
  runtime.reconcile([object], object.id)
  const step = groundTrackHistoryStepSeconds(nominalOrbitalPeriodSeconds(object.source))
  for (let index = 0; index <= 8; index += 1) runtime.updateAt({ unixSeconds: index * step }, undefined, index * 1000)
  const recorded = vi.mocked(map.setHistory!).mock.calls.at(-1)![0] as readonly { points: unknown[] }[]
  expect(recorded.length).toBeGreaterThan(0)
  const recordedPoints = recorded.flatMap((segment) => segment.points).length

  failing = true
  runtime.updateAt({ unixSeconds: 9 * step }, undefined, 9000)
  for (const view of [globe, map]) {
    expect(vi.mocked(view.setCurrent).mock.calls.at(-1)![0]).toBeNull()
    expect(vi.mocked(view.setWindow).mock.calls.at(-1)![0]).toBeNull()
  }
  expect(runtime.errorFor(object.id)).toBe(failure)
  // The honest recorded trail survives the failure and gains a gap, rather than
  // being erased by the window that was cleared alongside the current point.
  const afterFailure = vi.mocked(map.setHistory!).mock.calls.at(-1)![0] as readonly { points: unknown[] }[]
  expect(afterFailure.flatMap((segment) => segment.points).length).toBe(recordedPoints)

  failing = false
  for (let index = 12; index <= 20; index += 1) runtime.updateAt({ unixSeconds: index * step }, undefined, index * 1000)
  const resumed = vi.mocked(map.setHistory!).mock.calls.at(-1)![0] as readonly { points: unknown[] }[]
  // A new segment rather than a chord bridging the interval that failed.
  expect(resumed.length).toBeGreaterThan(recorded.length)
  expect(resumed).toBe(vi.mocked(globe.setHistory!).mock.calls.at(-1)![0])
})

it('tells the ground-track port about body visibility and name, for the map marker and legend', () => {
  const track = { ...stubTrack(), setBodyVisible: vi.fn(), setName: vi.fn() }
  const runtime = new OrbitalObjectRuntime({ createBody: stubBody, createPath: stubPath, createGroundTrack: () => track, createPropagator })
  const object = initialKeplerian()
  runtime.reconcile([object], null)
  expect(track.setBodyVisible).toHaveBeenLastCalledWith(true)
  expect(track.setName).toHaveBeenLastCalledWith(object.name)
  runtime.reconcile([{ ...object, name: 'Renamed', display: { ...object.display, bodyVisible: false } }], null)
  expect(track.setBodyVisible).toHaveBeenLastCalledWith(false)
  expect(track.setName).toHaveBeenLastCalledWith('Renamed')
})

it('exposes body and path ports for picking without simulation work', () => {
  const runtime = new OrbitalObjectRuntime({ createBody: stubBody, createPath: stubPath, createPropagator })
  const object = initialKeplerian()
  runtime.reconcile([object], null)
  const ports = [...runtime.viewPorts()]
  expect(ports.map((port) => [port.id, port.errored, port.bodyVisible, port.orbitPathVisible])).toEqual([[object.id, false, true, object.display.orbitPathVisible]])
})
