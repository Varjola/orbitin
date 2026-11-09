import { MAX_SIMULATION_INSTANT, MAX_SPEED_MULTIPLIER, MIN_SIMULATION_INSTANT } from '../core/constants.ts'
import { formatUtcInputValue, parseUtcInputValue } from '../core/timeFormat.ts'
import type { SimulationInstant } from '../core/time.ts'
import type { AppState, ProductMode } from '../state/AppState.ts'
import { timePolicyFor } from '../ui/timePolicy.ts'
import { format, text } from '../i18n/index.ts'
import { html } from '../ui/markup.ts'
import { sliderFromSpeed, speedFromSlider } from '../ui/uiFormat.ts'
import type { UiCallbacks } from '../ui/uiTypes.ts'
import { mobileId } from './PanelHost.ts'

type TimeCallbacks = Pick<UiCallbacks, 'onInstantChange' | 'onNow' | 'onReset' | 'onReversedChange' | 'onSpeedChange'>

export function timePanelMarkup(ids: { readonly status: string; readonly faded: string }): string {
  const t = text().mobile.time
  const time = text().time
  return html`
    <div class="m-time-travel">
      <label class="m-field">
        <span class="m-field-label">${time.dateTimeUtc}</span>
        <input class="m-time-input" type="datetime-local" step="1" min="${formatUtcInputValue(MIN_SIMULATION_INSTANT)}" max="${formatUtcInputValue(MAX_SIMULATION_INSTANT)}" aria-describedby="${ids.status}" />
      </label>
      <p class="m-line m-time-status" id="${ids.status}" role="status"></p>
      <div class="m-button-row">
        <button class="m-button m-time-now" type="button">${t.now}</button>
        <button class="m-button m-time-reset" type="button" aria-label="${t.resetName}">${t.reset}</button>
        <label class="m-switch"><input class="m-time-reverse" type="checkbox" role="switch" /><span class="m-switch-track" aria-hidden="true"></span><span class="m-switch-label">${t.reverse}</span></label>
      </div>
      <p class="m-line m-time-faded" id="${ids.faded}" hidden>${t.faded}</p>
    </div>
    <label class="m-field m-time-speed" hidden>
      <span class="m-field-label">${time.playbackSpeed} <output class="m-time-speed-value"></output></span>
      <input class="m-time-speed-slider" type="range" min="0" max="100" step="0.1" />
    </label>
  `
}

/** The native date-and-time field in UTC with the existing range and
 *  validation, Now, Reset and Reverse. A game runs only forward, so in
 *  Interception the panel is the speed slider instead. Elsewhere the speed
 *  slider and the sub-solar point stay on desktop. */
export class TimePanelView {
  readonly root: HTMLElement
  private readonly input: HTMLInputElement
  private readonly status: HTMLElement
  private readonly reverse: HTMLInputElement
  private readonly faded: HTMLElement
  private readonly speedSlider: HTMLInputElement

  constructor(documentRef: Document, callbacks: TimeCallbacks) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-time-panel'
    this.root.innerHTML = timePanelMarkup({ status: mobileId('clock-status'), faded: mobileId('clock-faded') })
    this.input = this.root.querySelector<HTMLInputElement>('.m-time-input')!
    this.status = this.root.querySelector<HTMLElement>('.m-time-status')!
    this.reverse = this.root.querySelector<HTMLInputElement>('.m-time-reverse')!
    this.faded = this.root.querySelector<HTMLElement>('.m-time-faded')!
    this.speedSlider = this.root.querySelector<HTMLInputElement>('.m-time-speed-slider')!
    this.speedSlider.addEventListener('input', () => callbacks.onSpeedChange(speedFromSlider(Number(this.speedSlider.value), MAX_SPEED_MULTIPLIER)))
    this.input.addEventListener('change', () => {
      const instant = parseUtcInputValue(this.input.value)
      if (!instant || !this.input.validity.valid) { this.status.textContent = text().time.invalidInput; return }
      this.status.textContent = ''
      callbacks.onInstantChange(instant)
    })
    this.root.querySelector('.m-time-now')!.addEventListener('click', () => callbacks.onNow())
    this.root.querySelector('.m-time-reset')!.addEventListener('click', () => callbacks.onReset())
    this.reverse.addEventListener('change', () => callbacks.onReversedChange(this.reverse.checked))
  }

  sync(simulation: AppState['simulation'], loading: boolean, mode: ProductMode = 'orbitLab'): void {
    const travel = timePolicyFor(mode).travel
    this.reverse.checked = simulation.reversed
    for (const control of this.root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) control.disabled = loading
    this.root.querySelector<HTMLElement>('.m-time-travel')!.hidden = !travel
    this.root.querySelector<HTMLElement>('.m-time-speed')!.hidden = travel
    this.root.querySelector('.m-time-speed-value')!.textContent = format().speedMultiplier(simulation.speedMultiplier)
    if (this.root.ownerDocument.activeElement !== this.speedSlider) this.speedSlider.value = String(sliderFromSpeed(simulation.speedMultiplier, MAX_SPEED_MULTIPLIER))
  }

  update(instant: SimulationInstant, simulation: AppState['simulation'], markerFaded: boolean): void {
    if (this.root.ownerDocument.activeElement !== this.input) {
      this.input.value = formatUtcInputValue(instant)
      const atLimit = simulation.reversed ? instant.unixSeconds === MIN_SIMULATION_INSTANT.unixSeconds : instant.unixSeconds === MAX_SIMULATION_INSTANT.unixSeconds
      this.status.textContent = !simulation.playing && atLimit ? text().time.limitReached : ''
    }
    this.faded.hidden = !markerFaded
  }
}
