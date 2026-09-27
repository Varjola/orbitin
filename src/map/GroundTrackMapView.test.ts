import { afterEach, expect, it, vi } from 'vitest'
import { text } from '../i18n/index.ts'
import type { EarthFixedVec3 } from '../core/referenceFrames.ts'
import { EARTH_RADIUS_KM, SIMULATION_START_INSTANT } from '../core/constants.ts'
import type { GroundTrackSegment, GroundTrackWindow, SubSatellitePoint } from '../simulation/groundTrack.ts'
import { subSatellitePointFromEarthFixed } from '../simulation/groundTrack.ts'
import { createInstantaneousSensorGeometry } from '../simulation/sensorFootprint.ts'
import { createFakeDom, FakeCanvasElement, type FakeContext2D, type FakeElement } from '../test-fixtures/fakeDom.ts'
import type { CoastlineResult } from './coastlineData.ts'
import { planFootprintDraw } from './footprintDrawPlan.ts'
import {
  GroundTrackMapView,
  MAP_LEGEND_NAME_LIMIT,
  MAP_MARKER_PICK_RADIUS_CSS_PX,
  MAP_SELECTED_LABEL_LIMIT,
  MAP_MAXIMIZED_TRACK_MIN_INTERVAL_MS,
  MAP_TRACK_BUILD_LAYERS_PER_FRAME,
  MAP_TRACK_COMPOSITE_MIN_INTERVAL_MS,
  MAP_TRACK_PICK_RADIUS_CSS_PX,
  mapLegendSummary,
  type GroundTrackMapObjectPort,
  type MapObjectDescriptor,
} from './GroundTrackMapView.ts'

function point(longitudeRad: number | null, latitudeRad: number, unixSeconds = 0): SubSatellitePoint {
  return {
    instant: { unixSeconds },
    directionEarthFixed: { x: 1, y: 0, z: 0 } as EarthFixedVec3,
    geocentricLatitudeRad: latitudeRad,
    geodeticLatitudeRad: latitudeRad,
    longitudeRad,
  }
}

function segment(...longitudes: number[]): GroundTrackSegment {
  return { points: longitudes.map((longitude, index) => point(longitude, 0.2 * Math.sin(index), index)) }
}

function windowOf(trailing: GroundTrackSegment[], leading: GroundTrackSegment[]): GroundTrackWindow {
  return {
    centreInstant: { unixSeconds: 0 },
    nominalPeriodSeconds: 5400,
    current: point(0, 0),
    trailing,
    leading,
    failedSampleCount: 0,
  }
}

const DESCRIPTOR: MapObjectDescriptor = { id: 'a', name: 'Explorer 01', colorHex: 0xffc857, visible: true, selected: true }

interface Harness {
  readonly view: GroundTrackMapView
  readonly root: FakeElement
  readonly canvases: FakeCanvasElement[]
  size: { width: number; height: number }
  ratio: number
  nowMs: number
  resize(): void
  readonly disconnects: () => number
  readonly background: () => FakeContext2D
  readonly tracks: () => FakeContext2D
  readonly selectedTracks: () => FakeContext2D
  readonly overlay: () => FakeContext2D
}

const NO_COASTLINE: CoastlineResult = { ok: true, data: { lines: [], pointCount: 0 } }

function setup(coastline: CoastlineResult = NO_COASTLINE, onClose?: () => void, onToggleMaximized?: () => void): Harness {
  const dom = createFakeDom()
  const state = { size: { width: 768, height: 384 }, ratio: 1, nowMs: 0 }
  let onResize = (): void => {}
  let disconnects = 0
  const view = new GroundTrackMapView(dom.root as unknown as HTMLElement, {
    documentRef: dom.document,
    devicePixelRatio: () => state.ratio,
    measure: () => state.size,
    loadCoastline: async () => coastline,
    observeResize: (_element, handler) => { onResize = handler; return () => { disconnects += 1 } },
    now: () => state.nowMs,
    onClose,
    onToggleMaximized,
  })
  return {
    view,
    root: dom.root,
    canvases: dom.canvases,
    get size() { return state.size },
    set size(value) { state.size = value },
    get ratio() { return state.ratio },
    set ratio(value) { state.ratio = value },
    get nowMs() { return state.nowMs },
    set nowMs(value) { state.nowMs = value },
    resize: () => onResize(),
    disconnects: () => disconnects,
    background: () => dom.canvases[0].getContext('2d')!,
    tracks: () => dom.canvases[1].getContext('2d')!,
    selectedTracks: () => dom.canvases[2].getContext('2d')!,
    overlay: () => dom.canvases[3].getContext('2d')!,
  }
}

/** Let the lazily requested coastline settle. */
const settle = (): Promise<void> => Promise.resolve().then(() => undefined)
const legendNames = (harness: Harness): string[] => harness.root.first('map-legend-objects')!.children.map((row) => row.textContent)

afterEach(() => { FakeCanvasElement.contextAvailable = true })

