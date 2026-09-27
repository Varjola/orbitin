import type { SceneState } from '../state/AppState.ts'
import { MAX_SCENE_OBJECTS } from '../state/objectActions.ts'
import { text } from '../i18n/index.ts'
import { html } from './markup.ts'
import type { ShellModel } from './shellModel.ts'
import type { UiCallbacks } from './uiTypes.ts'

export class RealObjectsDrawerView {
  readonly root: HTMLElement
  private readonly callbacks: UiCallbacks
  private readonly recordFormat: HTMLSelectElement
  private readonly tleInput: HTMLTextAreaElement
  private readonly ommInput: HTMLTextAreaElement
  private readonly epochToggle: HTMLInputElement

  constructor(container: HTMLElement, callbacks: UiCallbacks) {
    this.root = container
    this.callbacks = callbacks
    this.root.dataset.region = 'realObjectsDrawer'
    const t = text().realObjects
    this.root.innerHTML = html`
      <div class="workspace-intro"><p id="real-empty-title" class="workspace-empty-title">${t.emptyTitle}</p><p id="real-empty-text" class="time-note">${t.emptyText}</p></div>
      <div class="workspace-toolbar"><div><strong id="real-object-count">${text().shell.objectCount(0, MAX_SCENE_OBJECTS)}</strong><span class="group-hint">${t.inThisScene}</span></div></div>
      <p id="catalogue-availability" class="time-note" role="status"></p>
      <div class="workspace-scene-status"><span id="real-selection-count" class="group-hint"></span><p id="real-scene-status" class="time-note" role="status"></p></div>
      <section id="tle-import-group" class="field-group"><div class="group-heading"><span>${t.manualHeading}</span><span class="group-hint">${t.manualHint}</span></div><label class="mode-label">${t.recordFormat} <select id="manual-record-format" aria-label="${t.recordFormatAccessible}"><option value="tle">${t.formats.tle}</option><option value="omm">${t.formats.omm}</option></select></label><textarea id="tle-input" rows="6" spellcheck="false" autocapitalize="off" autocorrect="off" aria-describedby="tle-help tle-errors" placeholder="${t.tlePlaceholder}"></textarea><textarea id="omm-input" rows="6" spellcheck="false" autocapitalize="off" autocorrect="off" aria-describedby="omm-help tle-errors" placeholder="${t.ommPlaceholder}" hidden></textarea><p id="tle-help" class="time-note">${t.tleHelp}</p><p id="omm-help" class="time-note" hidden>${t.ommHelp}</p><label class="toggle-row" title="${t.goToEpochHint}"><span>${t.goToEpoch}</span><input id="tle-epoch-toggle" type="checkbox" checked aria-label="${t.goToEpoch}" /><span class="toggle-ui" aria-hidden="true"></span></label><button id="add-tle" class="action-button" type="button">${t.addRecord}</button><p id="tle-errors" class="time-note" role="alert"></p></section>
    `
    this.recordFormat = this.root.querySelector<HTMLSelectElement>('#manual-record-format')!
    this.tleInput = this.root.querySelector<HTMLTextAreaElement>('#tle-input')!
    this.ommInput = this.root.querySelector<HTMLTextAreaElement>('#omm-input')!
    this.epochToggle = this.root.querySelector<HTMLInputElement>('#tle-epoch-toggle')!
    this.bindEvents()
  }

  sync(model: ShellModel['realObjects'], scene: SceneState, loading: boolean): void {
    this.root.dataset.empty = String(model.showEmptyState)
    this.root.dataset.catalogue = model.catalogueLine
    this.root.toggleAttribute('aria-busy', loading)
    this.root.querySelector('#real-object-count')!.textContent = model.objectCountLabel
    this.root.querySelector('#catalogue-availability')!.textContent = model.catalogueLine
    this.root.querySelector<HTMLElement>('.workspace-intro')!.hidden = !model.showEmptyState
    this.root.querySelector('#real-selection-count')!.textContent = scene.selection.ids.length > 0 ? text().shell.selectedCount(scene.selection.ids.length) : ''
    for (const input of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')) input.disabled = loading || (!model.addRecordEnabled && input.id !== 'tle-epoch-toggle')
  }

  showTleErrors(messages: readonly string[]): void {
    this.root.querySelector('#tle-errors')!.textContent = messages.join(' ')
    ;(this.recordFormat.value === 'omm' ? this.ommInput : this.tleInput).focus()
  }
  clearTleErrors(): void { this.root.querySelector('#tle-errors')!.textContent = '' }
  setSceneStatus(message: string): void { this.root.querySelector('#real-scene-status')!.textContent = message }
  dispose(): void { this.root.textContent = '' }

  private bindEvents(): void {
    this.root.querySelector('#add-tle')!.addEventListener('click', () => {
      if (this.recordFormat.value === 'omm') this.callbacks.onImportOmm(this.ommInput.value, this.epochToggle.checked)
      else this.callbacks.onImportTle(this.tleInput.value, this.epochToggle.checked)
    })
    this.recordFormat.addEventListener('change', () => {
      const omm = this.recordFormat.value === 'omm'
      this.tleInput.hidden = omm; this.ommInput.hidden = !omm
      this.root.querySelector<HTMLElement>('#tle-help')!.hidden = omm
      this.root.querySelector<HTMLElement>('#omm-help')!.hidden = !omm
    })
  }
}
