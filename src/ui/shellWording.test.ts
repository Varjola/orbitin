import { expect, it } from 'vitest'
import { text } from '../i18n/index.ts'
import { MAX_SCENE_OBJECTS } from '../state/sceneActions.ts'
import { sceneFullForManualAdd } from './shellWording.ts'

it('keeps the durable shell vocabulary explicit', () => {
  const t = text()
  expect(t.shell.modes).toEqual({ orbitLab: 'Orbit Lab', realObjects: 'Real Objects' })
  expect(t.orbitLab.createOrbit).toBe('Create orbit')
  expect(t.shell.collapseWorkspace).toBe('Collapse workspace')
  expect(t.shell.expandWorkspace).toBe('Expand workspace')
  expect(t.shell.collapseInspector).toBe('Collapse inspector')
  expect(t.shell.expandInspector).toBe('Expand inspector')
})

it('derives every capacity message from the scene capacity', () => {
  const limit = text().shell.sceneLimit(MAX_SCENE_OBJECTS)
  expect(limit).toBe('This scene holds 100 objects. Remove one to add another.')
  expect(sceneFullForManualAdd('tle')).toBe('This scene already holds 100 objects. Remove an object before adding a TLE.')
  expect(`${limit} ${sceneFullForManualAdd('omm')}`.toLowerCase()).not.toContain('eight')
})
