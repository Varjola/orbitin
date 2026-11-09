import { format, text } from '../i18n/index.ts'
import type { RouteProfile } from '../simulation/route/routeDrawing.ts'
import { html, trusted } from './markup.ts'
import type { RouteBurnRow, RouteLegModel, RoutePairModel, RouteResultModel, RouteShownModel } from './routePanelModel.ts'
import { burnChangeLines, burnDirectionText, burnOrbitText, burnPartText, deltaVText, routeNotes, sideTitle, spanText } from './routeWording.ts'

/** The pieces a route is shown with, in the planning window and in the drawer
 *  beside its playback. */

/** A burn's numbers, behind its box's Details toggle. */
function burnFactsMarkup(burn: RouteBurnRow): string {
  const t = text().routePlanner
  const f = format()
  const row = (label: string, value: string) => html`<span>${label}</span><strong>${value}</strong>`
  return [
    row(t.purpose, t.purposes[burn.purpose]),
    row(t.burnTime, t.afterStart(spanText(burn.atSeconds))),
    row(t.burnSize, deltaVText(burn.sizeKmPerSecond)),
    row(t.prograde, `${burnPartText(burn.progradeKmPerSecond)} ${t.burnUnits}`),
    row(t.normal, `${burnPartText(burn.normalKmPerSecond)} ${t.burnUnits}`),
    row(t.radial, `${burnPartText(burn.outwardKmPerSecond)} ${t.burnUnits}`),
    row(t.orbitAfter, burnOrbitText(burn)),
    row(t.inclinationAfter, f.degrees(burn.after.inclinationRad, 1)),
  ].join('')
}

/** One burn as a box: when, what for, which way and what it changes, with its
 *  numbers behind a toggle. Beside playback it can also show the burn in the view. */
function burnBoxMarkup(burn: RouteBurnRow, selectable: boolean): string {
  const t = text().routePlanner
  const show = selectable ? html`<button class="link-button route-burn-select" type="button" data-burn="${String(burn.number - 1)}" aria-label="${t.showBurn(burn.number)}">${t.showInView}</button>` : ''
  return html`
    <li class="route-burn-words" data-burn-box="${String(burn.number - 1)}">
      <span class="route-burn-words-head"><span class="route-burn-number" aria-hidden="true">${String(burn.number)}</span>${t.planning.burnLine(t.burnNumber(burn.number), t.afterStart(spanText(burn.atSeconds)), t.purposes[burn.purpose])}</span>
      <strong>${burnDirectionText(burn)}</strong>
      ${trusted(burnChangeLines(burn).map((line) => html`<span class="route-burn-change">${line}</span>`).join(''))}
      <details class="route-burn-facts" data-burn-facts="${String(burn.number - 1)}">
        <summary>${t.burnDetails}</summary>
        <div class="readout-grid">${trusted(burnFactsMarkup(burn))}</div>
      </details>
      ${trusted(show)}
    </li>`
}

function legMarkup(leg: RouteLegModel): string {
  const t = text().routePlanner.planning
  return html`<li class="route-timeline-leg route-timeline-leg-${leg.kind}"><span class="route-timeline-key" aria-hidden="true"></span>${t.legLine(t.legs[leg.kind], spanText(leg.toSeconds - leg.fromSeconds))}</li>`
}

/** The route in order: from the start, each wait, transfer or drift between the
 *  burns, and each burn as a box, until it is matched with the target. */
export function burnTimelineMarkup(route: Pick<RouteResultModel, 'burns' | 'legs' | 'arrivalSeconds'>, selectable: boolean): string {
  const t = text().routePlanner
  const items: string[] = [html`<li class="route-timeline-end">${t.planning.start}</li>`]
  let leg = 0
  for (const burn of route.burns) {
    while (leg < route.legs.length && route.legs[leg]!.fromSeconds < burn.atSeconds) items.push(legMarkup(route.legs[leg++]!))
    items.push(burnBoxMarkup(burn, selectable))
  }
  while (leg < route.legs.length) items.push(legMarkup(route.legs[leg++]!))
  items.push(html`<li class="route-timeline-end">${t.afterStart(spanText(route.arrivalSeconds))} · ${t.planning.arrival}</li>`)
  return html`<ol class="route-burn-list route-timeline-list">${trusted(items.join(''))}</ol><p class="time-note">${t.directionsNote}</p>`
}

