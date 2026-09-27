import { expect, it, vi } from 'vitest'
import { MOUSE_PICK_TOLERANCES, pickTolerances, TOUCH_PICK_TOLERANCES, type PickHit } from '../interaction/pickRanking.ts'
import { nextChooserIndex, chooserMoreLabel } from '../ui/SceneObjectChooserView.ts'
import { REVEAL_DURATION_MS, SceneInteractionController, type ChooserPort, type InteractionSurface } from './SceneInteractionController.ts'

class FakeDocument extends EventTarget { activeElement: unknown = null }
class FakeSurface extends EventTarget {
  tabIndex = 0
  readonly ownerDocument: FakeDocument
  readonly focus = vi.fn(() => { this.ownerDocument.activeElement = this })
  constructor(documentRef: FakeDocument) { super(); this.ownerDocument = documentRef }
  getBoundingClientRect() { return { left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600 } }
}

function pointer(type: string, init: { button?: number; x?: number; y?: number; pointerId?: number; ctrlKey?: boolean; metaKey?: boolean; pointerType?: string } = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), { button: init.button ?? 0, clientX: init.x ?? 200, clientY: init.y ?? 150, pointerId: init.pointerId ?? 1, ctrlKey: init.ctrlKey ?? false, metaKey: init.metaKey ?? false, pointerType: init.pointerType ?? 'mouse' })
}

function harness(hits: Partial<Record<InteractionSurface, PickHit[]>> = {}) {
  const documentRef = new FakeDocument()
  const canvas = new FakeSurface(documentRef)
  const mapFrame = new FakeSurface(documentRef)
  const listed: string[] = []
  const chooser: ChooserPort & { open: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } = {
    get isOpen() { return listed.length > 0 },
    get listedIds() { return listed },
    open: vi.fn((_anchor, _bounds, entries) => { listed.splice(0, listed.length, ...entries.map((entry: { id: string }) => entry.id)) }),
    close: vi.fn(() => { listed.length = 0 }),
    contains: (target) => target === chooserElement,
  }
  const chooserElement = new EventTarget()
  let nowMs = 0
  const deps = {
    canvas: canvas as unknown as HTMLElement,
    mapFrame: mapFrame as unknown as HTMLElement,
    chooser,
    pick: vi.fn((surface: InteractionSurface) => hits[surface] ?? []),
    objectInfo: (id: string) => ({ name: `Name ${id}`, colorHex: 0xffffff, selection: 'none' as const }),
    select: vi.fn(),
    clearSelection: vi.fn(),
    surfaceActive: vi.fn((_surface: InteractionSurface) => true),
    showHover: vi.fn(),
    applyReveals: vi.fn(),
    emptyTap: vi.fn(),
    now: () => nowMs,
  }
  const controller = new SceneInteractionController(deps)
  const click = (surface: FakeSurface, init: Parameters<typeof pointer>[1] = {}, moveTo?: { x: number; y: number }) => {
    surface.dispatchEvent(pointer('pointerdown', init))
    if (moveTo) surface.dispatchEvent(pointer('pointermove', { ...init, ...moveTo }))
    surface.dispatchEvent(pointer('pointerup', { ...init, ...(moveTo ?? {}) }))
  }
  return { controller, deps, canvas, mapFrame, documentRef, chooser, chooserElement, click, setNow: (value: number) => { nowMs = value } }
}

const marker = (objectId: string, distanceCssPx: number): PickHit => ({ objectId, kind: 'marker', distanceCssPx, depth: 5 })
const path = (objectId: string, distanceCssPx: number): PickHit => ({ objectId, kind: 'path', distanceCssPx, depth: 5 })