it('keeps a fixed set of four canvases however many tracks are visible', () => {
  for (const count of [1, 30, 100]) {
    const harness = setup()
    harness.view.setOpen(true)
    for (let index = 0; index < count; index += 1) {
      const port = harness.view.createObjectLayer({ ...DESCRIPTOR, id: `o${index}`, selected: index % 7 === 0 })
      port.setWindow(windowOf([segment(-1, -0.5, 0)], [segment(0, 0.5, 1)]))
      port.setCurrent(point(0.01 * index, 0))
    }
    harness.view.render()
    expect(harness.canvases).toHaveLength(4)
    expect(harness.root.first('map-frame')!.children).toHaveLength(4)
    expect(harness.canvases.every((canvas) => canvas.width === 768 && canvas.height === 384)).toBe(true)
    // Every track is drawn: 100 layers put 100 x 2 polylines on the composites.
    expect(harness.tracks().countOf('stroke') + harness.selectedTracks().countOf('stroke')).toBeGreaterThanOrEqual(count * 2)
  }
})

it('draws a marker for every visible body whether or not its ground track is on', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const tracked = harness.view.createObjectLayer({ ...DESCRIPTOR, selected: false })
  const untracked = harness.view.createObjectLayer({ ...DESCRIPTOR, id: 'b', name: 'Explorer 02', visible: false, selected: false })
  const hidden = harness.view.createObjectLayer({ ...DESCRIPTOR, id: 'c', name: 'Explorer 03', visible: false, selected: false, bodyVisible: false })
  tracked.setCurrent(point(0.1, 0.1))
  untracked.setCurrent(point(-0.5, 0.2))
  hidden.setCurrent(point(0.9, -0.2))
  harness.view.render()
  expect(harness.overlay().countOf('arc')).toBe(2)
  expect(harness.root.first('map-empty')!.hidden).toBe(true)
  expect(harness.root.first('map-legend-summary')!.textContent).toBe(mapLegendSummary(3, 1, 0))

  hidden.setBodyVisible(true)
  harness.overlay().clearRecording()
  harness.view.render()
  expect(harness.overlay().countOf('arc')).toBe(3)
})

it('shows the empty prompt only when no object has anything to draw', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const port = harness.view.createObjectLayer({ ...DESCRIPTOR, visible: false })
  harness.view.render()
  expect(harness.root.first('map-empty')!.hidden).toBe(false)
  expect(harness.root.first('map-empty')!.textContent).toBe(text().map.emptyPrompt)
  port.setCurrent(point(0, 0))
  harness.view.render()
  expect(harness.root.first('map-empty')!.hidden).toBe(true)
  port.setBodyVisible(false)
  harness.view.render()
  expect(harness.root.first('map-empty')!.hidden).toBe(false)
  port.setVisible(true)
  harness.view.render()
  expect(harness.root.first('map-empty')!.hidden).toBe(true)
})

it('draws nothing and releases pixel buffers while the map is closed', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const port = harness.view.createObjectLayer(DESCRIPTOR)
  port.setWindow(windowOf([segment(-1, -0.5, 0)], []))
  port.setCurrent(point(0.2, 0.3))
  harness.view.render()
  expect(harness.background().lineToCount).toBeGreaterThan(0)
  expect(harness.canvases[2].width).toBe(768)

  harness.view.setOpen(false)
  expect(harness.view.open).toBe(false)
  expect(harness.canvases.every((canvas) => canvas.width === 1 && canvas.height === 1)).toBe(true)

  const counts = harness.canvases.map((canvas) => canvas.getContext('2d')!.calls.length)
  port.setCurrent(point(0.4, 0.1))
  harness.view.render()
  harness.view.render()
  expect(harness.canvases.map((canvas) => canvas.getContext('2d')!.calls.length)).toEqual(counts)
})

it('restores the retained window, history and current point when reopened', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const port = harness.view.createObjectLayer(DESCRIPTOR)
  port.setHistory([segment(-1, -0.5, 0, 0.5)])
  port.setCurrent(point(0.2, 0.3))
  harness.view.render()
  const drawnWhileOpen = harness.selectedTracks().lineToCount
  expect(drawnWhileOpen).toBeGreaterThan(0)

  harness.view.setOpen(false)
  harness.view.setOpen(true)
  harness.selectedTracks().clearRecording()
  harness.view.render()
  // Nothing was asked of the runtime: the same references are redrawn.
  expect(harness.selectedTracks().lineToCount).toBe(drawnWhileOpen)
  expect(harness.overlay().countOf('arc')).toBeGreaterThan(0)
})

it('redraws only the overlay on a current-point-only frame', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const port = harness.view.createObjectLayer(DESCRIPTOR)
  const window = windowOf([segment(-1, -0.5, 0)], [segment(0, 0.5, 1)])
  port.setWindow(window)
  port.setCurrent(point(0, 0))
  harness.view.render()
  const counts = [harness.background(), harness.tracks(), harness.selectedTracks()].map((context) => context.calls.length)

  for (let frame = 0; frame < 5; frame += 1) {
    port.setCurrent(point(0.1 * frame, 0.05 * frame))
    // Republishing the identical window reference must not redraw the track.
    port.setWindow(window)
    harness.nowMs += 16
    harness.view.render()
  }
  expect([harness.background(), harness.tracks(), harness.selectedTracks()].map((context) => context.calls.length)).toEqual(counts)
  expect(harness.overlay().countOf('clearRect')).toBe(6)
})

