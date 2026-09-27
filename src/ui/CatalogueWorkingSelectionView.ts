import type { AddCatalogueRecordsOutcome } from '../state/catalogueAdditionOutcome.ts'
import { sceneStatusMessage } from './sceneStatusWording.ts'
import { buildWorkingSelectionPresentation, type CatalogueWorkingSelectionModel } from './catalogueWorkingSelection.ts'
import { text } from '../i18n/index.ts'
import { catalogueFailureOf } from '../data/catalogueFailure.ts'
import { html } from './markup.ts'

export interface CatalogueWorkingSelectionCallbacks {
  onRemove(catalogId: string): void
  onClear(): void
  /** The whole ordered selection goes to the existing atomic scene action. */
  onAddSelected(catalogIds: readonly string[]): Promise<AddCatalogueRecordsOutcome>
  onViewScene(): void
}

export function catalogueWorkingSelectionMarkup(): string {
  const t = text().catalogue
  return html`
  <h3 id="catalogue-selection-heading" class="sr-only" tabindex="-1">${t.workingSelection}</h3>
  <p id="catalogue-selection-empty" class="catalogue-review-empty">${t.workingSelectionEmpty}</p>
  <dl id="catalogue-selection-preview" class="catalogue-selection-preview" hidden></dl>
  <p id="catalogue-selection-message" class="time-note" hidden></p>
  <p id="catalogue-selection-capacity" class="time-note" role="alert"></p>
  <div class="catalogue-selection-actions">
    <button id="catalogue-add-selected" class="action-button primary-action" type="button" disabled></button>
    <button id="catalogue-view-scene" class="action-button" type="button" hidden>${t.viewScene}</button>
  </div>
  <p id="catalogue-selection-outcome" class="time-note" role="status"></p>
  <p id="catalogue-selection-error" class="time-note" role="alert"></p>
  <ul id="catalogue-selection-list" class="catalogue-selection-list" aria-labelledby="catalogue-selection-heading"></ul>
  <button id="catalogue-selection-clear" class="action-button" type="button" disabled>${t.clearWorkingSelection}</button>
`
}

/** Working selection panel: tray items, the index/scene preview, Clear,
 *  Add selected and View scene. It reads only index identity and scene
 *  membership; records load only inside the explicit Add selected action. */
export class CatalogueWorkingSelectionView {
  readonly root: HTMLElement
  private readonly callbacks: CatalogueWorkingSelectionCallbacks
  private readonly heading: HTMLElement
  private readonly empty: HTMLElement
  private readonly preview: HTMLElement
  private readonly message: HTMLElement
  private readonly capacity: HTMLElement
  private readonly add: HTMLButtonElement
  private readonly viewScene: HTMLButtonElement
  private readonly outcome: HTMLElement
  private readonly error: HTMLElement
  private readonly list: HTMLElement
  private readonly clear: HTMLButtonElement
  private model: CatalogueWorkingSelectionModel = { ids: [], items: [], preview: { totalSelected: 0, alreadyInScene: 0, newRecordsToAdd: 0, slotsRemaining: 0, canAddAll: false } }
  private pending = false
  private disposed = false

  constructor(container: HTMLElement, callbacks: CatalogueWorkingSelectionCallbacks) {
    this.root = container
    this.callbacks = callbacks
    this.root.innerHTML = catalogueWorkingSelectionMarkup()
    const find = <T extends HTMLElement>(selector: string) => this.root.querySelector<T>(selector)!
    this.heading = find('#catalogue-selection-heading')
    this.empty = find('#catalogue-selection-empty')
    this.preview = find('#catalogue-selection-preview')
    this.message = find('#catalogue-selection-message')
    this.capacity = find('#catalogue-selection-capacity')
    this.add = find<HTMLButtonElement>('#catalogue-add-selected')
    this.viewScene = find<HTMLButtonElement>('#catalogue-view-scene')
    this.outcome = find('#catalogue-selection-outcome')
    this.error = find('#catalogue-selection-error')
    this.list = find('#catalogue-selection-list')
    this.clear = find<HTMLButtonElement>('#catalogue-selection-clear')
    this.add.addEventListener('click', () => { void this.addSelected() })
    this.viewScene.addEventListener('click', () => this.callbacks.onViewScene())
    this.clear.addEventListener('click', () => {
      this.setOutcome('', '')
      this.callbacks.onClear()
      // Clear disables itself; keep focus inside the panel.
      this.heading.focus()
    })
  }

