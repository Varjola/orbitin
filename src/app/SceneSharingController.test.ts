import { expect, it, vi } from 'vitest'
import { CatalogueClient } from '../data/CatalogueClient.ts'
import { servedSnapshotPayloads, buildAutomaticSnapshotFixture } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { encodeSceneLinkPayload } from '../data/sceneLink.ts'
import { sceneFileText } from '../data/sceneFile.ts'
import { sharedSceneDocument } from '../data/sharedScene.ts'
import { SIMULATION_START_INSTANT, MAX_SIMULATION_INSTANT } from '../core/constants.ts'
import { EMPTY_SCENE, withScene, type AppState, type ProductMode } from '../state/AppState.ts'
import { createInitialState } from '../state/initialState.ts'
import { createCountingFetch } from '../test-fixtures/countingFetch.ts'
import { memorySceneLinkLocation } from '../test-fixtures/memorySceneLinkLocation.ts'
import { orbitLabState, realObjectsState } from '../test-fixtures/sharedSceneFixtures.ts'
import { applySharedSceneToState } from './applySharedScene.ts'
import { CatalogueController, CatalogueSnapshotChangedError, type CataloguePresenter, type ResolvedCatalogueRecords } from './CatalogueController.ts'
import type { ResolvedSceneDocument } from './resolveSceneDocument.ts'
import { SceneSharingController, type SceneSharingPresenter } from './SceneSharingController.ts'
import { setActiveLocale } from '../i18n/active.ts'

const NOW_MS = Date.UTC(2026, 8, 25, 18, 0, 0)
const cataloguePresenter: CataloguePresenter = { syncWorkspace() {}, setSnapshot() {}, setError() {}, renderQuery() {}, showDetails() {}, showDetailsError() {}, clearDetails() {}, setComparison() {}, clearComparison() {} }

function recordingPresenter() {
  const events: string[] = []
  const presenter: SceneSharingPresenter = {
    showConfirmation: (confirmation) => events.push(`confirm:${confirmation.message}|${confirmation.incoming}`),
    showProgress: (message) => events.push(`progress:${message}`),
    showNotice: (lines) => events.push(`notice:${lines.join(' / ')}`),
    showError: (message, retryable) => events.push(`error:${retryable ? 'retry:' : ''}${message}`),
    hideOpenStatus: () => events.push('hide'),
    setOpening: (opening) => events.push(`opening:${opening}`),
  }
  return { presenter, events }
}

async function linkHash(state: AppState, compress: 'auto' | 'never' = 'auto'): Promise<string> {
  const encoded = await encodeSceneLinkPayload(sharedSceneDocument(state), { compress })
  if (!encoded.ok) throw new Error('Expected a linkable scene.')
  return `#scene=s1.${encoded.payload}`
}

interface HarnessOptions {
  readonly state?: AppState
  readonly hash?: string
  readonly resolveRecords?: (ids: readonly string[]) => Promise<ResolvedCatalogueRecords>
  readonly loadCatalogue?: () => Promise<void>
}
function harness(options: HarnessOptions = {}) {
  const box = { state: options.state ?? createInitialState(() => 0), addPending: false, commits: 0 }
  const location = memorySceneLinkLocation({ hash: options.hash ?? '' })
  const { presenter, events } = recordingPresenter()
  const loadCatalogue = vi.fn(options.loadCatalogue ?? (async () => {}))
  const resolveRecords = vi.fn(options.resolveRecords ?? (async () => { throw new Error('No catalogue in this harness.') }))
  const applied: { mode: ProductMode; resolved: ResolvedSceneDocument }[] = []
  const controller = new SceneSharingController({
    getState: () => box.state, catalogueAddPending: () => box.addPending, loadCatalogue, resolveRecords, presenter, location,
    applySharedScene: (mode, resolved) => { applied.push({ mode, resolved }); box.commits++; box.state = applySharedSceneToState(box.state, mode, resolved, NOW_MS) },
  })
  return { box, location, events, loadCatalogue, resolveRecords, applied, controller }
}
async function settle(): Promise<void> { for (let index = 0; index < 20; index++) await new Promise((resolve) => setTimeout(resolve, 0)) }
function file(text: string, size = text.length) { return { size, text: async () => text } }

