import { MAX_SIMULATION_INSTANT, MAX_SPEED_MULTIPLIER, MIN_SIMULATION_INSTANT } from '../core/constants.ts'
import { formatUtcDisplay, formatUtcInputValue, parseUtcInputValue } from '../core/timeFormat.ts'
import type { EnvironmentState } from '../simulation/environment.ts'
import type { AppState } from '../state/AppState.ts'
import type { UiCallbacks, ReadoutValues } from './uiTypes.ts'
import { sliderFromSpeed, speedFromSlider } from './uiFormat.ts'
import { samplingBandNote } from '../app/samplingPresentation.ts'
import { format, text } from '../i18n/index.ts'
import { html, trusted } from './markup.ts'
import { termLabelMarkup } from './termLabel.ts'
import { isLiveClock } from './liveClock.ts'
import type { ProductMode } from '../state/AppState.ts'
import { timePolicyFor } from './timePolicy.ts'

export const COMPACT_SPEED_CYCLE = timePolicyFor('orbitLab').cycle

export function nextCompactSpeed(current: number, cycle: readonly number[] = COMPACT_SPEED_CYCLE): number {
  const index = cycle.indexOf(current)
  return index < 0 ? cycle[0] : cycle[(index + 1) % cycle.length]
}

/** What moves a mode's objects as time runs. SGP4 objects are not animated
 *  by mean anomaly. */
function animationHintMarkup(mode: ProductMode): string {
  const t = text().time
  switch (mode) {
    case 'orbitLab': case 'maneuvers': case 'routePlanner': return termLabelMarkup(t.animationHint, 'meanAnomaly')
    case 'realObjects': return html`${t.animationHintRealObjects}`
  }
}

function compactSpeedLabel(value: number): string {
  return (text().time.speedSteps as Readonly<Record<number, string | undefined>>)[value] ?? format().speedMultiplier(value)
}

export class TimeControlsView {
  readonly root: HTMLElement
  private readonly callbacks: UiCallbacks
  private readonly playButton: HTMLButtonElement
  private readonly speedValue: HTMLElement
  private readonly compactTimeValue: HTMLOutputElement
  private readonly timeInput: HTMLInputElement
  /** Where the speed slider lives in a mode with no drawer. */
  private readonly compactSlider: HTMLInputElement
  private currentSpeed = 60
  private playing = true
  private mode: ProductMode = 'orbitLab'
  /** A burn holds the clock at 1×: no rate or play changes until release. */
  private locked = false
  private readonly liveBadge: HTMLElement
  private readonly goLiveButton: HTMLButtonElement

