import { text } from '../i18n/index.ts'
import type { BurnDirection } from '../simulation/maneuverGame.ts'
import { BurnHold } from './burnHold.ts'
import { html } from './markup.ts'
import type { ManeuverPanelModel } from './maneuverPanelModel.ts'
import { controlsStatusText } from './maneuverWording.ts'
import type { UiCallbacks } from './uiTypes.ts'

/** The desktop hold-to-burn controls above the bottom bars, with the Aid switch
 *  between them; the input rules are `BurnHold`'s. While the drawer is closed,
 *  a line under them says what its status would: a burn running, the game's
 *  result or an empty tank. */
export class ManeuverBurnControlsView {
  readonly root: HTMLElement
  private readonly hold: BurnHold
  private readonly aidToggle: HTMLButtonElement
  private aidOn = false

  constructor(container: HTMLElement, callbacks: UiCallbacks) {
    this.root = container
    this.root.dataset.region = 'maneuverControls'
    const t = text().maneuvers
    this.root.innerHTML = html`
      <div class="maneuver-burns-row">
        <button id="maneuver-slow-down" class="maneuver-burn-button" type="button" data-direction="retrograde"><span aria-hidden="true">◀</span> ${t.slowDown}</button>
        <button id="maneuver-aid" class="maneuver-aid-toggle" type="button" aria-pressed="false" title="${t.aidTitle}">${t.aid}</button>
        <button id="maneuver-speed-up" class="maneuver-burn-button" type="button" data-direction="prograde">${t.speedUp} <span aria-hidden="true">▶</span></button>
      </div>
      <p class="maneuver-keys">${t.keys}</p>
      <p id="maneuver-controls-status" class="maneuver-controls-status" role="status"></p>
    `
    this.hold = new BurnHold(container.ownerDocument, callbacks)
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.maneuver-burn-button')) this.hold.bindButton(button, button.dataset.direction as BurnDirection)
    this.aidToggle = this.root.querySelector<HTMLButtonElement>('#maneuver-aid')!
    this.aidToggle.addEventListener('click', () => callbacks.onManeuverAidChange(!this.aidOn))
  }

  /** Shown and listening only in Interception; leaving ends a burn. */
  setActive(active: boolean): void {
    this.root.hidden = !active
    this.hold.setActive(active)
  }

  sync(model: ManeuverPanelModel | null, loading: boolean, drawerOpen: boolean): void {
    this.hold.sync(model, loading)
    this.aidOn = model?.aid ?? false
    this.aidToggle.disabled = loading || !model
    this.aidToggle.setAttribute('aria-pressed', String(this.aidOn))
    const status = drawerOpen || model === null ? '' : controlsStatusText(model)
    const line = this.root.querySelector<HTMLElement>('#maneuver-controls-status')!
    if (line.textContent !== status) line.textContent = status
    line.dataset.outcome = model?.outcome ?? ''
    this.root.querySelector<HTMLElement>('.maneuver-keys')!.hidden = status !== ''
  }

  dispose(): void {
    this.hold.dispose()
    this.root.textContent = ''
  }
}
