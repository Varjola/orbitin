import type { EarthStyle, LookState, ProductMode, SceneBackdrop, SceneState } from '../state/AppState.ts'
import type { MyPlaceStatus } from '../ui/applicationUi.ts'
import type { SceneLayer } from '../ui/uiTypes.ts'
import { text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'

export interface LayersPanelCallbacks {
  onLayer(layer: SceneLayer, on: boolean): void
  onMyPlace(on: boolean): void
  /** The scene's look. */
  onEarthStyle(style: EarthStyle): void
  onOrbitLabBackdrop(backdrop: SceneBackdrop): void
}

/** Footprints have no switch on mobile: their sensor cannot be set here. */
type MobileLayer = Exclude<SceneLayer, 'sensorGeometry'>
const LAYERS: ReadonlyArray<readonly [MobileLayer, 'orbitPaths' | 'groundTracks']> = [
  ['orbitPath', 'orbitPaths'], ['groundTrack', 'groundTracks'],
]

export function layersPanelMarkup(): string {
  const t = text().mobile.layers
  const l = text().look
  const layer = ([id, word]: readonly [MobileLayer, 'orbitPaths' | 'groundTracks']) => html`<label class="m-switch"><input type="checkbox" role="switch" data-layer="${id}" /><span class="m-switch-track" aria-hidden="true"></span><span class="m-switch-label">${t[word]}</span></label>`
  return html`
    <div class="m-layer-switches">${trusted(LAYERS.map(layer).join(''))}</div>
    <p class="m-line m-layers-budget" role="status"></p>
    <label class="m-switch m-my-place"><input type="checkbox" role="switch" /><span class="m-switch-track" aria-hidden="true"></span><span class="m-switch-label">${t.myPlace}</span></label>
    <p class="m-line m-my-place-status" role="status"></p>
    <h3 class="m-subheading">${l.heading}</h3>
    <label class="m-switch m-look-map"><input type="checkbox" role="switch" /><span class="m-switch-track" aria-hidden="true"></span><span class="m-switch-label">${l.mapEarth}</span></label>
    <label class="m-switch m-look-lab"><input type="checkbox" role="switch" /><span class="m-switch-track" aria-hidden="true"></span><span class="m-switch-label">${l.lab}</span></label>
    <p class="m-line m-look-note" hidden>${l.notInLab}</p>
    <section class="m-map-key" hidden>
      <h3 class="m-subheading">${t.mapKey}</h3>
      <ul>
        <li><span class="m-key-dot" aria-hidden="true"></span>${t.keyPoint}</li>
        <li><span class="m-key-solid" aria-hidden="true"></span>${t.keyLast}</li>
        <li><span class="m-key-dashed" aria-hidden="true"></span>${t.keyNext}</li>
      </ul>
    </section>
  `
}

/** Two scene-wide switches through the existing
 *  layer budgets, with an inline refusal line; the map key while the map is
 *  showing; and Show my place. */
export class LayersPanelView {
  readonly root: HTMLElement
  private readonly switches: ReadonlyMap<MobileLayer, HTMLInputElement>
  private readonly myPlace: HTMLInputElement
  private readonly myPlaceStatus: HTMLElement
  private readonly budget: HTMLElement
  private readonly lookMap: HTMLInputElement
  private readonly lookLab: HTMLInputElement

  constructor(documentRef: Document, callbacks: LayersPanelCallbacks) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-layers'
    this.root.innerHTML = layersPanelMarkup()
    const switches = new Map<MobileLayer, HTMLInputElement>()
    for (const input of this.root.querySelectorAll<HTMLInputElement>('input[data-layer]')) {
      const layer = input.dataset.layer as MobileLayer
      switches.set(layer, input)
      input.addEventListener('change', () => callbacks.onLayer(layer, input.checked))
    }
    this.switches = switches
    this.myPlace = this.root.querySelector<HTMLInputElement>('.m-my-place input')!
    this.myPlaceStatus = this.root.querySelector<HTMLElement>('.m-my-place-status')!
    this.budget = this.root.querySelector<HTMLElement>('.m-layers-budget')!
    this.myPlace.addEventListener('change', () => callbacks.onMyPlace(this.myPlace.checked))
    this.lookMap = this.root.querySelector<HTMLInputElement>('.m-look-map input')!
    this.lookLab = this.root.querySelector<HTMLInputElement>('.m-look-lab input')!
    this.lookMap.addEventListener('change', () => callbacks.onEarthStyle(this.lookMap.checked ? 'map' : 'imagery'))
    this.lookLab.addEventListener('change', () => callbacks.onOrbitLabBackdrop(this.lookLab.checked ? 'lab' : 'space'))
  }

  /** A switch is on when every object in the scene has that layer on. */
  sync(scene: SceneState, mapShowing: boolean, loading: boolean, look: LookState, mode: ProductMode): void {
    const inLab = mode === 'orbitLab' && look.orbitLabBackdrop === 'lab'
    this.lookMap.checked = look.earthStyle === 'map'
    this.lookLab.checked = look.orbitLabBackdrop === 'lab'
    this.lookMap.disabled = loading || inLab
    this.lookLab.disabled = loading
    this.root.querySelector<HTMLElement>('.m-look-lab')!.hidden = mode !== 'orbitLab'
    this.root.querySelector<HTMLElement>('.m-look-note')!.hidden = !inLab
    const read: Readonly<Record<MobileLayer, (object: SceneState['objects'][number]) => boolean>> = {
      orbitPath: (object) => object.display.orbitPathVisible,
      groundTrack: (object) => object.display.groundTrackVisible,
    }
    for (const [layer, input] of this.switches) {
      input.checked = scene.objects.length > 0 && scene.objects.every(read[layer])
      input.disabled = loading || scene.objects.length === 0
    }
    this.myPlace.disabled = loading
    this.root.querySelector<HTMLElement>('.m-map-key')!.hidden = !mapShowing
  }

  setBudgetMessage(message: string): void { this.budget.textContent = message }

  setMyPlaceStatus(status: MyPlaceStatus): void {
    const t = text().mobile.myPlace
    this.myPlace.checked = status === 'on' || status === 'locating'
    this.myPlaceStatus.textContent = status === 'locating' ? t.locating : status === 'failed' ? t.failed : ''
  }
}
