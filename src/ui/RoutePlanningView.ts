import { format, text } from '../i18n/index.ts'
import { ROUTE_DEFAULT_ISP_SECONDS, ROUTE_ELECTRIC_ISP_SECONDS } from '../simulation/route/routeSetup.ts'
import { replaceKeepingFocus } from './focusKeeping.ts'
import { html, trusted } from './markup.ts'
import { frontChartMarkup, frontRouteLabel, routeTableMarkup } from './RouteFrontChart.ts'
import { budgetFromPosition, ispFromPosition, limitFromPosition, positionFromBudget, positionFromIsp, positionFromLimit, ROUTE_SLIDER_STEPS, type RoutePanelModel } from './routePanelModel.ts'
import { burnTimelineMarkup, costMarkup, fuelMarkup, notesMarkup, pairText, routeSummaryMarkup, timelineStripMarkup } from './routeResultMarkup.ts'
import { deltaVText, limitText, listNotes, statusText } from './routeWording.ts'
import type { UiCallbacks } from './uiTypes.ts'

type PlanningCallbacks = Pick<UiCallbacks, 'onRoutePlannerClose' | 'onRouteLimitTimeChange' | 'onRouteLimitFuelChange' | 'onRouteLimitChange' | 'onRouteBudgetChange' | 'onRouteIspChange' | 'onPlanRoute' | 'onCancelRoute' | 'onRouteSelect' | 'onRouteDetailsBack' | 'onRoutePlayDetails'>

/** The Route Planner's planning window, over the paused scene. Choosing a route:
 *  the limits and the engine on the left, the routes found as a table in the
 *  middle and as a chart on the right, a row and its mark lit together. Then one
 *  route's details with Play and Back. A modal dialog, so the scene and the drawers
 *  wait behind it; Escape or Close let the scene run on. */
export class RoutePlanningView {
  readonly root: HTMLElement
  private readonly dialog: HTMLDialogElement
  private readonly limitTime: HTMLInputElement
  private readonly limitFuel: HTMLInputElement
  private readonly limitSlider: HTMLInputElement
  private readonly budgetSlider: HTMLInputElement
  private readonly ispSlider: HTMLInputElement
  private readonly list: HTMLElement
  private readonly chart: HTMLElement
  private readonly detailsBody: HTMLElement
  private model: RoutePanelModel | null = null
  private listShown = ''
  private chartShown = ''
  private detailsShown = ''
  private status = ''
  private shownWindow: RoutePanelModel['window'] = 'closed'
  private lit: number | null = null

