import type { CatalogueManifestV1, CatalogueSnapshotParts, CatalogueRecordV1, CatalogueSearchEntryV1 } from '../data/catalogueSchema.ts'
import type { CatalogueFacetCounts, CatalogueQuery, CatalogueQueryResult } from '../data/catalogueQuery.ts'
import { catalogueProfileMode } from '../data/catalogueProfile.ts'
import { EMPTY_CATALOGUE_QUERY } from '../data/catalogueQuery.ts'
import { INITIAL_CATALOGUE_WORKSPACE, workspaceSnapshotId, type CatalogueWorkspaceState } from '../state/catalogueWorkspaceState.ts'
import type { SceneState } from '../state/AppState.ts'
import { remainingCapacity } from '../state/sceneActions.ts'
import { buildCatalogueAdditionPreview, catalogueIdOfSceneObject } from '../app/catalogueToScene.ts'
import { catalogueAttributionNotice, catalogueFreshness } from './catalogueWording.ts'
import { text } from '../i18n/index.ts'
import type { CatalogueFailure } from '../data/catalogueFailure.ts'
import { html } from './markup.ts'
import { buildCatalogueWorkingSelectionModel } from './catalogueWorkingSelection.ts'
import { buildCatalogueResultsModel } from './catalogueResultsModel.ts'
import type { CatalogueDiscoveryPresentation } from './catalogueDiscoveryModel.ts'
import { CatalogueDiscoveryView } from './CatalogueDiscoveryView.ts'
import { GroupEducationView } from './GroupEducationView.ts'
import { CatalogueResultsView } from './CatalogueResultsView.ts'
import { CatalogueReviewView } from './CatalogueReviewView.ts'
import { buildCatalogueRecordDetails } from './catalogueRecordDetails.ts'
import { MAX_COMPARED_RECORDS, type CatalogueComparisonItem } from './catalogueComparison.ts'
import type { UiCallbacks } from './uiTypes.ts'
import { formatUtcDisplay } from '../core/timeFormat.ts'

/** Workspace frame. Close is first in DOM order (shown top right) and the full
 * search is the first task control after it; discovery never precedes search
 * in keyboard order. The review column is stable beside the results at
 * desktop widths. */
export function catalogueWorkspaceMarkup(): string {
  const t = text().catalogue
  return html`
  <header class="catalogue-header">
    <button id="catalogue-workspace-close" class="action-button catalogue-close" type="button">${t.close}</button>
    <div class="catalogue-title">
      <h2 id="catalogue-workspace-heading" tabindex="-1">${t.heading}</h2>
      <p id="catalogue-scope" class="catalogue-scope"></p>
    </div>
    <div id="catalogue-find-mount" class="catalogue-find-mount"></div>
    <button id="catalogue-working-selection-button" class="action-button catalogue-working-selection-button" type="button" aria-controls="catalogue-panel-selection" hidden>${t.workingSelectionButton(0)}</button>
    <p id="catalogue-selection-count-status" class="sr-only" role="status"></p>
    <div class="catalogue-header-status">
      <p id="catalogue-status" class="time-note" role="status"></p>
      <button id="catalogue-load" class="action-button primary-action" type="button">${t.load}</button>
      <button id="catalogue-refresh" class="action-button" type="button" hidden>${t.refresh}</button>
    </div>
    <p id="catalogue-notice" class="time-note catalogue-notice" role="alert"></p>
    <p id="catalogue-errors" class="time-note" role="alert"></p>
  </header>
  <div class="catalogue-body">
    <div class="catalogue-explore-column">
      <nav id="catalogue-discovery-region" class="catalogue-discovery" aria-label="${t.explore}"></nav>
      <section id="catalogue-about" class="catalogue-about" aria-labelledby="catalogue-about-heading">
        <h3 id="catalogue-about-heading">${t.aboutHeading}</h3>
        <p id="catalogue-warning" class="teaching-note is-visible catalogue-warning" role="note">${t.educationalWarning}</p>
        <div id="catalogue-attribution" class="time-note catalogue-attribution" hidden></div>
      </section>
    </div>
    <section class="catalogue-results-column" aria-labelledby="catalogue-results-heading">
      <div id="catalogue-page-region"></div>
      <div id="catalogue-results-region"></div>
    </section>
    <section id="catalogue-review-region" class="catalogue-review-column" aria-label="${t.review}"></section>
  </div>
`
}

