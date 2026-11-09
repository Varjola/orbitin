import { format, text } from '../i18n/index.ts'
import { ROUTE_TIMELINE_FACTORS, type RouteTimelineFactor } from '../simulation/route/routePlayback.ts'
import type { RouteTimelineSegment } from '../simulation/route/routeTimeline.ts'
import { ROUTE_CAMERA_VIEWS, type RouteCameraView, type RouteProfile } from '../simulation/route/routeDrawing.ts'
import { keyBelongsToControl } from './keyTargets.ts'
import { html, trusted } from './markup.ts'
import { CONSTANT_RATE_STEPS, constantRateFromPosition, positionFromConstantRate, type RoutePlaybackModel } from './routePanelModel.ts'
import { profileCaptionMarkup, profileMarkup } from './routeResultMarkup.ts'
import { spanText } from './routeWording.ts'
import type { UiCallbacks } from './uiTypes.ts'

const TIMELINE_STEPS = 1000
const DAY = 86_400
/** Playback seconds moved by an arrow key, and by Page Up or Page Down. */
const KEY_STEP_SECONDS = 1
const PAGE_STEP_SECONDS = 5

type PlaybackCallbacks = Pick<UiCallbacks, 'onRoutePlayToggle' | 'onRouteReverseChange' | 'onRouteSpeedChange' | 'onRouteAutoplayChange' | 'onRouteSeek' | 'onRouteBurnStep' | 'onRouteFit' | 'onRoutePlanesChange' | 'onRouteExit' | 'onRouteCameraView' | 'onRouteFrameBurns'>

/** Pointing at a burn on the timeline, or away from it. Burns are numbered from 0. */
export type BurnHover = (burnIndex: number | null) => void

const PLAY_ICON = '<svg class="playback-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.75 19 12 7 19.25Z"></path></svg>'
const PAUSE_ICON = '<svg class="playback-symbol" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"></rect><rect x="13.5" y="5" width="4" height="14" rx="1"></rect></svg>'
const PREVIOUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M18 5 9 12l9 7Z"></path></svg>'
const NEXT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14M6 5l9 7-9 7Z"></path></svg>'
const MORE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"></path><circle cx="15" cy="7" r="2"></circle><circle cx="9" cy="17" r="2"></circle></svg>'
const REVERSE_ICON ='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H5M10 6l-6 6 6 6"></path></svg>'

function factorText(factor: RouteTimelineFactor): string {
  return `${format().number(factor, factor === 0.25 ? 2 : factor < 1 ? 1 : 0)}×`
}

/** A rate read at a glance: two significant figures. */
function rateText(rate: number): string {
  return format().speedMultiplier(Number(rate.toPrecision(2)))
}

/** Waits and transfers as wide as their playback time, and each burn numbered. */
function trackMarkup(segments: readonly RouteTimelineSegment[], durationTau: number): string {
  if (!(durationTau > 0)) return ''
  return segments.map((segment) => {
    const left = (100 * segment.fromTau) / durationTau
    const width = (100 * (segment.toTau - segment.fromTau)) / durationTau
    const number = segment.burnIndex === null ? '' : String(segment.burnIndex + 1)
    return html`<span class="route-track-${segment.kind}" style="left: ${left.toFixed(3)}%; width: ${width.toFixed(3)}%">${number}</span>`
  }).join('')
}

/** The track's inset from the timeline's ends: half the thumb. */
const TRACK_INSET_PX = 7
/** A burn is pointed at from this close on either side. */
const BURN_HOVER_PX = 4

/** The Route Planner's playback bar, in place of the time controls: play, reverse,
 *  previous and next burn, speed, the timeline and the view buttons. */