it('appends a growing history suffix without clearing the composite, and never joins across a break', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const port = harness.view.createObjectLayer({ ...DESCRIPTOR, selected: false })
  const growing = [point(-1, 0, 0), point(-0.9, 0.1, 1), point(-0.8, 0.2, 2)]
  const openSegment: GroundTrackSegment = { points: growing }
  port.setHistory([openSegment])
  harness.view.render()
  const track = harness.tracks()
  const clears = track.countOf('clearRect')

  growing.push(point(-0.7, 0.3, 3), point(-0.6, 0.4, 4))
  port.setHistory([openSegment])
  harness.nowMs += 16
  harness.view.render()
  expect(track.countOf('clearRect')).toBe(clears)
  // The append restarts at the last drawn point and traces only the two new
  // ones, so the stroke joins the existing line instead of leaving a gap.
  const lastMove = track.calls.filter((call) => call.op === 'moveTo').at(-1)!
  const appended = track.calls.slice(track.calls.lastIndexOf(lastMove))
  expect(appended.filter((call) => call.op === 'lineTo')).toHaveLength(2)

  // A structural change - the leading segment dropped - forces one full
  // redraw, coalesced to the composite interval.
  port.setHistory([{ points: growing.slice(1) }])
  harness.nowMs += MAP_TRACK_COMPOSITE_MIN_INTERVAL_MS
  harness.view.render()
  expect(track.countOf('clearRect')).toBe(clears + 1)
})

it('coalesces unselected window updates but redraws the selected track at once', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const unselected = harness.view.createObjectLayer({ ...DESCRIPTOR, id: 'u', selected: false })
  const selected = harness.view.createObjectLayer({ ...DESCRIPTOR, id: 's', selected: true })
  harness.view.render()
  const trackClears = harness.tracks().countOf('clearRect')
  const selectedClears = harness.selectedTracks().countOf('clearRect')
  for (let frame = 1; frame <= 5; frame += 1) {
    harness.nowMs += 16
    unselected.setWindow(windowOf([segment(-1, -0.5, 0.1 * frame)], []))
    selected.setWindow(windowOf([segment(-1, -0.5, 0.1 * frame)], []))
    harness.view.render()
  }
  // 80 ms of updates: the selected composite followed every frame, the
  // shared one waited for the interval.
  expect(harness.selectedTracks().countOf('clearRect')).toBe(selectedClears + 5)
  expect(harness.tracks().countOf('clearRect')).toBe(trackClears)
  harness.nowMs += MAP_TRACK_COMPOSITE_MIN_INTERVAL_MS
  harness.view.render()
  expect(harness.tracks().countOf('clearRect')).toBe(trackClears + 1)
})

it('moves a track between the composites on selection and states selection in the legend', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const first = harness.view.createObjectLayer({ ...DESCRIPTOR, selected: true })
  const second = harness.view.createObjectLayer({ ...DESCRIPTOR, id: 'b', name: 'Explorer 02', colorHex: 0x69d6e8, selected: false })
  first.setWindow(windowOf([segment(-1, -0.5, 0)], []))
  second.setWindow(windowOf([segment(-1, -0.5, 0)], []))
  harness.view.render()
  const strokedColours = (context: FakeContext2D): Set<unknown> => new Set(context.calls.filter((call) => call.op === 'stroke').map((call) => call.args[0]))
  expect(strokedColours(harness.selectedTracks()).has('#ffc857')).toBe(true)
  expect(strokedColours(harness.tracks()).has('#69d6e8')).toBe(true)
  // The overlay stays above both track composites.
  expect(harness.root.first('map-frame')!.children.at(-1)).toBe(harness.canvases[3])

  first.setSelected(false)
  second.setSelected(true)
  harness.tracks().clearRecording()
  harness.selectedTracks().clearRecording()
  harness.view.render()
  expect(strokedColours(harness.selectedTracks()).has('#69d6e8')).toBe(true)
  expect(strokedColours(harness.selectedTracks()).has('#ffc857')).toBe(false)
  expect(strokedColours(harness.tracks()).has('#ffc857')).toBe(true)
  // Selected names first, then track- or sensor-enabled ones.
  expect(legendNames(harness)).toEqual(['Explorer 02 (selected)', 'Explorer 01'])
})

