import { expect, it } from 'vitest'

/** Every application source file, as text. Layer boundaries are a property of
 *  the import graph, and the only way to keep that honest over time is to read
 *  it rather than to trust a convention. */
const sources = import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const styles = import.meta.glob('../styles/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const workerSources = import.meta.glob('../../workers/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Module specifiers of every static and dynamic import in one file. */
function importsOf(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /(?:^|\n)\s*import\s+(?:type\s+)?[^'"\n]*from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?:^|\n)\s*export\s+(?:type\s+)?[^'"\n]*from\s*['"]([^'"]+)['"]/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1])
  }
  return specifiers
}

function filesUnder(directory: string): [string, string][] {
  return Object.entries(sources).filter(([path]) => path.startsWith(`../${directory}/`) && !path.endsWith('.test.ts'))
}

function resolveWorkerImport(from: string, specifier: string): string {
  const parts = [...from.split('/').slice(0, -1), ...specifier.split('/')]
  const normalized: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..' && normalized.length > 0 && normalized.at(-1) !== '..') normalized.pop()
    else normalized.push(part)
  }
  return normalized.join('/')
}

it('keeps three.js out of the map, orbital and simulation layers', () => {
  for (const directory of ['map', 'orbital', 'simulation']) {
    const files = filesUnder(directory)
    expect(files.length, `no source files found under ${directory}/`).toBeGreaterThan(0)
    for (const [path, source] of files) {
      for (const specifier of importsOf(source)) {
        expect(specifier === 'three' || specifier.startsWith('three/'), `${path} imports ${specifier}`).toBe(false)
      }
    }
  }
})

it('keeps propagation, application, UI and scene code out of the map layer', () => {
  // The map is a view over data it is handed. It owns no propagator, no
  // application state and no control, so it cannot start a second simulation
  // or mutate the one that exists.
  const forbidden = ['../orbital/', '../app/', '../state/', '../ui/', '../scene/', '../data/', '../assets/']
  for (const [path, source] of filesUnder('map')) {
    for (const specifier of importsOf(source)) {
      expect(forbidden.some((prefix) => specifier.startsWith(prefix)), `${path} imports ${specifier}`).toBe(false)
      expect(
        specifier.startsWith('.') || specifier.startsWith('../core/') || specifier.startsWith('../simulation/') || specifier === '../i18n/index.ts',
        `${path} imports ${specifier}`,
      ).toBe(true)
    }
  }
})

it('keeps sensor geometry and its control mapping unable to propagate or orient the Earth', () => {
  // One propagated state and one Earth orientation per frame: the runtime hands
  // both to sensor code, which has no route to obtain either itself.
  const forbidden = ['../orbital/', './earthOrientation', '../app/', '../state/', '../ui/', '../scene/', '../data/', 'three']
  for (const path of ['../simulation/sensorFootprint.ts', '../simulation/sensorControlRange.ts']) {
    expect(sources[path], `${path} is missing`).toBeDefined()
    for (const specifier of importsOf(sources[path])) {
      expect(forbidden.some((prefix) => specifier.startsWith(prefix)), `${path} imports ${specifier}`).toBe(false)
    }
  }
  // The runtime builds the one result per object per frame; nothing else does.
  const builders = Object.entries(sources)
    .filter(([path, source]) => !path.endsWith('.test.ts') && !path.endsWith('sensorFootprint.ts') && source.includes('createInstantaneousSensorGeometry('))
    .map(([path]) => path)
  expect(builders).toEqual(['./OrbitalObjectRuntime.ts'])
  expect(sources['./OrbitalObjectRuntime.ts'].match(/createInstantaneousSensorGeometry\(/g) ?? []).toHaveLength(1)
})

it('runs one animation loop, and renders the map from inside it', () => {
  // The dev-only harness observes frame intervals with its own
  // callbacks; it is never bundled (scripts/build/checkMeasurementHarnessExcluded.mjs).
  const loops = Object.entries(sources).filter(([path, source]) => path !== '../performance/sceneScaleHarness.ts' && source.includes('requestAnimationFrame('))
  // The render loop and the deferred camera fit are the only two callers; the
  // map draws from the existing frame callback rather than a loop of its own.
  expect(loops.map(([path]) => path).sort()).toEqual(['./Application.ts', './renderLoop.ts'])
  expect(sources['../map/GroundTrackMapView.ts']).not.toContain('requestAnimationFrame')
  expect(sources['../map/GroundTrackMapView.ts']).not.toContain('setInterval')
  expect(sources['./Application.ts']).toContain('this.map.render()')
})

it('keeps the map view free of focus traps and pointer handlers on its canvases', () => {
  // Vitest stubs CSS imports, so the stylesheet's `pointer-events: none` on
  // `.map-layer` is checked in browser acceptance. What is checkable here is
  // that the view marks every layer with the class that rule targets and adds
  // no interaction of its own beyond the Close button.
  const view = sources['../map/GroundTrackMapView.ts']
  // Exactly the four fixed canvases, each marked with that class.
  expect(view.match(/'canvas', 'map-layer map-/g) ?? []).toHaveLength(4)
  expect(view).not.toContain('tabindex')
  expect(view).not.toContain('pointerdown')
  expect(view).not.toContain('wheel')
  // Exactly three listeners: the two map presentation buttons, and the
  // window-resize fallback for browsers without ResizeObserver. Nothing
  // listens on a Canvas.
  expect(view.match(/addEventListener\(/g) ?? []).toHaveLength(3)
  expect(view).toContain("this.closeButton.addEventListener('click'")
  expect(view).toContain("this.maximizeButton.addEventListener('click'")
  expect(view).toContain("globalThis.addEventListener('resize'")
})

it('keeps provider endpoints at the Worker provider boundary and three.js out of Worker code', () => {
  // A provider swap must be a change inside one directory. If an upstream host,
  // path or query dialect appears anywhere else in the Worker, the abstraction
  // has already leaked.
  const providerVocabulary = ['//www.space-track.org', 'basicspacedata', 'ajaxauth', 'chocolatechip', 'celestrak']
  for (const [path, source] of Object.entries(workerSources)) {
    if (path.endsWith('.test.ts')) continue
    expect(source).not.toMatch(/from\s+['"]three(?:\/|['"])/)
    if (path.includes('/provider/')) continue
    for (const token of providerVocabulary) expect(source.toLowerCase(), `${path} mentions ${token}`).not.toContain(token.toLowerCase())
  }
})

it('keeps provider credentials out of every file that can reach the browser', () => {
  // The identity and password exist as Cloudflare Worker secrets. Nothing under
  // src/ may name them, because everything under src/ is bundled and shipped.
  const secretNames = ['SPACETRACK_IDENTITY', 'SPACETRACK_PASSWORD']
  for (const [path, source] of Object.entries(sources)) {
    if (path.endsWith('.test.ts')) continue
    for (const name of secretNames) expect(source, `${path} names ${name}`).not.toContain(name)
  }
  // Inside the Worker they are confined to the provider implementation and the
  // environment declaration that types them.
  const permitted = ['../../workers/catalogue/provider/spaceTrack.ts', '../../workers/catalogue/types.ts']
  for (const [path, source] of Object.entries(workerSources)) {
    if (path.endsWith('.test.ts')) continue
    if (secretNames.some((name) => source.includes(name))) expect(permitted, `${path} names a provider credential`).toContain(path)
  }
})

it('keeps browser code free of any request that could reach a provider directly', () => {
  // Every catalogue read is same-origin by construction. This is the property
  // that keeps learner count from becoming upstream request volume. A provider
  // name may legitimately appear as display text for attribution; a provider
  // URL may not appear at all.
  const providerUrl = /https?:\/\/[^'"\s]*(?:space-track|celestrak)/i
  for (const [path, source] of Object.entries(sources)) {
    if (path.endsWith('.test.ts')) continue
    expect(providerUrl.test(source), `${path} contains a provider URL`).toBe(false)
  }
})

it('keeps catalogue exploration independent of simulation and rendering layers', () => {
  const forbidden = ['three', '../scene/', '../simulation/', '../orbital/', '../map/', '../app/']
  for (const path of ['../data/catalogueQuery.ts', '../ui/catalogueResultsModel.ts', '../ui/catalogueDiscoveryModel.ts', '../ui/CatalogueDiscoveryView.ts', '../ui/CatalogueResultsView.ts', '../ui/CatalogueReviewView.ts', '../ui/CatalogueWorkingSelectionView.ts']) {
    const source = sources[path]
    expect(source, `${path} is missing`).toBeDefined()
    for (const specifier of importsOf(source)) expect(forbidden.some((prefix) => specifier === prefix || specifier.startsWith(prefix)), `${path} imports ${specifier}`).toBe(false)
  }
})

it('keeps frontend runtime reachability limited to its shared serving closure', () => {
  const entry = '../../workers/frontend/index.ts'
  const expected = new Set([entry, '../../workers/frontend/usageEventSchema.ts', '../../workers/shared/serve.ts', '../../workers/shared/types.ts'])
  const seen = new Set<string>()
  const pending = [entry]
  while (pending.length > 0) {
    const current = pending.pop()!
    if (seen.has(current)) continue
    seen.add(current)
    const source = workerSources[current]
    expect(source, `${current} is missing from worker sources`).toBeDefined()
    for (const specifier of importsOf(source)) {
      expect(specifier.startsWith('.'), `${current} imports non-relative module ${specifier}`).toBe(true)
      const resolved = resolveWorkerImport(current, specifier)
      expect(workerSources[resolved], `${current} imports missing worker module ${specifier}`).toBeDefined()
      pending.push(resolved)
    }
  }
  expect(seen).toEqual(expected)
})

it('keeps shared worker modules self-contained', () => {
  for (const [pathName, source] of Object.entries(workerSources)) {
    if (!pathName.includes('/workers/shared/') || pathName.endsWith('.test.ts')) continue
    for (const specifier of importsOf(source)) {
      expect(specifier.startsWith('./'), `${pathName} imports outside shared modules: ${specifier}`).toBe(true)
      expect(resolveWorkerImport(pathName, specifier).includes('/workers/shared/'), `${pathName} imports outside shared modules: ${specifier}`).toBe(true)
    }
  }
})

it('keeps frontend and catalogue entry-point boundaries explicit', () => {
  for (const [pathName, source] of Object.entries(workerSources)) {
    if (pathName.endsWith('.test.ts')) continue
    if (!pathName.includes('/workers/frontend/')) {
      for (const specifier of importsOf(source)) expect(specifier.includes('/frontend/'), `${pathName} imports frontend code: ${specifier}`).toBe(false)
    }
    if (pathName.includes('/workers/catalogue/')) {
      expect(source).not.toContain("../shared/serve.ts")
    }
  }
})

it('keeps frontend and shared runtime code free of producer capabilities', () => {
  const forbidden = ['scheduled', 'SPACETRACK_', 'CATALOGUE_PROVIDER', 'CATALOGUE_RETRIEVAL', '.put(', '.delete(', '.list(', 'catalog/v1/control']
  for (const [pathName, source] of Object.entries(workerSources)) {
    if ((!pathName.includes('/workers/frontend/') && !pathName.includes('/workers/shared/')) || pathName.endsWith('.test.ts')) continue
    for (const token of forbidden) expect(source, `${pathName} contains ${token}`).not.toContain(token)
  }
})

it('keeps the recovered shell free of the legacy panel composition', () => {
  const ui = Object.entries(sources).filter(([path]) => path.startsWith('../ui/') && !path.endsWith('.test.ts')).map(([, source]) => source).join('\n')
  const css = Object.values(styles).join('\n')
  for (const token of ['control-panel', 'panel-header', 'panel-content', 'panel-chevron', 'is-collapsed', 'id="add-orbit"', 'Add an orbit', 'Hide objects panel', 'Hide inspector']) {
    expect(`${ui}\n${css}`, `legacy UI token ${token}`).not.toContain(token)
  }
  expect(sources['../ui/AppShellView.ts']).toContain('class="brand-lockup"')
  // The shell syncs only its mode buttons; rows and swatches own their state.
  expect(sources['../ui/AppShellView.ts']).toContain(`querySelectorAll<HTMLButtonElement>('.mode-selector [aria-pressed]')`)
  expect(sources['../ui/AppShellView.ts']).not.toContain(`querySelectorAll<HTMLButtonElement>('[aria-pressed]')`)
  expect(sources['../ui/UiRoot.ts']).not.toContain('innerHTML')
  expect(sources['../ui/UiRoot.ts']).toContain('new AppShellView')
  expect(sources['../ui/UiRoot.ts']).toContain('new OrbitLabDrawerView')
  expect(sources['../ui/UiRoot.ts']).toContain('new RealObjectsDrawerView')
  expect(sources['../ui/UiRoot.ts']).toContain('new SceneInspectorView')
  expect(sources['../ui/UiRoot.ts']).toContain('new TimeControlsView')
  expect(sources['../ui/UiRoot.ts']).toContain('new ViewControlsView')
  expect(sources['../ui/UiRoot.ts']).toContain('new CatalogueWorkspaceView')
  expect(sources['../ui/UiRoot.ts']).toContain('new CatalogueLauncherView')
  expect(sources['../ui/UiRoot.ts']).toContain('new OrbitLabLauncherView')
  expect(sources['../ui/OrbitLabLauncherView.ts']).toContain('id="create-orbit"')
  expect(sources['../ui/OrbitLabDrawerView.ts']).not.toContain('id="create-orbit"')
})

it('gives each migrated control family one source owner', () => {
  const owner = (file: string) => sources[`../ui/${file}`]
  const families: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['TimeControlsView.ts', ['time-drawer-toggle', 'time-speed-cycle', 'sim-time-input', 'time-now', 'time-reset', 'play-button', 'speed-slider', 'reverse-toggle']],
    ['ViewControlsView.ts', ['view-drawer-toggle', 'fit-orbits', 'ground-track-map-open', 'marker-scaling-toggle', 'all-orbit-paths-toggle', 'all-ground-track-histories-toggle', 'all-sensor-geometries-toggle']],
    ['SceneInspectorView.ts', ['color-palette', 'marker-size-slider', 'path-toggle', 'ground-track-toggle', 'ground-track-history-toggle', 'inspector-name']],
    ['OrbitLabAuthoringView.ts', ['geometry-controls', 'propagation-select', 'sso-lock-toggle', 'phase-slider']],
    ['RealObjectsDrawerView.ts', ['manual-record-format', 'tle-input', 'omm-input', 'add-tle']],
    ['CatalogueWorkspaceView.ts', ['catalogue-load', 'catalogue-refresh', 'catalogue-workspace-close', 'catalogue-find-mount', 'catalogue-discovery-region', 'catalogue-page-region', 'catalogue-results-region', 'catalogue-review-region', 'catalogue-working-selection-button', 'catalogue-selection-count-status']],
    ['CatalogueDiscoveryView.ts', ['catalogue-explore-list', 'catalogue-browse-all', 'catalogue-active-page']],
    ['CatalogueResultsView.ts', ['catalogue-search', 'catalogue-sort', 'catalogue-all-filters-toggle', 'catalogue-all-filters', 'catalogue-clear-filters', 'catalogue-summary', 'catalogue-results-body']],
    ['CatalogueReviewView.ts', ['catalogue-review-tabs', 'catalogue-tab-details', 'catalogue-tab-selection', 'catalogue-tab-compare', 'catalogue-details-body', 'catalogue-selection-body', 'catalogue-compare-body', 'catalogue-epoch-toggle']],
    ['CatalogueWorkingSelectionView.ts', ['catalogue-selection-heading', 'catalogue-selection-preview', 'catalogue-selection-capacity', 'catalogue-add-selected', 'catalogue-view-scene', 'catalogue-selection-outcome', 'catalogue-selection-list', 'catalogue-selection-clear']],
  ]
  const uiSources = Object.entries(sources).filter(([path]) => path.startsWith('../ui/') && !path.endsWith('.test.ts'))
  for (const [file, ids] of families) for (const id of ids) {
    expect(owner(file), id).toContain(`#${id}`)
    const token = new RegExp(`(?:#|id=["'])${id}(?:\\b|["'])`)
    const otherOwners = uiSources.filter(([path, source]) => path !== `../ui/${file}` && token.test(source)).map(([path]) => path)
    expect(otherOwners, `${id} also appears outside ${file}`).toEqual([])
  }
  expect(owner('OrbitLabAuthoringView.ts')).not.toContain('sensor-host')
  expect(owner('UiRoot.ts')).toContain('views.inspectorView.sensorHost')
})

it('constructs every exported UI view class', () => {
  const production = Object.entries(sources).filter(([path]) => !path.endsWith('.test.ts')).map(([, source]) => source).join('\n')
  for (const [path, source] of Object.entries(sources)) {
    if (!path.startsWith('../ui/') || path.endsWith('.test.ts')) continue
    for (const match of source.matchAll(/export class (\w+View)\b/g)) {
      expect(production, `${match[1]} from ${path} is never constructed`).toContain(`new ${match[1]}`)
    }
  }
})

it('keeps the mobile presentation on shared state, words and helpers only', () => {
  const files = filesUnder('mobile')
  expect(files.length, 'no source files found under mobile/').toBeGreaterThan(0)
  const shared = ['../i18n/', '../core/', '../state/', '../data/', '../orbital/', '../simulation/']
  for (const [path, source] of files) {
    for (const specifier of importsOf(source)) {
      const allowed = specifier.startsWith('./') || shared.some((prefix) => specifier.startsWith(prefix))
        || specifier === '../app/applicationBuildInfo.ts'
        // Shared UI helpers and wording, and the reused scene-open view; no desktop view.
        || (specifier.startsWith('../ui/') && (!/View\.ts$/.test(specifier) || specifier === '../ui/SceneOpenView.ts'))
      expect(allowed, `${path} imports ${specifier}`).toBe(true)
      expect(specifier === 'three' || specifier.startsWith('three/'), `${path} imports ${specifier}`).toBe(false)
    }
  }
  for (const [path, source] of Object.entries(sources)) {
    if (!path.startsWith('../ui/') || path.endsWith('.test.ts')) continue
    for (const specifier of importsOf(source)) expect(specifier.includes('/mobile/'), `${path} imports ${specifier}`).toBe(false)
  }
})

it('keeps desktop control ids out of the mobile views; mobile ids are generated and prefixed', () => {
  const desktopIds = new Set<string>()
  for (const [path, source] of Object.entries(sources)) {
    if (!path.startsWith('../ui/') || path.endsWith('.test.ts')) continue
    for (const match of source.matchAll(/id="([a-z][a-z0-9-]*)"/g)) desktopIds.add(match[1])
  }
  expect(desktopIds.size).toBeGreaterThan(50)
  for (const [path, source] of filesUnder('mobile')) {
    // Literal ids never appear: views keep element references, and ARIA ids come from `mobileId`.
    expect(source.match(/\bid="[a-z]/g) ?? [], path).toEqual([])
    expect(source, path).not.toMatch(/querySelector[^(]*\(\s*['"`]#/)
    for (const id of desktopIds) expect(new RegExp(`['"\`#]${id}['"\`]`).test(source), `${path} names desktop id ${id}`).toBe(false)
  }
  expect(sources['../mobile/PanelHost.ts']).toContain('return `m-${stem}-${generatedIds}`')
})

it('constructs every exported mobile view class', () => {
  const production = Object.entries(sources).filter(([path]) => !path.endsWith('.test.ts')).map(([, source]) => source).join('\n')
  for (const [path, source] of filesUnder('mobile')) {
    for (const match of source.matchAll(/export class (\w+View)\b/g)) {
      expect(production, `${match[1]} from ${path} is never constructed`).toContain(`new ${match[1]}`)
    }
  }
})

it('drives either presentation through the ApplicationUi port', () => {
  const application = sources['./Application.ts']
  expect(application).toContain('private ui: ApplicationUi')
  expect(application).not.toMatch(/private (?:readonly )?ui: (?:UiRoot|MobileUiRoot)/)
  expect(application.match(/new UiRoot\(/g) ?? []).toHaveLength(1)
  expect(application.match(/new MobileUiRoot\(/g) ?? []).toHaveLength(1)
  expect(sources['../ui/UiRoot.ts']).toContain('export class UiRoot implements ApplicationUi')
  expect(sources['../mobile/MobileUiRoot.ts']).toContain('export class MobileUiRoot implements ApplicationUi')
  // One owner of the presentation, with a balanced media listener.
  const presentation = sources['./PresentationController.ts']
  expect(presentation.match(/\.addEventListener\('change', this\.onQueryChange\)/g) ?? []).toHaveLength(1)
  expect(presentation.match(/\.removeEventListener\('change', this\.onQueryChange\)/g) ?? []).toHaveLength(1)
  expect(application).toContain('this.presentation.dispose()')
  const matchers = Object.entries(sources).filter(([path, source]) => !path.endsWith('.test.ts') && source.includes('MOBILE_PRESENTATION_QUERY')).map(([path]) => path)
  expect(matchers).toEqual(['./PresentationController.ts'])
  // The development override is read only in development builds.
  expect(sources['../main.ts']).toContain("import.meta.env.DEV ? parsePresentationOverride(params.get('presentation')) : null")
})

it('asks for the location only from My place and keeps it out of scenes, links and requests', () => {
  const production = Object.entries(sources).filter(([path]) => !path.endsWith('.test.ts'))
  const askers = production.filter(([, source]) => source.includes('geolocation')).map(([path]) => path)
  expect(askers).toEqual(['./Application.ts'])
  const application = sources['./Application.ts']
  expect(application.match(/navigator\.geolocation/g) ?? []).toHaveLength(1)
  expect(application.match(/\.getCurrentPosition\(/g) ?? []).toHaveLength(1)
  expect(application.match(/watchPosition/g) ?? []).toEqual([])
  const handler = application.slice(application.indexOf('  private changeMyPlace(on: boolean): void {'), application.indexOf('  private setMyPlace('))
  expect(handler).toContain('navigator.geolocation')
  expect(handler).toContain('if (!on) {')
  // The location never reaches a scene document, link, file, store or log.
  for (const path of ['../data/sceneDocument.ts', '../data/sharedScene.ts', '../data/sceneLink.ts', '../data/sceneFile.ts', '../state/AppState.ts', './applySharedScene.ts', './SceneSharingController.ts']) {
    expect(sources[path], path).not.toMatch(/observer|geolocation|latitude: |myPlace/i)
  }
  expect(application).not.toMatch(/console\.[a-z]+\([^)]*observer/)
  for (const specifier of importsOf(sources['../simulation/observerGeometry.ts'])) expect(specifier.startsWith('../core/'), specifier).toBe(true)
})

it('balances the shell viewport listener and disposes the composed shell', () => {
  const application = sources['./Application.ts']
  expect(application.match(/narrowViewportQuery\.addEventListener\('change', this\.onViewportChange\)/g) ?? []).toHaveLength(1)
  expect(application.match(/narrowViewportQuery\.removeEventListener\('change', this\.onViewportChange\)/g) ?? []).toHaveLength(1)
  expect(application).toContain('this.ui.dispose()')
  expect(application).toContain('this.sharing.dispose()')
  const root = sources['../ui/UiRoot.ts']
  for (const field of ['sensorView', 'sceneOpenView', 'shareView', 'optionsMenu', 'catalogueView', 'catalogueLauncher', 'orbitLabLauncher', 'orbitLabView', 'realObjectsView', 'inspectorView', 'shellView']) {
    expect(root, `${field} is not disposed`).toContain(`views.${field}.dispose()`)
  }
})

it('keeps catalogue-to-scene conversion behind the explicit action boundary', () => {
  expect(sources['./Application.ts']).toContain('addCatalogueRecordsToScene({')
  expect(sources['./Application.ts']).not.toContain('sceneObjectFromCatalogueRecord(')
  expect(sources['./addCatalogueRecordsToScene.ts']).toContain('sceneObjectFromCatalogueRecord(')
  expect(sources['./resolveSceneDocument.ts']).toContain('sceneObjectFromCatalogueRecord(')
  const directConverters = Object.entries(sources)
    // Test fixtures build scenes the way the catalogue would; they are never bundled.
    .filter(([path, source]) => !path.endsWith('.test.ts') && !path.startsWith('../test-fixtures/') && path !== './catalogueToScene.ts' && source.includes('sceneObjectFromCatalogueRecord('))
    .map(([path]) => path).sort()
  expect(directConverters).toEqual(['./addCatalogueRecordsToScene.ts', './resolveSceneDocument.ts'])
})

it('keeps the scene document a pure data contract', () => {
  const contract = sources['../data/sceneDocument.ts']
  for (const specifier of importsOf(contract)) {
    expect(specifier === 'three' || specifier.startsWith('../scene/') || specifier.startsWith('../map/') || specifier.startsWith('../ui/') || specifier.startsWith('../app/'), `sceneDocument imports ${specifier}`).toBe(false)
  }
  for (const match of contract.matchAll(/import([^\n]+)from ['"](\.\.\/(?:state|simulation)\/[^'"]+)['"]/g)) {
    expect(match[1].trim().startsWith('type '), `runtime import from ${match[2]}`).toBe(true)
  }
  const production = Object.entries(sources).filter(([path]) => !path.endsWith('.test.ts'))
  for (const [path, source] of production) for (const token of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'history.pushState', 'location.hash =', 'location.href =', 'location.assign(']) {
    // The remembered interface language is the one exception.
    if (token === 'localStorage' && path === './LocaleController.ts') continue
    // The back gesture's one same-URL entry.
    if (token === 'history.pushState' && path === '../mobile/backGesture.ts') continue
    expect(source, `${path} contains persistence token ${token}`).not.toContain(token)
  }
  // One module may remove the scene fragment; nothing else writes history.
  const historyWriters = production.filter(([, source]) => source.includes('history.replaceState')).map(([path]) => path)
  expect(historyWriters).toEqual(['./sceneLinkLocation.ts'])
  expect(sources['./sceneLinkLocation.ts'].match(/history\.replaceState\(/g) ?? []).toHaveLength(1)
  // One module may push one same-URL entry; it never names a URL.
  const pushers = production.filter(([, source]) => /\bpushState\(/.test(source)).map(([path]) => path)
  expect(pushers).toEqual(['../mobile/backGesture.ts'])
  expect(sources['../mobile/backGesture.ts'].match(/history\.pushState\(/g) ?? []).toHaveLength(1)
  expect(sources['../mobile/backGesture.ts']).toMatch(/history\.pushState\(\{ \[MARKER\]: true \}, ''\)/)
  expect(sources['../mobile/backGesture.ts']).not.toMatch(/location|replaceState|\.go\(/)
  expect(sources['./Application.ts']).not.toContain('resolveSceneDocument(')
  expect(sources['./Application.ts']).not.toContain('encodeSceneDocument(')
  const callersOf = (call: string, definedIn: string) => production.filter(([path, source]) => path !== definedIn && !path.startsWith('../test-fixtures/') && source.includes(call)).map(([path]) => path)
  expect(callersOf('resolveSceneDocument(', './resolveSceneDocument.ts')).toEqual(['./SceneSharingController.ts'])
  expect(callersOf('encodeSceneDocument(', '../data/sceneDocument.ts')).toEqual(['../data/sharedScene.ts'])
  expect(sources['./resolveSceneDocument.ts'].match(/parseOmmRecord\(/g) ?? []).toHaveLength(1)
  expect(sources['./resolveSceneDocument.ts']).toContain("parseOmmRecord(object.record, { kind: 'manual' })")
  expect(sources['./resolveSceneDocument.ts']).not.toContain('new CatalogueClient(')
})

it('injects only the reviewed official group and keeps fixture groups test-only', () => {
  // performance/ holds the bench and the dev-only harness; neither is bundled.
  // Every build injects the reviewed GPS bundle.
  expect(sources['./Application.ts']).toContain('private readonly groupInjection: CatalogueGroupInjection = officialCatalogueGroupInjection()')
  expect(sources['./Application.ts']).not.toContain('import.meta.env.MODE')
  expect(sources['../data/catalogueGroups.ts']).not.toContain('gpsOperational')
  const production = Object.entries(sources).filter(([path]) => !path.endsWith('.test.ts') && !path.startsWith('../test-fixtures/') && !path.startsWith('../data/fixtures/') && !path.endsWith('.bench.ts') && !path.startsWith('../performance/'))
  for (const [path, source] of production) {
    expect(importsOf(source).some((specifier) => specifier.includes('test-fixtures/') || specifier.includes('/fixtures/')), `${path} imports a fixture`).toBe(false)
    expect(source, `${path} names the fixture GPS group`).not.toMatch(/gps-system|FIXTURE_GPS|FIXTURE_CATALOGUE_GROUP/)
  }
})

it('keeps scene sharing codecs pure and scene content out of HTML', () => {
  // The link codec touches no DOM and no location.
  for (const path of ['../data/sceneLink.ts', '../data/sceneFile.ts', '../data/sharedScene.ts']) {
    const source = sources[path]
    expect(source, `${path} is missing`).toBeDefined()
    for (const specifier of importsOf(source)) expect(specifier.startsWith('./') || specifier === '../state/AppState.ts', `${path} imports ${specifier}`).toBe(true)
    expect(source, `${path} reaches the DOM or location`).not.toMatch(/\bwindow\b|\blocation\.|ownerDocument|querySelector|createElement|innerHTML/)
  }
  // Views set scene-derived text only with textContent; markup is fixed wording.
  for (const path of ['../ui/ShareSceneView.ts', '../ui/SceneOpenView.ts']) {
    expect(sources[path].match(/innerHTML/g) ?? [], path).toHaveLength(1)
    expect(sources[path]).toMatch(/template\.innerHTML = sceneOpenMarkup\(\)|template\.innerHTML = shareSceneMarkup\(\)/)
    expect(sources[path]).not.toContain('insertAdjacentHTML')
  }
})

/** Code whose output must not depend on the interface
 *  language. It never imports the localization boundary. */
const LANGUAGE_INDEPENDENT = ['../data/', '../core/', '../orbital/', '../simulation/']

it('keeps data, core, orbital and simulation code independent of the interface language', () => {
  for (const [path, source] of Object.entries(sources)) {
    if (path.endsWith('.test.ts') || !LANGUAGE_INDEPENDENT.some((prefix) => path.startsWith(prefix))) continue
    for (const specifier of importsOf(source)) expect(specifier.includes('/i18n/'), `${path} imports ${specifier}`).toBe(false)
  }
  for (const [path, source] of Object.entries(workerSources)) {
    if (path.endsWith('.test.ts')) continue
    expect(source, `${path} reaches the localization boundary`).not.toMatch(/\/i18n\//)
  }
  // Scene documents, files and links, and the preset notes they store.
  for (const path of ['../data/sceneLink.ts', '../data/sceneDocument.ts', '../data/sharedScene.ts', '../data/sceneFile.ts', '../simulation/orbitPresets.ts', '../state/canonicalNotes.ts']) {
    expect(sources[path], `${path} is missing`).toBeDefined()
    for (const specifier of importsOf(sources[path])) expect(specifier.includes('/i18n/'), `${path} imports ${specifier}`).toBe(false)
  }
})

it('lets only the locale owner change the active language', () => {
  const setters = Object.entries(sources).filter(([path, source]) => !path.endsWith('.test.ts') && path !== '../i18n/active.ts' && source.includes('setActiveLocale(')).map(([path]) => path)
  expect(setters).toEqual(['./LocaleController.ts'])
  // Views read the active catalogue through the public boundary only.
  expect(sources['../i18n/index.ts']).not.toContain('setActiveLocale')
})

it('formats locale-sensitive values only through the localization boundary', () => {
  for (const [path, source] of Object.entries(sources)) {
    if (path.endsWith('.test.ts') || path.startsWith('../i18n/') || path.startsWith('../test-fixtures/') || path.startsWith('../performance/')) continue
    expect(source, `${path} formats with the browser locale`).not.toMatch(/\.toLocaleString\(|\.toLocaleDateString\(|\.toLocaleTimeString\(/)
    expect(source, `${path} changes case with the browser locale`).not.toMatch(/\.toLocale(?:Lower|Upper)Case\(\)/)
    expect(source, `${path} builds its own Intl formatter`).not.toMatch(/new Intl\./)
  }
})

it('remembers the language in one browser key and keeps the pseudo-locale out of production', () => {
  const controller = sources['./LocaleController.ts']
  expect(controller.match(/localStorage/g)).toHaveLength(1)
  expect(controller).toContain("export const LOCALE_STORAGE_KEY = 'orbitin.locale'")
  expect(controller).not.toMatch(/navigator\.language|fetch\(|document\.cookie/)
  const importers = Object.entries(sources).filter(([path, source]) => !path.endsWith('.test.ts') && path !== '../i18n/messages/pseudo.ts' && importsOf(source).some((specifier) => specifier.endsWith('/pseudo.ts'))).map(([path]) => path)
  expect(importers).toEqual(['../main.ts'])
  const main = sources['../main.ts']
  expect(main).toMatch(/if \(import\.meta\.env\.DEV && params\.get\('locale'\) === 'pseudo'\) \{\s*const \{ pseudoCatalogue \} = await import\('\.\/i18n\/messages\/pseudo\.ts'\)/)
})
