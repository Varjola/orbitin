import { format, text } from '../i18n/index.ts'
import { replaceKeepingFocus } from '../ui/focusKeeping.ts'
import { html, trusted } from '../ui/markup.ts'
import { familyMark, frontChartMarkup, frontRouteLabel } from '../ui/RouteFrontChart.ts'
import type { RouteBurnRow, RouteListModel, RoutePanelModel, RouteShownModel } from '../ui/routePanelModel.ts'
import { notesMarkup, pairText, timelineStripMarkup } from '../ui/routeResultMarkup.ts'
import { burnChangeLines, burnDirectionText, deltaVText, listNotes, routeNotes, spanText, statusText } from '../ui/routeWording.ts'

export interface RoutePlanCallbacks {
  onPlan(): void
  onCancel(): void
  onSelect(index: number): void
  onBack(): void
  onPlay(): void
}

/** The routes as a list, one 48 px row each: arrival, Δv and the family's mark.
 *  A list, not a table, as the phone has no tables. */
export function routeRowsMarkup(list: RouteListModel): string {
  const t = text().routePlanner
  const rows = list.routes.map((point, index) => html`<li><button class="m-route-row" type="button" data-route="${String(index)}" aria-label="${t.planning.details}: ${frontRouteLabel(point)}"><span class="m-route-row-time">${spanText(point.arrivalSeconds)}</span><span class="m-route-row-cost">${deltaVText(point.deltaVKmPerSecond)}</span><svg class="m-route-row-mark" viewBox="-7 -7 14 14" aria-hidden="true" focusable="false">${trusted(familyMark(point.family, 4.5))}</svg></button></li>`).join('')
  return html`<ul class="m-route-rows" aria-label="${text().mobile.route.routesName}">${trusted(rows)}</ul>`
}

function burnMarkup(burn: RouteBurnRow): string {
  const t = text().routePlanner
  return html`<li class="m-route-burn" data-burn="${String(burn.number - 1)}"><span class="m-route-burn-head"><span class="route-burn-number" aria-hidden="true">${String(burn.number)}</span>${t.planning.burnLine(t.burnNumber(burn.number), t.afterStart(spanText(burn.atSeconds)), t.purposes[burn.purpose])}</span><strong>${burnDirectionText(burn)}</strong>${trusted(burnChangeLines(burn).map((line) => html`<span class="m-route-burn-change">${line}</span>`).join(''))}</li>`
}

/** One route on a phone: its cost, time and burns in one line, its kind, the
 *  profile over the timeline, each burn in words, the fuel and what it costs
 *  beside changing height alone. No component numbers. */
export function routeDetailsMarkup(shown: RouteShownModel): string {
  const t = text().routePlanner
  const m = text().mobile.route
  const f = format()
  const family = t.families[shown.family]
  const share = f.percent(shown.propellantFraction, 0)
  const width = Math.min(100, Math.max(0, shown.propellantFraction * 100))
  return html`
    <p class="m-caption">${pairText(shown)}</p>
    <p class="m-route-summary">${m.summary(deltaVText(shown.totalDeltaVKmPerSecond), spanText(shown.arrivalSeconds), shown.burns.length)}</p>
    ${trusted(notesMarkup(routeNotes(shown)))}
    <section class="m-route-family"><h3 class="m-subheading">${family.name}</h3><p class="m-line">${family.explanation}</p></section>
    ${trusted(timelineStripMarkup(shown))}
    <h3 class="m-subheading">${t.burns}</h3>
    <ol class="m-route-burns">${trusted(shown.burns.map(burnMarkup).join(''))}</ol>
    <h3 class="m-subheading">${t.fuel}</h3>
    <div class="route-fuel-bar" role="img" aria-label="${t.propellantBar(share)}"><span class="route-fuel-propellant" style="width:${width.toFixed(2)}%"></span><span class="route-fuel-rest"></span></div>
    <p class="m-line">${m.propellant(share)}</p>
    <h3 class="m-subheading">${t.cost}</h3>
    <p class="m-line">${m.cost(deltaVText(shown.totalDeltaVKmPerSecond), deltaVText(shown.altitudeOnlyKmPerSecond))}</p>
  `
}

export function routePlanMarkup(): string {
  const t = text().routePlanner
  return html`
    <div class="m-route-plan-routes">
      <p class="m-caption m-route-pair"></p>
      <p class="m-line">${t.planHint}</p>
      <div class="m-route-plan-status">
        <progress class="m-route-progress" max="1" value="0" aria-label="${t.searching}" hidden></progress>
        <p class="m-line m-route-status" role="status"></p>
        <div class="m-button-row">
          <button class="m-button m-route-plan-again" type="button">${t.planning.planAgain}</button>
          <button class="m-button m-route-cancel" type="button" hidden>${t.cancel}</button>
        </div>
      </div>
      <div class="m-route-notes"></div>
      <div class="m-route-chart" tabindex="-1"></div>
      <div class="m-route-list" tabindex="-1"></div>
    </div>
    <div class="m-route-plan-details" hidden>
      <button class="m-button m-route-back" type="button">‹ ${t.planning.back}</button>
      <div class="m-route-details-body" tabindex="-1"></div>
      <div class="m-route-play-bar"><button class="m-button is-primary m-route-play" type="button">${t.planning.play}</button></div>
    </div>
  `
}