it('lists at most ten names in the legend, selected first, then the rest as a count', () => {
  const harness = setup()
  harness.view.setOpen(true)
  for (let index = 0; index < 30; index += 1) harness.view.createObjectLayer({ ...DESCRIPTOR, id: `o${index}`, name: `Object ${index}`, selected: index === 13, visible: index % 2 === 0 })
  // Objects with nothing but a marker are counted but not named.
  harness.view.createObjectLayer({ ...DESCRIPTOR, id: 'plain', name: 'Plain', selected: false, visible: false })
  harness.view.render()
  const names = legendNames(harness)
  expect(names).toHaveLength(MAP_LEGEND_NAME_LIMIT + 1)
  expect(names[0]).toBe('Object 13 (selected)')
  expect(names[1]).toBe('Object 0')
  expect(names.at(-1)).toBe('+6 more')
  expect(names).not.toContain('Plain')
  expect(harness.root.first('map-legend-summary')!.textContent).toBe('31 objects, 15 with ground tracks, 0 with sensor geometry')
})

it('redraws every layer after a colour, size or device-pixel-ratio change', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const port = harness.view.createObjectLayer(DESCRIPTOR)
  port.setWindow(windowOf([segment(-1, -0.5, 0)], []))
  harness.view.render()
  const track = harness.selectedTracks()
  let clears = track.countOf('clearRect')
  let backgroundClears = harness.background().countOf('clearRect')

  port.setColor(0x69d6e8)
  harness.view.render()
  expect(track.countOf('clearRect')).toBe(clears + 1)
  expect(track.calls.some((call) => call.op === 'stroke' && call.args[0] === '#69d6e8')).toBe(true)
  clears = track.countOf('clearRect')

  harness.size = { width: 420, height: 210 }
  harness.resize()
  harness.view.render()
  expect(harness.canvases[2].width).toBe(420)
  expect(track.countOf('clearRect')).toBe(clears + 1)
  expect(harness.background().countOf('clearRect')).toBe(backgroundClears + 1)
  clears = track.countOf('clearRect')
  backgroundClears = harness.background().countOf('clearRect')

  harness.ratio = 2
  harness.resize()
  harness.view.render()
  expect(harness.canvases[2].width).toBe(840)
  expect(track.calls.some((call) => call.op === 'setTransform' && call.args[0] === 2)).toBe(true)
  expect(track.countOf('clearRect')).toBe(clears + 1)

  // An unchanged size and ratio redraw nothing on the track composites.
  const settled = track.calls.length
  harness.resize()
  harness.view.render()
  expect(track.calls.length).toBe(settled)
})

it('defers every allocation while the container has no drawable size', () => {
  const harness = setup()
  harness.size = { width: 0, height: 0 }
  harness.view.setOpen(true)
  const port = harness.view.createObjectLayer(DESCRIPTOR)
  port.setWindow(windowOf([segment(-1, 0)], []))
  harness.view.render()
  expect(harness.canvases.every((canvas) => canvas.width === 300)).toBe(true)

  harness.size = { width: 320, height: 160 }
  harness.resize()
  harness.view.render()
  expect(harness.canvases.every((canvas) => canvas.width === 320)).toBe(true)
})

it('keeps the grid and tracks when the coastline cannot load, and says so once', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const harness = setup({ ok: false, reason: 'HTTP 404' })
  harness.view.setOpen(true)
  const port = harness.view.createObjectLayer(DESCRIPTOR)
  port.setWindow(windowOf([segment(-1, -0.5, 0)], []))
  await settle()
  harness.view.render()
  expect(harness.view.statusMessage).toBe(text().map.coastlineUnavailable)
  expect(harness.root.first('map-status')!.textContent).toBe(text().map.coastlineUnavailable)
  expect(warn).toHaveBeenCalledTimes(1)
  expect(harness.background().lineToCount).toBeGreaterThan(0)
  expect(harness.selectedTracks().lineToCount).toBeGreaterThan(0)

  // Closing and reopening must not repeat the request or the warning.
  harness.view.setOpen(false)
  harness.view.setOpen(true)
  await settle()
  harness.view.render()
  expect(warn).toHaveBeenCalledTimes(1)
  warn.mockRestore()
})

it('draws the coastline when it is available and never asks for it twice', async () => {
  const load = vi.fn(async (): Promise<CoastlineResult> => ({
    ok: true,
    data: { lines: [[[-10, 0], [10, 5], [20, 10]]], pointCount: 3 },
  }))
  const dom = createFakeDom()
  const view = new GroundTrackMapView(dom.root as unknown as HTMLElement, {
    documentRef: dom.document,
    devicePixelRatio: () => 1,
    measure: () => ({ width: 768, height: 384 }),
    loadCoastline: load,
    observeResize: () => () => {},
    now: () => 0,
  })
  view.setOpen(true)
  view.render()
  const beforeCoastline = dom.canvases[0].getContext('2d')!.lineToCount
  await settle()
  view.render()
  expect(dom.canvases[0].getContext('2d')!.lineToCount).toBeGreaterThan(beforeCoastline)
  expect(view.statusMessage).toBe('')
  view.setOpen(false)
  view.setOpen(true)
  await settle()
  expect(load).toHaveBeenCalledTimes(1)
  view.dispose()
})

