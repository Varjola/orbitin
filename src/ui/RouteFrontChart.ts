import { format, text } from '../i18n/index.ts'
import type { RouteFamily } from '../simulation/route/routeModel.ts'
import { html, trusted } from './markup.ts'
import type { RouteFrontPointModel, RouteListModel } from './routePanelModel.ts'
import { deltaVText, spanText } from './routeWording.ts'

const MINUTE = 60
const HOUR = 3600
const DAY = 86_400
/** The chart's own units, which the page scales to the drawer's width. */
export const FRONT_CHART_WIDTH = 300
export const FRONT_CHART_HEIGHT = 168
const MARGIN = { left: 44, right: 12, top: 14, bottom: 24 } as const
/** Ticks on the time axis at least this far apart, and on the Δv axis. */
const MIN_TICK_GAP = 42
const MIN_DELTA_V_TICK_GAP = 16
/** 1, 2 and 5 in every decade from 1 m/s to 50 km/s. */
const DELTA_V_TICKS = [-3, -2, -1, 0, 1].flatMap((power) => [1, 2, 5].map((digit) => digit * 10 ** power))
const TIME_TICKS = [10 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 60 * DAY, 120 * DAY, 365 * DAY]
/** The order the legend lists families in, and each family's colour and mark.
 *  Checked for colour-blind separation on the drawer's surface; the shape carries
 *  the family too. */
export const FAMILY_ORDER: readonly RouteFamily[] = ['direct', 'turnAtNode', 'goHigh', 'drift']
const FAMILY_COLOURS: Readonly<Record<RouteFamily, string>> = { direct: '#3987e5', turnAtNode: '#d95926', goHigh: '#199e70', drift: '#c98500' }

export interface FrontTick { readonly at: number; readonly value: number }

export interface FrontChartLayout {
  /** Each route's mark, in chart units, in front order. */
  readonly points: readonly { readonly x: number; readonly y: number }[]
  readonly timeTicks: readonly FrontTick[]
  readonly deltaVTicks: readonly FrontTick[]
  /** Where the goal's limit or budget is drawn, if it is in the chart. */
  readonly limitX: number | null
  readonly budgetY: number | null
  readonly plot: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }
}

/** Where everything goes: arrival and Δv both on logarithmic axes, since a front
 *  runs from minutes to months and from tens of m/s to tens of km/s. */
export function frontChartLayout(front: readonly RouteFrontPointModel[], limitSeconds: number | null, budgetKmPerSecond: number | null): FrontChartLayout {
  const plot = { left: MARGIN.left, right: FRONT_CHART_WIDTH - MARGIN.right, top: MARGIN.top, bottom: FRONT_CHART_HEIGHT - MARGIN.bottom }
  const arrivals = front.map((point) => point.arrivalSeconds)
  const firstArrival = Math.min(...arrivals)
  const lastArrival = Math.max(...arrivals, limitSeconds ?? 0)
  const fromLog = Math.log10(firstArrival / 1.4)
  const toLog = Math.log10(Math.max(lastArrival * 1.15, firstArrival * 4))
  const x = (seconds: number) => plot.left + ((Math.log10(seconds) - fromLog) / (toLog - fromLog)) * (plot.right - plot.left)

  const costs = front.map((point) => point.deltaVKmPerSecond)
  const highest = Math.max(...costs)
  const lowest = Math.max(1e-3, Math.min(...costs))
  // A budget far from every route would squash them, so it is left out.
  const shownBudget = budgetKmPerSecond !== null && budgetKmPerSecond <= 3 * highest && budgetKmPerSecond >= lowest / 3 ? budgetKmPerSecond : null
  const bottomLog = Math.log10(Math.min(lowest, shownBudget ?? Infinity) / 1.3)
  const topLog = Math.log10(Math.max(Math.max(highest, shownBudget ?? 0) * 1.3, lowest * 4))
  const y = (kmPerSecond: number) => plot.bottom - ((Math.log10(kmPerSecond) - bottomLog) / (topLog - bottomLog)) * (plot.bottom - plot.top)

  const timeTicks: FrontTick[] = []
  for (const seconds of TIME_TICKS) {
    const at = x(seconds)
    if (at < plot.left || at > plot.right) continue
    const previous = timeTicks[timeTicks.length - 1]
    if (previous === undefined || at - previous.at >= MIN_TICK_GAP) timeTicks.push({ at, value: seconds })
  }
  const deltaVTicks: FrontTick[] = []
  for (const value of DELTA_V_TICKS) {
    const at = y(value)
    if (at < plot.top || at > plot.bottom) continue
    const previous = deltaVTicks[deltaVTicks.length - 1]
    if (previous === undefined || previous.at - at >= MIN_DELTA_V_TICK_GAP) deltaVTicks.push({ at, value })
  }
  return {
    points: front.map((point) => ({ x: x(point.arrivalSeconds), y: y(point.deltaVKmPerSecond) })),
    timeTicks,
    deltaVTicks,
    limitX: limitSeconds === null ? null : x(limitSeconds),
    budgetY: shownBudget === null ? null : y(shownBudget),
    plot,
  }
}