  constructor(container: HTMLElement, callbacks: PlanningCallbacks) {
    this.root = container
    this.root.dataset.region = 'routePlanning'
    const t = text().routePlanner
    const f = format()
    this.root.innerHTML = html`
      <dialog id="route-planning" class="route-planning" aria-labelledby="route-planning-heading">
        <header class="route-planning-header">
          <h2 id="route-planning-heading">${t.planning.heading}</h2>
          <button id="route-planning-close" class="region-toggle" type="button" aria-label="${t.planning.close}" title="${t.planning.close}"><span aria-hidden="true">×</span></button>
        </header>
        <div id="route-planning-routes" class="route-planning-body route-planning-choose">
          <div class="route-planning-setup">
            <section class="field-group" aria-labelledby="route-limits-heading">
              <div class="group-heading"><span id="route-limits-heading">${t.limits}</span></div>
              <label class="toggle-row"><span>${t.limitTime}</span><input id="route-limit-time" type="checkbox" /><span class="toggle-ui" aria-hidden="true"></span></label>
              <label id="route-limit-row" class="slider-row" hidden><span class="slider-label"><span>${t.timeLimit}</span><output id="route-limit-value">—</output></span><input id="route-limit" type="range" min="0" max="${ROUTE_SLIDER_STEPS}" step="1" value="0" /></label>
              <label class="toggle-row"><span>${t.limitFuel}</span><input id="route-limit-fuel" type="checkbox" /><span class="toggle-ui" aria-hidden="true"></span></label>
              <label id="route-budget-row" class="slider-row" hidden><span class="slider-label"><span>${t.budget}</span><output id="route-budget-value">—</output></span><input id="route-budget" type="range" min="0" max="${ROUTE_SLIDER_STEPS}" step="1" value="0" /></label>
              <p class="time-note">${t.limitsHint}</p>
            </section>
            <section class="field-group" aria-labelledby="route-engine-heading">
              <div class="group-heading"><span id="route-engine-heading">${t.engine}</span></div>
              <div class="button-row route-goal-kind" role="group" aria-labelledby="route-engine-heading">
                <button id="route-isp-chemical" class="action-button" type="button" aria-pressed="false">${t.chemical(f.integer(ROUTE_DEFAULT_ISP_SECONDS))}</button>
                <button id="route-isp-electric" class="action-button" type="button" aria-pressed="false">${t.electric(f.integer(ROUTE_ELECTRIC_ISP_SECONDS))}</button>
              </div>
              <label class="slider-row"><span class="slider-label"><span>${t.isp}</span><output id="route-isp-value">—</output></span><input id="route-isp" type="range" min="0" max="${ROUTE_SLIDER_STEPS}" step="1" value="0" /></label>
              <p class="time-note">${t.engineHint}</p>
            </section>
            <section class="field-group route-plan">
              <div class="button-row">
                <button id="route-plan" class="action-button" type="button">${t.planning.planAgain}</button>
                <button id="route-cancel" class="action-button" type="button" hidden>${t.cancel}</button>
              </div>
              <progress id="route-progress" class="route-progress" max="1" value="0" aria-label="${t.searching}" hidden></progress>
              <p id="route-status" class="maneuver-status" role="status" hidden></p>
            </section>
          </div>
          <div id="route-planning-list" class="route-planning-list" role="region" aria-label="${t.planning.routes}" tabindex="-1"></div>
          <div id="route-planning-chart" class="route-planning-chart" tabindex="-1"></div>
        </div>
        <div id="route-planning-details" class="route-planning-body route-planning-details" hidden>
          <div class="button-row"><button id="route-details-back" class="link-button" type="button">‹ ${t.planning.back}</button></div>
          <div id="route-details-body"></div>
          <div class="button-row route-details-actions">
            <button id="route-details-play" class="action-button primary-action" type="button">${t.planning.play}</button>
            <button id="route-details-back-bottom" class="action-button" type="button">${t.planning.back}</button>
          </div>
        </div>
      </dialog>
    `
    const q = <T extends Element>(selector: string) => this.root.querySelector<T>(selector)!
    this.dialog = q<HTMLDialogElement>('#route-planning')
    this.limitTime = q<HTMLInputElement>('#route-limit-time')
    this.limitFuel = q<HTMLInputElement>('#route-limit-fuel')
    this.limitSlider = q<HTMLInputElement>('#route-limit')
    this.budgetSlider = q<HTMLInputElement>('#route-budget')
    this.ispSlider = q<HTMLInputElement>('#route-isp')
    this.list = q<HTMLElement>('#route-planning-list')
    this.chart = q<HTMLElement>('#route-planning-chart')
    this.detailsBody = q<HTMLElement>('#route-details-body')
    q('#route-planning-close').addEventListener('click', () => callbacks.onRoutePlannerClose())
    // Escape closes the window the same way, through the model.
    this.dialog.addEventListener('cancel', (event) => { event.preventDefault(); callbacks.onRoutePlannerClose() })
    this.limitTime.addEventListener('change', () => callbacks.onRouteLimitTimeChange(this.limitTime.checked))
    this.limitFuel.addEventListener('change', () => callbacks.onRouteLimitFuelChange(this.limitFuel.checked))
    this.limitSlider.addEventListener('input', () => callbacks.onRouteLimitChange(limitFromPosition(Number(this.limitSlider.value))))
    this.budgetSlider.addEventListener('input', () => callbacks.onRouteBudgetChange(budgetFromPosition(Number(this.budgetSlider.value))))
    this.ispSlider.addEventListener('input', () => callbacks.onRouteIspChange(ispFromPosition(Number(this.ispSlider.value))))
    q('#route-isp-chemical').addEventListener('click', () => callbacks.onRouteIspChange(ROUTE_DEFAULT_ISP_SECONDS))
    q('#route-isp-electric').addEventListener('click', () => callbacks.onRouteIspChange(ROUTE_ELECTRIC_ISP_SECONDS))
    q('#route-plan').addEventListener('click', () => callbacks.onPlanRoute())
    q('#route-cancel').addEventListener('click', () => callbacks.onCancelRoute())
    q('#route-details-back').addEventListener('click', () => callbacks.onRouteDetailsBack())
    q('#route-details-back-bottom').addEventListener('click', () => callbacks.onRouteDetailsBack())
    q('#route-details-play').addEventListener('click', () => callbacks.onRoutePlayDetails())
    // A row and a mark are the same route: pressing either shows its details, and
    // pointing at or focusing either lights both.
    for (const area of [this.list, this.chart]) {
      area.addEventListener('click', (event) => {
        const route = (event.target as Element | null)?.closest<HTMLElement>('[data-route]')
        if (route) callbacks.onRouteSelect(Number(route.dataset.route))
      })
      area.addEventListener('pointerover', (event) => this.light(routeIndex(event.target)))
      area.addEventListener('pointerout', (event) => { if (routeIndex(event.relatedTarget) === null) this.light(null) })
      area.addEventListener('focusin', (event) => this.light(routeIndex(event.target)))
      area.addEventListener('focusout', (event) => { if (routeIndex(event.relatedTarget) === null) this.light(null) })
    }
  }

