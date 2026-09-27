import type { SceneSelection, SceneState } from '../state/AppState.ts'
import { MAX_SCENE_OBJECTS } from '../state/sceneActions.ts'
import { activeObjectSummary, applyHeaderAction, buildSceneObjectsModel, NO_GROUP_PROVENANCE, removeSelectedConfirmation, removeSelectedLabel, sceneObjectsToggleLabel, type GroupProvenance, type SceneObjectsModel } from './sceneObjectsModel.ts'
import { selectionIntentFromClick, type SceneSelectionIntent } from './sceneSelectionIntent.ts'
import { text } from '../i18n/index.ts'
import { html } from './markup.ts'

export interface SceneObjectsCallbacks {
  onSelectSceneObject(id: string, intent: SceneSelectionIntent): void
  onRemoveSceneObjects(ids: readonly string[]): void
  onSceneSelectionChange(selection: SceneSelection): void
  onRevealSceneObjects(ids: readonly string[]): void
  onToggleSceneObjects(): void
}

interface Row {
  readonly root: HTMLElement
  readonly check: HTMLInputElement
  readonly select: HTMLButtonElement
  readonly name: HTMLElement
  readonly state: HTMLElement
  readonly swatch: HTMLElement
  readonly remove: HTMLButtonElement
}

export function sceneObjectsMarkup(): string {
  const t = text().sceneObjects
  return html`
  <button type="button" class="scene-objects-toggle" aria-expanded="true" aria-controls="scene-objects-body">
    <span class="object-swatch scene-objects-active-swatch" aria-hidden="true"></span>
    <span class="scene-objects-active-name"></span>
    <span class="scene-objects-chevron" aria-hidden="true"></span>
  </button>
  <div id="scene-objects-body" class="scene-objects-body">
  <div class="scene-objects-header">
    <div class="scene-objects-counts"><strong class="scene-objects-count"></strong><span class="scene-objects-selected"></span></div>
    <div class="scene-objects-tools">
      <input type="checkbox" class="scene-objects-all" />
      <input type="search" class="scene-objects-search" placeholder="${t.search}" aria-label="${t.searchAccessible}" autocomplete="off" />
    </div>
  </div>
  <p class="scene-objects-empty" role="status"></p>
  <ul class="scene-objects-rows" aria-label="${t.rows}"></ul>
  <div class="scene-objects-footer">
    <button type="button" class="action-button scene-objects-remove-selected"></button>
    <div class="scene-objects-confirm" role="group" aria-label="${t.confirmRemoval}" hidden>
      <p class="scene-objects-confirm-text" role="status"></p>
      <div class="scene-objects-confirm-actions"><button type="button" class="action-button danger-action scene-objects-confirm-remove">${t.remove}</button><button type="button" class="action-button scene-objects-confirm-cancel">${t.cancel}</button></div>
    </div>
  </div>
  </div>
`
}

/** The Scene Objects manager: keyed rows with a
 *  membership checkbox, a name button and a remove button; a transient search;
 *  a scoped Select all; and confirmed bulk removal. Search never changes
 *  selection by itself, and nothing here is stored in application state.
 *  A toggle bar on top shows the active object and collapses the manager to
 *  that bar alone; the expanded flag is shell state. */
export class SceneObjectsView {
  private readonly rows = new Map<string, Row>()
  private readonly container: HTMLElement
  private readonly callbacks: SceneObjectsCallbacks
  private readonly focusAdd: () => void
  private readonly list: HTMLElement
  private readonly all: HTMLInputElement
  private readonly search: HTMLInputElement
  private readonly empty: HTMLElement
  private readonly removeSelected: HTMLButtonElement
  private readonly confirm: HTMLElement
  private readonly confirmText: HTMLElement
  private readonly toggle: HTMLButtonElement
  private readonly body: HTMLElement
  private expanded = true
  private scene: SceneState = { objects: [], selection: { ids: [], primaryId: null } }
  private provenance: GroupProvenance = NO_GROUP_PROVENANCE
  private model: SceneObjectsModel | null = null
  private loading = false
  private mode: string | null = null