it('selects an unambiguous candidate with the plain or Ctrl/Cmd intent', () => {
  const h = harness({ '3d': [marker('a', 2)] })
  h.click(h.canvas)
  expect(h.deps.select).toHaveBeenLastCalledWith('a', 'only')
  h.click(h.canvas, { ctrlKey: true })
  expect(h.deps.select).toHaveBeenLastCalledWith('a', 'toggle')
  h.click(h.canvas, { metaKey: true })
  expect(h.deps.select).toHaveBeenLastCalledWith('a', 'toggle')
  // Coordinates are surface-relative.
  expect(h.deps.pick).toHaveBeenLastCalledWith('3d', { x: 100, y: 100 }, MOUSE_PICK_TOLERANCES)
})

it('uses touch-sized tolerances for a finger or pen and mouse values otherwise', () => {
  expect(TOUCH_PICK_TOLERANCES).toEqual({ slopCssPx: 10, markerMinimumCssPx: 22, markerPadCssPx: 8, pathCssPx: 14, mapMarkerCssPx: 16, mapTrackCssPx: 12 })
  expect(MOUSE_PICK_TOLERANCES).toEqual({ slopCssPx: 5, markerMinimumCssPx: 10, markerPadCssPx: 4, pathCssPx: 6, mapMarkerCssPx: 8, mapTrackCssPx: 5 })
  expect(pickTolerances('touch')).toBe(TOUCH_PICK_TOLERANCES)
  expect(pickTolerances('pen')).toBe(TOUCH_PICK_TOLERANCES)
  expect(pickTolerances('mouse')).toBe(MOUSE_PICK_TOLERANCES)
  expect(pickTolerances('')).toBe(MOUSE_PICK_TOLERANCES)
  const h = harness({ '3d': [marker('a', 2)], map: [marker('m', 3)] })
  // An 8 px wobble is still a tap for a finger, not for a mouse.
  h.click(h.canvas, { pointerType: 'touch' }, { x: 208, y: 150 })
  expect(h.deps.pick).toHaveBeenLastCalledWith('3d', { x: 108, y: 100 }, TOUCH_PICK_TOLERANCES)
  expect(h.deps.select).toHaveBeenCalledTimes(1)
  h.click(h.canvas, { pointerType: 'mouse' }, { x: 208, y: 150 })
  expect(h.deps.select).toHaveBeenCalledTimes(1)
  h.click(h.mapFrame, { pointerType: 'pen' })
  expect(h.deps.pick).toHaveBeenLastCalledWith('map', { x: 100, y: 100 }, TOUCH_PICK_TOLERANCES)
})

it('never selects during a two-finger gesture and forgets a cancelled press', () => {
  const h = harness({ '3d': [marker('a', 2)] })
  h.canvas.dispatchEvent(pointer('pointerdown', { pointerId: 1, pointerType: 'touch' }))
  h.canvas.dispatchEvent(pointer('pointerdown', { pointerId: 2, pointerType: 'touch', x: 260 }))
  h.canvas.dispatchEvent(pointer('pointerup', { pointerId: 2, pointerType: 'touch', x: 260 }))
  h.canvas.dispatchEvent(pointer('pointerup', { pointerId: 1, pointerType: 'touch' }))
  expect(h.deps.select).not.toHaveBeenCalled()
  expect(h.deps.emptyTap).not.toHaveBeenCalled()
  h.canvas.dispatchEvent(pointer('pointerdown', { pointerId: 3, pointerType: 'touch' }))
  h.canvas.dispatchEvent(pointer('pointercancel', { pointerId: 3, pointerType: 'touch' }))
  h.canvas.dispatchEvent(pointer('pointerup', { pointerId: 3, pointerType: 'touch' }))
  expect(h.deps.select).not.toHaveBeenCalled()
  // Once every finger is up, a single tap selects again.
  h.click(h.canvas, { pointerId: 4, pointerType: 'touch' })
  expect(h.deps.select).toHaveBeenCalledWith('a', 'only')
})

