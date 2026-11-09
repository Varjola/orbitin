import { text } from '../i18n/index.ts'
import { html } from '../ui/markup.ts'

export interface RouteExitCallbacks {
  onExit(): void
  onKeep(): void
}

export function routeExitMarkup(): string {
  const t = text().mobile.route
  return html`
    <p class="m-route-exit-text">${text().routePlanner.playback.exitTitle}.</p>
    <div class="m-button-row m-route-exit-actions">
      <button class="m-button m-route-keep" type="button">${t.keepWatching}</button>
      <button class="m-button is-primary m-route-exit-confirm" type="button">${text().routePlanner.playback.exit}</button>
    </div>
  `
}

/** The stop square in the playback bar sits beside Route, so a finger meant for
 *  the details can land on it: Exit asks first, in a small panel above the bar.
 *  Back with no panel open still exits at once, being deliberate. */
export class RouteExitPanelView {
  readonly root: HTMLElement
  readonly keepButton: HTMLButtonElement

  constructor(documentRef: Document, callbacks: RouteExitCallbacks) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-route-exit-panel'
    this.root.innerHTML = routeExitMarkup()
    this.keepButton = this.root.querySelector<HTMLButtonElement>('.m-route-keep')!
    this.keepButton.addEventListener('click', () => callbacks.onKeep())
    this.root.querySelector<HTMLButtonElement>('.m-route-exit-confirm')!.addEventListener('click', () => callbacks.onExit())
  }

  sync(loading: boolean): void {
    for (const button of this.root.querySelectorAll('button')) button.disabled = loading
  }
}
