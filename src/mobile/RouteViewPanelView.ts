import { text } from '../i18n/index.ts'
import { ROUTE_CAMERA_VIEWS, type RouteCameraView } from '../simulation/route/routeDrawing.ts'
import { html, trusted } from '../ui/markup.ts'

export interface RouteViewCallbacks {
  onView(view: RouteCameraView): void
  onFrameBurns(frameBurns: boolean): void
}

export function routeViewMarkup(): string {
  const t = text().routePlanner.camera
  return html`
    <div class="m-route-views" role="group" aria-label="${t.label}">${trusted(ROUTE_CAMERA_VIEWS.map((view) => html`<button class="m-row m-route-view" type="button" data-view="${view}" aria-pressed="false"><span class="m-toggle-mark" aria-hidden="true"></span><span class="m-row-name">${t.views[view]}</span></button>`).join(''))}</div>
    <label class="m-switch"><input class="m-route-frame" type="checkbox" role="switch" /><span class="m-switch-track" aria-hidden="true"></span><span class="m-switch-label">${t.frameBurns}</span></label>
    <p class="m-caption">${t.hint}</p>
  `
}

/** View, a small panel: the desktop's camera views and Turn to each burn. Every
 *  one is the learner's choice, and turning the scene by hand ends it. */
export class RouteViewPanelView {
  readonly root: HTMLElement
  private readonly frame: HTMLInputElement

  constructor(documentRef: Document, callbacks: RouteViewCallbacks) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-route-view-panel'
    this.root.innerHTML = routeViewMarkup()
    this.frame = this.root.querySelector<HTMLInputElement>('.m-route-frame')!
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-view]')) button.addEventListener('click', () => callbacks.onView(button.dataset.view as RouteCameraView))
    this.frame.addEventListener('change', () => callbacks.onFrameBurns(this.frame.checked))
  }

  sync(camera: RouteCameraView, frameBurns: boolean, loading: boolean): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      button.setAttribute('aria-pressed', String(button.dataset.view === camera))
      button.disabled = loading
    }
    this.frame.checked = frameBurns
    this.frame.disabled = loading
  }
}