function timeTickText(seconds: number): string {
  const t = text().routePlanner
  if (seconds < HOUR) return t.frontTickMinutes(seconds / MINUTE)
  return seconds < DAY ? t.frontTickHours(seconds / HOUR) : t.frontTickDays(seconds / DAY)
}

/** A family's mark, centred on the origin, with a ring in the surface colour so
 *  touching marks stay apart. */
export function familyMark(family: RouteFamily, size: number): string {
  const colour = FAMILY_COLOURS[family]
  const ring = 'stroke="#091625" stroke-width="2" paint-order="stroke"'
  switch (family) {
    case 'direct': return `<circle r="${size}" fill="${colour}" ${ring}/>`
    case 'turnAtNode': return `<rect x="${-size * 0.9}" y="${-size * 0.9}" width="${size * 1.8}" height="${size * 1.8}" rx="1.5" fill="${colour}" ${ring}/>`
    case 'goHigh': return `<path d="M0 ${-size * 1.15} L${size * 1.1} ${size * 0.8} L${-size * 1.1} ${size * 0.8} Z" fill="${colour}" stroke-linejoin="round" ${ring}/>`
    case 'drift': return `<path d="M0 ${-size * 1.25} L${size * 1.1} 0 L0 ${size * 1.25} L${-size * 1.1} 0 Z" fill="${colour}" stroke-linejoin="round" ${ring}/>`
  }
}

function familyName(family: RouteFamily): string {
  return text().routePlanner.families[family].name
}

export function frontRouteLabel(point: RouteFrontPointModel): string {
  return text().routePlanner.frontRoute(deltaVText(point.deltaVKmPerSecond), spanText(point.arrivalSeconds), familyName(point.family))
}

/** The shortlist as Δv against arrival time: each route a mark that shows its
 *  details when pressed, the limits as lines, and the cheapest Δv by each time as a
 *  step. The table beside it says the same in words. */