/** Matches the stylesheet breakpoint where the three columns stack. */
export const STACKED_WORKSPACE_QUERY = '(max-width: 1023px)'

/** Coordinates the Catalogue workspace: header, open state, modal keyboard
 * boundary and the Discovery, Results and Review children. Catalogue state
 * stays with the controller; this view keeps only transient presentation. */
export class CatalogueWorkspaceView {
  readonly root: HTMLElement
  private readonly callbacks: UiCallbacks
  private readonly discovery: CatalogueDiscoveryView
  private readonly education: GroupEducationView
  private readonly results: CatalogueResultsView
  private readonly review: CatalogueReviewView
  private workspace: CatalogueWorkspaceState = INITIAL_CATALOGUE_WORKSPACE
  private scene: SceneState = { objects: [], selection: { ids: [], primaryId: null } }
  private manifest: CatalogueManifestV1 | null = null
  private entries = new Map<string, CatalogueSearchEntryV1>()
  private returnFocus: HTMLElement | null = null
  private snapshotStatus = ''
  private errorStatus = ''
  private rowStateSignature = ''
  private selectionSignature = ''
  private readonly onOutsidePointerDown = (event: PointerEvent): void => this.closeOnOutsidePress(event)

  constructor(container: HTMLElement, callbacks: UiCallbacks) {
    this.root = container
    this.callbacks = callbacks
    this.root.dataset.region = 'catalogueWorkspace'
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-modal', 'true')
    this.root.setAttribute('aria-labelledby', 'catalogue-workspace-heading')
    this.root.innerHTML = catalogueWorkspaceMarkup()
    this.discovery = new CatalogueDiscoveryView(this.root.querySelector<HTMLElement>('#catalogue-page-region')!, this.root.querySelector<HTMLElement>('#catalogue-discovery-region')!, {
      onOpenPage: (pageId) => callbacks.onOpenCatalogueDiscoveryPage(pageId),
      onOpenLegacyGroup: (groupId) => callbacks.onCatalogueQuery({ ...EMPTY_CATALOGUE_QUERY, group: groupId }),
      onBrowseAll: () => callbacks.onBrowseAllCatalogue(),
      onAddGroup: (groupId, memberIds) => callbacks.onAddCatalogueGroupToScene(groupId, memberIds),
      previewGroupAdd: (memberIds) => buildCatalogueAdditionPreview(this.scene, memberIds),
      onOpenGroupEducation: (groupId) => this.education.open(groupId),
    })
    this.education = new GroupEducationView(this.root, {
      loadFacts: (groupId) => callbacks.onLoadGroupFacts(groupId),
      tryExample: (presetId) => callbacks.onTryOrbitLabExample(presetId),
    })
    this.results = new CatalogueResultsView(this.root.querySelector<HTMLElement>('#catalogue-find-mount')!, this.root.querySelector<HTMLElement>('#catalogue-results-region')!, {
      onQueryChange: (query) => callbacks.onCatalogueQuery(query),
      onFocusRecord: (catalogId, name) => {
        this.review.showDetailsLoading(catalogId, name)
        // Stacked layouts place Details below the result window; follow the explicit choice there.
        if (this.root.ownerDocument.defaultView?.matchMedia(STACKED_WORKSPACE_QUERY).matches) this.review.focusDetails()
        callbacks.onCatalogueDetailsChange(catalogId)
      },
      onToggleCompare: (catalogId) => this.toggleComparison(catalogId),
      onToggleWorkingSelection: (catalogId) => callbacks.onCatalogueWorkingSelectionToggle(catalogId),
    })
    this.review = new CatalogueReviewView(this.root.querySelector<HTMLElement>('#catalogue-review-region')!, {
      onAddToScene: (ids, jumpToEpoch) => callbacks.onAddToScene(ids, jumpToEpoch),
      onDetailsChange: (catalogId) => {
        const closing = this.workspace.focusedCatalogId
        callbacks.onCatalogueDetailsChange(catalogId)
        if (catalogId === null && !(closing !== null && this.results.focusRow(closing))) this.results.focusSearch()
      },
      onDetailsRetry: (catalogId) => callbacks.onCatalogueDetailsRetry(catalogId),
      onToggleCompare: (catalogId) => this.toggleComparison(catalogId),
      onCompareChange: (ids) => callbacks.onCatalogueCompareChange(ids),
      onCompareRetry: (catalogId) => callbacks.onCatalogueCompareRetry(catalogId),
      workingSelection: {
        onRemove: (catalogId) => callbacks.onCatalogueWorkingSelectionToggle(catalogId),
        onClear: () => callbacks.onCatalogueWorkingSelectionClear(),
        onAddSelected: (catalogIds) => callbacks.onAddCatalogueSelectionToScene(catalogIds),
        onViewScene: () => callbacks.onViewCatalogueScene(),
      },
    })
    this.root.querySelector('#catalogue-working-selection-button')!.addEventListener('click', () => this.review.showWorkingSelection())
    this.root.querySelector('#catalogue-workspace-close')!.addEventListener('click', () => callbacks.onCloseCatalogueWorkspace())
    this.root.addEventListener('keydown', (event) => this.onKeyDown(event))
    this.root.querySelector('#catalogue-load')!.addEventListener('click', () => callbacks.onCatalogueLoad())
    this.root.querySelector('#catalogue-refresh')!.addEventListener('click', () => callbacks.onCatalogueRefresh())
    this.root.ownerDocument.addEventListener('pointerdown', this.onOutsidePointerDown, true)
  }