it('leaves no stale track geometry when a track is hidden, and keeps the marker', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const port = harness.view.createObjectLayer(DESCRIPTOR)
  port.setWindow(windowOf([segment(-1, -0.5, 0)], []))
  port.setCurrent(point(0.5, 0.5))
  harness.view.render()

  port.setVisible(false)
  harness.selectedTracks().clearRecording()
  harness.overlay().clearRecording()
  harness.view.render()
  expect(harness.selectedTracks().countOf('clearRect')).toBe(1)
  expect(harness.selectedTracks().countOf('stroke')).toBe(0)
  expect(harness.overlay().countOf('arc')).toBeGreaterThan(0)
  // Still named in the legend, because it is selected.
  expect(legendNames(harness)).toEqual(['Explorer 01 (selected)'])
})

it('shows an exactly polar current point as an edge rather than a fabricated dot', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const port = harness.view.createObjectLayer({ ...DESCRIPTOR, selected: false })
  port.setCurrent(point(null, Math.PI / 2))
  harness.view.render()
  const overlay = harness.overlay()
  expect(overlay.countOf('arc')).toBe(0)
  const moves = overlay.calls.filter((call) => call.op === 'moveTo')
  expect(moves.length).toBeGreaterThan(0)
  expect(moves.every((call) => call.args[1] === 0)).toBe(true)
  expect(overlay.calls.filter((call) => call.op === 'lineTo').every((call) => call.args[0] === 768)).toBe(true)
})

it('draws sensor-only geometry on the overlay without drawing any track', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const position = { x: EARTH_RADIUS_KM + 500, y: 0, z: 0 }
  const centre = subSatellitePointFromEarthFixed(position, SIMULATION_START_INSTANT)!
  const result = createInstantaneousSensorGeometry({ instant: SIMULATION_START_INSTANT, positionEarthFixedKm: position, centre, sensor: { fieldOfViewHalfAngleRad: 10 * Math.PI / 180, maxOffNadirSteeringRad: 20 * Math.PI / 180 } })
  if (result.kind !== 'valid') throw new Error(result.message)
  const port = harness.view.createObjectLayer({ ...DESCRIPTOR, visible: false, sensorVisible: true, bodyVisible: false })
  port.setGeometry(result.geometry)
  harness.view.render()
  expect(harness.selectedTracks().countOf('stroke')).toBe(0)
  expect(harness.overlay().countOf('fill')).toBeGreaterThan(0)
  expect(harness.root.first('map-empty')!.hidden).toBe(true)
  port.setSensorVisible(false)
  harness.view.render()
  expect(harness.root.first('map-empty')!.hidden).toBe(false)
})

function sensorPort(harness: Harness, longitudeDeg: number, latitudeDeg: number, fovDeg: number, steeringDeg: number): { port: GroundTrackMapObjectPort; centre: SubSatellitePoint; geometry: NonNullable<ReturnType<typeof validGeometry>> } {
  const longitude = longitudeDeg * Math.PI / 180
  const latitude = latitudeDeg * Math.PI / 180
  const position = { x: 7000 * Math.cos(latitude) * Math.cos(longitude), y: 7000 * Math.cos(latitude) * Math.sin(longitude), z: 7000 * Math.sin(latitude) }
  const centre = subSatellitePointFromEarthFixed(position, SIMULATION_START_INSTANT)!
  const geometry = validGeometry(position, centre, fovDeg, steeringDeg)
  const port = harness.view.createObjectLayer({ ...DESCRIPTOR, visible: false, sensorVisible: true, bodyVisible: false })
  port.setGeometry(geometry)
  return { port, centre, geometry }
}

function validGeometry(position: { x: number; y: number; z: number }, centre: SubSatellitePoint, fovDeg: number, steeringDeg: number) {
  const result = createInstantaneousSensorGeometry({ instant: SIMULATION_START_INSTANT, positionEarthFixedKm: position, centre, sensor: { fieldOfViewHalfAngleRad: fovDeg * Math.PI / 180, maxOffNadirSteeringRad: steeringDeg * Math.PI / 180 } })
  if (result.kind !== 'valid') throw new Error(result.message)
  return result.geometry
}

it('draws a seam-crossing footprint as two clipped copies without a map-width chord', () => {
  const harness = setup()
  harness.view.setOpen(true)
  sensorPort(harness, 179, 0, 30, 0)
  harness.view.render()
  const calls = harness.overlay().calls
  expect(calls.filter((call) => call.op === 'fill')).toHaveLength(2)
  let lastPoint: { x: number; y: number } | null = null
  for (const call of calls) {
    if (call.op === 'beginPath') lastPoint = null
    if (call.op === 'moveTo') lastPoint = { x: Number(call.args[0]), y: Number(call.args[1]) }
    if (call.op === 'lineTo') {
      const next = { x: Number(call.args[0]), y: Number(call.args[1]) }
      if (lastPoint) expect(Math.abs(next.x - lastPoint.x)).toBeLessThanOrEqual(384)
      lastPoint = next
    }
  }
})

it('draws a seam-crossing field of regard as dashed outlines without filling it', () => {
  const harness = setup()
  harness.view.setOpen(true)
  sensorPort(harness, 179, 0, 30, 20)
  harness.view.render()
  const calls = harness.overlay().calls
  expect(calls.filter((call) => call.op === 'fill')).toHaveLength(2)
  expect(calls.filter((call) => call.op === 'setLineDash' && JSON.stringify(call.args[0]) === JSON.stringify([5, 4]))).toHaveLength(2)
})