it('opens an initial Orbit Lab link without confirmation or catalogue requests and keeps Real Objects', async () => {
  const shared = orbitLabState()
  const recipient = withScene(realObjectsState(), 'orbitLab', { objects: [createInitialState(() => 0.9).orbitLab.scene.objects[0]], selection: { ids: [], primaryId: null } })
  const test = harness({ state: { ...recipient, activeMode: 'realObjects', simulation: { ...recipient.simulation, speedMultiplier: 600, reversed: true } }, hash: `#a=1&${(await linkHash(shared)).slice(1)}` })
  test.controller.start()
  await settle()
  expect(test.events.some((event) => event.startsWith('confirm:'))).toBe(false)
  expect(test.loadCatalogue).not.toHaveBeenCalled()
  expect(test.resolveRecords).not.toHaveBeenCalled()
  expect(test.applied).toHaveLength(1)
  expect(test.box.commits).toBe(1)
  const state = test.box.state
  expect(state.activeMode).toBe('orbitLab')
  expect(state.orbitLab.scene.objects.map((object) => object.name)).toEqual(shared.orbitLab.scene.objects.map((object) => object.name))
  expect(state.orbitLab.scene.selection).toEqual({ ids: ['orbit-2', 'orbit-3'], primaryId: 'orbit-3' })
  expect(state.realObjects).toBe(recipient.realObjects)
  expect(state.view).toEqual(shared.view)
  // The start instant, paused; speed and direction kept.
  expect(state.simulation).toEqual({ currentInstant: SIMULATION_START_INSTANT, playing: false, speedMultiplier: 600, reversed: true })
  expect(test.location.hash).toBe('#a=1')
  expect(test.events.at(-1)).toBe('notice:Opened a shared Orbit Lab scene: 3 orbits.')
})

it('loads the catalogue once and only the distinct referenced shards for a Real Objects link', async () => {
  const fixture = buildAutomaticSnapshotFixture()
  const counted = createCountingFetch(await servedSnapshotPayloads(fixture))
  const client = new CatalogueClient({ fetch: counted.fetch, pointerSessionTtlMs: 60_000 })
  const catalogue = new CatalogueController({ presenter: cataloguePresenter, client })
  const shared = realObjectsState()
  const recipient = createInitialState(() => 0)
  const test = harness({ state: recipient, hash: await linkHash(shared), loadCatalogue: () => catalogue.load(), resolveRecords: (ids) => catalogue.resolveRecords(ids) })
  test.controller.start()
  await settle()
  expect(test.applied).toHaveLength(1)
  const snapshot = catalogue.snapshot!
  const indexFiles = ['/catalog/v1/current.json', `/catalog/v1/snapshots/${snapshot.manifest.snapshotId}/manifest.json`, snapshot.manifest.index.path]
  expect(counted.requests.slice(0, 3)).toEqual(indexFiles)
  const catalogueIds = sharedSceneDocument(shared).realObjects.objects.flatMap((object) => object.kind === 'catalogue' ? [object.catalogId] : [])
  const shards = new Set(catalogueIds.map((id) => snapshot.manifest.shards[client.indexEntry(id)!.shard].path))
  expect(counted.requests.slice(3).sort()).toEqual([...shards].sort())
  const state = test.box.state
  expect(state.activeMode).toBe('realObjects')
  expect(state.realObjects.scene.objects).toHaveLength(6)
  // The recipient's Orbit Lab default orbit is kept; the clock opens at the current time, playing.
  expect(state.orbitLab).toBe(recipient.orbitLab)
  expect(state.simulation.currentInstant).toEqual({ unixSeconds: NOW_MS / 1000 })
  expect(state.simulation.playing).toBe(true)
  expect(test.events).toContain('progress:Opening shared scene… Loading catalogue records for 2 objects.')
  catalogue.dispose()
})

it('confirms file and pasted-link opens only when the target scene has objects', async () => {
  const text = sceneFileText(sharedSceneDocument(orbitLabState()))
  const empty = harness({ state: withScene(createInitialState(() => 0), 'orbitLab', EMPTY_SCENE) })
  await empty.controller.openFile(file(text))
  await settle()
  expect(empty.events.some((event) => event.startsWith('confirm:'))).toBe(false)
  expect(empty.applied).toHaveLength(1)

  const busy = harness()
  await busy.controller.openFile(file(text))
  expect(busy.events).toContain('confirm:Opening this scene replaces your Orbit Lab scene (1 orbit). Your Real Objects scene is kept. The clock moves to Orbitin\'s start time and pauses.|Orbit Lab: 3 orbits')
  expect(busy.applied).toHaveLength(0)
  await busy.controller.confirmPendingOpen()
  expect(busy.applied).toHaveLength(1)

  const pasted = harness()
  pasted.controller.start()
  pasted.location.navigate(await linkHash(orbitLabState()))
  await settle()
  expect(pasted.events.filter((event) => event.startsWith('confirm:'))).toHaveLength(1)
  expect(pasted.applied).toHaveLength(0)
  pasted.controller.cancelPendingOpen()
  expect(pasted.location.hash).toBe('')
  pasted.location.navigate(await linkHash(orbitLabState()))
  await settle()
  await pasted.controller.confirmPendingOpen()
  expect(pasted.applied).toHaveLength(1)
})

