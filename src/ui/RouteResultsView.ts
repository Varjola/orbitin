import { text } from '../i18n/index.ts'
import { replaceKeepingFocus } from './focusKeeping.ts'
import { html, trusted } from './markup.ts'
import type { RoutePanelModel, RouteShownModel } from './routePanelModel.ts'
import { budgetsMarkup, burnTimelineMarkup, costMarkup, fuelMarkup, routeSummaryMarkup } from './routeResultMarkup.ts'
import type { UiCallbacks } from './uiTypes.ts'

function shownMarkup(shown: RouteShownModel): string {
  const t = text().routePlanner
  return html`
    ${trusted(routeSummaryMarkup(shown))}
    <section class="field-group">
      <div class="group-heading"><span>${t.burns}</span></div>
      ${trusted(burnTimelineMarkup(shown, true))}
    </section>
    ${trusted(fuelMarkup(shown))}
    ${trusted(costMarkup(shown))}
  `
}

/** The Route Planner's right drawer, beside a route's playback: the route in
 *  order, a box for each burn. The burn being held, or pointed at on the playback
 *  bar, is lit; a box's button shows its burn in the view. Below it, what Δv
 *  real satellites carry, then the model notes. */
export class RouteResultsView {
  readonly root: HTMLElement
  private readonly body: HTMLElement
  private shown = ''
  private held: number | null = null
  private hovered: number | null = null
  private lit: number | null = null

  constructor(container: HTMLElement, callbacks: Pick<UiCallbacks, 'onRouteBurnSelect'>) {
    this.root = container
    this.root.dataset.region = 'routeResults'
    const t = text().routePlanner
    this.root.innerHTML = html`
      <div id="route-result-body" tabindex="-1"></div>
      <details class="field-group maneuver-model route-budgets" open>
        <summary>${t.budgets.heading}</summary>
        ${trusted(budgetsMarkup())}
      </details>
      <details class="field-group maneuver-model">
        <summary>${t.modelHeading}</summary>
        <ul>${trusted(t.modelNotes.map((note) => html`<li>${note}</li>`).join(''))}</ul>
      </details>
    `
    this.body = this.root.querySelector<HTMLElement>('#route-result-body')!
    this.body.addEventListener('click', (event) => {
      const burn = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-burn]')
      if (burn) callbacks.onRouteBurnSelect(Number(burn.dataset.burn))
    })
  }

  /** Only redrawn when it says something new; a burn's details stay open. */
  sync(model: RoutePanelModel | null): void {
    const markup = model?.shown ? shownMarkup(model.shown) : html`<p class="time-note">${text().routePlanner.nothingYet}</p>`
    if (markup === this.shown) return
    const open = new Set([...this.body.querySelectorAll<HTMLDetailsElement>('details[data-burn-facts]')].filter((facts) => facts.open).map((facts) => facts.dataset.burnFacts))
    this.shown = markup
    replaceKeepingFocus(this.body, markup)
    for (const facts of this.body.querySelectorAll<HTMLDetailsElement>('details[data-burn-facts]')) facts.open = open.has(facts.dataset.burnFacts)
    this.lit = null
    this.lightBurn()
  }

  /** The burn playback is holding, numbered from 0. */
  setHeldBurn(index: number | null): void {
    if (index === this.held) return
    this.held = index
    this.lightBurn()
  }

  /** The burn pointed at on the playback bar, numbered from 0. */
  setHoveredBurn(index: number | null): void {
    if (index === this.hovered) return
    this.hovered = index
    this.lightBurn()
  }

  dispose(): void { this.root.textContent = '' }

  private lightBurn(): void {
    const index = this.hovered ?? this.held
    if (index === this.lit) return
    this.lit = index
    for (const box of this.body.querySelectorAll<HTMLElement>('[data-burn-box]')) {
      const lit = box.dataset.burnBox === String(index)
      box.classList.toggle('is-lit', lit)
      // Brought into view without moving the page or the playback bar.
      if (lit && typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'nearest' })
    }
  }
}