  constructor(container: HTMLElement, callbacks: UiCallbacks) {
    this.callbacks = callbacks
    this.root = container
    this.root.dataset.region = 'timeControls'
    const t = text().time
    const f = format()
    this.root.innerHTML = html`
      <div class="compact-drawer-bar time-compact-bar">
        <button id="time-drawer-toggle" class="drawer-toggle-button icon-button" type="button" aria-controls="time-drawer-content" aria-expanded="false" aria-label="${t.expand}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M8 3v4M16 3v4M4 9h16M8 13h3M13 13h3M8 16h3"></path></svg><span class="sr-only">${t.controls}</span></button>
        <output id="compact-time-value" class="compact-time-value" aria-label="${t.currentTime}">—</output>
        <span id="compact-live-badge" class="live-badge" title="${t.liveTitle}" hidden>${t.live}</span>
        <button id="compact-go-live" class="action-button compact-now-button" type="button" aria-label="${t.goLive}" title="${t.goLive}" hidden>${t.now}</button>
        <button id="play-button" class="action-button compact-playback-button icon-button" type="button" aria-label="${t.pauseSimulation}"><svg class="playback-symbol" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"></rect><rect x="13.5" y="5" width="4" height="14" rx="1"></rect></svg><span class="sr-only">${t.pause}</span></button>
        <button id="time-speed-cycle" class="action-button compact-speed-button" type="button">${t.speedSteps[60]}</button>
        <input id="compact-speed-slider" class="compact-speed-slider" type="range" min="0" max="100" step="0.1" value="${sliderFromSpeed(60, MAX_SPEED_MULTIPLIER)}" aria-label="${t.playbackSpeed}" title="${t.speedTitle}" />
      </div>
      <div id="time-drawer-content" class="drawer-content time-drawer-content" hidden>
        <div class="region-body compact-region-body time-controls-layout">
          <section class="time-cluster" aria-labelledby="time-clock-heading">
            <div class="region-kicker" id="time-clock-heading">${t.simulationTime}</div>
            <output id="sim-time-value" class="time-value"></output>
            <label class="time-input-label">${t.dateTimeUtc}
              <input id="sim-time-input" type="datetime-local" step="1" min="${formatUtcInputValue(MIN_SIMULATION_INSTANT)}" max="${formatUtcInputValue(MAX_SIMULATION_INSTANT)}" aria-label="${t.dateTimeUtc}" aria-describedby="time-range-note time-status" />
            </label>
            <div class="button-row"><button id="time-now" class="action-button" type="button">${t.now}</button><button id="time-reset" class="action-button" type="button">${t.reset}</button></div>
            <p id="time-range-note" class="time-note">${t.supportedRange}</p>
            <p id="time-status" class="time-note" role="status"></p>
          </section>
          <section class="time-cluster" aria-labelledby="time-animation-heading">
            <div class="region-kicker" id="time-animation-heading">${t.animation} <span class="group-hint" id="time-animation-hint">${trusted(animationHintMarkup('orbitLab'))}</span></div>
            <div class="speed-readout-row">${t.currentSpeed} <span class="speed-readout" id="speed-value">${f.speedMultiplier(60)}</span></div>
            <label class="toggle-row compact-toggle"><span>${t.reverse}</span><input id="reverse-toggle" type="checkbox" aria-label="${t.reversePlayback}" /><span class="toggle-ui" aria-hidden="true"></span></label>
            <label class="slider-row" title="${t.speedTitle}">
              <span class="slider-label"><span>${t.playbackSpeed}</span><output>${t.speedRange(f.speedMultiplier(MAX_SPEED_MULTIPLIER))}</output></span>
              <input id="speed-slider" type="range" min="0" max="100" step="0.1" value="${sliderFromSpeed(60, MAX_SPEED_MULTIPLIER)}" aria-label="${t.playbackSpeed}" />
            </label>
            <div class="button-row speed-steps" id="speed-steps"></div>
            <p class="time-note" id="sampling-note" role="status"></p>
          </section>
          <section class="time-cluster environment-cluster" aria-labelledby="time-environment-heading">
            <div class="region-kicker" id="time-environment-heading">${t.environment}</div>
            <div class="readout-grid compact-readouts"><span>${trusted(termLabelMarkup(t.subSolarPoint, 'subSolarPoint'))}</span><strong id="sub-solar-value">—</strong></div>
          </section>
        </div>
      </div>
    `
    this.playButton = this.root.querySelector<HTMLButtonElement>('#play-button')!
    this.speedValue = this.root.querySelector<HTMLElement>('#speed-value')!
    this.compactTimeValue = this.root.querySelector<HTMLOutputElement>('#compact-time-value')!
    this.timeInput = this.root.querySelector<HTMLInputElement>('#sim-time-input')!
    this.compactSlider = this.root.querySelector<HTMLInputElement>('#compact-speed-slider')!
    this.liveBadge = this.root.querySelector<HTMLElement>('#compact-live-badge')!
    this.goLiveButton = this.root.querySelector<HTMLButtonElement>('#compact-go-live')!
    this.goLiveButton.addEventListener('click', () => this.callbacks.onGoLive())
    this.renderSteps()
    this.root.querySelector('#time-drawer-toggle')!.addEventListener('click', () => this.callbacks.onToggleTimeDrawer())
    this.root.querySelector('#time-speed-cycle')!.addEventListener('click', () => this.callbacks.onSpeedChange(nextCompactSpeed(this.currentSpeed, timePolicyFor(this.mode).cycle)))
    this.bindEvents()
  }

  sync(simulation: AppState['simulation'], loading: boolean, drawerOpen: boolean, mode: ProductMode = this.mode): void {
    const t = text().time
    if (mode !== this.mode) {
      this.mode = mode
      this.root.querySelector('#time-animation-hint')!.innerHTML = animationHintMarkup(mode)
      this.renderSteps()
    }
    this.goLiveButton.disabled = loading
    this.currentSpeed = simulation.speedMultiplier
    this.playing = simulation.playing
    this.root.toggleAttribute('aria-busy', loading)
    // A drawer left open in another mode stays closed here and returns with it.
    const expanded = drawerOpen && timePolicyFor(mode).travel
    this.root.classList.toggle('is-expanded', expanded)
    const toggle = this.root.querySelector<HTMLButtonElement>('#time-drawer-toggle')!
    toggle.setAttribute('aria-expanded', String(expanded))
    toggle.setAttribute('aria-label', expanded ? t.collapse : t.expand)
    this.root.querySelector<HTMLElement>('#time-drawer-content')!.hidden = !expanded
    this.playButton.innerHTML = simulation.playing
      ? html`<svg class="playback-symbol" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"></rect><rect x="13.5" y="5" width="4" height="14" rx="1"></rect></svg><span class="sr-only">${t.pause}</span>`
      : html`<svg class="playback-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.75 19 12 7 19.25Z"></path></svg><span class="sr-only">${t.play}</span>`
    this.playButton.setAttribute('aria-label', simulation.playing ? t.pauseSimulation : t.playSimulation)
    this.root.querySelector<HTMLInputElement>('#reverse-toggle')!.checked = simulation.reversed
    this.speedValue.textContent = format().speedMultiplier(simulation.speedMultiplier)
    const speedCycle = this.root.querySelector<HTMLButtonElement>('#time-speed-cycle')!
    speedCycle.textContent = compactSpeedLabel(simulation.speedMultiplier)
    speedCycle.setAttribute('aria-label', t.speedCycle(compactSpeedLabel(simulation.speedMultiplier), compactSpeedLabel(nextCompactSpeed(simulation.speedMultiplier, timePolicyFor(this.mode).cycle))))
    for (const slider of this.root.querySelectorAll<HTMLInputElement>('#speed-slider, #compact-speed-slider')) {
      if (this.root.ownerDocument.activeElement !== slider) slider.value = String(sliderFromSpeed(simulation.speedMultiplier, MAX_SPEED_MULTIPLIER))
    }
    if (!loading) this.applyPolicy()
  }

