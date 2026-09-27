import type { SceneState } from '../state/AppState.ts'
import { text } from '../i18n/index.ts'
import type { OrbitPresetId } from '../simulation/orbitPresets.ts'
import type { ShellModel } from './shellModel.ts'
import type { UiCallbacks, UiLockStatus, UiConstraint } from './uiTypes.ts'
import { OrbitLabAuthoringView } from './OrbitLabAuthoringView.ts'
import { html, trusted } from './markup.ts'
import { termLabelMarkup } from './termLabel.ts'

export class OrbitLabDrawerView {
  readonly root: HTMLElement
  readonly authoring: OrbitLabAuthoringView
  private readonly callbacks: UiCallbacks

  constructor(container: HTMLElement, callbacks: UiCallbacks, presets: readonly OrbitPresetId[]) {
    this.root = container
    this.callbacks = callbacks
    this.root.dataset.region = 'orbitLabDrawer'
    const t = text().orbitLab
    this.root.innerHTML = html`
      <div id="orbit-lab-empty" class="workspace-empty" hidden><strong>${t.emptyTitle}</strong><p>${t.emptyText}</p></div>
      <div class="workspace-scene-status"><span id="orbit-lab-selection-count" class="group-hint"></span><p id="scene-status" class="time-note" role="status"></p><p id="orbit-lab-limit" class="time-note" role="status"></p></div>
      <div class="tab-list" role="tablist" aria-label="${t.tabList}"><button id="orbit-lab-tab-edit" role="tab" aria-controls="orbit-lab-edit-panel" aria-selected="true" type="button">${t.tabs.edit}</button><button id="orbit-lab-tab-examples" role="tab" aria-controls="orbit-lab-examples-panel" aria-selected="false" type="button">${t.tabs.examples}</button></div>
      <section id="orbit-lab-edit-panel" role="tabpanel"><div id="orbit-lab-authoring"></div></section>
      <section id="orbit-lab-examples-panel" role="tabpanel" hidden><p class="example-intro">${t.examplesIntro}</p><div class="teaching-note is-visible ground-track-lesson"><strong>${trusted(termLabelMarkup(t.lessonHeading, 'groundTrack'))}</strong><br>${t.lessonText}<br><br>${t.sensorLesson}</div><div id="preset-cards"></div><p id="object-limit" role="status"></p></section>
    `
    this.authoring = new OrbitLabAuthoringView(this.root.querySelector('#orbit-lab-authoring')!, callbacks)
    const cards = this.root.querySelector('#preset-cards')!
    for (const id of presets) {
      const preset = text().presets[id]
      const card = documentRef(this.root).createElement('article'); card.className = 'preset-card'
      const name = documentRef(this.root).createElement('strong'); name.textContent = preset.name
      const description = documentRef(this.root).createElement('p'); description.textContent = preset.description
      const set = documentRef(this.root).createElement('button'); set.type = 'button'; set.className = 'action-button'; set.textContent = t.setOrbit; set.setAttribute('aria-label', t.setOrbitTo(preset.name)); set.addEventListener('click', () => callbacks.onSetPreset(id))
      card.append(name, description, set); cards.append(card)
    }
    this.bindEvents()
  }

  sync(model: ShellModel['orbitLab'], scene: SceneState, loading: boolean, object: import('../simulation/OrbitalObject.ts').OrbitalObject | undefined, constraint: UiConstraint, lockStatus: UiLockStatus): void {
    this.root.dataset.tab = model.tab
    this.root.dataset.empty = String(model.showEmptyState)
    this.root.querySelector<HTMLElement>('#orbit-lab-empty')!.hidden = !model.showEmptyState
    this.root.querySelector('#orbit-lab-selection-count')!.textContent = scene.selection.ids.length > 0 ? text().shell.selectedCount(scene.selection.ids.length) : ''
    this.root.querySelector('#orbit-lab-limit')!.textContent = model.limitMessage
    this.root.querySelector<HTMLElement>('#orbit-lab-edit-panel')!.hidden = model.tab !== 'edit'
    this.root.querySelector<HTMLElement>('#orbit-lab-examples-panel')!.hidden = model.tab !== 'examples'
    this.root.querySelector<HTMLButtonElement>('#orbit-lab-tab-edit')!.setAttribute('aria-selected', String(model.tab === 'edit'))
    this.root.querySelector<HTMLButtonElement>('#orbit-lab-tab-examples')!.setAttribute('aria-selected', String(model.tab === 'examples'))
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.tab-list button')) button.disabled = loading
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#preset-cards button')) button.disabled = loading || !object
    this.authoring.sync(object, constraint, lockStatus, loading)
  }

  setSceneStatus(message: string): void { this.root.querySelector('#scene-status')!.textContent = message }
  dispose(): void { this.authoring.dispose(); this.root.textContent = '' }

  private bindEvents(): void {
    const tabs = [...this.root.querySelectorAll<HTMLButtonElement>('.tab-list button')]
    for (const [index, tab] of tabs.entries()) {
      tab.addEventListener('click', () => this.callbacks.onOrbitLabDrawerTabChange(index === 0 ? 'edit' : 'examples'))
      tab.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault(); const next = index + (event.key === 'ArrowRight' ? 1 : -1); tabs[(next + tabs.length) % tabs.length].focus(); this.callbacks.onOrbitLabDrawerTabChange((next + tabs.length) % tabs.length === 0 ? 'edit' : 'examples')
      })
    }
  }
}

function documentRef(root: HTMLElement): Document { return root.ownerDocument }