  constructor(container: HTMLElement, callbacks: SceneObjectsCallbacks, focusAdd: () => void) {
    this.container = container; this.callbacks = callbacks; this.focusAdd = focusAdd
    container.innerHTML = sceneObjectsMarkup()
    const find = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!
    this.list = find('.scene-objects-rows')
    this.all = find<HTMLInputElement>('.scene-objects-all')
    this.search = find<HTMLInputElement>('.scene-objects-search')
    this.empty = find('.scene-objects-empty')
    this.removeSelected = find<HTMLButtonElement>('.scene-objects-remove-selected')
    this.confirm = find('.scene-objects-confirm')
    this.confirmText = find('.scene-objects-confirm-text')
    this.toggle = find<HTMLButtonElement>('.scene-objects-toggle')
    this.body = find('.scene-objects-body')
    this.toggle.addEventListener('click', () => this.callbacks.onToggleSceneObjects())
    this.search.addEventListener('input', () => this.render())
    this.all.addEventListener('change', () => {
      if (!this.model) return
      this.callbacks.onSceneSelectionChange(applyHeaderAction(this.scene.selection, this.model.header))
    })
    this.removeSelected.addEventListener('click', () => {
      const ids = this.scene.selection.ids
      if (ids.length === 0) return
      if (ids.length === 1) { this.callbacks.onRemoveSceneObjects(ids); return }
      this.confirmText.textContent = removeSelectedConfirmation(ids.length)
      this.confirm.hidden = false
      find<HTMLButtonElement>('.scene-objects-confirm-cancel').focus()
    })
    find('.scene-objects-confirm-remove').addEventListener('click', () => {
      const ids = this.scene.selection.ids
      this.hideConfirm()
      this.callbacks.onRemoveSceneObjects(ids)
    })
    find('.scene-objects-confirm-cancel').addEventListener('click', () => { this.hideConfirm(); this.removeSelected.focus() })
  }

  /** Focus the primary (else first) scene object; false when the list is
   *  empty. A collapsed manager focuses its toggle instead. */
  focusPrimary(): boolean {
    if (!this.expanded) {
      if (this.scene.objects.length === 0) return false
      this.toggle.focus()
      return true
    }
    const row = [...this.rows.values()].find((candidate) => candidate.root.classList.contains('is-primary')) ?? this.rows.values().next().value
    row?.select.focus()
    return row !== undefined
  }

  setProvenance(provenance: GroupProvenance): void {
    this.provenance = provenance
    this.render()
  }

  sync(state: SceneState, loading: boolean, mode: string): void {
    // Search text is transient and belongs to one mode's scene.
    if (this.mode !== null && mode !== this.mode) this.search.value = ''
    this.mode = mode
    this.scene = state
    this.loading = loading
    this.render()
  }

  setExpanded(expanded: boolean): void {
    if (expanded === this.expanded) return
    const focusWasInside = !expanded && this.body.contains(this.container.ownerDocument.activeElement)
    this.expanded = expanded
    this.hideConfirm()
    this.renderToggle()
    if (focusWasInside) this.toggle.focus()
  }

  private renderToggle(): void {
    const summary = activeObjectSummary(this.scene)
    const toggleLabel = sceneObjectsToggleLabel(this.expanded)
    this.container.classList.toggle('is-minimized', !this.expanded)
    this.body.hidden = !this.expanded
    this.toggle.setAttribute('aria-expanded', String(this.expanded))
    this.toggle.setAttribute('aria-label', text().sceneObjects.toggle(summary.label))
    this.toggle.title = toggleLabel
    this.toggle.disabled = this.loading
    this.container.querySelector('.scene-objects-active-name')!.textContent = summary.label
    this.container.querySelector('.scene-objects-chevron')!.textContent = this.expanded ? '▴' : '▾'
    const swatch = this.container.querySelector<HTMLElement>('.scene-objects-active-swatch')!
    swatch.hidden = summary.colorHex === null
    if (summary.colorHex !== null) swatch.style.backgroundColor = `#${summary.colorHex.toString(16).padStart(6, '0')}`
  }

  private hideConfirm(): void { this.confirm.hidden = true; this.confirmText.textContent = '' }