it('strokes a pole-containing field of regard as an open outline', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const { centre, geometry } = sensorPort(harness, 0, 85, 5, 80)
  harness.view.render()
  const calls = harness.overlay().calls
  const dashed = calls.reduce((paths, call, index) => {
    if (call.op !== 'setLineDash' || JSON.stringify(call.args[0]) !== JSON.stringify([5, 4])) return paths
    const start = calls.slice(0, index).findLastIndex((candidate) => candidate.op === 'beginPath')
    const end = calls.slice(index + 1).findIndex((candidate) => candidate.op === 'stroke')
    const pathCalls = calls.slice(start, end < 0 ? calls.length : index + 1 + end)
      .filter((candidate) => candidate.op === 'moveTo' || candidate.op === 'lineTo')
    paths.push(pathCalls)
    return paths
  }, [] as Array<readonly { readonly op: string; readonly args: readonly unknown[] }[]>)
  const forPlan = planFootprintDraw(centre, geometry.fieldOfRegard)
  expect(dashed).toHaveLength(forPlan.longitudeOffsetsRad.length)
  // An open pole outline has exactly one move plus one line per boundary
  // point. A closed helper would add one more line back to the first point.
  expect(dashed.every((path) => path.length === forPlan.outline.length)).toBe(true)
})

it('disables itself locally when no 2D drawing surface is available', () => {
  FakeCanvasElement.contextAvailable = false
  const harness = setup()
  harness.view.setOpen(true)
  const port = harness.view.createObjectLayer(DESCRIPTOR)
  port.setWindow(windowOf([segment(-1, 0)], []))
  expect(() => harness.view.render()).not.toThrow()
  expect(harness.view.unavailable).toBe(true)
  expect(harness.view.statusMessage).toBe(text().map.canvasUnavailable)
  expect(harness.view.pickAt({ x: 384, y: 192 })).toEqual([])
  port.dispose()
  harness.view.dispose()
})

it('exposes a stable role, label and description for the map content', () => {
  const harness = setup()
  const frame = harness.root.first('map-frame')!
  expect(frame.getAttribute('role')).toBe('img')
  expect(frame.getAttribute('aria-label')).toBe(text().map.description)
  expect(frame.getAttribute('aria-describedby')).toBe('ground-track-map-legend')
  expect(harness.root.first('map-legend')!.id).toBe('ground-track-map-legend')
  expect(harness.root.first('map-status')!.getAttribute('role')).toBe('status')
  expect(harness.root.first('map-title')!.textContent).toBe('2D map')
  // Canvas layers are presentation only and are never focusable.
  for (const canvas of harness.canvases) expect(canvas.getAttribute('tabindex')).toBeNull()
})

it('runs the Close button through the same callback the toggle uses', () => {
  const onClose = vi.fn()
  const harness = setup(undefined, onClose)
  harness.view.setOpen(true)
  harness.root.first('map-close')!.dispatch('click')
  expect(onClose).toHaveBeenCalledTimes(1)
  // The view does not close itself; the committed view state does.
  expect(harness.view.open).toBe(true)
})

it('uses one map for the minimap and the maximized main view', () => {
  const onToggleMaximized = vi.fn()
  const harness = setup(undefined, undefined, onToggleMaximized)
  harness.size = { width: 1200, height: 600 }
  harness.view.setOpen(true)
  harness.view.render()
  expect(harness.background().calls.filter((call) => call.op === 'fillRect').at(-1)!.args).toEqual([216, 108, 768, 384])
  const button = harness.root.first('map-maximize')!
  expect(button.textContent).toBe('Maximize map')
  expect(button.getAttribute('aria-pressed')).toBe('false')

  harness.view.setMaximized(true)
  harness.view.render()
  expect(harness.view.maximized).toBe(true)
  expect(harness.root.first('ground-track-map')!.className).toBe('ground-track-map is-maximized')
  expect(harness.background().calls.filter((call) => call.op === 'fillRect').at(-1)!.args).toEqual([0, 0, 1200, 600])
  expect(button.textContent).toBe('Restore map')
  expect(button.getAttribute('aria-pressed')).toBe('true')
  button.dispatch('click')
  expect(onToggleMaximized).toHaveBeenCalledTimes(1)
})

