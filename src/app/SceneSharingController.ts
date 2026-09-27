import { decodeSceneFileText, MAX_SCENE_FILE_BYTES, sceneFileName, sceneFileText } from '../data/sceneFile.ts'
import { createSceneLink, decodeSceneLinkPayload, sceneLinkAvailability, sceneLinkPayload, type SceneTextFailure } from '../data/sceneLink.ts'
import type { SceneDocumentError, SceneDocumentV1 } from '../data/sceneDocument.ts'
import { sharedSceneDocument, sharedSceneSummary, type SharedSceneSummary } from '../data/sharedScene.ts'
import { sceneFor, type AppState, type ProductMode } from '../state/AppState.ts'
import { text } from '../i18n/index.ts'
import { openConfirmationMessage, openIncomingLine, openProgressMessage, openResultLines, sceneOpenFailureMessage } from '../ui/sceneSharingWording.ts'
import { CatalogueSnapshotChangedError, type ResolvedCatalogueRecords } from './CatalogueController.ts'
import { resolveSceneDocument, type ResolvedSceneDocument } from './resolveSceneDocument.ts'
import type { SceneLinkLocation } from './sceneLinkLocation.ts'
import { recordUsage } from './usageEvents.ts'

/** The UI side of opening: one confirmation dialog and one status panel. */
export interface SceneSharingPresenter {
  showConfirmation(confirmation: { readonly message: string; readonly incoming: string }): void
  showProgress(message: string): void
  showNotice(lines: readonly string[]): void
  showError(message: string, retryable: boolean): void
  hideOpenStatus(): void
  /** True while an open blocks Share, Open scene file and catalogue adds. */
  setOpening(opening: boolean): void
}
export interface SceneSharingDependencies {
  getState(): AppState
  catalogueAddPending(): boolean
  loadCatalogue(): Promise<void>
  resolveRecords(ids: readonly string[]): Promise<ResolvedCatalogueRecords>
  applySharedScene(mode: ProductMode, resolved: ResolvedSceneDocument): void
  presenter: SceneSharingPresenter
  location: SceneLinkLocation
  /** Development builds log the first validation paths; learners never see them. */
  reportInvalidDocument?(errors: readonly SceneDocumentError[]): void
}
export type SceneOpenSource = 'initial-link' | 'link' | 'file' | 'example'
export interface SceneFileReadable { readonly size: number; text(): Promise<string> }
type Phase = 'decoding' | 'confirming' | 'resolving' | 'failed-retryable'
interface PendingOpen { readonly source: SceneOpenSource; phase: Phase; document: SceneDocumentV1 | null }

/** The only production caller of `resolveSceneDocument`;
 *  it encodes scenes only through `sharedSceneDocument`.
 *
 *  One pending open at a time. A newer open, cancel or dispose replaces the
 *  pending object, and every await checks it is still current, so a
 *  superseded open never applies. */
export class SceneSharingController {
  private readonly deps: SceneSharingDependencies
  private pending: PendingOpen | null = null
  /** What the open status shows while it matters to a pending open, so a
   *  language change can show it again in the new words. */
  private shown: (() => void) | null = null
  private unsubscribe: (() => void) | null = null
  private disposed = false

  constructor(deps: SceneSharingDependencies) { this.deps = deps }

  /** Called once the application is ready: listens for pasted links and opens the link the page was loaded with. */
  start(): void {
    if (this.disposed || this.unsubscribe) return
    this.unsubscribe = this.deps.location.onSceneHashChange(() => { void this.openFromLocation('link') })
    void this.openFromLocation('initial-link')
  }

  /** True while an open is decoding, confirming or resolving. */
  get opening(): boolean { return this.pending !== null && this.pending.phase !== 'failed-retryable' }

  shareSummary(): SharedSceneSummary & { readonly link: ReturnType<typeof sceneLinkAvailability> } {
    const document = sharedSceneDocument(this.deps.getState())
    return { ...sharedSceneSummary(document), link: sceneLinkAvailability(document) }
  }
  createLink(): ReturnType<typeof createSceneLink> { return createSceneLink(sharedSceneDocument(this.deps.getState()), this.deps.location) }
  file(now: Date): { readonly name: string; readonly text: string } {
    const document = sharedSceneDocument(this.deps.getState())
    return { name: sceneFileName(document.activeMode, now), text: sceneFileText(document) }
  }

  /** The result notice stays until the next open, share or catalogue add. */
  dismissNotice(): void { if (!this.pending) this.hide() }

  /** After a language change: the pending open's confirmation, progress or
   *  retryable error is shown again, worded anew. Result notices and final
   *  errors are transient and stay cleared. */
  republish(): void {
    if (this.disposed) return
    this.deps.presenter.setOpening(this.opening)
    this.shown?.()
  }

  async openFromLocation(source: 'initial-link' | 'link'): Promise<void> {
    await this.openLinkFragment(this.deps.location.currentHash(), source)
  }

  /** A curated example opens exactly like a pasted link: the
   *  same decoding, confirmation and resolution. Its result notice leaves out
   *  the newer-element-sets line, since an example always loads the newest. */
  async openExample(fragment: string): Promise<void> {
    await this.openLinkFragment(`#${fragment}`, 'example')
  }

  private async openLinkFragment(hash: string, source: 'initial-link' | 'link' | 'example'): Promise<void> {
    const link = sceneLinkPayload(hash)
    if (!link || this.disposed) return
    const pending = this.begin(source)
    let decoded: Awaited<ReturnType<typeof decodeSceneLinkPayload>>
    try { decoded = await decodeSceneLinkPayload(link.encoding, link.payload) } catch { if (pending === this.pending) this.fail(pending, () => text().sharing.linkInvalid, false); return }
    if (pending !== this.pending) return
    if (decoded.ok) this.decoded(pending, decoded.document)
    else this.rejectInput(pending, 'link', decoded.failure)
  }