  sync(workspace: CatalogueWorkspaceState, open: boolean, loading: boolean, scene: SceneState): void {
    const previous = this.workspace
    const previousScene = this.scene
    this.workspace = workspace; this.scene = scene
    if (scene !== previousScene) this.discovery.refreshGroupAdd()
    this.root.hidden = !open
    this.root.toggleAttribute('aria-busy', loading)
    const catalogueLoading = workspace.availability.kind === 'loading'
    this.root.querySelector<HTMLButtonElement>('#catalogue-load')!.disabled = loading || catalogueLoading
    this.root.querySelector<HTMLButtonElement>('#catalogue-refresh')!.disabled = loading || catalogueLoading
    // Keep snapshot freshness or refresh-failure text across ordinary shell syncs.
    const status = catalogueLoading ? text().catalogue.loading : workspace.availability.kind === 'error' ? this.errorStatus : this.snapshotStatus
    const statusElement = this.root.querySelector('#catalogue-status')!
    if (statusElement.textContent !== status) statusElement.textContent = status
    if (workspace.availability.kind === 'ready') this.root.querySelector('#catalogue-errors')!.textContent = ''
    this.syncRowState()
    this.syncWorkingSelection(previous)
  }

  setSnapshot(snapshot: CatalogueSnapshotParts, updated = false): void {
    this.manifest = snapshot.manifest
    this.entries = new Map(snapshot.index.entries.map((entry) => [entry.catalogId, entry]))
    const freshness = catalogueFreshness(snapshot.pointer.providerRetrievedAtUtc, Date.now())
    // The publication time never breaks across lines (non-breaking spaces).
    this.snapshotStatus = text().catalogue.snapshotStatus(text().catalogue.freshness[freshness], snapshot.index.entries.length, formatUtcDisplay({ unixSeconds: Date.parse(snapshot.pointer.publishedAtUtc) / 1000 }).replaceAll(' ', '\u00a0'), updated)
    this.root.querySelector('#catalogue-status')!.textContent = this.snapshotStatus
    this.renderAttribution(snapshot.manifest)
    this.root.querySelector<HTMLButtonElement>('#catalogue-load')!.hidden = true
    this.root.querySelector<HTMLButtonElement>('#catalogue-refresh')!.hidden = false
    this.root.querySelector('#catalogue-errors')!.textContent = ''
    this.rowStateSignature = ''; this.selectionSignature = ''
    this.syncRowState()
    this.syncWorkingSelection(this.workspace)
  }