it('picks markers, pole edges and visible tracks from cached draw geometry with neutral depth', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const marker = harness.view.createObjectLayer({ ...DESCRIPTOR, id: 'marker', visible: false, selected: false })
  marker.setCurrent(point(0, 0))
  const pole = harness.view.createObjectLayer({ ...DESCRIPTOR, id: 'pole', visible: false, selected: false })
  pole.setCurrent(point(null, Math.PI / 2))
  const tracked = harness.view.createObjectLayer({ ...DESCRIPTOR, id: 'tracked', selected: false, bodyVisible: false })
  // A straight equatorial track from 90 W to 0.
  tracked.setWindow(windowOf([{ points: [point(-Math.PI / 2, 0), point(-Math.PI / 4, 0), point(0, 0)] }], []))
  harness.view.render()
  // The equator is y = 192; longitude 0 is x = 384.
  expect(harness.view.pickAt({ x: 384 + MAP_MARKER_PICK_RADIUS_CSS_PX - 1, y: 192 })).toEqual(expect.arrayContaining([
    { objectId: 'marker', kind: 'mapMarker', distanceCssPx: MAP_MARKER_PICK_RADIUS_CSS_PX - 1, depth: 0 },
  ]))
  expect(harness.view.pickAt({ x: 250, y: 192 + MAP_TRACK_PICK_RADIUS_CSS_PX - 1 })).toEqual([
    { objectId: 'tracked', kind: 'mapTrack', distanceCssPx: MAP_TRACK_PICK_RADIUS_CSS_PX - 1, depth: 0 },
  ])
  expect(harness.view.pickAt({ x: 250, y: 192 + MAP_TRACK_PICK_RADIUS_CSS_PX + 1 })).toEqual([])
  // Anywhere along the highlighted pole edge is the pole.
  expect(harness.view.pickAt({ x: 700, y: 3 }).map((hit) => hit.objectId)).toEqual(['pole'])

  // Hidden tracks and hidden bodies are not pickable.
  tracked.setVisible(false)
  marker.setBodyVisible(false)
  harness.view.render()
  expect(harness.view.pickAt({ x: 250, y: 192 })).toEqual([])
  expect(harness.view.pickAt({ x: 384, y: 192 })).toEqual([])
})

it('draws hover emphasis, the primary label and a reveal ring', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const port = harness.view.createObjectLayer({ ...DESCRIPTOR, visible: false })
  port.setCurrent(point(0, 0))
  harness.view.setPrimary('a')
  harness.view.render()
  expect(harness.overlay().calls.filter((call) => call.op === 'fillText').map((call) => call.args[0])).toEqual(['Explorer 01'])
  harness.view.setReveals(new Map([['a', 0]]), false)
  harness.nowMs = 600
  harness.overlay().clearRecording()
  harness.view.render()
  // Marker, selection halo and reveal ring.
  expect(harness.overlay().countOf('arc')).toBe(3)
  harness.nowMs = 2000
  harness.overlay().clearRecording()
  harness.view.render()
  expect(harness.overlay().countOf('arc')).toBe(2)
})

it('releases observers, canvases and references on disposal', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const port = harness.view.createObjectLayer(DESCRIPTOR)
  port.setWindow(windowOf([segment(-1, 0)], []))
  port.setCurrent(point(0, 0))
  harness.view.render()

  harness.view.dispose()
  expect(harness.disconnects()).toBe(1)
  expect(harness.root.children).toHaveLength(0)
  expect(harness.canvases.every((canvas) => canvas.parent === null)).toBe(true)
  // Repeated disposal, and updates from a runtime that has not caught up yet,
  // are harmless.
  harness.view.dispose()
  port.setCurrent(point(1, 1))
  port.dispose()
  expect(() => harness.view.render()).not.toThrow()
  expect(harness.disconnects()).toBe(1)
})

it('keeps map content at two-to-one and centred inside a non-conforming container', () => {
  const harness = setup()
  harness.size = { width: 600, height: 400 }
  harness.view.setOpen(true)
  harness.view.render()
  const fills = harness.background().calls.filter((call) => call.op === 'fillRect')
  expect(fills).toHaveLength(1)
  // 600 x 400 holds a 600 x 300 map, vertically centred.
  expect(fills[0].args).toEqual([0, 50, 600, 300])

  // A container too short for its width is limited by its height, not padded.
  harness.size = { width: 1200, height: 300 }
  harness.resize()
  harness.view.render()
  expect(harness.background().calls.filter((call) => call.op === 'fillRect').at(-1)!.args).toEqual([300, 0, 600, 300])

  harness.size = { width: 1200, height: 600 }
  harness.resize()
  harness.view.render()
  const wide = harness.background().calls.filter((call) => call.op === 'fillRect').at(-1)!
  // The desktop cap is 768 CSS px of content, centred in the wider container.
  expect(wide.args).toEqual([216, 108, 768, 384])
})

it('shows no text below the map: the legend is visually hidden and notices sit over the map', () => {
  const harness = setup()
  const map = harness.root.first('ground-track-map')!
  const stage = harness.root.first('map-stage')!
  // Heading, map stage, then only the visually hidden description.
  expect(map.children.map((child) => child.className)).toEqual(['map-heading', 'map-stage', 'map-legend sr-only'])
  expect(stage.children.map((child) => child.className)).toEqual(['map-frame', 'map-empty', 'map-status'])
})