it('clamps the Real Objects opening time and keeps speed and direction', () => {
  const resolved: ResolvedSceneDocument = { activeMode: 'realObjects', orbitLab: EMPTY_SCENE, realObjects: realObjectsState().realObjects.scene, simulation: null, view: { groundTrackMapVisible: true, scaleMarkersWithZoom: false }, problems: [] }
  const before = createInitialState(() => 0)
  const opened = applySharedSceneToState({ ...before, simulation: { ...before.simulation, speedMultiplier: 3600, reversed: true, playing: false } }, 'realObjects', resolved, Date.UTC(2080, 0, 1))
  expect(opened.simulation).toEqual({ currentInstant: MAX_SIMULATION_INSTANT, playing: true, speedMultiplier: 3600, reversed: true })
  expect(opened.orbitLab).toBe(before.orbitLab)
  expect(opened.realObjects.scene).toBe(resolved.realObjects)
  expect(opened.view).toEqual(resolved.view)
})

it('cancels during confirming or resolving without changing anything, and clears the fragment', async () => {
  let release!: () => void
  const test = harness({ state: realObjectsState(), hash: await linkHash(realObjectsState()), loadCatalogue: () => new Promise<void>((resolve) => { release = resolve }) })
  const before = test.box.state
  test.controller.start()
  await settle()
  expect(test.controller.opening).toBe(true)
  test.controller.cancelPendingOpen()
  expect(test.location.hash).toBe('')
  expect(test.controller.opening).toBe(false)
  release()
  await settle()
  expect(test.applied).toHaveLength(0)
  expect(test.box.state).toBe(before)
})

it('keeps the session when the catalogue fails and succeeds on retry', async () => {
  let fail = true
  const resolveRecords = async (): Promise<ResolvedCatalogueRecords> => {
    if (fail) throw new Error('offline')
    const fixture = buildAutomaticSnapshotFixture()
    const counted = createCountingFetch(await servedSnapshotPayloads(fixture))
    const catalogue = new CatalogueController({ presenter: cataloguePresenter, client: new CatalogueClient({ fetch: counted.fetch }) })
    await catalogue.load()
    const ids = sharedSceneDocument(realObjectsState()).realObjects.objects.flatMap((object) => object.kind === 'catalogue' ? [object.catalogId] : [])
    return catalogue.resolveRecords(ids)
  }
  const test = harness({ hash: await linkHash(realObjectsState()), resolveRecords })
  const before = test.box.state
  test.controller.start()
  await settle()
  expect(test.events).toContain('error:retry:The catalogue could not be loaded, so the scene was not opened.')
  expect(test.box.state).toBe(before)
  expect(test.location.hash).toBe('')
  fail = false
  await test.controller.retry()
  expect(test.applied).toHaveLength(1)
  expect(test.box.state.realObjects.scene.objects).toHaveLength(6)
})

it('names a catalogue update during the open', async () => {
  const test = harness({ hash: await linkHash(realObjectsState()), resolveRecords: async () => { throw new CatalogueSnapshotChangedError('changed') } })
  test.controller.start()
  await settle()
  expect(test.events).toContain('error:retry:The catalogue was updated while the scene was opening.')
})

