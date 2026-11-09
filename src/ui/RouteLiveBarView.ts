import { ROUTE_LIVE_RATES } from '../app/RoutePlannerController.ts'
import { formatUtcDisplay } from '../core/timeFormat.ts'
import { format, text } from '../i18n/index.ts'
import { html, trusted } from './markup.ts'
import type { RoutePanelModel } from './routePanelModel.ts'
import { nextCompactSpeed } from './TimeControlsView.ts'
import type { UiCallbacks } from './uiTypes.ts'

const PAUSE_SYMBOL = '<svg class="playback-symbol" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"></rect><rect x="13.5" y="5" width="4" height="14" rx="1"></rect></svg>'
const PLAY_SYMBOL = '<svg class="playback-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.75 19 12 7 19.25Z"></path></svg>'

function rateLabel(rate: number): string {
  return (text().time.speedSteps as Readonly<Record<number, string | undefined>>)[rate] ?? format().speedMultiplier(rate)
}

/** The live scene's clock, at the bottom left where the other modes keep
 *  theirs: the scene's time, play and pause, and its speed. */
export class RouteLiveBarView {
  readonly root: HTMLElement
  private readonly time: HTMLOutputElement
  private readonly play: HTMLButtonElement
  private readonly speed: HTMLButtonElement
  private playing = true
  private rate = ROUTE_LIVE_RATES[0]!

  constructor(container: HTMLElement, callbacks: Pick<UiCallbacks, 'onRouteLiveToggle' | 'onRouteLiveRate'>) {
    this.root = container
    this.root.dataset.region = 'routeLiveBar'
    const t = text().time
    this.root.innerHTML = html`
      <div class="compact-drawer-bar time-compact-bar">
        <output id="route-live-time" class="compact-time-value" aria-label="${t.currentTime}">—</output>
        <button id="route-live-play" class="action-button compact-playback-button icon-button" type="button"></button>
        <button id="route-live-speed" class="action-button compact-speed-button" type="button"></button>
      </div>
    `
    this.time = this.root.querySelector<HTMLOutputElement>('#route-live-time')!
    this.play = this.root.querySelector<HTMLButtonElement>('#route-live-play')!
    this.speed = this.root.querySelector<HTMLButtonElement>('#route-live-speed')!
    this.play.addEventListener('click', () => callbacks.onRouteLiveToggle())
    this.speed.addEventListener('click', () => callbacks.onRouteLiveRate(nextCompactSpeed(this.rate, ROUTE_LIVE_RATES)))
  }

  /** Shown with the live scene; playback has its own bar. */
  sync(model: RoutePanelModel | null, active: boolean, loading: boolean): void {
    this.root.hidden = !active || model === null || model.view !== 'live'
    this.play.disabled = loading || model === null
    this.speed.disabled = loading || model === null
    if (!model) return
    const t = text().time
    this.time.textContent = formatUtcDisplay(model.live.instant)
    if (model.live.playing !== this.playing || !this.play.hasChildNodes()) {
      this.playing = model.live.playing
      this.play.innerHTML = html`${trusted(this.playing ? PAUSE_SYMBOL : PLAY_SYMBOL)}<span class="sr-only">${this.playing ? t.pause : t.play}</span>`
      this.play.setAttribute('aria-label', this.playing ? t.pauseSimulation : t.playSimulation)
    }
    this.rate = model.live.rate
    const current = rateLabel(this.rate)
    this.speed.textContent = current
    this.speed.setAttribute('aria-label', t.speedCycle(current, rateLabel(nextCompactSpeed(this.rate, ROUTE_LIVE_RATES))))
  }

  dispose(): void { this.root.textContent = '' }
}
