import { format, text } from '../i18n/index.ts'
import type { BurnDirection } from '../simulation/maneuverGame.ts'
import { BurnHold } from '../ui/burnHold.ts'
import { html, trusted } from '../ui/markup.ts'
import type { ManeuverPanelModel } from '../ui/maneuverPanelModel.ts'
import { GOAL_KEYS, tankText, type GoalKey } from '../ui/maneuverWording.ts'
import type { UiCallbacks } from '../ui/uiTypes.ts'

/** The phone's game controls, in three places: the goals as plain text at the
 *  top left (a tap opens the game panel), the tank as an upright gauge under the
 *  view tools, and two large hold-to-burn buttons above the dock. The buttons
 *  show only while no panel covers them; the input rules are `BurnHold`'s. */
export class MobileManeuverBarView {
  readonly root: HTMLElement
  private readonly status: HTMLButtonElement
  private readonly gauge: HTMLElement
  private readonly hold: BurnHold
  private readonly aid: HTMLInputElement
  private readonly buttons: readonly HTMLButtonElement[]

  /** `bottom` takes the buttons, `overlay` the goals and `tools` the gauge. */
  constructor(bottom: HTMLElement, overlay: HTMLElement, tools: HTMLElement, callbacks: UiCallbacks, onGame: () => void) {
    const t = text().maneuvers
    const documentRef = bottom.ownerDocument
    this.root = documentRef.createElement('section')
    this.root.className = 'm-burn-bar'
    this.root.setAttribute('aria-label', text().shell.maneuverControls)
    this.root.hidden = true
    this.root.innerHTML = html`
      <div class="m-burn-row">
        <button class="m-burn-button" type="button" data-direction="retrograde"><span aria-hidden="true">◀</span> ${t.slowDown}</button>
        <label class="m-switch m-burn-aid" title="${t.aidTitle}"><input type="checkbox" role="switch" /><span class="m-switch-track" aria-hidden="true"></span><span class="m-switch-label">${t.aid}</span></label>
        <button class="m-burn-button" type="button" data-direction="prograde">${t.speedUp} <span aria-hidden="true">▶</span></button>
      </div>
    `
    this.status = documentRef.createElement('button')
    this.status.className = 'm-goals'
    this.status.type = 'button'
    this.status.hidden = true
    this.status.setAttribute('aria-haspopup', 'true')
    this.status.setAttribute('aria-label', text().mobile.dock.gameName)
    this.status.innerHTML = html`
      <span class="m-burn-goals">${trusted(GOAL_KEYS.map((key) => html`<span class="m-burn-goal" data-goal="${key}"><span class="m-burn-goal-mark" aria-hidden="true"></span><span class="m-burn-goal-text">${t.goalShort[key]}</span></span>`).join(''))}</span>
      <span class="m-burn-outcome" hidden></span>
    `
    this.status.addEventListener('click', () => onGame())
    this.gauge = documentRef.createElement('div')
    this.gauge.className = 'm-fuel'
    this.gauge.hidden = true
    this.gauge.innerHTML = html`
      <span class="m-fuel-track" role="meter" aria-label="${t.tank}" aria-valuemin="0" aria-valuemax="100"><span class="m-fuel-fill"></span></span>
      <span class="m-fuel-label" aria-hidden="true">${t.tank}</span>
    `
    this.hold = new BurnHold(documentRef, callbacks)
    this.buttons = [...this.root.querySelectorAll<HTMLButtonElement>('.m-burn-button')]
    for (const button of this.buttons) this.hold.bindButton(button, button.dataset.direction as BurnDirection)
    this.aid = this.root.querySelector<HTMLInputElement>('.m-burn-aid input')!
    this.aid.addEventListener('change', () => callbacks.onManeuverAidChange(this.aid.checked))
    bottom.append(this.root)
    overlay.append(this.status)
    tools.append(this.gauge)
  }

  /** `buttons` follows the mode and the open panel, `shown` the mode alone;
   *  hiding the buttons ends a hold. */
  sync(model: ManeuverPanelModel | null, loading: boolean, buttons: boolean, shown: boolean): void {
    this.root.hidden = !buttons
    this.status.hidden = !shown
    this.gauge.hidden = !shown
    this.hold.setActive(buttons && !loading)
    this.hold.sync(model, loading)
    this.aid.disabled = loading || !model
    this.status.disabled = loading || !model
    if (!model) return
    this.aid.checked = model.aid
    const t = text().maneuvers
    const goals = model.goals
    const met: Readonly<Record<GoalKey, boolean>> = { distance: goals.distanceMet, shape: goals.shapeMet, period: goals.periodMet }
    for (const key of GOAL_KEYS) {
      const goal = this.status.querySelector<HTMLElement>(`[data-goal="${key}"]`)!
      goal.classList.toggle('is-met', met[key])
      goal.querySelector('.m-burn-goal-text')!.textContent = key === 'distance' && !met.distance ? format().km(goals.distanceKm, 0) : t.goalShort[key]
    }
    const left = 100 * model.remainingKmPerSecond / model.tankKmPerSecond
    this.gauge.querySelector<HTMLElement>('.m-fuel-fill')!.style.height = `${left.toFixed(1)}%`
    const meter = this.gauge.querySelector<HTMLElement>('.m-fuel-track')!
    meter.setAttribute('aria-valuenow', left.toFixed(0))
    meter.setAttribute('aria-valuetext', tankText(model))
    meter.title = tankText(model)
    const outcome = this.status.querySelector<HTMLElement>('.m-burn-outcome')!
    outcome.textContent = model.outcome === 'won' ? t.won : model.outcome === 'reentered' ? t.reentered : ''
    outcome.hidden = model.outcome === null
    this.status.dataset.outcome = model.outcome ?? ''
    this.status.classList.toggle('is-low', model.lowPeriapsis && model.outcome === null)
  }

  dispose(): void {
    this.hold.dispose()
    this.root.remove()
    this.status.remove()
    this.gauge.remove()
  }
}