it('lets a newer open supersede one still resolving, and applies nothing after dispose', async () => {
  const releases: (() => void)[] = []
  const test = harness({ state: withScene(createInitialState(() => 0), 'orbitLab', EMPTY_SCENE), hash: await linkHash(realObjectsState()), loadCatalogue: () => new Promise<void>((resolve) => { releases.push(resolve) }), resolveRecords: async () => { throw new Error('superseded opens never get here') } })
  test.controller.start()
  await settle()
  expect(releases).toHaveLength(1)
  await test.controller.openFile(file(sceneFileText(sharedSceneDocument(orbitLabState()))))
  await settle()
  expect(test.applied.map((item) => item.mode)).toEqual(['orbitLab'])
  releases[0]()
  await settle()
  expect(test.applied).toHaveLength(1)
  expect(test.resolveRecords).not.toHaveBeenCalled()

  const disposed = harness({ hash: await linkHash(realObjectsState()), loadCatalogue: () => new Promise<void>((resolve) => { releases.push(resolve) }) })
  disposed.controller.start()
  await settle()
  disposed.controller.dispose()
  releases.at(-1)!()
  await settle()
  expect(disposed.applied).toHaveLength(0)
})

it('refuses to open while a catalogue add is pending', async () => {
  const test = harness({ state: withScene(createInitialState(() => 0), 'orbitLab', EMPTY_SCENE) })
  test.box.addPending = true
  await test.controller.openFile(file(sceneFileText(sharedSceneDocument(orbitLabState()))))
  expect(test.applied).toHaveLength(0)
  expect(test.events).toContain('error:Wait for the current add to finish, then open the scene again.')
})

it('makes no catalogue request and changes nothing on a fresh load without a fragment', async () => {
  const test = harness({ hash: '#section' })
  test.controller.start()
  await settle()
  expect(test.loadCatalogue).not.toHaveBeenCalled()
  expect(test.events).toEqual([])
  expect(test.location.clears).toBe(0)
  expect(test.location.hash).toBe('#section')
})

it('shows the specific message for each unreadable input and changes nothing', async () => {
  const cases: [string, string][] = [
    ['#scene=s1.AA+A', 'error:This link does not contain a valid Orbitin scene.'],
    ['#scene=s9.AAAA', 'error:This link was made by a newer version of Orbitin.'],
  ]
  for (const [hash, expected] of cases) {
    const test = harness({ hash })
    const before = test.box.state
    test.controller.start()
    await settle()
    expect(test.events).toContain(expected)
    expect(test.box.state).toBe(before)
    expect(test.location.hash).toBe('')
  }
  const files: [ReturnType<typeof file>, string][] = [
    [file('{'), 'error:This file is not a valid Orbitin scene file.'],
    [file('{}', 2_000_000), 'error:This file is too large to be an Orbitin scene file.'],
    [file('{"format":"orbitin.scene","version":2}'), 'error:This file was made by a newer version of Orbitin.'],
  ]
  for (const [input, expected] of files) {
    const test = harness()
    await test.controller.openFile(input)
    expect(test.events).toContain(expected)
    expect(test.applied).toHaveLength(0)
  }
})

it('summarizes the share and never touches the catalogue while sharing', async () => {
  const test = harness({ state: realObjectsState() })
  expect(test.controller.shareSummary()).toEqual({ mode: 'realObjects', objectCount: 6, manualObjectCount: 4, catalogueObjectCount: 2, link: { ok: true } })
  const link = await test.controller.createLink()
  expect(link.ok && link.url.startsWith('https://orbitin.test/#scene=s1.')).toBe(true)
  const saved = test.controller.file(new Date(NOW_MS))
  expect(saved.name).toBe('orbitin-scene-real-objects-20260925-1800.orbitin.json')
  expect(saved.text).toBe(sceneFileText(sharedSceneDocument(realObjectsState())))
  expect(test.loadCatalogue).not.toHaveBeenCalled()
  expect(test.resolveRecords).not.toHaveBeenCalled()
})

it('shows a pending open again in the new language, but not a finished notice', async () => {
  const test = harness({ hash: await linkHash(realObjectsState()), resolveRecords: async () => { throw new Error('offline') } })
  test.controller.start()
  await settle()
  expect(test.events.at(-1)).toBe('error:retry:The catalogue could not be loaded, so the scene was not opened.')
  setActiveLocale('fi')
  try {
    test.events.length = 0
    test.controller.republish()
    expect(test.events).toEqual(['opening:false', 'error:retry:Luetteloa ei voitu ladata, joten näkymää ei avattu.'])
  } finally { setActiveLocale('en') }
  // A finished open leaves only a transient notice, which a rebuild clears.
  const done = harness({ hash: await linkHash(orbitLabState()) })
  done.controller.start()
  await settle()
  expect(done.events.at(-1)).toMatch(/^notice:/)
  done.events.length = 0
  done.controller.republish()
  expect(done.events).toEqual(['opening:false'])
})
