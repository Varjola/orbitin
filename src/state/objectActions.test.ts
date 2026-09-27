import { expect, it } from 'vitest'
import { degToRad } from '../core/angles.ts'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { activeScene, withScene, type AppState } from './AppState.ts'
import { createDefaultOrbitLabObject, createInitialState } from './initialState.ts'
import { addObject, addObjectToMode, getSelectedObject, removeObject, selectObject, setLastConstraint, setObjectMinimumGroundElevation, setObjectSensorFieldOfViewHalfAngle, setObjectSensorGeometryVisible, setObjectSensorSteeringLimit, updateObject } from './objectActions.ts'
import { MAX_SCENE_OBJECTS } from './sceneActions.ts'

function fixture(): AppState {
  const base = createInitialState(); const template = createDefaultOrbitLabObject('x', 0xffc857, SIMULATION_START_INSTANT)
  return withScene(base, 'orbitLab', { objects: ['a', 'b', 'c'].map((id) => ({ ...template, id })), selection: { ids: ['b'], primaryId: 'b' } })
}
it('removes middle, last and final selections deterministically', () => {
  let state = fixture(); state = removeObject(state, 'b'); expect(activeScene(state).selection.primaryId).toBe('c'); state = removeObject(state, 'c'); expect(activeScene(state).selection.primaryId).toBe('a'); state = removeObject(state, 'a'); expect(activeScene(state).selection.primaryId).toBeNull(); expect(activeScene(state).objects).toEqual([]); expect(removeObject(state, 'a')).toBe(state)
})
it('preserves unrelated objects and rejects stale IDs, duplicates and overflow', () => {
  let state = selectObject(fixture(), 'a'); const b = activeScene(state).objects[1]
  expect(activeScene(removeObject(state, 'b')).selection.primaryId).toBe('a'); expect(updateObject(state, 'a', (a) => ({ ...a, name: 'changed' })).orbitLab.scene.objects[1]).toBe(b); expect(updateObject(state, 'missing', () => { throw Error('called') })).toBe(state); expect(selectObject(state, 'missing')).toBe(state); expect(selectObject(state, 'a')).toBe(state); expect(addObject(state, activeScene(state).objects[0])).toBe(state); expect(() => updateObject(state, 'a', (a) => ({ ...a, id: 'b' }))).toThrow()
  for (let i = 3; i < MAX_SCENE_OBJECTS; i++) state = addObject(state, { ...b, id: String(i) }); expect(addObject(state, { ...b, id: 'ninth' })).toBe(state)
})
it('clears constraints when selection changes or an object is added', () => { let state = setLastConstraint(fixture(), { kind: 'minimumPeriapsis', adjustedField: 'eccentricity', adjustedValue: 0, boundKm: 6578 }); expect(selectObject(state, 'a').orbitLab.authoring.lastConstraint.kind).toBe('none'); expect(addObject(state, { ...activeScene(state).objects[0], id: 'd' }).orbitLab.authoring.lastConstraint.kind).toBe('none'); expect(removeObject(state, 'b').orbitLab.authoring.lastConstraint.kind).toBe('none') })
it('updates only learner-owned sensor intent and visibility within authored bounds', () => { const state = fixture(); const next = setObjectSensorGeometryVisible(state, 'a', true); expect(activeScene(next).objects[0].display.sensorGeometryVisible).toBe(true); const withFov = setObjectSensorFieldOfViewHalfAngle(next, 'a', degToRad(30)); expect(activeScene(withFov).objects[0].sensor.fieldOfViewHalfAngleRad).toBeCloseTo(degToRad(30)); const withSteering = setObjectSensorSteeringLimit(withFov, 'a', degToRad(40)); expect(activeScene(withSteering).objects[0].sensor.maxOffNadirSteeringRad).toBeCloseTo(degToRad(40)); expect(setObjectSensorFieldOfViewHalfAngle(withSteering, 'a', 0)).toBe(withSteering) })
it('authors the minimum ground elevation separately', () => { const state = fixture(); const constrained = setObjectMinimumGroundElevation(state, 'a', degToRad(10)); expect(activeScene(constrained).objects[0].reachConstraint.minimumGroundElevationRad).toBe(degToRad(10)); expect(activeScene(constrained).objects[0].sensor).toBe(activeScene(state).objects[0].sensor); expect(setObjectMinimumGroundElevation(constrained, 'a', degToRad(45))).toBe(constrained) })
it('targets only the named scene', () => { const state = fixture(); const other = { ...activeScene(state).objects[0], id: 'real' }; const next = addObjectToMode(state, 'realObjects', other); expect(next.orbitLab).toBe(state.orbitLab); expect(next.realObjects.scene.objects).toHaveLength(1); expect(getSelectedObject(next)?.id).toBe('b') })