export class RoutePlaybackView {
  readonly root: HTMLElement
  private readonly callbacks: PlaybackCallbacks
  private readonly play: HTMLButtonElement
  private readonly previous: HTMLButtonElement
  private readonly next: HTMLButtonElement
  private readonly reverse: HTMLButtonElement
  private readonly speed: HTMLSelectElement
  private readonly manual: HTMLInputElement
  private readonly autoplay: HTMLInputElement
  private readonly constantRow: HTMLElement
  private readonly constant: HTMLInputElement
  private readonly constantValue: HTMLOutputElement
  private readonly timeline: HTMLInputElement
  private readonly track: HTMLElement
  private readonly elapsed: HTMLElement
  private readonly rate: HTMLElement
  private readonly planes: HTMLButtonElement
  private readonly camera: HTMLSelectElement
  private readonly frameBurns: HTMLInputElement
  private readonly profile: HTMLElement
  private shownProfile: RouteProfile | null = null
  private readonly documentRef: Document
  private model: RoutePlaybackModel | null = null
  private active = false
  private dragging = false
  private shownSegments: readonly RouteTimelineSegment[] | null = null
  private shownPlaying: boolean | null = null
  private readonly onKeyDown = (event: KeyboardEvent): void => { if (!keyBelongsToControl(event.target, { pressable: true })) this.handleKey(event) }

  private readonly burnHover: BurnHover
  private hoveredBurn: number | null = null
  private readonly exitSlot: HTMLElement
  private readonly moreButton: HTMLButtonElement
  /** The bar's own: the rest of the controls and the profile, shown or not. */
  private expanded = false

