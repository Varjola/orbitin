import { expect, it } from 'vitest'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { createDefaultOrbitLabObject } from './initialState.ts'
import { EMPTY_SCENE, type SceneState } from './AppState.ts'
import { addObjects, clearSelection, MAX_SCENE_OBJECTS, primaryObject, remainingCapacity, removeObjects, selectMany, selectOnly, setSelection, singleSelectedObject, toggleMembership, toggleSelected, updateSceneObject } from './sceneActions.ts'

const object = (id: string) => ({ ...createDefaultOrbitLabObject(id, 0x44ccff, SIMULATION_START_INSTANT), id, name: id })
const scene = (ids: readonly string[], selected: readonly string[] = [], primaryId: string | null = selected.at(-1) ?? null): SceneState => ({ objects: ids.map(object), selection: { ids: selected, primaryId } })

it('adds unique objects atomically, selects them in order and enforces capacity', () => {
  const base = scene(['a'])
  const added = addObjects(base, [object('b'), object('c')])
  expect(added.objects.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  expect(added.selection).toEqual({ ids: ['b', 'c'], primaryId: 'b' })
  expect(addObjects(base, [object('a')])).toBe(base)
  expect(addObjects(base, [object('x'), object('x')])).toBe(base)
  const full = scene(Array.from({ length: MAX_SCENE_OBJECTS }, (_, index) => String(index)))
  expect(remainingCapacity(full)).toBe(0)
  expect(addObjects(full, [object('overflow')])).toBe(full)
})

it('preserves selection order and maintains a valid primary selection', () => {
  const base = scene(['a', 'b', 'c'])
  const selected = setSelection(base, { ids: ['c', 'missing', 'a', 'c'], primaryId: 'missing' })
  expect(selected.selection).toEqual({ ids: ['c', 'a'], primaryId: 'a' })
  expect(selectMany(base, ['c', 'missing', 'a']).selection).toEqual({ ids: ['c', 'a'], primaryId: 'c' })
  expect(selectOnly(base, 'b').selection).toEqual({ ids: ['b'], primaryId: 'b' })
  expect(toggleSelected(selected, 'b').selection).toEqual({ ids: ['c', 'a', 'b'], primaryId: 'b' })
  expect(toggleSelected(selected, 'a').selection).toEqual({ ids: ['c'], primaryId: 'c' })
  expect(clearSelection(selected).selection).toEqual({ ids: [], primaryId: null })
})

it('removes deterministically and projects primary/single selection', () => {
  const base = scene(['a', 'b', 'c'], ['b'], 'b')
  const next = removeObjects(base, ['b'])
  expect(next.objects.map((item) => item.id)).toEqual(['a', 'c'])
  expect(next.selection).toEqual({ ids: ['c'], primaryId: 'c' })
  expect(primaryObject(next)?.id).toBe('c')
  expect(singleSelectedObject(next)?.id).toBe('c')
  expect(removeObjects(next, ['missing'])).toBe(next)
  expect(primaryObject(EMPTY_SCENE)).toBeUndefined()
})

it('updates one object without allowing its identity to change', () => {
  const base = scene(['a', 'b'])
  const next = updateSceneObject(base, 'a', (item) => ({ ...item, name: 'renamed' }))
  expect(next.objects[0].name).toBe('renamed')
  expect(next.objects[1]).toBe(base.objects[1])
  expect(updateSceneObject(base, 'missing', (item) => item)).toBe(base)
  expect(() => updateSceneObject(base, 'a', (item) => ({ ...item, id: 'changed' }))).toThrow('preserve its ID')
})

it('holds exactly 100 objects: 99 + 1 fits, 100 + 1 and 99 + 2 are refused atomically', () => {
  expect(MAX_SCENE_OBJECTS).toBe(100)
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `o${index}`)
  const ninetyNine = scene(ids(99))
  expect(remainingCapacity(ninetyNine)).toBe(1)
  const hundred = addObjects(ninetyNine, [object('last')])
  expect(hundred.objects).toHaveLength(100)
  expect(remainingCapacity(hundred)).toBe(0)
  expect(addObjects(hundred, [object('overflow')])).toBe(hundred)
  expect(addObjects(ninetyNine, [object('x'), object('y')])).toBe(ninetyNine)
})

it('toggles checkbox membership without moving the primary unless it must', () => {
  const base = scene(['a', 'b', 'c', 'd'])
  // Empty selection: the checked object becomes primary.
  const first = toggleMembership(base, 'b')
  expect(first.selection).toEqual({ ids: ['b'], primaryId: 'b' })
  // Adding keeps the existing primary, unlike the Ctrl/Cmd toggle.
  const second = toggleMembership(first, 'd')
  expect(second.selection).toEqual({ ids: ['b', 'd'], primaryId: 'b' })
  expect(toggleSelected(first, 'd').selection.primaryId).toBe('d')
  // Removing a non-primary member keeps the primary.
  const third = toggleMembership(toggleMembership(second, 'a'), 'd')
  expect(third.selection).toEqual({ ids: ['b', 'a'], primaryId: 'b' })
  // Unchecking the primary moves it to the last remaining member.
  expect(toggleMembership(third, 'b').selection).toEqual({ ids: ['a'], primaryId: 'a' })
  expect(toggleMembership(toggleMembership(third, 'b'), 'a').selection).toEqual({ ids: [], primaryId: null })
  expect(toggleMembership(base, 'missing')).toBe(base)
})
