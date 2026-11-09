import type { SimulationInstant } from '../core/time.ts'
import { formatUtcInputValue } from '../core/timeFormat.ts'
import type { AppState, ProductMode } from '../state/AppState.ts'
import { format, text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'
import { icon } from './mobileIcons.ts'
import { timePolicyFor } from '../ui/timePolicy.ts'
import type { RoutePanelModel } from '../ui/routePanelModel.ts'

/** The dock's speed pill cycles every existing step in the scene modes and the
 *  Route Planner's live scene (the same steps as its desktop bar); Interception
 *  cycles its own steps and never reaches 1×. */
export const MOBILE_SPEED_CYCLE = [1, 60, 600, 3600] as const

export function mobileSpeedCycle(mode: ProductMode): readonly number[] {
  return mode === 'maneuvers' ? timePolicyFor(mode).cycle : MOBILE_SPEED_CYCLE
}

export function nextMobileSpeed(current: number, cycle: readonly number[] = MOBILE_SPEED_CYCLE): number {
  const index = cycle.indexOf(current)
  return index < 0 ? cycle[0] : cycle[(index + 1) % cycle.length]
}

export function mobileSpeedLabel(value: number): string {
  return (text().time.speedSteps as Readonly<Record<number, string | undefined>>)[value] ?? format().speedMultiplier(value)
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
  onGame(): void
  onRouteEdit(): void
  onRoutePlan(): void
}

export function mobileDockMarkup(): string {
  const t = text().mobile
  const time = text().time
  return html`
    <div class="m-dock-time">
      <button class="m-icon-button m-play" type="button" aria-label="${time.pauseSimulation}">${trusted(icon('pause'))}</button>
      <button class="m-pill m-speed" type="button">${time.speedSteps[60]}</button>
      <button class="m-time" type="button" aria-haspopup="true" aria-expanded="false"><span class="m-time-clock"></span><span class="m-time-meta"><span class="m-time-date"></span><span class="m-live-badge" hidden>${time.live}</span></span></button>
    </div>
    <div class="m-dock-actions" data-mode="orbitLab">
      <button class="m-icon-button m-new" type="button" aria-label="${t.dock.newOrbitName}">${trusted(icon('plus'))}</button>
      <button class="m-dock-button m-edit" type="button" aria-pressed="false" aria-label="${t.dock.editName}">${trusted(icon('edit'))}<span>${t.dock.edit}</span></button>
    </div>
    <div class="m-dock-actions" data-mode="maneuvers">
      <button class="m-dock-button m-dock-game" type="button" aria-haspopup="true" aria-expanded="false" aria-label="${t.dock.gameName}">${trusted(icon('list'))}<span>${t.dock.game}</span></button>
    </div>
    <div class="m-dock-actions" data-mode="routePlanner">
      <button class="m-dock-button m-route-edit" type="button" aria-pressed="false" aria-label="${t.route.editName}">${trusted(icon('edit'))}<span>${t.route.edit}</span></button>
      <button class="m-dock-button is-primary m-route-plan" type="button" aria-haspopup="dialog" aria-label="${t.route.planName}">${trusted(icon('route'))}<span>${t.route.plan}</span></button>
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
  readonly gameButton: HTMLButtonElement
  readonly routeEditButton: HTMLButtonElement
  readonly routePlanButton: HTMLButtonElement
  private readonly playButton: HTMLButtonElement
  private readonly speedButton: HTMLButtonElement
  private readonly editButton: HTMLButtonElement
  private readonly clock: HTMLElement
  private readonly date: HTMLElement
  private readonly actions: readonly HTMLElement[]
  private playing = true
  private speed = 60
  private mode: ProductMode = 'orbitLab'
  /** A burn holds the clock: play and speed wait for its release. */
  private locked = false
  private loading = true
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
    this.gameButton = find('.m-dock-game')
    this.routeEditButton = find('.m-route-edit')
    this.routePlanButton = find('.m-route-plan')
    this.clock = find('.m-time-clock')
    this.date = find('.m-time-date')
    this.actions = [...this.root.querySelectorAll<HTMLElement>('.m-dock-actions')]
    this.playButton.addEventListener('click', () => callbacks.onPlayingChange(!this.playing))
    this.speedButton.addEventListener('click', () => callbacks.onSpeedChange(nextMobileSpeed(this.speed, mobileSpeedCycle(this.mode))))
    this.timeButton.addEventListener('click', () => callbacks.onTime())
    this.newButton.addEventListener('click', () => callbacks.onNewOrbit())
    this.editButton.addEventListener('click', () => callbacks.onEdit())
    this.addButton.addEventListener('click', () => callbacks.onAdd())
    this.gameButton.addEventListener('click', () => callbacks.onGame())
    this.routeEditButton.addEventListener('click', () => callbacks.onRouteEdit())
    this.routePlanButton.addEventListener('click', () => callbacks.onRoutePlan())
    container.append(this.root)
  }

  /** In the Route Planner `route` is its live scene's clock, which play and the
   *  speed pill run; the time reads as on the desktop and opens nothing. */
  sync(input: { readonly simulation: AppState['simulation']; readonly mode: ProductMode; readonly loading: boolean; readonly timeOpen: boolean; readonly shapeOpen: boolean; readonly newOrbitOpen: boolean; readonly addOpen: boolean; readonly gameOpen?: boolean; readonly route?: RoutePanelModel['live'] | null; readonly routeBlocked?: boolean; readonly routeEditOpen?: boolean }): void {
    const t = text().time
    const { simulation } = input
    const route = input.mode === 'routePlanner' ? input.route ?? null : null
    this.playing = route ? route.playing : simulation.playing
    this.speed = route ? route.rate : simulation.speedMultiplier
    this.mode = input.mode
    this.loading = input.loading
    this.root.dataset.mode = input.mode
    this.playButton.innerHTML = icon(this.playing ? 'pause' : 'play')
    this.playButton.setAttribute('aria-label', this.playing ? t.pauseSimulation : t.playSimulation)
    const current = mobileSpeedLabel(this.speed)
    this.speedButton.textContent = current
    this.speedButton.setAttribute('aria-label', t.speedCycle(current, mobileSpeedLabel(nextMobileSpeed(this.speed, mobileSpeedCycle(input.mode)))))
    this.timeButton.setAttribute('aria-expanded', String(input.timeOpen))
    for (const group of this.actions) group.hidden = group.dataset.mode !== input.mode
    this.editButton.setAttribute('aria-pressed', String(input.shapeOpen))
    this.newButton.setAttribute('aria-expanded', String(input.newOrbitOpen))
    this.addButton.setAttribute('aria-expanded', String(input.addOpen))
    this.gameButton.setAttribute('aria-expanded', String(input.gameOpen ?? false))
    this.routeEditButton.setAttribute('aria-pressed', String(input.routeEditOpen ?? false))
    for (const button of [this.timeButton, this.editButton, this.addButton, this.gameButton]) button.disabled = input.loading
    this.routeEditButton.disabled = input.loading || route === null
    this.routePlanButton.disabled = input.loading || route === null || input.routeBlocked === true
    if (input.mode === 'routePlanner') this.timeButton.disabled = true
    this.applyLock()
    this.newButton.disabled = input.loading
    this.updateTime(route ? route.instant : simulation.currentInstant)
  }

  /** Called with the readouts; text changes only once a minute. */
  updateTime(instant: SimulationInstant): void {
    const clock = text().mobile.time.clock(mobileClockTime(instant))
    const date = mobileClockDate(instant)
    const label = `${date} ${clock}`
    const key = `${this.mode === 'routePlanner'}|${label}`
    if (key === this.lastClock) return
    this.lastClock = key
    this.clock.textContent = clock
    this.date.textContent = date
    // The Route Planner's time opens nothing: its name is the time alone.
    this.timeButton.setAttribute('aria-label', this.mode === 'routePlanner' ? `${text().time.currentTime} ${label}` : text().mobile.dock.timeName(label))
  }

  /** The Live badge while Real Objects follows real time. */
  setLive(live: boolean): void {
    const badge = this.timeButton.querySelector<HTMLElement>('.m-live-badge')!
    if (badge.hidden === !live) return
    badge.hidden = !live
    this.timeButton.classList.toggle('is-live', live)
  }

  setLocked(locked: boolean): void {
    if (locked === this.locked) return
    this.locked = locked
    this.applyLock()
  }

  private applyLock(): void {
    for (const button of [this.playButton, this.speedButton]) button.disabled = this.loading || this.locked
  }

  /** Focus returns here when Escape closes the Shape strip. */
  focusEdit(): void { this.editButton.focus({ preventScroll: true }) }

  dispose(): void { this.root.remove() }
}
