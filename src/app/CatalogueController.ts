import { CatalogueClient, CatalogueClientError, catalogueFailureOf, type CatalogueFailure } from '../data/CatalogueClient.ts'
import type { CatalogueManifestV1, CatalogueRecordV1, CatalogueSnapshotParts } from '../data/catalogueSchema.ts'
import { EMPTY_CATALOGUE_QUERY, type CatalogueFacetCounts, type CatalogueQuery, type CatalogueQueryResult } from '../data/catalogueQuery.ts'
import { MAX_CATALOGUE_RESULTS, QUICK_SEARCH_RESULT_LIMIT, type CatalogueSearchResult } from '../data/catalogueSearch.ts'
import { EMPTY_CATALOGUE_GROUP_DEFINITIONS, normalizeCatalogueGroupDefinitionSet, validateCatalogueGroupDefinitionSet, type CatalogueGroupDefinitionSet } from '../data/catalogueGroups.ts'
import { CATALOGUE_DISCOVERY_PAGES, catalogueDiscoveryPage, validateCatalogueDiscoveryPages, type CatalogueDiscoveryPage } from '../data/catalogueDiscoveryPages.ts'
import { catalogueProfileMode } from '../data/catalogueProfile.ts'
import { buildCatalogueDiscoveryPresentation, resolveDiscoveryMembership as resolvePageMembership, type CatalogueDiscoveryMembershipModel, type CatalogueDiscoveryNavigationItem, type CatalogueDiscoveryPresentation } from '../ui/catalogueDiscoveryModel.ts'
import { reconcileQueryWithSnapshot } from '../ui/catalogueResultsModel.ts'
import { text } from '../i18n/index.ts'
import { httpStatusClass, loadTimeBucket, recordUsage } from './usageEvents.ts'
import type { CatalogueComparisonItem } from '../ui/catalogueComparison.ts'
import { catalogueLoadFailed, catalogueLoadStarted, catalogueLoadSucceeded, clearWorkingSelection, INITIAL_CATALOGUE_WORKSPACE, openCatalogueDetails, setActiveDiscoveryPageId, setCatalogueQuery, setComparedCatalogIds, setQuickSearchText, toggleWorkingSelection, type CatalogueWorkspaceState } from '../state/catalogueWorkspaceState.ts'

export interface CataloguePresenter {
  syncWorkspace(workspace: CatalogueWorkspaceState): void
  setSnapshot(snapshot: CatalogueSnapshotParts, updated: boolean): void
  setError(failure: CatalogueFailure): void
  /** A transient notice, worded when it happens; a language change clears it. */
  setCatalogueNotice?(message: string): void
  renderQuickSearch?(result: CatalogueSearchResult, reason: 'input' | 'snapshot'): void
  renderQuery(manifest: CatalogueManifestV1, query: CatalogueQuery, result: CatalogueQueryResult, overviewFacets: CatalogueFacetCounts | null): void
  /** Explore cards, active page copy/facts and scope; index-derived only. */
  renderDiscovery?(presentation: CatalogueDiscoveryPresentation): void
  showDetailsLoading?(catalogId: string): void
  showDetails(record: CatalogueRecordV1, referenceUnixMs: number): void
  showDetailsError(catalogId: string, failure: CatalogueFailure): void
  clearDetails(): void
  setComparison(items: readonly CatalogueComparisonItem[]): void
  clearComparison(): void
}
/** The published snapshot changed while `resolveRecords` was loading; a scene open says so. */
export class CatalogueSnapshotChangedError extends CatalogueClientError {
  constructor(message: string) { super(message, { kind: 'snapshot-changed' }) }
}
export interface ResolvedCatalogueRecords { readonly snapshotId: string; readonly manifest: CatalogueManifestV1; readonly records: readonly CatalogueRecordV1[]; readonly missingIds: readonly string[] }
export interface ResolveRecordsOptions { readonly requireAll?: boolean }
export interface CatalogueControllerOptions {
  readonly presenter: CataloguePresenter
  readonly client?: CatalogueClient
  readonly now?: () => number
  readonly groupDefinitions?: CatalogueGroupDefinitionSet
  readonly discoveryPages?: readonly CatalogueDiscoveryPage[]
}

