import type { ProductMode } from '../state/AppState.ts'
import { text } from '../i18n/index.ts'
import { html } from './markup.ts'
import { ModeSwitcherView } from './ModeSwitcherView.ts'
import type { ShellModel } from './shellModel.ts'

export interface AppShellCallbacks {
  onModeChange(mode: ProductMode): void
  onToggleLeftDrawer(): void
  onToggleInspector(): void
}

/** Owns only the application chrome, region boundaries and shell measurement.
 * Feature views receive their own roots from this view and never query across
 * the shell. */
export class AppShellView {
  readonly root: HTMLElement
  readonly orbitLabRoot: HTMLElement
  readonly realObjectsRoot: HTMLElement
  readonly maneuversRoot: HTMLElement
  readonly maneuverControlsRoot: HTMLElement
  readonly maneuverViewRoot: HTMLElement
  readonly maneuverInfoRoot: HTMLElement
  readonly routeDrawerRoot: HTMLElement
  readonly routeResultsRoot: HTMLElement
  readonly routePlaybackRoot: HTMLElement
  readonly routeLiveBarRoot: HTMLElement
  readonly routeLauncherRoot: HTMLElement
  readonly routeExitRoot: HTMLElement
  readonly routePlanningRoot: HTMLElement
  readonly inspectorRoot: HTMLElement
  readonly timeRoot: HTMLElement
  readonly viewRoot: HTMLElement
  readonly sceneObjectsRoot: HTMLElement
  readonly orbitLabLauncherRoot: HTMLElement
  readonly catalogueLauncherRoot: HTMLElement
  readonly catalogueRoot: HTMLElement
  readonly optionsRoot: HTMLElement
  private readonly callbacks: AppShellCallbacks
  private readonly modeSwitcher: ModeSwitcherView
  private readonly resizeObserver: ResizeObserver | null
  private readonly layoutRoot: HTMLElement

