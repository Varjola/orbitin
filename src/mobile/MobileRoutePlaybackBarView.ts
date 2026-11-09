import { format, text } from '../i18n/index.ts'
import type { RouteTimelineSegment } from '../simulation/route/routeTimeline.ts'
import type { RouteProfile } from '../simulation/route/routeDrawing.ts'
import { html, trusted } from '../ui/markup.ts'
import type { RoutePlaybackModel, RouteShownModel } from '../ui/routePanelModel.ts'
import { profileMarkup } from '../ui/routeResultMarkup.ts'
import { burnChangeLines, burnDirectionText, spanText } from '../ui/routeWording.ts'
import { icon } from './mobileIcons.ts'

const TIMELINE_STEPS = 1000
const DAY = 86_400

export interface RoutePlaybackBarCallbacks {
  onPlayToggle(): void
  onBurnStep(direction: 1 | -1): void
  onSeek(tau: number): void
  onDetails(burnIndex: number | null): void
  onExit(): void
}

/** The burn the caption speaks of: the one held, else the next one; null once past
 *  the last. Burns are numbered from 0. */
export function captionBurn(playback: Pick<RoutePlaybackModel, 'burnNumber' | 'seconds'>, burns: readonly { readonly atSeconds: number }[]): { readonly index: number; readonly held: boolean } | null {
  if (playback.burnNumber !== null) return { index: playback.burnNumber - 1, held: true }
  const index = burns.findIndex((burn) => burn.atSeconds > playback.seconds)
  return index < 0 ? null : { index, held: false }
}

/** The caption's two lines for a route at a moment of its playback. */
export function captionLines(playback: Pick<RoutePlaybackModel, 'burnNumber' | 'seconds'>, shown: Pick<RouteShownModel, 'burns'>): { readonly number: string; readonly head: string; readonly line: string; readonly held: boolean; readonly index: number | null } {
  const t = text().mobile.route
  const burn = captionBurn(playback, shown.burns)
  if (burn === null) return { number: '', head: text().routePlanner.planning.arrival, line: '', held: false, index: null }
  const row = shown.burns[burn.index]!
  const name = t.burnOf(burn.index + 1, shown.burns.length)
  return { number: String(burn.index + 1), head: `${burn.held ? name : t.nextBurn(name)} · ${burnDirectionText(row)}`, line: burnChangeLines(row).join(' · '), held: burn.held, index: burn.index }
}

function rateText(rate: number): string {
  return format().speedMultiplier(Number(rate.toPrecision(2)))
}

/** What the readout says: how far into the route, and how fast or that a burn holds. */
export function playbackReadout(model: RoutePlaybackModel): { readonly elapsed: string; readonly rate: string } {
  const t = text().routePlanner.playback
  const elapsed = model.drifting ? t.day(Math.floor(model.seconds / DAY) + 1) : text().routePlanner.afterStart(spanText(model.seconds))
  const pace = model.burnNumber !== null ? t.burnHeld(model.burnNumber) : model.drifting ? t.earthHeld(rateText(model.rate)) : rateText(model.rate)
  return { elapsed, rate: model.followHeld ? `${pace} · ${t.followHeld}` : pace }
}

function trackMarkup(segments: readonly RouteTimelineSegment[], durationTau: number): string {
  if (!(durationTau > 0)) return ''
  return segments.map((segment) => {
    const left = (100 * segment.fromTau) / durationTau
    const width = (100 * (segment.toTau - segment.fromTau)) / durationTau
    return html`<span class="route-track-${segment.kind}" style="left: ${left.toFixed(3)}%; width: ${width.toFixed(3)}%">${segment.burnIndex === null ? '' : String(segment.burnIndex + 1)}</span>`
  }).join('')
}

export function routePlaybackBarMarkup(): string {
  const t = text().routePlanner.playback
  const m = text().mobile.route
  return html`
    <div class="m-route-bar-row">
      <button class="m-icon-button m-route-previous" type="button" aria-label="${t.previousBurn}">${trusted(icon('previous'))}</button>
      <button class="m-icon-button m-route-play" type="button" aria-label="${t.play}">${trusted(icon('play'))}</button>
      <button class="m-icon-button m-route-next" type="button" aria-label="${t.nextBurn}">${trusted(icon('next'))}</button>
      <p class="m-route-readout"><strong class="m-route-elapsed"></strong><span class="m-route-rate"></span></p>
      <button class="m-dock-button m-route-details" type="button" aria-haspopup="dialog" aria-label="${m.routeName}">${trusted(icon('list'))}<span>${m.route}</span></button>
      <button class="m-icon-button m-route-exit" type="button" aria-haspopup="dialog" aria-label="${t.exit}" title="${t.exitTitle}">${trusted(icon('stop'))}</button>
    </div>
    <div class="route-profile-plot m-route-profile" aria-hidden="true"></div>
    <div class="m-route-track">
      <div class="m-route-segments" aria-hidden="true"></div>
      <input class="m-route-timeline" type="range" min="0" max="${String(TIMELINE_STEPS)}" step="1" value="0" aria-label="${t.timeline}" />
    </div>
  `
}

/** Playback on a phone: in place of the dock, a bar of previous burn, play, next
 *  burn, the time and rate, Route (the details) and Exit; under it the profile and the
 *  timeline, both full width and in playback time, the timeline being the scrub
 *  slider with numbered burn holds. Above it the burn caption, in place of the
 *  desktop's right drawer: the burn held, or the next, in the details' words. */
