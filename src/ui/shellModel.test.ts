import { expect, it } from 'vitest'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { withScene } from '../state/AppState.ts'
import { createDefaultOrbitLabObject, createInitialState } from '../state/initialState.ts'
import { buildShellModel } from './shellModel.ts'

const shell = { narrowViewport: false, leftDrawerOpen: true, inspectorOpen: true, timeDrawerOpen: false, viewDrawerOpen: false, mapMaximized: false, catalogueWorkspaceOpen: false, sceneObjectsExpanded: true }
it('models the initial Orbit Lab orbit and a centered mode selector', () => {
  const model = buildShellModel({ state: createInitialState(() => 0), shell, catalogue: { kind: 'not-loaded' }, loading: false })
  expect(model.modeButtons.map((button) => [button.label, button.pressed])).toEqual([['Orbit Lab', true], ['Real Objects', false]])
  expect(model.orbitLab.showEmptyState).toBe(false)
  expect(model.orbitLab.createOrbitEnabled).toBe(true)
  expect(model.inspector.content).toBe('single')
  expect(model.inspector.identity?.name).toBe('Alpha Array')
})

it('models the selected object in the inspector and preserves Real Objects readiness', () => {
  let state = createInitialState()
  const object = createDefaultOrbitLabObject('orbit-1', 0xffc857, SIMULATION_START_INSTANT)
  state = withScene(state, 'orbitLab', { objects: [object], selection: { ids: [object.id], primaryId: object.id } })
  const model = buildShellModel({ state, shell, catalogue: { kind: 'loading', snapshotId: null }, loading: false })
  expect(model.inspector.content).toBe('single')
  expect(model.inspector.identity?.name).toBe('Explorer orbit')
  expect(model.sensorSettingsHost).toBe('inspector')
  expect(model.realObjects.catalogueLine).toBe('Loading the published catalogue…')
})