  sync(model: RoutePanelModel | null, active: boolean, loading: boolean): void {
    this.model = model
    const window = active && !loading && model !== null ? model.window : 'closed'
    this.setOpen(window !== 'closed')
    if (model === null || window === 'closed') { this.shownWindow = 'closed'; return }
    const t = text().routePlanner
    const f = format()
    const routes = this.root.querySelector<HTMLElement>('#route-planning-routes')!
    const details = this.root.querySelector<HTMLElement>('#route-planning-details')!
    routes.hidden = window !== 'routes'
    details.hidden = window !== 'details'
    this.setText('#route-planning-heading', window === 'details' ? t.planning.details : t.planning.heading)

    this.limitTime.checked = model.limitTime
    this.limitFuel.checked = model.limitFuel
    this.root.querySelector<HTMLElement>('#route-limit-row')!.hidden = !model.limitTime
    this.root.querySelector<HTMLElement>('#route-budget-row')!.hidden = !model.limitFuel
    this.setSlider(this.limitSlider, positionFromLimit(model.limitSeconds), limitText(model.limitSeconds), '#route-limit-value')
    this.setSlider(this.budgetSlider, positionFromBudget(model.budgetKmPerSecond), deltaVText(model.budgetKmPerSecond), '#route-budget-value')
    this.setSlider(this.ispSlider, positionFromIsp(model.specificImpulseSeconds), t.ispValue(f.integer(model.specificImpulseSeconds)), '#route-isp-value')
    this.root.querySelector('#route-isp-chemical')!.setAttribute('aria-pressed', String(model.specificImpulseSeconds === ROUTE_DEFAULT_ISP_SECONDS))
    this.root.querySelector('#route-isp-electric')!.setAttribute('aria-pressed', String(model.specificImpulseSeconds === ROUTE_ELECTRIC_ISP_SECONDS))

    const solving = model.status.kind === 'solving'
    const plan = this.root.querySelector<HTMLButtonElement>('#route-plan')!
    plan.hidden = solving
    plan.disabled = model.blocked !== null
    // Plan again leads only once the routes shown are out of date.
    plan.classList.toggle('primary-action', model.list === null || model.list.outOfDate)
    this.root.querySelector<HTMLElement>('#route-cancel')!.hidden = !solving
    const progress = this.root.querySelector<HTMLProgressElement>('#route-progress')!
    progress.hidden = !solving
    if (model.status.kind === 'solving') progress.value = model.status.fraction
    this.renderStatus(statusText(model))
    this.renderList(model, solving)
    this.renderDetails(model)

    // Opening, and moving between the two views, puts the focus where to start.
    if (window !== this.shownWindow) {
      const previous = this.shownWindow
      this.shownWindow = window
      if (window === 'details') this.root.querySelector<HTMLButtonElement>('#route-details-play')!.focus()
      else if (previous === 'details') this.list.querySelector<HTMLElement>('.route-row-button')?.focus()
      else this.root.querySelector<HTMLButtonElement>('#route-planning-close')!.focus()
    }
  }

  dispose(): void {
    this.setOpen(false)
    this.root.textContent = ''
  }

