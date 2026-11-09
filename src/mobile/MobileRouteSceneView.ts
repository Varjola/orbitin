import { text } from '../i18n/index.ts'
import { html } from '../ui/markup.ts'
import type { RoutePanelModel } from '../ui/routePanelModel.ts'
import { separationLine } from './RouteEditPanelView.ts'

export function routeKeyMarkup(): string {
  const t = text().routePlanner.legend
  return html`<li><span class="m-dot m-route-dot-own" aria-hidden="true"></span>${t.interceptor}</li><li><span class="m-dot m-route-dot-target" aria-hidden="true"></span>${t.target}</li>`
}

/** The Route Planner's scene on a phone: at the top left the key, naming the two
 *  dots, under every panel; above the dock in the live scene one line saying how
 *  far apart the two are, which opens Edit. */
export class MobileRouteSceneView {
  readonly key: HTMLElement
  readonly line: HTMLButtonElement

  constructor(container: HTMLElement, bottom: HTMLElement, callbacks: { onEdit(): void }) {
    const documentRef = container.ownerDocument
    this.key = documentRef.createElement('ul')
    this.key.className = 'm-route-key'
    this.key.setAttribute('aria-label', text().routePlanner.legend.label)
    this.key.hidden = true
    this.key.innerHTML = routeKeyMarkup()
    // Before the bottom stack, so a panel that reaches the top covers the key.
    container.insertBefore(this.key, bottom)
    this.line = documentRef.createElement('button')
    this.line.type = 'button'
    this.line.className = 'm-route-line'
    this.line.dataset.frames = ''
    this.line.hidden = true
    this.line.addEventListener('click', () => callbacks.onEdit())
    bottom.append(this.line)
  }

  /** `active` follows the mode; the line also needs the live scene uncovered. */
  sync(model: RoutePanelModel | null, active: boolean, lineShown: boolean, loading: boolean): void {
    this.key.hidden = !active
    this.line.hidden = !lineShown || model === null
    this.line.disabled = loading
    if (!model || this.line.hidden) return
    const line = separationLine(model.separation)
    if (this.line.textContent !== line) {
      this.line.textContent = line
      this.line.setAttribute('aria-label', text().mobile.route.separationName(line))
    }
  }

  dispose(): void {
    this.key.remove()
    this.line.remove()
  }
}