  private render(): void {
    const documentRef = this.container.ownerDocument
    const model = buildSceneObjectsModel(this.scene, this.search.value, MAX_SCENE_OBJECTS, this.provenance)
    this.model = model
    this.renderToggle()
    this.container.querySelector('.scene-objects-count')!.textContent = model.countLabel
    this.container.querySelector('.scene-objects-selected')!.textContent = model.selectedLabel
    this.all.checked = model.header.checked
    this.all.indeterminate = model.header.indeterminate
    this.all.setAttribute('aria-label', model.header.label)
    this.all.title = model.header.label
    this.all.disabled = this.loading || model.header.scopeIds.length === 0
    this.search.disabled = this.loading
    this.empty.textContent = model.emptySearchMessage ?? ''
    this.empty.hidden = model.emptySearchMessage === null
    const selectedCount = this.scene.selection.ids.length
    this.removeSelected.textContent = removeSelectedLabel(selectedCount)
    this.removeSelected.disabled = this.loading || selectedCount === 0
    if (selectedCount < 2) this.hideConfirm()
    else if (!this.confirm.hidden) this.confirmText.textContent = removeSelectedConfirmation(selectedCount)

    let restoreFocus = false
    const present = new Set(this.scene.objects.map((object) => object.id))
    const listed = new Set(model.rows.map((row) => row.id))
    for (const [id, row] of this.rows) {
      if (present.has(id) && listed.has(id)) continue
      restoreFocus ||= row.root.contains(documentRef.activeElement)
      row.root.remove()
      if (!present.has(id)) this.rows.delete(id)
    }
    let previous: Element | null = null
    for (const rowModel of model.rows) {
      let row = this.rows.get(rowModel.id)
      if (!row) row = this.createRow(rowModel.id)
      // Keyed rows keep focus; only misplaced rows are moved.
      const expected: Element | null = previous ? previous.nextElementSibling : this.list.firstElementChild
      if (expected !== row.root) previous ? previous.after(row.root) : this.list.prepend(row.root)
      previous = row.root
      row.root.classList.toggle('is-selected', rowModel.selected)
      row.root.classList.toggle('is-primary', rowModel.primary)
      row.check.checked = rowModel.selected
      const t = text().sceneObjects
      const state = rowModel.stateLabel ? t.states[rowModel.stateLabel] : ''
      row.check.setAttribute('aria-label', t.include(rowModel.name))
      row.select.setAttribute('aria-pressed', String(rowModel.selected))
      row.select.setAttribute('aria-label', state ? t.rowState(rowModel.name, state) : rowModel.name)
      if (row.name.textContent !== rowModel.name) row.name.textContent = rowModel.name
      row.state.textContent = state
      row.swatch.style.backgroundColor = `#${rowModel.colorHex.toString(16).padStart(6, '0')}`
      row.remove.setAttribute('aria-label', t.removeNamed(rowModel.name))
      for (const control of [row.check, row.select, row.remove]) control.disabled = this.loading
    }
    if (restoreFocus) {
      const primary = this.scene.selection.primaryId && this.rows.get(this.scene.selection.primaryId)
      if (primary && primary.root.isConnected) primary.select.focus()
      else if (model.rows.length > 0) this.search.focus()
      else this.focusAdd()
    }
  }

  private createRow(id: string): Row {
    const documentRef = this.container.ownerDocument
    const root = documentRef.createElement('li')
    root.className = 'scene-object-row'
    root.innerHTML = html`<input type="checkbox" class="scene-object-check" /><button type="button" class="scene-object-select"><span class="object-swatch" aria-hidden="true"></span><span class="object-name"></span><span class="scene-object-state" aria-hidden="true"></span></button><button type="button" class="remove-object" title="${text().sceneObjects.removeObject}"><span aria-hidden="true">×</span></button>`
    const row: Row = {
      root,
      check: root.querySelector<HTMLInputElement>('.scene-object-check')!,
      select: root.querySelector<HTMLButtonElement>('.scene-object-select')!,
      name: root.querySelector<HTMLElement>('.object-name')!,
      state: root.querySelector<HTMLElement>('.scene-object-state')!,
      swatch: root.querySelector<HTMLElement>('.object-swatch')!,
      remove: root.querySelector<HTMLButtonElement>('.remove-object')!,
    }
    row.check.addEventListener('change', () => this.callbacks.onSelectSceneObject(id, 'membership'))
    row.select.addEventListener('click', (event) => {
      const intent = selectionIntentFromClick(event)
      this.callbacks.onSelectSceneObject(id, intent)
      if (intent === 'only') this.callbacks.onRevealSceneObjects([id])
    })
    row.remove.addEventListener('click', () => this.callbacks.onRemoveSceneObjects([id]))
    this.rows.set(id, row)
    return row
  }
}