export function frontChartMarkup(list: RouteListModel): string {
  const t = text().routePlanner
  const f = format()
  const front = list.routes
  if (front.length === 0) return ''
  const layout = frontChartLayout(front, list.limits.timeSeconds, list.limits.deltaVKmPerSecond)
  const { plot } = layout
  const grid = layout.deltaVTicks.map((tick) => `<line x1="${plot.left}" x2="${plot.right}" y1="${tick.at}" y2="${tick.at}" class="route-front-grid"/><text x="${plot.left - 5}" y="${tick.at + 3.5}" text-anchor="end" class="route-front-tick">${f.integer(tick.value * 1000)}</text>`).join('')
  const ticks = layout.timeTicks.map((tick) => `<line x1="${tick.at}" x2="${tick.at}" y1="${plot.bottom}" y2="${plot.bottom + 4}" class="route-front-axis"/><text x="${tick.at}" y="${plot.bottom + 17}" text-anchor="middle" class="route-front-tick">${html`${timeTickText(tick.value)}`}</text>`).join('')
  // The cheapest Δv by each time: flat until the next route, then down to it.
  const steps = layout.points.map((point, index) => {
    const next = layout.points[index + 1]
    return next === undefined ? `${point.x},${point.y}` : `${point.x},${point.y} ${next.x},${point.y}`
  }).join(' ')
  const limit = layout.limitX === null ? '' : `<line x1="${layout.limitX}" x2="${layout.limitX}" y1="${plot.top}" y2="${plot.bottom}" class="route-front-goal"/><text x="${layout.limitX - 3}" y="${plot.top + 8}" text-anchor="end" class="route-front-goal-text">${html`${t.frontLimit}`}</text>`
  const budget = layout.budgetY === null ? '' : `<line x1="${plot.left}" x2="${plot.right}" y1="${layout.budgetY}" y2="${layout.budgetY}" class="route-front-goal"/><text x="${plot.right}" y="${layout.budgetY - 3}" text-anchor="end" class="route-front-goal-text">${html`${t.frontBudget}`}</text>`
  const svg = `<svg class="route-front-plot" viewBox="0 0 ${FRONT_CHART_WIDTH} ${FRONT_CHART_HEIGHT}" aria-hidden="true" focusable="false">
    ${grid}<line x1="${plot.left}" x2="${plot.right}" y1="${plot.bottom}" y2="${plot.bottom}" class="route-front-axis"/>${ticks}
    ${limit}${budget}<polyline points="${steps}" class="route-front-step"/></svg>`
  const marks = front.map((point, index) => {
    const at = layout.points[index]!
    return html`<button type="button" class="route-front-point" data-route="${String(index)}" aria-label="${frontRouteLabel(point)}" tabindex="-1" style="left:${String((at.x / FRONT_CHART_WIDTH) * 100)}%;top:${String((at.y / FRONT_CHART_HEIGHT) * 100)}%"><svg viewBox="-9 -9 18 18" aria-hidden="true" focusable="false">${trusted(familyMark(point.family, 4.6))}</svg></button>`
  }).join('')
  const families = FAMILY_ORDER.filter((family) => front.some((point) => point.family === family))
  const legend = families.map((family) => html`<li><svg viewBox="-7 -7 14 14" aria-hidden="true" focusable="false">${trusted(familyMark(family, 4))}</svg>${familyName(family)}</li>`).join('')
  return html`
    <section class="field-group route-front" aria-labelledby="route-front-heading">
      <div class="group-heading"><span id="route-front-heading">${t.front}</span></div>
      <p class="time-note">${t.frontHint}</p>
      <p class="route-front-caption route-front-caption-y">${t.frontAxisDeltaV}</p>
      <div class="route-front-chart">${trusted(svg)}${trusted(marks)}<div class="route-front-tip" role="presentation" hidden></div></div>
      <p class="route-front-caption">${t.frontAxisTime}</p>
      <ul class="route-front-legend">${trusted(legend)}</ul>
    </section>
  `
}

/** The shortlist in words: how long, how much and how, a row for each route. A
 *  row shows its route's details, and is the same route as the chart's mark. */
export function routeTableMarkup(list: RouteListModel): string {
  const t = text().routePlanner
  const rows = list.routes.map((point, index) => html`
    <tr class="route-row" data-route="${String(index)}">
      <td><button type="button" class="route-row-button" data-route="${String(index)}" aria-label="${t.planning.details}: ${frontRouteLabel(point)}">${spanText(point.arrivalSeconds)}</button></td>
      <td>${deltaVText(point.deltaVKmPerSecond)}</td>
      <td><span class="route-row-family"><svg viewBox="-7 -7 14 14" aria-hidden="true" focusable="false">${trusted(familyMark(point.family, 4))}</svg>${familyName(point.family)}</span></td>
    </tr>`).join('')
  return html`
    <section class="field-group route-list" aria-labelledby="route-list-heading">
      <div class="group-heading"><span id="route-list-heading">${t.planning.routes}</span></div>
      <p class="time-note">${t.planning.routesHint}</p>
      <table class="route-list-table">
        <thead><tr><th scope="col">${t.arrivesIn}</th><th scope="col">${t.frontDeltaV}</th><th scope="col">${t.familyHeading}</th></tr></thead>
        <tbody>${trusted(rows)}</tbody>
      </table>
    </section>
  `
}