export class MobileRoutePlaybackBarView {
  readonly root: HTMLElement
  readonly caption: HTMLButtonElement
  readonly detailsButton: HTMLButtonElement
  /** Opens the confirmation; Back exits without one. */
  readonly exitButton: HTMLButtonElement
  private readonly play: HTMLButtonElement
  private readonly previous: HTMLButtonElement
  private readonly next: HTMLButtonElement
  private readonly timeline: HTMLInputElement
  private readonly track: HTMLElement
  private readonly profile: HTMLElement
  private model: RoutePlaybackModel | null = null
  private captionIndex: number | null = null
  private dragging = false
  private shownSegments: readonly RouteTimelineSegment[] | null = null
  private shownProfile: RouteProfile | null = null
  private shownPlaying: boolean | null = null

  constructor(bottom: HTMLElement, callbacks: RoutePlaybackBarCallbacks) {
    const documentRef = bottom.ownerDocument
    this.caption = documentRef.createElement('button')
    this.caption.type = 'button'
    this.caption.className = 'm-route-caption'
    this.caption.dataset.frames = ''
    this.caption.hidden = true
    this.caption.innerHTML = html`<span class="route-burn-number" aria-hidden="true"></span><span class="m-route-caption-text"><strong class="m-route-caption-head"></strong><span class="m-route-caption-line"></span></span>`
    this.caption.addEventListener('click', () => callbacks.onDetails(this.captionIndex))
    this.root = documentRef.createElement('section')
    this.root.className = 'm-route-bar'
    this.root.dataset.frames = ''
    this.root.setAttribute('aria-label', text().routePlanner.playback.region)
    this.root.hidden = true
    this.root.innerHTML = routePlaybackBarMarkup()
    const find = <T extends HTMLElement>(selector: string): T => this.root.querySelector<T>(selector)!
    this.play = find('.m-route-play')
    this.previous = find('.m-route-previous')
    this.next = find('.m-route-next')
    this.detailsButton = find('.m-route-details')
    this.timeline = find('.m-route-timeline')
    this.track = find('.m-route-segments')
    this.profile = find('.m-route-profile')
    this.play.addEventListener('click', () => callbacks.onPlayToggle())
    this.previous.addEventListener('click', () => callbacks.onBurnStep(-1))
    this.next.addEventListener('click', () => callbacks.onBurnStep(1))
    this.detailsButton.addEventListener('click', () => callbacks.onDetails(null))
    this.exitButton = find('.m-route-exit')
    this.exitButton.addEventListener('click', () => callbacks.onExit())
    this.timeline.addEventListener('input', () => {
      const duration = this.model?.durationTau ?? 0
      callbacks.onSeek(Math.min(duration, Math.max(0, (Number(this.timeline.value) / TIMELINE_STEPS) * duration)))
    })
    this.timeline.addEventListener('pointerdown', () => { this.dragging = true })
    for (const type of ['pointerup', 'pointercancel', 'blur'] as const) this.timeline.addEventListener(type, () => { this.dragging = false })
    bottom.append(this.caption, this.root)
  }

  /** As often as every frame while a route plays; `visible` follows the mode and
   *  immersive mode, and the caption also steps aside while a panel is open. */
  sync(model: RoutePlaybackModel | null, shown: RouteShownModel | null, loading: boolean, visible: boolean, panelOpen: boolean): void {
    this.model = model
    this.root.hidden = !visible || model === null
    this.caption.hidden = this.root.hidden || shown === null || panelOpen
    if (model === null || this.root.hidden) return
    for (const control of this.root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) control.disabled = loading
    const t = text().routePlanner.playback
    if (model.segments !== this.shownSegments) {
      this.shownSegments = model.segments
      this.track.innerHTML = trackMarkup(model.segments, model.durationTau)
    }
    if (model.profile !== this.shownProfile) {
      this.shownProfile = model.profile
      this.profile.innerHTML = model.profile === null ? '' : profileMarkup(model.profile)
    }
    if (model.playing !== this.shownPlaying) {
      this.shownPlaying = model.playing
      this.play.innerHTML = icon(model.playing ? 'pause' : 'play')
      this.play.setAttribute('aria-label', model.playing ? t.pause : t.play)
    }
    this.previous.disabled = loading || !model.hasPreviousBurn
    this.next.disabled = loading || !model.hasNextBurn
    const readout = playbackReadout(model)
    setText(this.root.querySelector<HTMLElement>('.m-route-elapsed')!, readout.elapsed)
    setText(this.root.querySelector<HTMLElement>('.m-route-rate')!, readout.rate)
    if (!this.dragging) {
      const value = String(model.durationTau > 0 ? Math.round((model.tau / model.durationTau) * TIMELINE_STEPS) : 0)
      if (this.timeline.value !== value) this.timeline.value = value
    }
    const valueText = `${readout.elapsed}, ${readout.rate}`
    if (this.timeline.getAttribute('aria-valuetext') !== valueText) this.timeline.setAttribute('aria-valuetext', valueText)
    if (shown === null) return
    const lines = captionLines(model, shown)
    this.captionIndex = lines.index
    this.caption.classList.toggle('is-held', lines.held)
    const number = this.caption.querySelector<HTMLElement>('.route-burn-number')!
    setText(number, lines.number)
    number.hidden = lines.number === ''
    setText(this.caption.querySelector<HTMLElement>('.m-route-caption-head')!, lines.head)
    setText(this.caption.querySelector<HTMLElement>('.m-route-caption-line')!, lines.line)
    const name = text().mobile.route.captionName(lines.line === '' ? lines.head : `${lines.head}, ${lines.line}`)
    if (this.caption.getAttribute('aria-label') !== name) this.caption.setAttribute('aria-label', name)
  }

  /** Where the keyboard starts once playback begins. */
  focus(): void { this.play.focus({ preventScroll: true }) }

  dispose(): void {
    this.caption.remove()
    this.root.remove()
  }
}

function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value
}
