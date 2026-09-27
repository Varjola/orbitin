import type { SimulationInstant } from '../core/time.ts'
import { formatUtcInputValue } from '../core/timeFormat.ts'
import type { AppState, ProductMode } from '../state/AppState.ts'
import { format, text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'
import { icon } from './mobileIcons.ts'

/** The dock's speed pill cycles every existing step. */
export const MOBILE_SPEED_CYCLE = [1, 60, 600, 3600] as const
type SpeedStep = (typeof MOBILE_SPEED_CYCLE)[number]

export function nextMobileSpeed(current: number): number {
  const index = MOBILE_SPEED_CYCLE.indexOf(current as SpeedStep)
  return index < 0 ? MOBILE_SPEED_CYCLE[0] : MOBILE_SPEED_CYCLE[(index + 1) % MOBILE_SPEED_CYCLE.length]
}

export function mobileSpeedLabel(value: number): string {
  const steps = text().time.speedSteps
  return (MOBILE_SPEED_CYCLE as readonly number[]).includes(value) ? steps[value as SpeedStep] : format().speedMultiplier(value)
}

/** Hours and minutes of a UTC instant, truncated to the minute ("12:04"). */
export function mobileClockTime(instant: SimulationInstant): string {
  const secondsOfDay = ((instant.unixSeconds % 86_400) + 86_400) % 86_400
  return format().solarTime(Math.floor(secondsOfDay / 60) / 60)
}

/** The UTC date in ISO order, which reads the same in both languages. */
export function mobileClockDate(instant: SimulationInstant): string {
  return formatUtcInputValue(instant).slice(0, 10)
}

export interface MobileDockCallbacks {
  onPlayingChange(playing: boolean): void
  onSpeedChange(speedMultiplier: number): void
  onTime(): void
  onNewOrbit(): void
  onEdit(): void
  onAdd(): void
}

export function mobileDockMarkup(): string {
  const t = text().mobile
  const time = text().time
  return html`
    <div class="m-dock-time">
      <button class="m-icon-button m-play" type="button" aria-label="${time.pauseSimulation}">${trusted(icon('pause'))}</button>
      <button class="m-pill m-speed" type="button">${time.speedSteps[60]}</button>
      <button class="m-time" type="button" aria-haspopup="true" aria-expanded="false"><span class="m-time-clock"></span><span class="m-time-meta"><span class="m-time-date"></span><span class="m-live" hidden>${time.live}</span></span></button>
    </div>
    <div class="m-dock-actions" data-mode="orbitLab">
      <button class="m-icon-button m-new" type="button" aria-label="${t.dock.newOrbitName}">${trusted(icon('plus'))}</button>
      <button class="m-dock-button m-edit" type="button" aria-pressed="false" aria-label="${t.dock.editName}">${trusted(icon('edit'))}<span>${t.dock.edit}</span></button>
    </div>
    <div class="m-dock-actions" data-mode="realObjects">
      <button class="m-dock-button m-add" type="button" aria-label="${t.dock.addName}">${trusted(icon('plus'))}<span>${t.dock.add}</span></button>
    </div>
  `
}

/** Play/pause, the speed pill and the time label on
 *  the left; the mode's actions on the right. */
export class MobileDockView {
  readonly root: HTMLElement
  readonly timeButton: HTMLButtonElement
  readonly newButton: HTMLButtonElement
  readonly addButton: HTMLButtonElement
  private readonly playButton: HTMLButtonElement
  private readonly speedButton: HTMLButtonElement
  private readonly editButton: HTMLButtonElement
  private readonly clock: HTMLElement
  private readonly date: HTMLElement
  private readonly actions: readonly HTMLElement[]
  private playing = true
  private speed = 60
  private lastClock = ''

  constructor(container: HTMLElement, callbacks: MobileDockCallbacks) {
    this.root = container.ownerDocument.createElement('nav')
    this.root.className = 'm-dock'
    this.root.setAttribute('aria-label', text().mobile.controls)
    this.root.innerHTML = mobileDockMarkup()
    const find = <T extends HTMLElement>(selector: string): T => this.root.querySelector<T>(selector)!
    this.playButton = find('.m-play')
    this.speedButton = find('.m-speed')
    this.timeButton = find('.m-time')
    this.newButton = find('.m-new')
    this.editButton = find('.m-edit')
    this.addButton = find('.m-add')
    this.clock = find('.m-time-clock')
    this.date = find('.m-time-date')
    this.actions = [...this.root.querySelectorAll<HTMLElement>('.m-dock-actions')]
    this.playButton.addEventListener('click', () => callbacks.onPlayingChange(!this.playing))
    this.speedButton.addEventListener('click', () => callbacks.onSpeedChange(nextMobileSpeed(this.speed)))
    this.timeButton.addEventListener('click', () => callbacks.onTime())
    this.newButton.addEventListener('click', () => callbacks.onNewOrbit())
    this.editButton.addEventListener('click', () => callbacks.onEdit())
    this.addButton.addEventListener('click', () => callbacks.onAdd())
    container.append(this.root)
  }

  sync(input: { readonly simulation: AppState['simulation']; readonly mode: ProductMode; readonly loading: boolean; readonly timeOpen: boolean; readonly shapeOpen: boolean; readonly newOrbitOpen: boolean; readonly addOpen: boolean }): void {
    const t = text().time
    const { simulation } = input
    this.playing = simulation.playing
    this.speed = simulation.speedMultiplier
    this.playButton.innerHTML = icon(simulation.playing ? 'pause' : 'play')
    this.playButton.setAttribute('aria-label', simulation.playing ? t.pauseSimulation : t.playSimulation)
    const current = mobileSpeedLabel(simulation.speedMultiplier)
    this.speedButton.textContent = current
    this.speedButton.setAttribute('aria-label', t.speedCycle(current, mobileSpeedLabel(nextMobileSpeed(simulation.speedMultiplier))))
    this.timeButton.setAttribute('aria-expanded', String(input.timeOpen))
    for (const group of this.actions) group.hidden = group.dataset.mode !== input.mode
    this.editButton.setAttribute('aria-pressed', String(input.shapeOpen))
    this.newButton.setAttribute('aria-expanded', String(input.newOrbitOpen))
    this.addButton.setAttribute('aria-expanded', String(input.addOpen))
    for (const button of [this.playButton, this.speedButton, this.timeButton, this.editButton, this.addButton]) button.disabled = input.loading
    this.newButton.disabled = input.loading
    this.updateTime(simulation.currentInstant)
  }

  /** Called with the readouts; text changes only once a minute. */
  updateTime(instant: SimulationInstant): void {
    const clock = text().mobile.time.clock(mobileClockTime(instant))
    const date = mobileClockDate(instant)
    const label = `${date} ${clock}`
    if (label === this.lastClock) return
    this.lastClock = label
    this.clock.textContent = clock
    this.date.textContent = date
    this.timeButton.setAttribute('aria-label', text().mobile.dock.timeName(label))
  }

  /** The Live badge while Real Objects follows real time. */
  setLive(live: boolean): void {
    const badge = this.timeButton.querySelector<HTMLElement>('.m-live')!
    if (badge.hidden === !live) return
    badge.hidden = !live
    this.timeButton.classList.toggle('is-live', live)
  }

  /** Focus returns here when Escape closes the Shape strip. */
  focusEdit(): void { this.editButton.focus({ preventScroll: true }) }

  dispose(): void { this.root.remove() }
}