/** Plan, an expanded sheet over the paused scene: the chart over the routes as
 *  rows, from the fastest to the cheapest, filling as the search goes. A mark lights
 *  its row and scrolls to it; a row opens the route's details, pushed over the
 *  list, with All routes at the top and Play this route fixed at the bottom. */
export class RoutePlanSheetView {
  readonly root: HTMLElement
  private readonly chart: HTMLElement
  private readonly list: HTMLElement
  private readonly details: HTMLElement
  private chartShown = ''
  private listShown = ''
  private detailsShown = ''
  private notesShown = ''
  private window: RoutePanelModel['window'] = 'closed'

  constructor(documentRef: Document, callbacks: RoutePlanCallbacks) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-route-plan'
    this.root.innerHTML = routePlanMarkup()
    this.chart = this.root.querySelector<HTMLElement>('.m-route-chart')!
    this.list = this.root.querySelector<HTMLElement>('.m-route-list')!
    this.details = this.root.querySelector<HTMLElement>('.m-route-details-body')!
    this.root.querySelector('.m-route-plan-again')!.addEventListener('click', () => callbacks.onPlan())
    this.root.querySelector('.m-route-cancel')!.addEventListener('click', () => callbacks.onCancel())
    this.root.querySelector('.m-route-back')!.addEventListener('click', () => callbacks.onBack())
    this.root.querySelector('.m-route-play')!.addEventListener('click', () => callbacks.onPlay())
    this.chart.addEventListener('click', (event) => {
      const mark = (event.target as Element | null)?.closest<HTMLElement>('[data-route]')
      if (mark) this.light(Number(mark.dataset.route), true)
    })
    this.list.addEventListener('click', (event) => {
      const row = (event.target as Element | null)?.closest<HTMLElement>('[data-route]')
      if (row) callbacks.onSelect(Number(row.dataset.route))
    })
  }

  /** The heading the panel shows for the view in front. */
  heading(model: RoutePanelModel | null): string {
    return model?.window === 'details' ? text().routePlanner.planning.details : text().mobile.route.planHeading
  }

  sync(model: RoutePanelModel | null, loading: boolean): void {
    const window = model?.window ?? 'closed'
    const routes = this.root.querySelector<HTMLElement>('.m-route-plan-routes')!
    const details = this.root.querySelector<HTMLElement>('.m-route-plan-details')!
    routes.hidden = window === 'details'
    details.hidden = window !== 'details'
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.m-route-back, .m-route-play')) button.disabled = loading
    if (!model || window === 'closed') { this.window = 'closed'; return }
    const t = text().routePlanner
    const solving = model.status.kind === 'solving'
    const list = model.list
    this.setText('.m-route-pair', list === null ? '' : pairText(list))
    const progress = this.root.querySelector<HTMLProgressElement>('.m-route-progress')!
    progress.hidden = !solving
    if (model.status.kind === 'solving') progress.value = model.status.fraction
    const status = statusText(model) || (list === null && !solving ? t.nothingYet : '')
    this.setText('.m-route-status', status)
    const again = this.root.querySelector<HTMLButtonElement>('.m-route-plan-again')!
    again.hidden = solving
    again.disabled = loading || model.blocked !== null
    // Plan again leads only once the routes shown are out of date.
    again.classList.toggle('is-primary', list === null || list.outOfDate)
    const cancel = this.root.querySelector<HTMLButtonElement>('.m-route-cancel')!
    cancel.hidden = !solving
    cancel.disabled = loading
    const notes = list === null ? '' : notesMarkup(listNotes(list, solving))
    if (notes !== this.notesShown) { this.notesShown = notes; this.root.querySelector('.m-route-notes')!.innerHTML = notes }
    // The phone's own hint replaces the desktop chart's, which speaks of the table.
    const chart = list === null ? '' : html`${trusted(frontChartMarkup(list))}<p class="m-caption">${text().mobile.route.chartHint}</p>`
    if (chart !== this.chartShown) { this.chartShown = chart; replaceKeepingFocus(this.chart, chart) }
    const rows = list === null ? '' : routeRowsMarkup(list)
    if (rows !== this.listShown) { this.listShown = rows; replaceKeepingFocus(this.list, rows) }
    const shown = window === 'details' && model.shown !== null ? routeDetailsMarkup(model.shown) : ''
    if (shown !== this.detailsShown) { this.detailsShown = shown; replaceKeepingFocus(this.details, shown) }
    // Moving between the two views puts the focus where to start.
    if (window !== this.window) {
      const previous = this.window
      this.window = window
      if (window === 'details') {
        // The details start at the top of the sheet, All routes first.
        const scroller = this.root.closest<HTMLElement>('.m-panel-body')
        if (scroller) scroller.scrollTop = 0
        this.root.querySelector<HTMLButtonElement>('.m-route-back')!.focus({ preventScroll: true })
      }
      else if (previous === 'details') this.list.querySelector<HTMLElement>('.m-route-row')?.focus({ preventScroll: true })
    }
  }

  /** Lights a route's mark and its row; from the chart, scrolls the row into view. */
  private light(index: number, scroll: boolean): void {
    for (const element of this.root.querySelectorAll<HTMLElement>('.route-front-point, .m-route-row')) element.classList.toggle('is-lit', element.dataset.route === String(index))
    const row = this.list.querySelector<HTMLElement>(`.m-route-row[data-route="${index}"]`)
    if (scroll && row) row.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }

  private setText(selector: string, value: string): void {
    const element = this.root.querySelector(selector)!
    if (element.textContent !== value) element.textContent = value
  }
}