  render(model: CatalogueWorkingSelectionModel): void {
    this.model = model
    const documentRef = this.root.ownerDocument
    const presentation = buildWorkingSelectionPresentation(model, this.pending)
    const empty = model.preview.totalSelected === 0
    this.empty.hidden = !empty
    this.preview.hidden = empty
    this.preview.textContent = ''
    for (const fact of presentation.facts) {
      const term = documentRef.createElement('dt'); term.textContent = fact.label
      const value = documentRef.createElement('dd'); value.textContent = fact.value; value.dataset.fact = fact.key
      this.preview.append(term, value)
    }
    this.message.hidden = presentation.message === null
    setText(this.message, presentation.message ?? '')
    setText(this.capacity, presentation.capacityAlert ?? '')
    setText(this.add, presentation.addLabel)
    this.add.hidden = empty
    this.viewScene.hidden = !presentation.viewSceneVisible
    this.clear.disabled = !presentation.clearEnabled
    // Pending keeps focus on the button (aria-disabled, clicks ignored). A
    // completed add disables it, so focus continues at View scene first.
    this.add.setAttribute('aria-disabled', String(this.pending))
    const disable = !presentation.addEnabled && !this.pending
    if (disable && documentRef.activeElement === this.add) (this.viewScene.hidden ? this.heading : this.viewScene).focus()
    this.add.disabled = disable
    this.renderItems(model)
  }

  focusHeading(): void { this.heading.focus() }
  dispose(): void { this.disposed = true; this.root.textContent = '' }

  private renderItems(model: CatalogueWorkingSelectionModel): void {
    const documentRef = this.root.ownerDocument
    const active = documentRef.activeElement instanceof HTMLElement && this.list.contains(documentRef.activeElement) ? documentRef.activeElement : null
    const focusedId = active?.closest<HTMLElement>('li')?.dataset.catalogId ?? null
    const previousIds = [...this.list.querySelectorAll<HTMLElement>('li')].map((item) => item.dataset.catalogId!)
    this.list.textContent = ''
    for (const item of model.items) {
      const li = documentRef.createElement('li'); li.dataset.catalogId = item.catalogId
      const identity = documentRef.createElement('div'); identity.className = 'catalogue-selection-identity'
      const name = documentRef.createElement('span'); name.className = 'catalogue-selection-name'; name.textContent = item.name
      const meta = documentRef.createElement('span'); meta.className = 'catalogue-row-designator'
      meta.textContent = [text().catalogue.noradId(item.catalogId), item.internationalDesignator].filter(Boolean).join(' · ')
      identity.append(name, meta)
      if (item.inScene) { const inScene = documentRef.createElement('span'); inScene.className = 'catalogue-in-scene'; inScene.textContent = text().catalogue.inScene; identity.append(inScene) }
      const remove = documentRef.createElement('button'); remove.type = 'button'; remove.className = 'action-button catalogue-selection-remove'
      remove.textContent = text().catalogue.remove; remove.setAttribute('aria-label', text().catalogue.labelledAction(text().catalogue.removeFromWorkingSelection, item.name))
      remove.addEventListener('click', () => this.callbacks.onRemove(item.catalogId))
      li.append(identity, remove)
      this.list.append(li)
    }
    if (focusedId === null) return
    const buttons = [...this.list.querySelectorAll<HTMLButtonElement>('.catalogue-selection-remove')]
    const same = buttons.find((button) => button.closest<HTMLElement>('li')?.dataset.catalogId === focusedId)
    if (same) { same.focus(); return }
    // The focused item was removed: continue at its neighbour, else the panel.
    const index = previousIds.indexOf(focusedId)
    const neighbour = buttons[Math.min(Math.max(index, 0), buttons.length - 1)]
    if (neighbour) neighbour.focus(); else this.heading.focus()
  }

  private async addSelected(): Promise<void> {
    if (this.pending || !buildWorkingSelectionPresentation(this.model, false).addEnabled) return
    this.pending = true
    this.setOutcome('', '')
    this.render(this.model)
    let outcome: AddCatalogueRecordsOutcome
    try { outcome = await this.callbacks.onAddSelected(this.model.ids) }
    catch (error) { outcome = { kind: 'failed', reason: { kind: 'catalogue', failure: catalogueFailureOf(error, text().errors.catalogueDefaults.addMany) } } }
    if (this.disposed) return
    this.pending = false
    const succeeded = outcome.kind === 'added' || outcome.kind === 'already-present'
    const message = sceneStatusMessage(outcome)
    this.setOutcome(succeeded ? message : '', succeeded ? '' : message)
    this.render(this.model)
  }

  private setOutcome(status: string, error: string): void { setText(this.outcome, status); setText(this.error, error) }
}

function setText(element: HTMLElement, text: string): void { if (element.textContent !== text) element.textContent = text }