it('reports an empty tap on either surface without changing the selection', () => {
  const h = harness({ '3d': [], map: [] })
  h.click(h.canvas, { pointerType: 'touch' })
  h.click(h.mapFrame, { pointerType: 'touch' })
  expect(h.deps.emptyTap.mock.calls).toEqual([['3d'], ['map']])
  expect(h.deps.select).not.toHaveBeenCalled()
  expect(h.deps.clearSelection).not.toHaveBeenCalled()
  // A drag is navigation, never an empty tap.
  h.click(h.canvas, { pointerType: 'touch' }, { x: 260, y: 150 })
  expect(h.deps.emptyTap).toHaveBeenCalledTimes(2)
})

it('treats a drag beyond the slop as navigation and an empty left click as nothing', () => {
  const h = harness({ '3d': [] })
  h.click(h.canvas)
  expect(h.deps.select).not.toHaveBeenCalled()
  expect(h.deps.clearSelection).not.toHaveBeenCalled()
  const hit = harness({ '3d': [marker('a', 1)] })
  hit.click(hit.canvas, {}, { x: 206, y: 150 })
  expect(hit.deps.select).not.toHaveBeenCalled()
  hit.click(hit.canvas, {}, { x: 204, y: 152 })
  expect(hit.deps.select).toHaveBeenCalledTimes(1)
})

it('opens the chooser for an ambiguous click and applies the captured intent', () => {
  const h = harness({ '3d': [path('b', 1), path('a', 2)] })
  h.click(h.canvas, { ctrlKey: true })
  expect(h.deps.select).not.toHaveBeenCalled()
  expect(h.controller.chooser).toMatchObject({ surface: '3d', intent: 'toggle' })
  expect(h.chooser.open.mock.calls[0][2].map((entry: { id: string; kind: string }) => [entry.id, entry.kind])).toEqual([['b', 'path'], ['a', 'path']])
  h.controller.choose('a')
  expect(h.deps.select).toHaveBeenCalledWith('a', 'toggle')
  expect(h.controller.chooser).toBeNull()
  // Focus returns to the surface the chooser belonged to.
  expect(h.canvas.focus).toHaveBeenCalled()
})

it('closes the chooser on Escape, an outside press, a drag, a scene change and a mode change', () => {
  const h = harness({ map: [{ objectId: 'x', kind: 'mapTrack', distanceCssPx: 1, depth: 0 }, { objectId: 'y', kind: 'mapTrack', distanceCssPx: 2, depth: 0 }] })
  const open = () => { h.click(h.mapFrame); expect(h.controller.chooser?.surface).toBe('map') }
  open(); h.controller.closeChooser(true); expect(h.controller.chooser).toBeNull(); expect(h.mapFrame.focus).toHaveBeenCalled()
  open(); h.documentRef.dispatchEvent(pointer('pointerdown')); expect(h.controller.chooser).toBeNull()
  open(); h.mapFrame.dispatchEvent(pointer('pointerdown', { pointerId: 7 })); h.mapFrame.dispatchEvent(pointer('pointermove', { pointerId: 7, x: 260 }))
  expect(h.controller.chooser).toBeNull()
  h.mapFrame.dispatchEvent(pointer('pointerup', { pointerId: 7, x: 260 }))
  open(); h.controller.sceneChanged(new Set(['x'])); expect(h.controller.chooser).toBeNull()
  open(); h.controller.reset(); expect(h.controller.chooser).toBeNull()
})

it('clears the selection on a right click and closes the chooser, but not on a right drag', () => {
  const h = harness({ '3d': [path('b', 1), path('a', 2)] })
  h.click(h.canvas)
  expect(h.controller.chooser).not.toBeNull()
  h.click(h.canvas, { button: 2 })
  expect(h.deps.clearSelection).toHaveBeenCalledTimes(1)
  expect(h.controller.chooser).toBeNull()
  h.click(h.canvas, { button: 2 }, { x: 240, y: 150 })
  expect(h.deps.clearSelection).toHaveBeenCalledTimes(1)
  h.click(h.mapFrame, { button: 2 })
  expect(h.deps.clearSelection).toHaveBeenCalledTimes(2)
})