  constructor(container: HTMLElement, exitSlot: HTMLElement, callbacks: PlaybackCallbacks, burnHover: BurnHover = () => {}) {
    this.root = container
    this.burnHover = burnHover
    this.callbacks = callbacks
    this.documentRef = container.ownerDocument
    this.root.dataset.region = 'routePlayback'
    const t = text().routePlanner.playback
    const options = ROUTE_TIMELINE_FACTORS.map((factor) => html`<option value="${String(factor)}">${factorText(factor)}</option>`).join('')
    // One row and the timeline; the rest opens from the first button, as the
    // other modes' calendar button opens their time drawer.
    this.root.innerHTML = html`
      <p id="route-playback-keys" class="sr-only">${t.keys}</p>
      <div class="route-playback-row">
        <button id="route-playback-more" class="drawer-toggle-button icon-button" type="button" aria-controls="route-profile route-playback-more-content" aria-expanded="false" aria-label="${t.moreControls}" title="${t.moreControls}">${trusted(MORE_ICON)}</button>
        <button id="route-previous-burn" class="action-button icon-button" type="button" aria-label="${t.previousBurn}" title="${t.previousBurn}" aria-keyshortcuts=",">${trusted(PREVIOUS_ICON)}</button>
        <button id="route-play" class="action-button icon-button route-play" type="button" aria-label="${t.play}" aria-keyshortcuts="Space">${trusted(PLAY_ICON)}</button>
        <button id="route-next-burn" class="action-button icon-button" type="button" aria-label="${t.nextBurn}" title="${t.nextBurn}" aria-keyshortcuts=".">${trusted(NEXT_ICON)}</button>
        <div class="route-readout"><strong id="route-elapsed"></strong><span id="route-rate"></span></div>
        <label class="route-speed" id="route-speed-row"><span class="sr-only">${t.speed}</span><select id="route-speed" title="${t.speed}">${trusted(options)}</select></label>
      </div>
      <div id="route-profile" class="route-profile" hidden><div id="route-profile-plot" class="route-profile-plot"></div><p id="route-profile-caption" class="route-profile-caption"></p></div>
      <div class="route-track">
        <div id="route-track-segments" class="route-track-segments" aria-hidden="true"></div>
        <input id="route-timeline" class="route-timeline" type="range" min="0" max="${String(TIMELINE_STEPS)}" step="1" value="0" aria-label="${t.timeline}" aria-describedby="route-playback-keys" />
      </div>
      <div id="route-playback-more-content" class="route-playback-more" hidden>
        <div class="route-playback-tools">
          <button id="route-reverse" class="action-button icon-button" type="button" aria-pressed="false" aria-label="${t.reverse}" title="${t.reverse}">${trusted(REVERSE_ICON)}</button>
          <label class="route-frame-burns" id="route-autoplay-row" title="${t.autoplayTitle}"><input id="route-autoplay" type="checkbox" checked /> ${t.autoplay}</label>
          <label class="route-frame-burns" title="${t.manualSpeedTitle}"><input id="route-manual-speed" type="checkbox" /> ${t.manualSpeed}</label>
          <button id="route-fit" class="action-button route-view-button" type="button" title="${t.fitTitle}">${t.fit}</button>
          <button id="route-planes" class="action-button route-view-button" type="button" aria-pressed="false" title="${t.planesTitle}">${t.planes}</button>
          <label class="route-speed"><span class="sr-only">${text().routePlanner.camera.label}</span><select id="route-camera-playback" title="${text().routePlanner.camera.label}">${trusted(ROUTE_CAMERA_VIEWS.map((view) => html`<option value="${view}">${text().routePlanner.camera.views[view]}</option>`).join(''))}</select></label>
          <label class="route-frame-burns"><input id="route-frame-burns" type="checkbox" /> ${text().routePlanner.camera.frameBurns}</label>
        </div>
        <label id="route-constant-row" class="slider-row route-constant" hidden>
          <span class="slider-label"><span>${t.constantRate}</span><output id="route-constant-value"></output></span>
          <input id="route-constant-rate" type="range" min="0" max="${String(CONSTANT_RATE_STEPS)}" step="1" value="${String(positionFromConstantRate(1000))}" />
        </label>
      </div>
    `
    // Exit stands at the top left, where the drawer is outside playback.
    this.exitSlot = exitSlot
    this.exitSlot.innerHTML = html`<button id="route-exit" class="action-button route-exit" type="button" title="${t.exitTitle}">‹ ${t.exit}</button>`
    this.exitSlot.hidden = true
    const find = <T extends HTMLElement>(selector: string) => this.root.querySelector<T>(selector)!
    this.play = find('#route-play')
    this.previous = find('#route-previous-burn')
    this.next = find('#route-next-burn')
    this.reverse = find('#route-reverse')
    this.speed = find('#route-speed')
    this.manual = find('#route-manual-speed')
    this.autoplay = find('#route-autoplay')
    this.constantRow = find('#route-constant-row')
    this.constant = find('#route-constant-rate')
    this.constantValue = find('#route-constant-value')
    this.timeline = find('#route-timeline')
    this.track = find('#route-track-segments')
    this.elapsed = find('#route-elapsed')
    this.rate = find('#route-rate')
    this.planes = find('#route-planes')
    this.profile = find('#route-profile-plot')
    this.play.addEventListener('click', () => callbacks.onRoutePlayToggle())
    this.previous.addEventListener('click', () => callbacks.onRouteBurnStep(-1))
    this.next.addEventListener('click', () => callbacks.onRouteBurnStep(1))
    this.reverse.addEventListener('click', () => callbacks.onRouteReverseChange(this.reverse.getAttribute('aria-pressed') !== 'true'))
    this.speed.addEventListener('change', () => this.chooseSpeed())
    this.manual.addEventListener('change', () => this.chooseSpeed())
    this.constant.addEventListener('input', () => this.chooseSpeed())
    this.autoplay.addEventListener('change', () => callbacks.onRouteAutoplayChange(this.autoplay.checked))
    this.timeline.addEventListener('pointermove', (event) => this.hoverBurn(event.clientX))
    this.timeline.addEventListener('pointerleave', () => this.setHoveredBurn(null))
    this.timeline.addEventListener('input', () => this.seekTo(Number(this.timeline.value) / TIMELINE_STEPS * (this.model?.durationTau ?? 0)))
    this.timeline.addEventListener('pointerdown', () => { this.dragging = true })
    for (const type of ['pointerup', 'pointercancel', 'blur'] as const) this.timeline.addEventListener(type, () => { this.dragging = false })
    this.timeline.addEventListener('keydown', (event) => this.handleKey(event))
    find<HTMLButtonElement>('#route-fit').addEventListener('click', () => callbacks.onRouteFit())
    this.planes.addEventListener('click', () => callbacks.onRoutePlanesChange(this.planes.getAttribute('aria-pressed') !== 'true'))
    this.exitSlot.querySelector<HTMLButtonElement>('#route-exit')!.addEventListener('click', () => callbacks.onRouteExit())
    this.moreButton = find('#route-playback-more')
    this.moreButton.addEventListener('click', () => this.setExpanded(!this.expanded))
    this.camera = find('#route-camera-playback')
    this.camera.addEventListener('change', () => callbacks.onRouteCameraView(this.camera.value as RouteCameraView))
    this.frameBurns = find('#route-frame-burns')
    this.frameBurns.addEventListener('change', () => callbacks.onRouteFrameBurns(this.frameBurns.checked))
    this.documentRef.addEventListener('keydown', this.onKeyDown)
    this.root.hidden = true
  }

