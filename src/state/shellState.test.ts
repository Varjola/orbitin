import { expect, it } from 'vitest'
import { initialShellState, mapCoversScene, shellAfterMapVisibilityChange, shellAfterPresentationChange, shellAfterModeChange, shellAfterViewportChange, shellForCameraFit, toggleInspector, toggleLeftDrawer, toggleMapMaximized, toggleSceneObjects, toggleTimeDrawer, toggleViewDrawer } from './shellState.ts'

it('starts both side regions retracted at every viewport size', () => {
  expect(initialShellState(false)).toEqual({ narrowViewport: false, leftDrawerOpen: false, inspectorOpen: false, timeDrawerOpen: false, viewDrawerOpen: false, mapMaximized: false, catalogueWorkspaceOpen: false, sceneObjectsExpanded: true })
  expect(initialShellState(true)).toEqual({ narrowViewport: true, leftDrawerOpen: false, inspectorOpen: false, timeDrawerOpen: false, viewDrawerOpen: false, mapMaximized: false, catalogueWorkspaceOpen: false, sceneObjectsExpanded: true })
})

it('keeps the compact Time and View drawers mutually exclusive', () => {
  const initial = initialShellState(false)
  const time = toggleTimeDrawer(initial)
  expect(time).toMatchObject({ timeDrawerOpen: true, viewDrawerOpen: false })
  const view = toggleViewDrawer(time)
  expect(view).toMatchObject({ timeDrawerOpen: false, viewDrawerOpen: true })
})

it('treats fullscreen as map presentation and clears it when the map closes', () => {
  const fullscreen = toggleMapMaximized(initialShellState(false))
  expect(fullscreen.mapMaximized).toBe(true)
  expect(shellAfterMapVisibilityChange(fullscreen, true)).toBe(fullscreen)
  expect(shellAfterMapVisibilityChange(fullscreen, false).mapMaximized).toBe(false)
})

it('keeps narrow sheets mutually exclusive', () => {
  const initial = initialShellState(true)
  const drawer = toggleLeftDrawer(initial)
  expect(drawer.leftDrawerOpen).toBe(true); expect(drawer.inspectorOpen).toBe(false)
  const inspector = toggleInspector(drawer)
  expect(inspector.leftDrawerOpen).toBe(false); expect(inspector.inspectorOpen).toBe(true)
})

it('closes both sheets for narrow camera fitting and catalogue on mode change', () => {
  const narrow = { ...initialShellState(true), leftDrawerOpen: true }
  expect(shellForCameraFit(narrow)).toMatchObject({ leftDrawerOpen: false, inspectorOpen: false })
  const catalogue = { ...initialShellState(false), catalogueWorkspaceOpen: true }
  expect(shellAfterModeChange(catalogue, 'orbitLab').catalogueWorkspaceOpen).toBe(false)
})

it('transitions to narrow without leaving two sheets open', () => {
  const desktop = { ...initialShellState(false), leftDrawerOpen: true, inspectorOpen: true }
  expect(shellAfterViewportChange(desktop, true)).toMatchObject({ narrowViewport: true, leftDrawerOpen: false, inspectorOpen: false })
  expect(shellAfterViewportChange({ ...desktop, inspectorOpen: false }, true)).toMatchObject({ narrowViewport: true, leftDrawerOpen: true, inspectorOpen: false })
})

it('maximizes and restores the map as shell state and skips 3D drawing only while it covers the view', () => {
  const shell = initialShellState(false)
  const maximized = toggleMapMaximized(shell)
  expect(maximized.mapMaximized).toBe(true)
  expect(toggleMapMaximized(maximized).mapMaximized).toBe(false)
  expect(mapCoversScene(maximized, true, true)).toBe(true)
  expect(mapCoversScene(maximized, false, true)).toBe(false)
  expect(mapCoversScene(maximized, true, false)).toBe(false)
  expect(mapCoversScene(shell, true, true)).toBe(false)
  // Closing the map also leaves the maximized presentation.
  expect(shellAfterMapVisibilityChange(maximized, false).mapMaximized).toBe(false)
})

it('collapses and expands Scene Objects without touching other regions', () => {
  const initial = initialShellState(false)
  const collapsed = toggleSceneObjects(initial)
  expect(collapsed).toEqual({ ...initial, sceneObjectsExpanded: false })
  expect(toggleSceneObjects(collapsed)).toEqual(initial)
})

it('closes desktop drawers across a presentation switch and maximizes a showing map on mobile', () => {
  const open = { ...initialShellState(false), leftDrawerOpen: true, inspectorOpen: true, timeDrawerOpen: true, catalogueWorkspaceOpen: true }
  expect(shellAfterPresentationChange(open, 'mobile', true)).toEqual({ ...initialShellState(false), mapMaximized: true })
  expect(shellAfterPresentationChange(open, 'mobile', false)).toEqual(initialShellState(false))
  expect(shellAfterPresentationChange({ ...open, viewDrawerOpen: true, timeDrawerOpen: false }, 'desktop', true)).toEqual(initialShellState(false))
  // Leaving mobile keeps the full-screen map the learner was looking at.
  expect(shellAfterPresentationChange({ ...initialShellState(false), mapMaximized: true }, 'desktop', true).mapMaximized).toBe(true)
  expect(shellAfterPresentationChange({ ...initialShellState(true), sceneObjectsExpanded: false }, 'mobile', false)).toMatchObject({ narrowViewport: true, sceneObjectsExpanded: false })
})