it('suppresses the context menu on the two picking surfaces only', () => {
  const h = harness()
  for (const surface of [h.canvas, h.mapFrame]) {
    const event = new Event('contextmenu', { cancelable: true })
    surface.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  }
  const elsewhere = new Event('contextmenu', { cancelable: true })
  h.documentRef.dispatchEvent(elsewhere)
  expect(elsewhere.defaultPrevented).toBe(false)
})

it('coalesces hover to one pick per frame and labels an ambiguous hover', () => {
  const h = harness({ '3d': [marker('a', 1), marker('b', 2)] })
  for (let move = 0; move < 5; move += 1) h.canvas.dispatchEvent(pointer('pointermove', { pointerId: 2, x: 200 + move }))
  expect(h.deps.pick).not.toHaveBeenCalled()
  h.controller.frame(16)
  expect(h.deps.pick).toHaveBeenCalledTimes(1)
  expect(h.deps.showHover).toHaveBeenLastCalledWith('3d', 'a', 'Name a +1 more', { x: 104, y: 100 })
  expect(h.controller.hover).toEqual({ objectId: 'a', surface: '3d', ambiguousCount: 1 })
  h.controller.frame(32)
  expect(h.deps.pick).toHaveBeenCalledTimes(1)
  h.canvas.dispatchEvent(new Event('pointerleave'))
  expect(h.deps.showHover).toHaveBeenLastCalledWith('3d', null, null, null)
})

it('does not pick on a covered surface and closes covered-view state on maximize or restore', () => {
  const h = harness({ '3d': [marker('a', 1)], map: [{ objectId: 'm', kind: 'mapMarker', distanceCssPx: 1, depth: 0 }] })
  h.deps.surfaceActive.mockImplementation((surface: InteractionSurface) => surface === 'map')
  h.click(h.canvas)
  expect(h.deps.select).not.toHaveBeenCalled()
  h.deps.surfaceActive.mockImplementation(() => true)
  h.canvas.dispatchEvent(pointer('pointermove', { pointerId: 3 }))
  h.controller.frame(1)
  expect(h.controller.hover?.surface).toBe('3d')
  h.controller.mapLayoutChanged(true)
  expect(h.controller.hover).toBeNull()
  h.mapFrame.dispatchEvent(pointer('pointermove', { pointerId: 3 }))
  h.controller.frame(2)
  expect(h.controller.hover?.surface).toBe('map')
  h.controller.mapLayoutChanged(false)
  expect(h.controller.hover).toBeNull()
})

it('runs reveal pulses for their duration and then drops them', () => {
  const h = harness()
  h.controller.reveal(['a', 'b'])
  expect([...h.controller.reveals.keys()]).toEqual(['a', 'b'])
  h.controller.frame(REVEAL_DURATION_MS / 2)
  expect(h.controller.reveals.size).toBe(2)
  h.controller.frame(REVEAL_DURATION_MS + 1)
  expect(h.controller.reveals.size).toBe(0)
  expect(h.deps.applyReveals).toHaveBeenLastCalledWith(new Map(), REVEAL_DURATION_MS + 1)
})

it('moves chooser focus with the arrow, Home and End keys and words the overflow', () => {
  expect(nextChooserIndex('ArrowDown', -1, 3)).toBe(0)
  expect(nextChooserIndex('ArrowDown', 2, 3)).toBe(0)
  expect(nextChooserIndex('ArrowUp', 0, 3)).toBe(2)
  expect(nextChooserIndex('Home', 2, 3)).toBe(0)
  expect(nextChooserIndex('End', 0, 3)).toBe(2)
  expect(nextChooserIndex('Enter', 0, 3)).toBeNull()
  expect(nextChooserIndex('ArrowDown', -1, 0)).toBeNull()
  expect(chooserMoreLabel(4)).toBe('+4 more — use Scene Objects search')
})