  renderQuery(manifest: CatalogueManifestV1, query: CatalogueQuery, result: CatalogueQueryResult, overviewFacets: CatalogueFacetCounts | null): void {
    this.results.render(buildCatalogueResultsModel({ manifest, query, result, overviewFacets }), query)
  }

  renderDiscovery(presentation: CatalogueDiscoveryPresentation): void {
    this.discovery.render(presentation)
    const scope = this.root.querySelector('#catalogue-scope')!
    if (scope.textContent !== presentation.scopeSummary) scope.textContent = presentation.scopeSummary
  }

  showDetails(record: CatalogueRecordV1, referenceUnixMs: number): void {
    if (!this.manifest) return
    this.review.showDetails(record.NORAD_CAT_ID, record.OBJECT_NAME, buildCatalogueRecordDetails(record, this.manifest, referenceUnixMs))
  }
  showDetailsLoading(catalogId: string): void { this.review.showDetailsLoading(catalogId, this.entries.get(catalogId)?.name ?? catalogId) }
  showDetailsError(catalogId: string, failure: CatalogueFailure): void { this.review.showDetailsError(catalogId, this.entries.get(catalogId)?.name ?? catalogId, failure) }
  clearDetails(): void { this.review.clearDetails() }
  setComparison(items: readonly CatalogueComparisonItem[]): void { this.review.setComparison(items) }
  clearComparison(): void { this.review.setComparison([]) }
  setNotice(message: string): void { this.root.querySelector('#catalogue-notice')!.textContent = message }

  setError(failure: CatalogueFailure): void {
    const hasSnapshot = workspaceSnapshotId(this.workspace) !== null
    this.root.querySelector('#catalogue-errors')!.textContent = text().errors.catalogue(failure)
    this.errorStatus = hasSnapshot ? text().catalogue.refreshFailed : text().catalogue.unavailable
    this.root.querySelector('#catalogue-status')!.textContent = this.errorStatus
    this.root.querySelector<HTMLButtonElement>('#catalogue-load')!.hidden = hasSnapshot
    this.root.querySelector<HTMLButtonElement>('#catalogue-refresh')!.hidden = !hasSnapshot
  }

  focusSearch(): void { this.results.focusSearch() }
  focusDetails(): void { this.review.focusDetails() }
  focusResultsSummary(): void { this.results.focusSummary() }
  captureReturnFocus(): void {
    const active = this.root.ownerDocument.activeElement
    this.returnFocus = active instanceof HTMLElement && active !== this.root.ownerDocument.body ? active : null
  }
  focusReturnFocus(): boolean {
    const target = this.returnFocus
    this.returnFocus = null
    if (!target || !target.isConnected) return false
    for (let element: HTMLElement | null = target; element; element = element.parentElement) if (element.hidden) return false
    target.focus(); return true
  }
  dispose(): void { this.root.ownerDocument.removeEventListener('pointerdown', this.onOutsidePointerDown, true); this.discovery.dispose(); this.education.dispose(); this.results.dispose(); this.review.dispose(); this.root.remove() }

  /** A press outside the open workspace - the top bar's logo, mode, Share or
   *  Options, or the scene around it - closes it, and the press still does its
   *  own job. Modal dialogs and the shared-scene status sit above everything
   *  and do not count as outside. */
  private closeOnOutsidePress(event: PointerEvent): void {
    const target = event.target
    if (this.root.hidden || !(target instanceof Node) || this.root.contains(target)) return
    if (target instanceof Element && target.closest('dialog[open], .scene-open-status')) return
    this.callbacks.onCloseCatalogueWorkspace()
  }