it('names every selected object on the map, primary first, up to the limit', () => {
  const harness = setup()
  harness.view.setOpen(true)
  const count = MAP_SELECTED_LABEL_LIMIT + 3
  for (let index = 0; index < count; index++) {
    const port = harness.view.createObjectLayer({ ...DESCRIPTOR, id: `s${index}`, name: `Sat ${index}`, visible: false, selected: index !== 1 })
    port.setCurrent(point(index * 0.1, 0))
  }
  harness.view.setPrimary('s5')
  harness.view.render()
  const labels = harness.overlay().calls.filter((call) => call.op === 'fillText').map((call) => call.args[0])
  expect(labels).toHaveLength(MAP_SELECTED_LABEL_LIMIT)
  expect(labels[0]).toBe('Sat 5')
  expect(labels).not.toContain('Sat 1')
  // The hovered object is named even beyond the limit.
  harness.view.setHovered('s1')
  harness.overlay().clearRecording()
  harness.view.render()
  expect(harness.overlay().calls.filter((call) => call.op === 'fillText').map((call) => call.args[0])).toContain('Sat 1')
})

function maximizedWithTracks(unselected: number, selected = 0): { harness: Harness; ports: GroundTrackMapObjectPort[] } {
  const harness = setup()
  harness.view.setOpen(true)
  harness.view.setMaximized(true)
  const ports: GroundTrackMapObjectPort[] = []
  for (let index = 0; index < unselected + selected; index++) {
    const port = harness.view.createObjectLayer({ ...DESCRIPTOR, id: `t${index}`, selected: index >= unselected })
    port.setWindow(windowOf([segment(-1, -0.5, 0.01 * index)], []))
    ports.push(port)
  }
  return { harness, ports }
}

it('rebuilds a large maximized composite a few tracks per frame in a back buffer, then swaps it in once', () => {
  const { harness } = maximizedWithTracks(10)
  const frames = Math.ceil(10 / MAP_TRACK_BUILD_LAYERS_PER_FRAME)
  const redraws = harness.view.compositeRedraws
  for (let frame = 1; frame <= frames; frame++) {
    harness.view.render()
    const back = harness.canvases[4].getContext('2d')!
    // Never more than the per-frame share of tracks is rasterized.
    expect(back.countOf('stroke')).toBeLessThanOrEqual(MAP_TRACK_BUILD_LAYERS_PER_FRAME * frame)
    expect(harness.tracks().countOf('drawImage')).toBe(frame === frames ? 1 : 0)
    expect(harness.tracks().countOf('stroke')).toBe(0)
  }
  expect(harness.canvases[4].getContext('2d')!.countOf('stroke')).toBe(10)
  // The empty selected composite clears once; the unselected one swaps in once.
  expect(harness.view.compositeRedraws).toBe(redraws + 2)
  expect(harness.view.canvasStats().canvases).toBe(5)
})

it('redraws a small maximized composite at once, and a restored map drops the back buffer', () => {
  const { harness } = maximizedWithTracks(MAP_TRACK_BUILD_LAYERS_PER_FRAME)
  harness.view.render()
  expect(harness.tracks().countOf('stroke')).toBe(MAP_TRACK_BUILD_LAYERS_PER_FRAME)
  expect(harness.canvases).toHaveLength(4)

  const large = maximizedWithTracks(12).harness
  large.view.render()
  expect(large.view.canvasStats().canvases).toBe(5)
  large.view.setMaximized(false)
  large.view.render()
  expect(large.view.canvasStats().canvases).toBe(4)
  expect(large.canvases[4].width).toBe(1)
})

it('waits at least the maximized interval before rebuilding for data updates', () => {
  const { harness, ports } = maximizedWithTracks(8)
  for (let frame = 0; frame < 2; frame++) harness.view.render()
  expect(harness.tracks().countOf('drawImage')).toBe(1)
  ports[0].setWindow(windowOf([segment(-1, -0.4)], []))
  harness.nowMs += MAP_MAXIMIZED_TRACK_MIN_INTERVAL_MS - 1
  for (let frame = 0; frame < 4; frame++) harness.view.render()
  expect(harness.tracks().countOf('drawImage')).toBe(1)
  harness.nowMs += 1
  for (let frame = 0; frame < 2; frame++) harness.view.render()
  expect(harness.tracks().countOf('drawImage')).toBe(2)
})

it('draws a newly selected track at once during an unselected rebuild', () => {
  const { harness, ports } = maximizedWithTracks(12)
  harness.view.render()
  ports[3].setSelected(true)
  harness.view.render()
  // One selected track redraws in one step, in the frame of the change.
  expect(harness.selectedTracks().countOf('stroke')).toBeGreaterThan(0)
})

it('lets large selected and unselected composites take turns under continuous updates', () => {
  const { harness, ports } = maximizedWithTracks(8, 8)
  for (let frame = 1; frame <= 80; frame++) {
    harness.nowMs += 16
    // Every window changes every frame, as at the highest speeds.
    for (const port of ports) port.setWindow(windowOf([segment(-1, -0.5, 0.001 * frame)], []))
    harness.view.render()
  }
  expect(harness.selectedTracks().countOf('drawImage')).toBeGreaterThan(3)
  expect(harness.tracks().countOf('drawImage')).toBeGreaterThan(1)
})
