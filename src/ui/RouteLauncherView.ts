import { text } from '../i18n/index.ts'
import { html } from './markup.ts'
import type { RoutePanelModel } from './routePanelModel.ts'
import type { UiCallbacks } from './uiTypes.ts'

/** Plan route, beside the drawer where Orbit Lab has Create orbit: it pauses the
 *  live scene and opens the planning window from that moment. */
export class RouteLauncherView {
  readonly root: HTMLElement
  private readonly button: HTMLButtonElement

  constructor(container: HTMLElement, callbacks: Pick<UiCallbacks, 'onRoutePlannerOpen'>) {
    this.root = container
    this.root.dataset.region = 'routeLauncher'
    const t = text().routePlanner.planning
    this.root.innerHTML = html`<button id="route-open-planner" class="floating-action primary-action" type="button" aria-haspopup="dialog" title="${t.openTitle}">${t.open}</button>`
    this.button = this.root.querySelector<HTMLButtonElement>('#route-open-planner')!
    this.button.addEventListener('click', () => callbacks.onRoutePlannerOpen())
  }

  /** Shown in the live scene; playback has Exit playback instead. */
  sync(model: RoutePanelModel | null, active: boolean, loading: boolean): void {
    this.root.hidden = !active || model === null || model.view !== 'live'
    this.button.disabled = loading || model === null || model.blocked !== null
    this.button.setAttribute('aria-expanded', String(model !== null && model.window !== 'closed'))
  }

  /** Back to the button that opened the window, once it closes. */
  focus(): void { this.button.focus() }

  dispose(): void { this.root.textContent = '' }
}