export class CatalogueController {
  private readonly presenter: CataloguePresenter
  private readonly client: CatalogueClient
  private readonly now: () => number
  private readonly groupDefinitions: CatalogueGroupDefinitionSet
  private readonly discoveryPages: readonly CatalogueDiscoveryPage[]
  private workspaceState: CatalogueWorkspaceState = INITIAL_CATALOGUE_WORKSPACE
  private overviewFacets: CatalogueFacetCounts | null = null
  private readonly loadedRecords = new Map<string, CatalogueRecordV1>()
  private readonly comparisonErrors = new Map<string, CatalogueFailure>()
  private detailsFailure: { readonly catalogId: string; readonly failure: CatalogueFailure } | null = null
  private detailsRequestToken = 0
  private activeDetailsId: string | null = null
  private comparisonRequestGeneration = 0
  private loadGeneration = 0
  private readonly discoveryMemberships = new Map<string, CatalogueDiscoveryMembershipModel>()
  private disposed = false

  constructor(options: CatalogueControllerOptions) {
    this.presenter = options.presenter; this.client = options.client ?? new CatalogueClient(); this.now = options.now ?? (() => Date.now())
    this.discoveryPages = options.discoveryPages ?? CATALOGUE_DISCOVERY_PAGES
    validateCatalogueDiscoveryPages(this.discoveryPages)
    validateCatalogueGroupDefinitionSet(options.groupDefinitions ?? EMPTY_CATALOGUE_GROUP_DEFINITIONS, this.discoveryPages)
    this.groupDefinitions = normalizeCatalogueGroupDefinitionSet(options.groupDefinitions ?? EMPTY_CATALOGUE_GROUP_DEFINITIONS)
  }
  get workspace(): CatalogueWorkspaceState { return this.workspaceState }
  get snapshot(): CatalogueSnapshotParts | null { return this.client.current }
  private sync(next: CatalogueWorkspaceState): void { this.workspaceState = next; this.presenter.syncWorkspace(next) }

  async load(): Promise<void> { return this.loadInternal(false) }
  async refresh(): Promise<void> { return this.loadInternal(true) }
  private async loadInternal(force: boolean): Promise<void> {
    if (this.disposed) return
    const generation = ++this.loadGeneration; this.sync(catalogueLoadStarted(this.workspaceState))
    const previous = this.client.current?.manifest.snapshotId ?? null
    const startedMs = this.now()
    try {
      const snapshot = await (force ? this.client.refresh() : this.client.load())
      if (this.disposed || generation !== this.loadGeneration) return
      if (previous === null) recordUsage({ type: 'catalogue_loaded', time: loadTimeBucket(this.now() - startedMs) })
      const hadWorkingSelection = this.workspaceState.workingSelectionIds.length > 0
      const changed = previous !== null && previous !== snapshot.manifest.snapshotId
      this.sync(catalogueLoadSucceeded(this.workspaceState, snapshot.manifest.snapshotId, snapshot.index.entries.length))
      if (changed || previous === null) this.discoveryMemberships.clear()
      if (changed) { this.detailsRequestToken++; this.activeDetailsId = null; this.comparisonRequestGeneration++; this.comparisonErrors.clear(); this.loadedRecords.clear(); this.presenter.clearDetails(); this.presenter.clearComparison(); if (hadWorkingSelection) this.presenter.setCatalogueNotice?.(text().catalogue.workingSelectionCleared) }
      if (previous === null || changed) this.presenter.setSnapshot(snapshot, changed)
      this.overviewFacets = this.client.query(this.workspaceState.query, this.now(), 1).facets
      const query = reconcileQueryWithSnapshot(this.workspaceState.query, snapshot.manifest, this.overviewFacets)
      if (query !== this.workspaceState.query) this.sync(setCatalogueQuery(this.workspaceState, query))
      this.reconcileActiveDiscoveryPage()
      this.renderQuery()
      if (previous === null || changed) this.presenter.renderQuickSearch?.(this.client.quickSearch(this.workspaceState.quickSearchText, QUICK_SEARCH_RESULT_LIMIT), 'snapshot')
    } catch (error) {
      if (this.disposed || generation !== this.loadGeneration) return
      const failure = catalogueFailureOf(error, 'The published catalogue could not be loaded.')
      // People see a friendly sentence; the technical
      // detail goes to the console and one coarse event.
      console.warn(`Catalogue load failed: ${failure.message}`)
      recordUsage({ type: 'catalogue_failed', status: failure.kind === 'http' ? httpStatusClass(failure.status) : failure.kind === 'invalid' ? 'invalid' : failure.kind === 'unknown' ? 'network' : 'other' })
      this.sync(catalogueLoadFailed(this.workspaceState, failure))
      this.presenter.setError(failure)
    }
  }