  /** Escape closes; Tab and Shift+Tab wrap inside the open modal workspace. */
  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); this.callbacks.onCloseCatalogueWorkspace(); return }
    if (event.key !== 'Tab') return
    const focusable = this.focusableElements()
    if (focusable.length === 0) return
    const first = focusable[0]; const last = focusable[focusable.length - 1]
    const active = this.root.ownerDocument.activeElement
    if (event.shiftKey && (active === first || !this.root.contains(active))) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && (active === last || !this.root.contains(active))) { event.preventDefault(); first.focus() }
  }

  private focusableElements(): HTMLElement[] {
    const candidates = this.root.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')
    return [...candidates].filter((element) => {
      if ((element as HTMLButtonElement).disabled || element.tabIndex < 0) return false
      for (let node: HTMLElement | null = element; node && node !== this.root; node = node.parentElement) if (node.hidden) return false
      return element.getClientRects().length > 0
    })
  }

  private toggleComparison(catalogId: string): void {
    const ids = this.workspace.comparedCatalogIds
    if (ids.includes(catalogId)) { this.callbacks.onCatalogueCompareChange(ids.filter((id) => id !== catalogId)); return }
    if (ids.length >= MAX_COMPARED_RECORDS) return
    // Only an explicit add-to-comparison activates the Compare panel.
    this.review.showComparison()
    this.callbacks.onCatalogueCompareChange([...ids, catalogId])
  }

  private syncRowState(): void {
    const sceneCatalogIds = new Set<string>()
    for (const object of this.scene.objects) { const catalogId = catalogueIdOfSceneObject(object); if (catalogId !== null) sceneCatalogIds.add(catalogId) }
    const compareAvailable = this.manifest !== null && catalogueProfileMode(this.manifest) === 'automatic'
    const sceneFull = remainingCapacity(this.scene) === 0
    const signature = JSON.stringify([[...sceneCatalogIds], this.workspace.workingSelectionIds, this.workspace.comparedCatalogIds, this.workspace.focusedCatalogId, compareAvailable, sceneFull])
    if (signature === this.rowStateSignature) return
    this.rowStateSignature = signature
    this.results.syncRowState({ sceneCatalogIds, workingSelectionIds: new Set(this.workspace.workingSelectionIds), comparedIds: this.workspace.comparedCatalogIds, focusedId: this.workspace.focusedCatalogId, compareAvailable })
    this.review.syncScene({ sceneFull, sceneCatalogIds, comparedIds: this.workspace.comparedCatalogIds, compareAvailable })
  }

  /** Tray, preview and header count from index identity and the Real Objects
   *  scene. Count changes are announced politely without moving focus; a
   *  snapshot replacement is explained by the catalogue notice instead. */
  private syncWorkingSelection(previous: CatalogueWorkspaceState): void {
    const ids = this.workspace.workingSelectionIds
    const sceneIds = this.scene.objects.map((object) => catalogueIdOfSceneObject(object) ?? '')
    const signature = JSON.stringify([ids, sceneIds, remainingCapacity(this.scene), this.entries.size])
    if (signature === this.selectionSignature) return
    this.selectionSignature = signature
    const button = this.root.querySelector<HTMLButtonElement>('#catalogue-working-selection-button')!
    button.hidden = this.entries.size === 0
    const label = text().catalogue.workingSelectionButton(ids.length)
    if (button.textContent !== label) button.textContent = label
    const snapshotChanged = workspaceSnapshotId(previous) !== null && workspaceSnapshotId(previous) !== workspaceSnapshotId(this.workspace)
    if (previous.workingSelectionIds.length !== ids.length && !snapshotChanged) this.root.querySelector('#catalogue-selection-count-status')!.textContent = text().catalogue.workingSelectionStatus(ids.length)
    this.review.setWorkingSelection(buildCatalogueWorkingSelectionModel(ids, (catalogId) => this.entries.get(catalogId), this.scene))
  }

  private renderAttribution(manifest: CatalogueManifestV1): void {
    const notice = catalogueAttributionNotice(manifest, (isoUtc) => formatUtcDisplay({ unixSeconds: Date.parse(isoUtc) / 1000 }))
    const element = this.root.querySelector<HTMLElement>('#catalogue-attribution')!; element.textContent = ''
    const citation = this.root.ownerDocument.createElement('a'); citation.href = notice.sourceLink; citation.target = '_blank'; citation.rel = 'noopener noreferrer'; citation.textContent = notice.citation
    const lines: (HTMLElement | string)[] = [citation, notice.retrieval, notice.educationalUse]; if (notice.derivedData) lines.push(notice.derivedData)
    for (const line of lines) { const span = this.root.ownerDocument.createElement('span'); span.append(line); element.append(span) }
    element.hidden = false
  }
}