  private renderList(model: RoutePanelModel, solving: boolean): void {
    const t = text().routePlanner
    const list = model.list
    const listMarkup = list === null
      ? html`<p class="time-note">${solving ? t.searching : model.noRoute ? t.noRoute : t.nothingYet}</p>`
      : html`<p class="route-pair">${pairText(list)}</p><p class="route-headline">${t.planHint}</p>${trusted(notesMarkup(listNotes(list, solving)))}${trusted(routeTableMarkup(list))}`
    if (listMarkup !== this.listShown) {
      this.listShown = listMarkup
      replaceKeepingFocus(this.list, listMarkup)
      this.lit = null
    }
    const chartMarkup = list === null ? '' : frontChartMarkup(list)
    if (chartMarkup !== this.chartShown) {
      this.chartShown = chartMarkup
      replaceKeepingFocus(this.chart, chartMarkup)
      this.lit = null
    }
  }

  private renderDetails(model: RoutePanelModel): void {
    const shown = model.shown
    const t = text().routePlanner
    const markup = shown === null ? '' : html`
      ${trusted(routeSummaryMarkup(shown))}
      ${trusted(timelineStripMarkup(shown))}
      <section class="field-group">
        <div class="group-heading"><span>${t.burns}</span></div>
        ${trusted(burnTimelineMarkup(shown, false))}
      </section>
      ${trusted(fuelMarkup(shown))}
      ${trusted(costMarkup(shown))}
    `
    if (markup === this.detailsShown) return
    this.detailsShown = markup
    replaceKeepingFocus(this.detailsBody, markup)
  }

  /** Lights a route's row and its mark together, and names it beside the mark. */
  private light(index: number | null): void {
    if (index === this.lit) return
    this.lit = index
    for (const element of this.root.querySelectorAll<HTMLElement>('.route-row, .route-front-point')) element.classList.toggle('is-lit', element.dataset.route === String(index))
    const tip = this.chart.querySelector<HTMLElement>('.route-front-tip')
    if (tip === null) return
    const point = index === null ? null : this.chart.querySelector<HTMLElement>(`.route-front-point[data-route="${index}"]`)
    const route = index === null ? undefined : this.model?.list?.routes[index]
    if (point === null || route === undefined) { tip.hidden = true; return }
    tip.textContent = frontRouteLabel(route)
    tip.style.left = point.style.left
    tip.style.top = point.style.top
    tip.style.removeProperty('--tip-shift')
    tip.classList.remove('is-below')
    tip.hidden = false
    keepInside(tip, tip.offsetParent)
  }

  private setOpen(open: boolean): void {
    if (open === this.dialog.open) return
    if (!open) { this.dialog.close(); return }
    // A browser without modal dialogs still shows it, without the backdrop.
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal()
    else this.dialog.setAttribute('open', '')
  }

  private setText(selector: string, value: string): void {
    const element = this.root.querySelector(selector)!
    if (element.textContent !== value) element.textContent = value
  }

  /** A slider being dragged keeps its own position, between the values it lands on. */
  private setSlider(slider: HTMLInputElement, position: number, value: string, output: string): void {
    if (slider.ownerDocument.activeElement !== slider) slider.value = String(position)
    slider.setAttribute('aria-valuetext', value)
    this.setText(output, value)
  }

  private renderStatus(status: string): void {
    if (status === this.status) return
    this.status = status
    const element = this.root.querySelector<HTMLElement>('#route-status')!
    element.hidden = status === ''
    element.textContent = status
  }
}

/** A tip near the chart's edge slides along so it stays on the chart, and one
 *  near the top goes below its mark: it never reaches past the window. */
function keepInside(tip: HTMLElement, area: Element | null): void {
  if (area === null) return
  const box = area.getBoundingClientRect()
  let rect = tip.getBoundingClientRect()
  if (rect.top < box.top) {
    tip.classList.add('is-below')
    rect = tip.getBoundingClientRect()
  }
  const shift = rect.left < box.left ? box.left - rect.left : rect.right > box.right ? box.right - rect.right : 0
  if (shift !== 0) tip.style.setProperty('--tip-shift', `${shift.toFixed(1)}px`)
}

/** The route a row, a mark or anything inside one stands for. */
function routeIndex(target: EventTarget | null): number | null {
  const element = target instanceof Element ? target.closest<HTMLElement>('[data-route]') : null
  return element === null ? null : Number(element.dataset.route)
}