  query(query: CatalogueQuery, options: { readonly clearDiscoveryPage?: boolean } = {}): void {
    if (this.disposed) return
    let next = setCatalogueQuery(this.workspaceState, query)
    if (options.clearDiscoveryPage ?? query.text !== this.workspaceState.query.text) next = setActiveDiscoveryPageId(next, null)
    this.sync(next); this.renderQuery()
  }
  setFullQuery(query: CatalogueQuery): void { this.query(query, { clearDiscoveryPage: true }) }
  quickSearch(text: string, limit = QUICK_SEARCH_RESULT_LIMIT): CatalogueSearchResult {
    if (this.disposed) return { entries: [], totalMatches: 0, hasMore: false }
    this.sync(setQuickSearchText(this.workspaceState, text))
    const result = this.client.quickSearch(text, limit)
    this.presenter.renderQuickSearch?.(result, 'input')
    return result
  }
  changeWorkingSelection(catalogId: string): void {
    if (this.disposed) return
    this.sync(toggleWorkingSelection(this.workspaceState, catalogId))
  }
  clearWorkingSelection(): void {
    if (this.disposed) return
    this.sync(clearWorkingSelection(this.workspaceState))
  }
  openDiscoveryPage(pageId: string): CatalogueDiscoveryMembershipModel | null {
    if (this.disposed || !this.client.current) return null
    const page = catalogueDiscoveryPage(pageId, this.discoveryPages)
    if (!page) return null
    const membership = this.membershipFor(page)
    if (!membership.supported) return null
    let next = setActiveDiscoveryPageId(this.workspaceState, page.id)
    next = setCatalogueQuery(next, EMPTY_CATALOGUE_QUERY)
    this.sync(next); this.renderQuery()
    return membership
  }
  browseAll(): void {
    if (this.disposed) return
    let next = setActiveDiscoveryPageId(this.workspaceState, null)
    next = setCatalogueQuery(next, EMPTY_CATALOGUE_QUERY)
    this.sync(next); this.renderQuery()
  }
  discoveryPage(pageId: string): CatalogueDiscoveryMembershipModel | null {
    if (this.disposed || !this.client.current) return null
    const page = catalogueDiscoveryPage(pageId, this.discoveryPages)
    return page ? this.membershipFor(page) : null
  }
  discoveryNavigation(): readonly CatalogueDiscoveryNavigationItem[] {
    if (this.disposed || !this.client.current) return []
    return this.discoveryPages.map((page) => this.membershipFor(page)).filter((membership) => membership.supported).map((membership) => ({ page: membership.page, supported: true, memberCount: membership.memberCount }))
  }
  private renderQuery(): void {
    const snapshot = this.client.current; if (!snapshot || this.disposed) return
    const membership = this.workspaceState.activeDiscoveryPageId === null ? null : this.discoveryMemberships.get(this.discoveryCacheKey(snapshot.manifest.snapshotId, this.workspaceState.activeDiscoveryPageId)) ?? null
    this.presenter.renderDiscovery?.(buildCatalogueDiscoveryPresentation({
      mode: catalogueProfileMode(snapshot.manifest), navigation: this.discoveryNavigation(), active: membership,
      legacyGroups: snapshot.manifest.groups, activeLegacyGroup: this.workspaceState.query.group,
    }))
    this.presenter.renderQuery(snapshot.manifest, this.workspaceState.query, this.client.query(this.workspaceState.query, this.now(), MAX_CATALOGUE_RESULTS, membership?.catalogIds), this.overviewFacets)
  }
  async changeDetails(catalogId: string | null): Promise<void> {
    if (this.disposed) return
    this.activeDetailsId = catalogId; this.detailsFailure = null; const token = ++this.detailsRequestToken; this.sync(openCatalogueDetails(this.workspaceState, catalogId))
    if (catalogId === null) { this.presenter.clearDetails(); return }
    await this.publishDetails(catalogId, token)
  }
  async retryDetails(catalogId: string): Promise<void> { return this.changeDetails(catalogId) }
  private async publishDetails(catalogId: string, token: number): Promise<void> {
    const snapshot = this.client.current; if (!snapshot) return
    const snapshotId = snapshot.manifest.snapshotId
    try {
      const record = await this.record(catalogId, snapshotId)
      if (this.disposed || token !== this.detailsRequestToken || this.activeDetailsId !== catalogId || this.client.current?.manifest.snapshotId !== snapshotId) return
      this.presenter.showDetails(record, this.now())
    } catch (error) {
      if (!this.disposed && token === this.detailsRequestToken && this.activeDetailsId === catalogId && this.client.current?.manifest.snapshotId === snapshotId) {
        this.detailsFailure = { catalogId, failure: catalogueFailureOf(error, 'Could not load record.') }
        this.presenter.showDetailsError(catalogId, this.detailsFailure.failure)
      }
    }
  }
  async changeComparison(ids: readonly string[]): Promise<void> {
    if (this.disposed) return
    this.sync(setComparedCatalogIds(this.workspaceState, ids)); const generation = ++this.comparisonRequestGeneration; const snapshot = this.client.current
    for (const id of [...this.comparisonErrors.keys()]) if (!this.workspaceState.comparedCatalogIds.includes(id)) this.comparisonErrors.delete(id)
    if (!snapshot || this.workspaceState.comparedCatalogIds.length === 0) { this.presenter.clearComparison(); return }
    const snapshotId = snapshot.manifest.snapshotId; this.publishComparison(snapshotId)
    await Promise.all(this.workspaceState.comparedCatalogIds.map(async (catalogId) => {
      if (this.loadedRecords.has(this.cacheKey(snapshotId, catalogId))) return
      try { const record = await this.record(catalogId, snapshotId); if (this.client.current?.manifest.snapshotId === snapshotId) this.loadedRecords.set(this.cacheKey(snapshotId, catalogId), record); if (generation === this.comparisonRequestGeneration) this.comparisonErrors.delete(catalogId) }
      catch (error) { if (generation === this.comparisonRequestGeneration && this.workspaceState.comparedCatalogIds.includes(catalogId)) this.comparisonErrors.set(catalogId, catalogueFailureOf(error, 'Could not load record.')) }
      if (!this.disposed && generation === this.comparisonRequestGeneration && this.client.current?.manifest.snapshotId === snapshotId) this.publishComparison(snapshotId)
    }))
  }
  async retryComparison(catalogId: string): Promise<void> { if (this.workspaceState.comparedCatalogIds.includes(catalogId)) { this.comparisonErrors.delete(catalogId); return this.changeComparison(this.workspaceState.comparedCatalogIds) } }
  private publishComparison(snapshotId: string): void {
    const items = this.workspaceState.comparedCatalogIds.map((catalogId) => { const record = this.loadedRecords.get(this.cacheKey(snapshotId, catalogId)); const error = this.comparisonErrors.get(catalogId); return record ? { catalogId, name: record.OBJECT_NAME, state: 'loaded' as const, record } : error ? { catalogId, name: this.catalogueName(catalogId), state: 'error' as const, failure: error } : { catalogId, name: this.catalogueName(catalogId), state: 'loading' as const } })
    this.presenter.setComparison(items)
  }
  private async record(catalogId: string, snapshotId: string): Promise<CatalogueRecordV1> { const cached = this.loadedRecords.get(this.cacheKey(snapshotId, catalogId)); if (cached) return cached; const record = await this.client.loadRecord(catalogId); if (this.client.current?.manifest.snapshotId === snapshotId) this.loadedRecords.set(this.cacheKey(snapshotId, catalogId), record); return record }
  private cacheKey(snapshotId: string, catalogId: string): string { return `${snapshotId}/${catalogId}` }
  private catalogueName(catalogId: string): string { return this.client.indexEntry(catalogId)?.name ?? catalogId }
  async resolveRecords(catalogIds: readonly string[], options: ResolveRecordsOptions = {}): Promise<ResolvedCatalogueRecords> {
    if (this.disposed) throw new CatalogueClientError('The catalogue was closed.', { kind: 'closed' })
    const snapshot = this.client.current; if (!snapshot) throw new CatalogueClientError('Load the catalogue before requesting catalogue records.', { kind: 'not-loaded' })
    const ids = [...new Set(catalogIds)]; const present = ids.filter((id) => this.client.indexEntry(id)); const missingIds = ids.filter((id) => !this.client.indexEntry(id))
    if (options.requireAll && missingIds.length > 0) return { snapshotId: snapshot.manifest.snapshotId, manifest: snapshot.manifest, records: [], missingIds }
    const records = await Promise.all(present.map((id) => this.client.loadRecord(id)))
    if (this.disposed) throw new CatalogueClientError('The catalogue was closed.', { kind: 'closed' })
    if (this.client.current?.manifest.snapshotId !== snapshot.manifest.snapshotId) throw new CatalogueSnapshotChangedError('The catalogue changed while records were loading. Try again.')
    return { snapshotId: snapshot.manifest.snapshotId, manifest: snapshot.manifest, records, missingIds }
  }
  private membershipFor(page: CatalogueDiscoveryPage): CatalogueDiscoveryMembershipModel {
    const snapshot = this.client.current
    if (!snapshot) return resolvePageMembership(page, [], this.groupDefinitions)
    const key = this.discoveryCacheKey(snapshot.manifest.snapshotId, page.id)
    const cached = this.discoveryMemberships.get(key)
    if (cached) return cached
    const resolved = resolvePageMembership(page, snapshot.index.entries, this.groupDefinitions, catalogueProfileMode(snapshot.manifest))
    this.discoveryMemberships.set(key, resolved)
    return resolved
  }
  private reconcileActiveDiscoveryPage(): void {
    const pageId = this.workspaceState.activeDiscoveryPageId
    if (pageId === null || !this.client.current) return
    const page = catalogueDiscoveryPage(pageId, this.discoveryPages)
    const membership = page ? this.membershipFor(page) : null
    if (!membership?.supported) { this.sync(setActiveDiscoveryPageId(this.workspaceState, null)); this.presenter.setCatalogueNotice?.(text().catalogue.discoveryUnavailable) }
  }
  private discoveryCacheKey(snapshotId: string, pageId: string): string { return `${snapshotId}/${pageId}` }
  /** Present the whole catalogue state again after the
   *  interface is rebuilt in another language. Nothing is fetched: details
   *  and comparison come from loaded records, and a load still in flight
   *  publishes into the new views when it settles. */
  republish(): void {
    if (this.disposed) return
    this.presenter.syncWorkspace(this.workspaceState)
    const snapshot = this.client.current
    const availability = this.workspaceState.availability
    if (snapshot) this.presenter.setSnapshot(snapshot, false)
    if (availability.kind === 'error') this.presenter.setError(availability.failure)
    if (!snapshot) return
    this.renderQuery()
    this.presenter.renderQuickSearch?.(this.client.quickSearch(this.workspaceState.quickSearchText, QUICK_SEARCH_RESULT_LIMIT), 'snapshot')
    const detailsId = this.activeDetailsId
    if (detailsId !== null) {
      this.presenter.showDetailsLoading?.(detailsId)
      const record = this.loadedRecords.get(this.cacheKey(snapshot.manifest.snapshotId, detailsId))
      if (record) this.presenter.showDetails(record, this.now())
      else if (this.detailsFailure?.catalogId === detailsId) this.presenter.showDetailsError(detailsId, this.detailsFailure.failure)
    }
    if (this.workspaceState.comparedCatalogIds.length > 0) this.publishComparison(snapshot.manifest.snapshotId)
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.detailsRequestToken++; this.comparisonRequestGeneration++; this.loadGeneration++; this.discoveryMemberships.clear(); this.client.dispose() }
}