  constructor(container: HTMLElement, callbacks: AppShellCallbacks) {
    this.callbacks = callbacks
    this.layoutRoot = container.parentElement ?? container
    const documentRef = container.ownerDocument
    this.root = documentRef.createElement('div')
    this.root.className = 'shell-chrome'
    const t = text().shell
    this.root.innerHTML = html`
      <header id="shell-topbar" class="shell-region shell-topbar">
        <div class="brand-lockup">
          <h1 class="brand-wordmark">
            <span class="sr-only">Orbitin</span>
            <img class="brand-wordmark-visual" src="/assets/branding/orbitin-wordmark.svg" width="291" height="64" alt="" aria-hidden="true" />
          </h1>
        </div>
        <nav id="mode-selector" class="mode-selector" aria-label="${t.productMode}"></nav>
        <div id="shell-options" class="shell-options"></div>
      </header>
      <aside id="workspace-region" class="shell-region shell-workspace" aria-label="${t.workspace}">
        <header class="region-header">
          <h2 id="workspace-heading">${t.workspaceHeading.orbitLab}</h2>
          <button id="workspace-toggle" class="region-toggle" type="button" aria-controls="workspace-content" aria-expanded="false"><span aria-hidden="true">›</span><span class="sr-only">${t.expandWorkspace}</span></button>
        </header>
        <div id="workspace-content" class="region-content" hidden>
          <div id="orbit-lab-drawer" class="workspace-body"></div>
          <div id="maneuvers-drawer" class="workspace-body" hidden></div>
          <div id="route-drawer" class="workspace-body" hidden></div>
          <div id="real-objects-drawer" class="workspace-body" hidden></div>
        </div>
      </aside>
      <section id="orbit-lab-launcher" class="floating-tool orbit-lab-launcher" aria-label="${t.createOrbitRegion}"></section>
      <section id="catalogue-launcher" class="floating-tool catalogue-launcher" aria-label="${t.catalogueAccess}"></section>
      <div class="route-corner">
        <section id="route-launcher" class="floating-tool route-launcher" aria-label="${text().routePlanner.planning.open}" hidden></section>
        <div id="route-exit-slot" class="route-exit-slot" hidden></div>
        <ul class="route-legend" aria-label="${text().routePlanner.legend.label}"><li class="route-legend-interceptor">${text().routePlanner.legend.interceptor}</li><li class="route-legend-target">${text().routePlanner.legend.target}</li></ul>
      </div>
      <div id="route-planning-root"></div>
      <section id="scene-object-list" class="floating-tool scene-object-list" aria-label="${t.sceneObjectsRegion}"></section>
      <section id="maneuver-controls" class="floating-tool maneuver-controls" aria-label="${t.maneuverControls}" hidden></section>
      <section id="maneuver-view-controls" class="floating-tool maneuver-view-controls" aria-label="${t.viewControls}" hidden></section>
      <aside id="scene-inspector" class="shell-region shell-inspector" aria-label="${t.inspector}">
        <header class="region-header">
          <h2 id="inspector-heading">${t.inspector}</h2>
          <button id="inspector-toggle" class="region-toggle" type="button" aria-controls="inspector-content" aria-expanded="false"><span aria-hidden="true">‹</span><span class="sr-only">${t.expandInspector}</span></button>
        </header>
        <div id="inspector-content" class="region-content" hidden>
          <div id="inspector-body"></div>
          <div id="maneuver-info" hidden></div>
          <div id="route-results" hidden></div>
        </div>
      </aside>
      <section id="time-controls" class="shell-region shell-time" aria-label="${t.timeControls}"></section>
      <section id="route-playback" class="shell-region route-playback" aria-label="${t.routePlayback}" hidden></section>
      <section id="route-live-bar" class="shell-region route-live-bar" aria-label="${t.timeControls}" hidden></section>
      <section id="view-controls" class="shell-region shell-view" aria-label="${t.viewControls}"></section>
      <section id="catalogue-workspace" class="shell-region catalogue-workspace" hidden></section>
    `
    container.prepend(this.root)
    this.orbitLabRoot = this.root.querySelector<HTMLElement>('#orbit-lab-drawer')!
    this.realObjectsRoot = this.root.querySelector<HTMLElement>('#real-objects-drawer')!
    this.maneuversRoot = this.root.querySelector<HTMLElement>('#maneuvers-drawer')!
    this.maneuverControlsRoot = this.root.querySelector<HTMLElement>('#maneuver-controls')!
    this.maneuverViewRoot = this.root.querySelector<HTMLElement>('#maneuver-view-controls')!
    this.maneuverInfoRoot = this.root.querySelector<HTMLElement>('#maneuver-info')!
    this.routeDrawerRoot = this.root.querySelector<HTMLElement>('#route-drawer')!
    this.routeResultsRoot = this.root.querySelector<HTMLElement>('#route-results')!
    this.routePlaybackRoot = this.root.querySelector<HTMLElement>('#route-playback')!
    this.routeLiveBarRoot = this.root.querySelector<HTMLElement>('#route-live-bar')!
    this.routeLauncherRoot = this.root.querySelector<HTMLElement>('#route-launcher')!
    this.routeExitRoot = this.root.querySelector<HTMLElement>('#route-exit-slot')!
    this.routePlanningRoot = this.root.querySelector<HTMLElement>('#route-planning-root')!
    this.inspectorRoot = this.root.querySelector<HTMLElement>('#inspector-body')!
    this.timeRoot = this.root.querySelector<HTMLElement>('#time-controls')!
    this.viewRoot = this.root.querySelector<HTMLElement>('#view-controls')!
    this.sceneObjectsRoot = this.root.querySelector<HTMLElement>('#scene-object-list')!
    this.orbitLabLauncherRoot = this.root.querySelector<HTMLElement>('#orbit-lab-launcher')!
    this.catalogueLauncherRoot = this.root.querySelector<HTMLElement>('#catalogue-launcher')!
    this.catalogueRoot = this.root.querySelector<HTMLElement>('#catalogue-workspace')!
    this.optionsRoot = this.root.querySelector<HTMLElement>('#shell-options')!
    this.modeSwitcher = new ModeSwitcherView(this.root.querySelector<HTMLElement>('#mode-selector')!, (mode) => this.callbacks.onModeChange(mode))
    this.root.querySelector<HTMLButtonElement>('#workspace-toggle')!.addEventListener('click', () => this.callbacks.onToggleLeftDrawer())
    this.root.querySelector<HTMLButtonElement>('#inspector-toggle')!.addEventListener('click', () => this.callbacks.onToggleInspector())
    this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.measure())
    if (this.resizeObserver) {
      for (const element of this.root.querySelectorAll<HTMLElement>('#shell-topbar, #workspace-region, #scene-inspector, #time-controls, #view-controls, #route-playback')) this.resizeObserver.observe(element)
    }
    this.measure()
  }

  sync(model: ShellModel): void {
    this.root.dataset.mode = model.mode
    this.modeSwitcher.sync(model.mode)
    const workspace = this.root.querySelector<HTMLElement>('#workspace-region')!
    const workspaceContent = this.root.querySelector<HTMLElement>('#workspace-content')!
    const workspaceToggle = this.root.querySelector<HTMLButtonElement>('#workspace-toggle')!
    workspace.classList.toggle('is-retracted', !model.leftDrawer.open)
    workspace.dataset.state = model.leftDrawer.open ? 'expanded' : 'retracted'
    this.root.parentElement?.classList.toggle('has-retracted-workspace', !model.leftDrawer.open)
    workspaceContent.hidden = !model.leftDrawer.open
    workspaceToggle.setAttribute('aria-expanded', String(model.leftDrawer.open))
    workspaceToggle.setAttribute('aria-label', model.leftDrawer.toggleLabel)
    workspaceToggle.querySelector('.sr-only')!.textContent = model.leftDrawer.toggleLabel
    workspaceToggle.querySelector('[aria-hidden]')!.textContent = model.leftDrawer.open ? '‹' : '›'
    this.root.querySelector<HTMLElement>('#workspace-heading')!.textContent = text().shell.workspaceHeading[model.mode]
    this.orbitLabRoot.hidden = model.mode !== 'orbitLab'
    this.realObjectsRoot.hidden = model.mode !== 'realObjects'
    this.maneuversRoot.hidden = model.mode !== 'maneuvers'
    this.routeDrawerRoot.hidden = model.mode !== 'routePlanner'

    const inspector = this.root.querySelector<HTMLElement>('#scene-inspector')!
    // A mode with no scene objects to inspect uses the same drawer for its own content.
    const inGame = model.mode === 'maneuvers'
    const inRoutePlanner = model.mode === 'routePlanner'
    const inspectorName = inGame ? text().shell.info : inRoutePlanner ? text().shell.routeResults : text().shell.inspector
    inspector.setAttribute('aria-label', inspectorName)
    this.root.querySelector<HTMLElement>('#inspector-heading')!.textContent = inspectorName
    this.inspectorRoot.hidden = inGame || inRoutePlanner
    this.maneuverInfoRoot.hidden = !inGame
    this.routeResultsRoot.hidden = !inRoutePlanner
    const inspectorContent = this.root.querySelector<HTMLElement>('#inspector-content')!
    const inspectorToggle = this.root.querySelector<HTMLButtonElement>('#inspector-toggle')!
    inspector.classList.toggle('is-retracted', !model.inspector.open)
    inspector.dataset.state = model.inspector.open ? 'expanded' : 'retracted'
    this.root.parentElement?.classList.toggle('has-retracted-inspector', !model.inspector.open)
    inspectorContent.hidden = !model.inspector.open
    inspectorToggle.setAttribute('aria-expanded', String(model.inspector.open))
    inspectorToggle.setAttribute('aria-label', model.inspector.toggleLabel)
    inspectorToggle.querySelector('.sr-only')!.textContent = model.inspector.toggleLabel
    inspectorToggle.querySelector('[aria-hidden]')!.textContent = model.inspector.open ? '›' : '‹'
    this.catalogueRoot.hidden = !model.catalogueWorkspace.open
    // The Catalogue is a modal surface: background shell regions leave the
    // focus order and pointer interaction while it is open.
    for (const region of this.root.children) if (region !== this.catalogueRoot) region.toggleAttribute('inert', model.catalogueWorkspace.open)
    this.orbitLabLauncherRoot.hidden = model.mode !== 'orbitLab'
    this.catalogueLauncherRoot.hidden = model.mode !== 'realObjects'
    this.root.classList.toggle('has-open-map', model.viewDrawer.mapOpen)
    this.root.classList.toggle('has-maximized-map', model.viewDrawer.mapMaximized)
    this.root.classList.toggle('has-open-sheet', model.sheetOpen)
    this.measure()
  }

  /** While a route plays, the drawer that sets up the scene has nothing to do: it
   *  steps aside, and Exit playback takes its corner. */
  setRoutePlayback(playing: boolean): void {
    if (this.root.classList.contains('is-route-playback') === playing) return
    this.root.classList.toggle('is-route-playback', playing)
    this.measure()
  }

  setLoading(loading: boolean): void {
    for (const control of this.root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('button, input, select, textarea')) control.disabled = loading
  }

  getOccludingRects(): DOMRect[] {
    const regions = [...this.root.querySelectorAll<HTMLElement>('.shell-region')]
      .filter((element) => !element.hidden && element.offsetWidth > 0 && element.offsetHeight > 0)
      .map((element) => element.getBoundingClientRect())
    // The burn controls float above the bottom bars, so everything below
    // their top edge is covered.
    const controls = this.maneuverControlsRoot
    if (!controls.hidden && controls.offsetHeight > 0) {
      const rect = controls.getBoundingClientRect()
      regions.push(new DOMRect(rect.left, rect.top, rect.width, this.layoutRoot.getBoundingClientRect().bottom - rect.top))
    }
    return regions
  }

  focusWorkspaceToggle(): void { this.root.querySelector<HTMLButtonElement>('#workspace-toggle')?.focus() }
  focusInspectorToggle(): void { this.root.querySelector<HTMLButtonElement>('#inspector-toggle')?.focus() }

  dispose(): void {
    this.resizeObserver?.disconnect()
    this.modeSwitcher.dispose()
    this.root.remove()
  }

  private measure(): void {
    const top = this.root.querySelector<HTMLElement>('#shell-topbar')?.getBoundingClientRect().height ?? 0
    const layoutRect = this.layoutRoot.getBoundingClientRect()
    const timeRect = this.timeRoot.getBoundingClientRect()
    const viewRect = this.viewRoot.getBoundingClientRect()
    const playbackRect = this.routePlaybackRoot.getBoundingClientRect()
    const liveBarRect = this.routeLiveBarRoot.getBoundingClientRect()
    // A region hidden with display: none measures as an empty rectangle at the
    // top of the page; it occupies nothing at the bottom (the view controls
    // are hidden while the map is open).
    const occupied = (rect: DOMRect): number => rect.width > 0 && rect.height > 0 ? layoutRect.bottom - rect.top : 0
    const bottom = Math.max(0, occupied(timeRect), occupied(viewRect), occupied(playbackRect), occupied(liveBarRect))
    const workspace = this.root.querySelector<HTMLElement>('#workspace-region')
    const inspector = this.root.querySelector<HTMLElement>('#scene-inspector')
    const workspaceRect = workspace?.getBoundingClientRect()
    const inspectorRect = inspector?.getBoundingClientRect()
    const left = workspaceRect ? Math.max(0, workspaceRect.right - layoutRect.left) : 0
    const right = inspectorRect ? Math.max(0, layoutRect.right - inspectorRect.left) : 0
    const leftPanel = workspaceRect && workspace && !workspace.classList.contains('is-retracted') ? left : 0
    const rightPanel = inspectorRect && inspector && !inspector.classList.contains('is-retracted') ? right : 0
    this.layoutRoot.style.setProperty('--shell-top-height', `${top}px`)
    this.layoutRoot.style.setProperty('--shell-bottom-offset', `${bottom}px`)
    this.layoutRoot.style.setProperty('--shell-left-offset', `${left}px`)
    this.layoutRoot.style.setProperty('--shell-right-offset', `${right}px`)
    this.layoutRoot.style.setProperty('--shell-left-panel-offset', `${leftPanel}px`)
    this.layoutRoot.style.setProperty('--shell-right-panel-offset', `${rightPanel}px`)
  }
}