  /** Locks the rate and play controls while a burn holds the clock. */
  setLocked(locked: boolean): void {
    if (locked === this.locked) return
    this.locked = locked
    if (!this.root.hasAttribute('aria-busy')) this.applyPolicy()
  }

  private applyPolicy(): void {
    const policy = timePolicyFor(this.mode)
    for (const selector of ['#sim-time-input', '#time-now', '#time-reset', '#reverse-toggle']) this.root.querySelector<HTMLInputElement | HTMLButtonElement>(selector)!.disabled = !policy.travel
    for (const control of this.root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#play-button, #time-speed-cycle, #speed-slider, #compact-speed-slider, #speed-steps button')) control.disabled = this.locked
  }

  private renderSteps(): void {
    const t = text().time
    const row = this.root.querySelector<HTMLElement>('#speed-steps')!
    row.textContent = ''
    for (const step of timePolicyFor(this.mode).steps) {
      const button = this.root.ownerDocument.createElement('button')
      const label = compactSpeedLabel(step)
      button.type = 'button'
      button.className = 'action-button'
      button.textContent = label
      button.setAttribute('aria-label', t.setSpeed(label))
      button.disabled = this.locked
      button.addEventListener('click', () => this.callbacks.onSpeedChange(step))
      row.append(button)
    }
  }

  updateReadouts(values: ReadoutValues | null, environment: EnvironmentState, simulation: AppState['simulation']): void {
    const currentTime = formatUtcDisplay(environment.instant)
    this.root.querySelector('#sim-time-value')!.textContent = currentTime
    this.compactTimeValue.textContent = currentTime
    if (this.root.ownerDocument.activeElement !== this.timeInput) this.timeInput.value = formatUtcInputValue(environment.instant)
    const point = environment.subSolarPoint
    const f = format()
    const latitudeDeg = point.latitudeRad * 180 / Math.PI
    const longitudeDeg = point.longitudeRad * 180 / Math.PI
    // The sub-solar readout always names both hemispheres, even at zero.
    this.root.querySelector('#sub-solar-value')!.textContent = text().time.subSolarValue(f.number(Math.abs(latitudeDeg), 1), latitudeDeg < 0 ? text().units.south : text().units.north, f.number(Math.abs(longitudeDeg), 1), longitudeDeg < 0 ? text().units.west : text().units.east)
    const atLimit = simulation.reversed ? environment.instant.unixSeconds === MIN_SIMULATION_INSTANT.unixSeconds : environment.instant.unixSeconds === MAX_SIMULATION_INSTANT.unixSeconds
    if (this.root.ownerDocument.activeElement !== this.timeInput) this.root.querySelector('#time-status')!.textContent = !simulation.playing && atLimit ? text().time.limitReached : ''
    this.root.querySelector('#sampling-note')!.textContent = values ? samplingBandNote(values.samplingBand) : ''
    // Real Objects shows whether the clock follows real time.
    const realObjects = this.mode === 'realObjects'
    const live = isLiveClock(simulation, environment.instant.unixSeconds, Date.now() / 1000)
    this.liveBadge.hidden = !realObjects || !live
    this.goLiveButton.hidden = !realObjects || live
  }

  setLoading(loading: boolean): void { this.root.toggleAttribute('aria-busy', loading) }

  private bindEvents(): void {
    this.timeInput.addEventListener('change', () => {
      const instant = parseUtcInputValue(this.timeInput.value)
      if (!instant || !this.timeInput.validity.valid) {
        this.root.querySelector('#time-status')!.textContent = text().time.invalidInput
        return
      }
      this.root.querySelector('#time-status')!.textContent = ''
      this.callbacks.onInstantChange(instant)
    })
    this.root.querySelector('#time-now')!.addEventListener('click', () => this.callbacks.onNow())
    this.root.querySelector('#time-reset')!.addEventListener('click', () => this.callbacks.onReset())
    this.root.querySelector<HTMLInputElement>('#reverse-toggle')!.addEventListener('change', (event) => this.callbacks.onReversedChange((event.currentTarget as HTMLInputElement).checked))
    this.playButton.addEventListener('click', () => this.callbacks.onPlayingChange(!this.playing))
    for (const slider of this.root.querySelectorAll<HTMLInputElement>('#speed-slider, #compact-speed-slider')) slider.addEventListener('input', () => this.callbacks.onSpeedChange(speedFromSlider(Number(slider.value), MAX_SPEED_MULTIPLIER)))
    // A focused input keeps the burn keys from firing: dragging the slider
    // must not leave them dead.
    this.compactSlider.addEventListener('pointerup', () => this.compactSlider.blur())
  }
}
