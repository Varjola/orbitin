import { describe, expect, it } from 'vitest'
import {
  afterEmptyTap, afterModeChange, afterSceneChange, closeSurface, entrySurface, INITIAL_MOBILE_SHELL, initialMobileShell,
  isCompactSurface, isExpandedSurface, openSurface, setExpanded, setShapeParameter, toggleImmersive, toggleSurface,
  type MobileSceneFacts, type MobileSurface,
} from './mobileShellState.ts'

const lab: MobileSceneFacts = { mode: 'orbitLab', sceneEmpty: false, hasKeplerianSelection: true, hasSelection: true }
const real: MobileSceneFacts = { mode: 'realObjects', sceneEmpty: true, hasKeplerianSelection: false, hasSelection: false }

describe('mobile shell state', () => {
  it('opens the Shape strip on Tilt in Orbit Lab and Add in an empty Real Objects scene', () => {
    // The page itself opens on the scene; only an empty Orbit Lab offers New orbit at once.
    expect(initialMobileShell(lab)).toEqual({ ...INITIAL_MOBILE_SHELL, surface: 'none', shapeParameter: 'tilt' })
    expect(initialMobileShell({ ...lab, sceneEmpty: true, hasKeplerianSelection: false, hasSelection: false }).surface).toBe('shape')
    expect(initialMobileShell(real).surface).toBe('add')
    expect(afterModeChange(INITIAL_MOBILE_SHELL, lab).surface).toBe('shape')
    expect(entrySurface({ ...lab, hasKeplerianSelection: false, hasSelection: false })).toBe('none')
    // With no orbit left, the strip offers New orbit (4.15).
    expect(entrySurface({ ...lab, sceneEmpty: true, hasKeplerianSelection: false, hasSelection: false })).toBe('shape')
    expect(entrySurface(real)).toBe('add')
    expect(entrySurface({ ...real, sceneEmpty: false })).toBe('none')
  })

  it('keeps one panel at a time and classifies compact and expanded panels', () => {
    const compact: MobileSurface[] = ['shape', 'time', 'layers', 'object']
    const expanded: MobileSurface[] = ['newOrbit', 'add', 'objects', 'menu', 'about', 'help']
    for (const surface of compact) expect(isCompactSurface(openSurface(INITIAL_MOBILE_SHELL, surface)), surface).toBe(true)
    for (const surface of expanded) expect(isExpandedSurface(openSurface(INITIAL_MOBILE_SHELL, surface)), surface).toBe(true)
    expect(isCompactSurface(INITIAL_MOBILE_SHELL)).toBe(false)
    expect(isExpandedSurface(INITIAL_MOBILE_SHELL)).toBe(false)
    const time = openSurface(openSurface(INITIAL_MOBILE_SHELL, 'shape'), 'time')
    expect(time.surface).toBe('time')
    expect(toggleSurface(time, 'time').surface).toBe('none')
    expect(toggleSurface(time, 'layers').surface).toBe('layers')
    expect(closeSurface(INITIAL_MOBILE_SHELL)).toBe(INITIAL_MOBILE_SHELL)
  })

  it('expands only the object card, and an expanded card overlays the scene', () => {
    const card = openSurface(INITIAL_MOBILE_SHELL, 'object')
    const expanded = setExpanded(card, true)
    expect(expanded.expanded).toBe(true)
    expect(isCompactSurface(expanded)).toBe(false)
    expect(setExpanded(openSurface(INITIAL_MOBILE_SHELL, 'time'), true).expanded).toBe(false)
    expect(openSurface(expanded, 'time').expanded).toBe(false)
  })

  it('toggles immersive mode and restores the panel that was open', () => {
    const shape = openSurface(INITIAL_MOBILE_SHELL, 'shape')
    const immersive = toggleImmersive(shape)
    expect(immersive).toMatchObject({ immersive: true, surface: 'none', surfaceBeforeImmersive: 'shape' })
    expect(toggleImmersive(immersive)).toMatchObject({ immersive: false, surface: 'shape', surfaceBeforeImmersive: 'none' })
    // Opening any panel another way ends immersive mode.
    expect(openSurface(immersive, 'menu')).toMatchObject({ immersive: false, surface: 'menu' })
  })

  it('closes an expanded panel or the Shape strip on an empty tap and otherwise toggles immersive mode', () => {
    expect(afterEmptyTap(openSurface(INITIAL_MOBILE_SHELL, 'add')).surface).toBe('none')
    expect(afterEmptyTap(openSurface(INITIAL_MOBILE_SHELL, 'add')).immersive).toBe(false)
    expect(afterEmptyTap(openSurface(INITIAL_MOBILE_SHELL, 'shape'))).toMatchObject({ surface: 'none', immersive: false })
    expect(afterEmptyTap(openSurface(INITIAL_MOBILE_SHELL, 'time'))).toMatchObject({ immersive: true, surfaceBeforeImmersive: 'time' })
    expect(afterEmptyTap(INITIAL_MOBILE_SHELL).immersive).toBe(true)
  })

  it('keeps the chosen chip across panels and mode changes', () => {
    const size = setShapeParameter(openSurface(INITIAL_MOBILE_SHELL, 'shape'), 'size')
    expect(setShapeParameter(size, 'size')).toBe(size)
    const inReal = afterModeChange(size, real)
    expect(inReal).toMatchObject({ surface: 'add', shapeParameter: 'size' })
    expect(afterModeChange(toggleImmersive(inReal), lab)).toMatchObject({ surface: 'shape', immersive: false, shapeParameter: 'size' })
  })

  it('closes panels the scene no longer supports', () => {
    const card = openSurface(INITIAL_MOBILE_SHELL, 'object')
    expect(afterSceneChange(card, { ...lab, hasSelection: false, hasKeplerianSelection: false }).surface).toBe('none')
    expect(afterSceneChange(card, lab)).toBe(card)
    const list = openSurface(INITIAL_MOBILE_SHELL, 'objects')
    expect(afterSceneChange(list, { ...real, sceneEmpty: true }).surface).toBe('none')
    const shape = openSurface(INITIAL_MOBILE_SHELL, 'shape')
    expect(afterSceneChange(shape, { ...lab, sceneEmpty: true, hasSelection: false, hasKeplerianSelection: false })).toBe(shape)
    const hidden = toggleImmersive(card)
    expect(afterSceneChange(hidden, { ...lab, hasSelection: false }).surfaceBeforeImmersive).toBe('none')
  })
})