const PROFILE_WIDTH = 1000
const PROFILE_HEIGHT = 40

/** The interceptor's height and the angle between the planes along the route, in
 *  playback time so they line up with the timeline below. Height runs from the
 *  lowest to the highest of the route; the angle from zero to its widest. */
export function profileMarkup(profile: RouteProfile): string {
  const line = (values: readonly number[], low: number, high: number) => values.map((value, index) => {
    const x = (PROFILE_WIDTH * index) / Math.max(1, values.length - 1)
    const y = high > low ? PROFILE_HEIGHT - 3 - ((value - low) / (high - low)) * (PROFILE_HEIGHT - 6) : PROFILE_HEIGHT / 2
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  const turns = profile.widestRad > 1e-4
  return `<svg viewBox="0 0 ${PROFILE_WIDTH} ${PROFILE_HEIGHT}" preserveAspectRatio="none" aria-hidden="true" focusable="false">`
    + `<path class="route-profile-altitude" d="${line(profile.altitudeKm, profile.lowestKm, profile.highestKm)}" vector-effect="non-scaling-stroke"/>`
    + (turns ? `<path class="route-profile-plane" d="${line(profile.planeAngleRad, 0, profile.widestRad)}" vector-effect="non-scaling-stroke"/>` : '')
    + '</svg>'
}

/** The profile's key: each line's colour beside what it is, with its range. */
export function profileCaptionMarkup(profile: RouteProfile): string {
  const t = text().routePlanner.playback
  const f = format()
  const height = html`<span class="route-profile-key-altitude">${t.profileHeight(f.number(profile.lowestKm), f.km(profile.highestKm))}</span>`
  return profile.widestRad > 1e-4 ? html`${trusted(height)}<span class="route-profile-key-plane">${t.profilePlanes(f.degrees(profile.widestRad, 1))}</span>` : height
}

/** The route as playback runs it, the same as the playback bar: the height and
 *  plane profile above waits, drifts and transfers as wide as their playback time,
 *  each burn numbered. */
export function timelineStripMarkup(route: Pick<RouteResultModel, 'timeline' | 'arrivalSeconds'>): string {
  const t = text().routePlanner
  const { segments, durationTau, profile } = route.timeline
  if (!(durationTau > 0)) return ''
  const spans = segments.map((segment) => {
    const left = (100 * segment.fromTau) / durationTau
    const width = (100 * (segment.toTau - segment.fromTau)) / durationTau
    const number = segment.burnIndex === null ? '' : String(segment.burnIndex + 1)
    return html`<span class="route-track-${segment.kind}" style="left: ${left.toFixed(3)}%; width: ${width.toFixed(3)}%">${number}</span>`
  }).join('')
  return html`
    <section class="field-group route-timeline">
      <div class="group-heading"><span>${t.planning.timeline}</span></div>
      <div class="route-profile"><div class="route-profile-plot">${trusted(profileMarkup(profile))}</div><p class="route-profile-caption">${trusted(profileCaptionMarkup(profile))}</p></div>
      <div class="route-timeline-strip route-track-segments" aria-hidden="true">${trusted(spans)}</div>
      <div class="route-timeline-ends"><span>${t.planning.start}</span><span>${t.afterStart(spanText(route.arrivalSeconds))}</span></div>
      <p class="time-note">${t.planning.timelineNote}</p>
    </section>
  `
}

/** Propellant against everything else at the start, at the engine's Isp, and the
 *  route against the fuel limit when one is set. */
export function fuelMarkup(result: RouteResultModel): string {
  const t = text().routePlanner
  const f = format()
  const share = f.percent(result.propellantFraction, 1)
  const limit = result.limits.deltaVKmPerSecond
  const tanks = limit === null ? '' : result.tanks <= 1 ? t.withinTank(deltaVText(limit)) : t.tanks(f.number(result.tanks, result.tanks < 10 ? 1 : 0), deltaVText(limit))
  const width = Math.min(100, Math.max(0, result.propellantFraction * 100))
  return html`
    <section class="field-group route-fuel">
      <div class="group-heading"><span>${t.fuel}</span><span class="group-hint">${t.propellantShare(share, f.integer(result.specificImpulseSeconds))}</span></div>
      <div class="route-fuel-bar" role="img" aria-label="${t.propellantBar(share)}"><span class="route-fuel-propellant" style="width:${width.toFixed(2)}%"></span><span class="route-fuel-rest"></span></div>
      <ul class="route-fuel-legend" aria-hidden="true"><li class="route-fuel-key-propellant">${t.propellantPart}</li><li class="route-fuel-key-rest">${t.restPart}</li></ul>
      ${trusted(tanks === '' ? '' : html`<p class="time-note">${tanks}</p>`)}
    </section>
  `
}

/** What Δv real satellites carry for their whole life, to judge a route's
 *  cost by: the Route Planner's info note on desktop and phone. */
export function budgetsMarkup(): string {
  const t = text().routePlanner.budgets
  return html`<p>${t.intro}</p><ul>${trusted(t.anchors.map((anchor) => html`<li>${anchor}</li>`).join(''))}</ul><p>${t.outro}</p>`
}

/** The route beside changing height alone; the rest is plane and phase together. */
export function costMarkup(result: RouteResultModel): string {
  const t = text().routePlanner
  const rest = Math.max(0, result.totalDeltaVKmPerSecond - result.altitudeOnlyKmPerSecond)
  return html`
    <section class="field-group route-cost">
      <div class="group-heading"><span>${t.cost}</span></div>
      <div class="readout-grid">
        <span>${t.thisRoute}</span><strong>${deltaVText(result.totalDeltaVKmPerSecond)}</strong>
        <span>${t.altitudeOnly}</span><strong>${deltaVText(result.altitudeOnlyKmPerSecond)}</strong>
        <span>${t.planeAndPhase}</span><strong>${deltaVText(rest)}</strong>
      </div>
      <p class="time-note">${t.costNote}</p>
    </section>
  `
}

export function pairText(pair: RoutePairModel): string {
  return text().routePlanner.pair(sideTitle({ label: pair.own, edited: pair.ownEdited }), sideTitle({ label: pair.target, edited: pair.targetEdited }))
}

export function notesMarkup(notes: readonly string[]): string {
  return notes.length > 0 ? html`<ul class="route-notes">${trusted(notes.map((note) => html`<li>${note}</li>`).join(''))}</ul>` : ''
}

/** One route: its cost, its arrival, its kind and, when it was fine-tuned, by how much. */
export function routeSummaryMarkup(shown: RouteShownModel): string {
  const t = text().routePlanner
  const f = format()
  const family = t.families[shown.family]
  const tuned = shown.fineTunedSavingKmPerSecond === null ? t.planning.notFineTuned : t.planning.fineTuned(deltaVText(shown.fineTunedSavingKmPerSecond))
  return html`
    <p class="route-pair">${pairText(shown)}</p>
    <p class="route-total"><strong>${deltaVText(shown.totalDeltaVKmPerSecond)}</strong> <span>${t.total}</span></p>
    ${trusted(notesMarkup(routeNotes(shown)))}
    <p class="time-note route-fine-tune">${tuned}</p>
    <div class="readout-grid route-summary">
      <span>${t.arrivesIn}</span><strong>${spanText(shown.arrivalSeconds)}</strong>
      <span>${t.burns}</span><strong>${f.integer(shown.burns.length)}</strong>
    </div>
    <section class="field-group">
      <div class="group-heading"><span>${family.name}</span></div>
      <p class="route-family-line">${family.explanation}</p>
    </section>
  `
}
