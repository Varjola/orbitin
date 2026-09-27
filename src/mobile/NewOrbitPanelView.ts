import type { OrbitPresetId } from '../simulation/orbitPresets.ts'
import { MAX_SCENE_OBJECTS } from '../state/sceneActions.ts'
import { text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'
import type { OrbitCreationKind } from '../ui/uiTypes.ts'

export interface NewOrbitCallbacks {
  onCreateOrbit(kind: OrbitCreationKind): void
  onCreateOrbitFromExample(presetId: OrbitPresetId): void
}

const KINDS: readonly OrbitCreationKind[] = ['leo', 'meo', 'geo', 'heo']
/** The six examples, in this order. */
export const MOBILE_EXAMPLES: readonly OrbitPresetId[] = ['leo', 'meo', 'geo', 'polar', 'elliptical', 'sso']

export function newOrbitMarkup(): string {
  const t = text().mobile.newOrbit
  const kinds = text().orbitLab.orbitKinds
  const tile = (kind: OrbitCreationKind) => html`<button class="m-orbit-tile" type="button" data-kind="${kind}"><span class="m-orbit-code">${kinds[kind].code}</span><span class="m-orbit-name">${kinds[kind].name}</span></button>`
  const example = (id: OrbitPresetId) => html`<li><button class="m-example" type="button" data-example="${id}"><span class="m-example-name">${t.exampleNames[id]}</span><span class="m-example-line">${t.exampleLines[id]}</span></button></li>`
  return html`
    <div class="m-orbit-tiles">${trusted(KINDS.map(tile).join(''))}</div>
    <p class="m-line m-new-full" role="status"></p>
    <h3 class="m-subheading">${t.examples}</h3>
    <ul class="m-examples">${trusted(MOBILE_EXAMPLES.map(example).join(''))}</ul>
  `
}

/** Four quick tiles (LEO, MEO, GEO, HEO) and six
 *  examples. Every tap creates a new orbit; at 100 orbits the choices are
 *  disabled with one line saying the scene is full. */
export class NewOrbitPanelView {
  readonly root: HTMLElement
  private readonly full: HTMLElement

  constructor(documentRef: Document, callbacks: NewOrbitCallbacks) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-new-orbit'
    this.root.innerHTML = newOrbitMarkup()
    this.full = this.root.querySelector<HTMLElement>('.m-new-full')!
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-kind]')) button.addEventListener('click', () => callbacks.onCreateOrbit(button.dataset.kind as OrbitCreationKind))
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-example]')) button.addEventListener('click', () => callbacks.onCreateOrbitFromExample(button.dataset.example as OrbitPresetId))
  }

  sync(objectCount: number, loading: boolean): void {
    const full = objectCount >= MAX_SCENE_OBJECTS
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-kind], [data-example]')) button.disabled = loading || full
    this.full.textContent = full ? text().mobile.newOrbit.full(MAX_SCENE_OBJECTS) : ''
  }
}