  /** Shown in the Route Planner once there is a route; keys work only then. */
  sync(model: RoutePlaybackModel | null, active: boolean, loading: boolean): void {
    this.model = model
    this.active = active && !loading && model !== null
    this.root.hidden = !active || model === null
    this.exitSlot.hidden = this.root.hidden
    for (const control of this.root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select')) control.disabled = loading || model === null
    this.exitSlot.querySelector<HTMLButtonElement>('#route-exit')!.disabled = loading || model === null
    if (model === null) return
    const t = text().routePlanner.playback
    if (model.segments !== this.shownSegments) {
      this.shownSegments = model.segments
      this.track.innerHTML = trackMarkup(model.segments, model.durationTau)
    }
    if (model.playing !== this.shownPlaying) {
      this.shownPlaying = model.playing
      this.play.innerHTML = model.playing ? PAUSE_ICON : PLAY_ICON
      this.play.setAttribute('aria-label', model.playing ? t.pause : t.play)
      this.play.title = model.playing ? t.pause : t.play
    }
    this.previous.disabled = loading || !model.hasPreviousBurn
    this.next.disabled = loading || !model.hasNextBurn
    setAttribute(this.reverse, 'aria-pressed', String(model.reversed))
    setAttribute(this.planes, 'aria-pressed', String(model.planesShown))
    if (this.camera.value !== model.camera) this.camera.value = model.camera
    this.frameBurns.checked = model.frameBurns
    if (model.profile !== this.shownProfile) {
      this.shownProfile = model.profile
      this.profile.innerHTML = model.profile === null ? '' : profileMarkup(model.profile)
      this.root.querySelector<HTMLElement>('#route-profile-caption')!.innerHTML = model.profile === null ? '' : profileCaptionMarkup(model.profile)
    }
    // Drifting fast, days are what can be followed, and the Earth stands still.
    const elapsed = model.drifting ? t.day(Math.floor(model.seconds / DAY) + 1) : text().routePlanner.afterStart(spanText(model.seconds))
    const pace = model.burnNumber !== null ? t.burnHeld(model.burnNumber) : model.drifting ? t.earthHeld(rateText(model.rate)) : rateText(model.rate)
    const rate = model.followHeld ? `${pace} · ${t.followHeld}` : pace
    setText(this.elapsed, elapsed)
    setText(this.rate, rate)
    if (!this.dragging) {
      const value = String(model.durationTau > 0 ? Math.round(model.tau / model.durationTau * TIMELINE_STEPS) : 0)
      if (this.timeline.value !== value) this.timeline.value = value
    }
    setAttribute(this.timeline, 'aria-valuetext', `${elapsed}, ${rate}`)
    const manual = model.speed.kind === 'constant'
    this.manual.checked = manual
    this.autoplay.checked = model.autoplay
    // By hand, a rate; paced by the timeline, a multiple of it and whether burns pause.
    this.root.querySelector<HTMLElement>('#route-speed-row')!.hidden = manual
    this.root.querySelector<HTMLElement>('#route-autoplay-row')!.hidden = manual
    if (model.speed.kind === 'timeline' && this.speed.value !== String(model.speed.factor)) this.speed.value = String(model.speed.factor)
    this.constantRow.hidden = !manual
    if (model.speed.kind === 'constant') {
      const position = String(positionFromConstantRate(model.speed.rate))
      if (this.documentRef.activeElement !== this.constant && this.constant.value !== position) this.constant.value = position
      setText(this.constantValue, format().speedMultiplier(model.speed.rate))
    }
  }

  /** Where the keyboard starts once playback begins. */
  focus(): void { this.play.focus() }

  dispose(): void {
    this.documentRef.removeEventListener('keydown', this.onKeyDown)
    this.root.textContent = ''
    this.exitSlot.textContent = ''
  }

  private setExpanded(expanded: boolean): void {
    const t = text().routePlanner.playback
    this.expanded = expanded
    this.root.classList.toggle('is-expanded', expanded)
    this.moreButton.setAttribute('aria-expanded', String(expanded))
    const label = expanded ? t.fewerControls : t.moreControls
    this.moreButton.setAttribute('aria-label', label)
    this.moreButton.title = label
    this.root.querySelector<HTMLElement>('#route-profile')!.hidden = !expanded
    this.root.querySelector<HTMLElement>('#route-playback-more-content')!.hidden = !expanded
  }

  /** The rate by hand, or the timeline's pace at its multiple; each keeps its own value. */
  private chooseSpeed(): void {
    if (this.manual.checked) this.callbacks.onRouteSpeedChange({ kind: 'constant', rate: constantRateFromPosition(Number(this.constant.value)) })
    else this.callbacks.onRouteSpeedChange({ kind: 'timeline', factor: Number(this.speed.value) as RouteTimelineFactor })
  }

  /** The burn under the pointer on the timeline, if any. */
  private hoverBurn(clientX: number): void {
    const model = this.model
    const rect = this.timeline.getBoundingClientRect()
    const width = rect.width - 2 * TRACK_INSET_PX
    if (model === null || !(width > 0) || !(model.durationTau > 0)) { this.setHoveredBurn(null); return }
    const tau = ((clientX - rect.left - TRACK_INSET_PX) / width) * model.durationTau
    const slack = (BURN_HOVER_PX / width) * model.durationTau
    const burn = model.segments.find((segment) => segment.kind === 'burn' && tau >= segment.fromTau - slack && tau <= segment.toTau + slack)
    this.setHoveredBurn(burn?.burnIndex ?? null)
  }

  private setHoveredBurn(burnIndex: number | null): void {
    if (burnIndex === this.hoveredBurn) return
    this.hoveredBurn = burnIndex
    this.burnHover(burnIndex)
  }

  private seekTo(tau: number): void {
    this.callbacks.onRouteSeek(Math.min(this.model?.durationTau ?? 0, Math.max(0, tau)))
  }

  /** Space, the arrows, comma and full stop anywhere in the mode; the timeline also
   *  takes Home, End, Page Up and Page Down. */
  private handleKey(event: KeyboardEvent): void {
    const model = this.model
    if (!this.active || model === null || event.ctrlKey || event.metaKey || event.altKey) return
    const onTimeline = event.currentTarget === this.timeline
    const step = (seconds: number) => this.seekTo(model.tau + seconds)
    switch (event.key) {
      case ' ': this.callbacks.onRoutePlayToggle(); break
      case 'ArrowLeft': step(-KEY_STEP_SECONDS); break
      case 'ArrowRight': step(KEY_STEP_SECONDS); break
      case ',': this.callbacks.onRouteBurnStep(-1); break
      case '.': this.callbacks.onRouteBurnStep(1); break
      case 'Home': if (!onTimeline) return; this.seekTo(0); break
      case 'End': if (!onTimeline) return; this.seekTo(model.durationTau); break
      case 'PageDown': if (!onTimeline) return; step(-PAGE_STEP_SECONDS); break
      case 'PageUp': if (!onTimeline) return; step(PAGE_STEP_SECONDS); break
      case 'ArrowDown': if (!onTimeline) return; step(-KEY_STEP_SECONDS); break
      case 'ArrowUp': if (!onTimeline) return; step(KEY_STEP_SECONDS); break
      default: return
    }
    event.preventDefault()
    event.stopPropagation()
  }
}

function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value
}

function setAttribute(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value)
}