  async openFile(file: SceneFileReadable): Promise<void> {
    if (this.disposed) return
    const pending = this.begin('file')
    if (file.size > MAX_SCENE_FILE_BYTES) { this.fail(pending, () => text().sharing.fileTooLarge, false); return }
    let contents: string
    try { contents = await file.text() } catch { if (pending === this.pending) this.fail(pending, () => text().sharing.fileInvalid, false); return }
    if (pending !== this.pending) return
    let decoded: ReturnType<typeof decodeSceneFileText>
    // Hostile input fails with a message, never a stuck open.
    try { decoded = decodeSceneFileText(contents) } catch { this.fail(pending, () => text().sharing.fileInvalid, false); return }
    if (decoded.ok) this.decoded(pending, decoded.document)
    else this.rejectInput(pending, 'file', decoded.failure)
  }

  async confirmPendingOpen(): Promise<void> {
    const pending = this.pending
    if (!pending || pending.phase !== 'confirming') return
    await this.resolve(pending)
  }

  cancelPendingOpen(): void {
    const pending = this.pending
    if (!pending) return
    this.finish(pending)
    this.hide()
  }

  async retry(): Promise<void> {
    const pending = this.pending
    if (!pending || pending.phase !== 'failed-retryable') return
    await this.resolve(pending)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.pending = null
    this.shown = null
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private begin(source: SceneOpenSource): PendingOpen {
    const previous = this.pending
    if (previous) this.finish(previous)
    const pending: PendingOpen = { source, phase: 'decoding', document: null }
    this.pending = pending
    this.hide()
    this.deps.presenter.setOpening(true)
    return pending
  }

  /** Every terminal state of a link open removes the fragment. */
  private finish(pending: PendingOpen): void {
    if (this.pending === pending) this.pending = null
    if (pending.source !== 'file') this.deps.location.clearSceneFragment()
    if (!this.pending) this.deps.presenter.setOpening(false)
  }

  private hide(): void {
    this.shown = null
    this.deps.presenter.hideOpenStatus()
  }

  /** Shows a status; `lasting` ones are shown again after a language change. */
  private present(show: () => void, lasting: boolean): void {
    this.shown = lasting ? show : null
    show()
  }

  private fail(pending: PendingOpen, message: () => string, retryable: boolean): void {
    if (retryable) {
      pending.phase = 'failed-retryable'
      if (pending.source !== 'file') this.deps.location.clearSceneFragment()
      this.deps.presenter.setOpening(false)
    } else this.finish(pending)
    this.present(() => this.deps.presenter.showError(message(), retryable), retryable)
  }

  private rejectInput(pending: PendingOpen, source: 'link' | 'file', failure: SceneTextFailure): void {
    if (failure.kind === 'invalid-document') this.deps.reportInvalidDocument?.(failure.errors.slice(0, 5))
    this.fail(pending, () => sceneOpenFailureMessage(source, failure), false)
  }

  /** Validation happens before confirmation; only a valid scene asks. */
  private decoded(pending: PendingOpen, document: SceneDocumentV1): void {
    pending.document = document
    const mode = document.activeMode
    const replaced = sceneFor(this.deps.getState(), mode).objects.length
    if (pending.source === 'initial-link' || replaced === 0) { void this.resolve(pending); return }
    pending.phase = 'confirming'
    const incoming = sharedSceneSummary(document).objectCount
    this.present(() => this.deps.presenter.showConfirmation({ message: openConfirmationMessage(mode, replaced), incoming: openIncomingLine(mode, incoming) }), true)
  }

  private async resolve(pending: PendingOpen): Promise<void> {
    const document = pending.document
    if (!document || pending !== this.pending) return
    if (this.deps.catalogueAddPending()) { this.fail(pending, () => text().sharing.waitForAdd, false); return }
    pending.phase = 'resolving'
    this.deps.presenter.setOpening(true)
    const catalogueCount = sharedSceneSummary(document).catalogueObjectCount
    if (catalogueCount > 0) this.present(() => this.deps.presenter.showProgress(openProgressMessage(catalogueCount)), true)
    else this.hide()
    let resolved: ResolvedSceneDocument
    try {
      // A superseded open stops before requesting record shards.
      resolved = await resolveSceneDocument(document, {
        loadCatalogue: () => this.deps.loadCatalogue(),
        resolveRecords: (ids) => pending === this.pending ? this.deps.resolveRecords(ids) : Promise.reject(new Error('Superseded scene open.')),
      })
    } catch (error) {
      if (pending === this.pending) this.fail(pending, () => error instanceof CatalogueSnapshotChangedError ? text().sharing.catalogueChanged : text().sharing.catalogueOpenFailed, true)
      return
    }
    if (pending !== this.pending) return
    const mode = document.activeMode
    this.deps.applySharedScene(mode, resolved)
    this.finish(pending)
    const opened = (mode === 'orbitLab' ? resolved.orbitLab : resolved.realObjects).objects.length
    // An example link arriving from outside carries `?example=`; it is an example too.
    const example = pending.source === 'example' || (pending.source !== 'file' && new URLSearchParams(this.deps.location.search).has('example'))
    const problems = example ? resolved.problems.filter((problem) => problem.kind !== 'element-set-changed') : resolved.problems
    this.present(() => this.deps.presenter.showNotice(openResultLines(mode, opened, problems)), false)
    recordUsage({ type: 'scene_opened', kind: pending.source === 'file' ? 'file' : example ? 'example' : 'link', mode })
  }
}
