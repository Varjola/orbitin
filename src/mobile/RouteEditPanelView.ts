import { EARTH_RADIUS_KM } from '../core/constants.ts'
import { format, text } from '../i18n/index.ts'
import type { RouteSeparation } from '../simulation/route/routeObjects.ts'
import { html, trusted } from '../ui/markup.ts'
import type { RoutePanelModel } from '../ui/routePanelModel.ts'
import { blockedText, deltaVText, sideTitle, spanText } from '../ui/routeWording.ts'
import { termLabelMarkup, type TermId } from '../ui/termLabel.ts'
import { icon } from './mobileIcons.ts'
import { RulerView, type RulerEnvironment } from './RulerView.ts'
import { ROUTE_EDIT_PARAMETERS, routeRulerSpec, routeRulerValue, signedDegrees, type RouteEditParameter, type RouteSide, type RouteSnap } from './routeRulerModel.ts'
import { snapAt, type RulerSpec, type SnapPoint } from './shapeRulerModel.ts'

const SIDES: readonly RouteSide[] = ['own', 'target']
const TERMS: Readonly<Record<RouteEditParameter, TermId | null>> = { height: null, tilt: 'inclination', node: 'raan', ahead: null }
/** Height gaps below this read as the same height. */
const SAME_HEIGHT_KM = 0.5
/** Planes closer than this read as one. */
const SAME_PLANE_RAD = Math.PI / 3600
/** The line-up time is named once the planes are visibly apart, as on the desktop. */
const LINE_UP_SHOWN_ABOVE_RAD = Math.PI / 360
/** A target within half a degree is beside the interceptor. */
const TOGETHER_DEG = 0.5

export interface RouteEditCallbacks {
  onSide(side: RouteSide): void
  onParameter(parameter: RouteEditParameter): void
  onSwap(): void
  onChoose(): void
  onValue(parameter: RouteEditParameter, value: number): void
}

function otherSide(side: RouteSide): RouteSide { return side === 'own' ? 'target' : 'own' }

/** Where the target is, as the phone says it. */
export function aheadText(phaseAheadRad: number): string {
  const t = text().mobile.route
  const degrees = phaseAheadRad * 180 / Math.PI
  if (Math.abs(degrees) < TOGETHER_DEG) return t.together
  const value = `${format().number(Math.abs(degrees), 0)}°`
  return degrees > 0 ? t.ahead(value) : t.behind(value)
}

export function heightGapText(separation: RouteSeparation): string {
  const gap = separation.altitudeGapKm
  const t = text().routePlanner.separation
  if (Math.abs(gap) < SAME_HEIGHT_KM) return text().mobile.route.sameHeight
  return gap > 0 ? t.targetHigher(format().km(gap)) : t.targetLower(format().km(-gap))
}

export function planeText(separation: RouteSeparation, withLineUp: boolean): string {
  const t = text().mobile.route
  if (separation.planeAngleRad < SAME_PLANE_RAD) return t.samePlane
  const apart = t.planesApart(format().degrees(separation.planeAngleRad, 1))
  return withLineUp && separation.lineUpSeconds !== null && separation.planeAngleRad > LINE_UP_SHOWN_ABOVE_RAD ? `${apart} · ${t.lineUp(spanText(separation.lineUpSeconds))}` : apart
}

/** The line above the dock: where the target is, the height gap and the planes,
 *  in short forms, the target being understood. */
export function separationLine(separation: RouteSeparation): string {
  const t = text().mobile.route
  const f = format()
  const degrees = separation.phaseAheadRad * 180 / Math.PI
  const angle = `${f.number(Math.abs(degrees), 0)}°`
  const ahead = Math.abs(degrees) < TOGETHER_DEG ? t.together : degrees > 0 ? t.lineAhead(angle) : t.lineBehind(angle)
  const gap = separation.altitudeGapKm
  const height = Math.abs(gap) < SAME_HEIGHT_KM ? t.sameHeight : gap > 0 ? t.lineHigher(f.km(gap)) : t.lineLower(f.km(-gap))
  return [ahead, height, planeText(separation, false)].join(' · ')
}

/** The one consequence line of a chip, from figures the desktop panel already shows. */
export function routeConsequence(parameter: RouteEditParameter, model: Pick<RoutePanelModel, 'separation' | 'own' | 'target'>, side: RouteSide): string {
  const t = text().mobile.route
  const { separation } = model
  switch (parameter) {
    case 'height':
      if (!model[side].circular) return t.makesCircular
      // At one height there is no climb to cost.
      return Math.abs(separation.altitudeGapKm) < SAME_HEIGHT_KM ? t.sameHeight : `${heightGapText(separation)} · ${t.heightCost(deltaVText(separation.altitudeOnlyKmPerSecond))}`
    case 'tilt': case 'node': return planeText(separation, true)
    case 'ahead': return aheadText(separation.phaseAheadRad)
  }
}

/** A ruler value as the heading shows it. */
export function routeValueText(parameter: RouteEditParameter, value: number): string {
  const f = format()
  switch (parameter) {
    case 'height': return f.km(value - EARTH_RADIUS_KM)
    case 'tilt': return `${f.number(value, 1)}°`
    case 'node': return `${f.integer(Math.round(value) % 360)}°`
    case 'ahead': return `${f.number(signedDegrees(value), 0)}°`
  }
}

/** A snap point's name, the other object's ones named after it. */
export function routeSnapText(snap: SnapPoint<RouteSnap>, side: RouteSide): string {
  const t = text().mobile.route
  const other = otherSide(side)
  switch (snap.label) {
    case null: return ''
    case 'otherHeight': return t.otherHeight[other]
    case 'otherTilt': return t.otherTilt[other]
    case 'otherNode': return t.otherNode[other]
    default: return t.snaps[snap.label]
  }
}

export function routeEditMarkup(): string {
  const t = text().mobile.route
  const r = text().routePlanner
  const side = (value: RouteSide) => html`<button type="button" data-side="${value}" aria-pressed="false"><span class="m-dot m-route-dot-${value}" aria-hidden="true"></span>${value === 'own' ? r.yourSatellite : r.target}</button>`
  const chip = (parameter: RouteEditParameter) => html`<button class="m-shape-chip" type="button" data-parameter="${parameter}" aria-pressed="false">${t.chips[parameter]}</button>`
  return html`
    <div class="m-route-edit-top">
      <div class="m-segments m-route-sides" role="group" aria-label="${t.sides}">${trusted(SIDES.map(side).join(''))}</div>
      <button class="m-icon-button m-route-swap" type="button" aria-label="${r.swapLabel}">${trusted(icon('swap'))}</button>
      <button class="m-pill m-route-choose-button" type="button" aria-haspopup="dialog" aria-label="${t.chooseName}">${trusted(icon('list'))}</button>
    </div>
    <p class="m-caption m-route-name"></p>
    <div class="m-shape-chips" role="group" aria-label="${t.editName}">${trusted(ROUTE_EDIT_PARAMETERS.map(chip).join(''))}</div>
    <div class="m-shape-editor">
      <p class="m-shape-heading"><span class="m-shape-term"></span><span class="m-shape-value"></span></p>
      <p class="m-line m-shape-line" role="status"></p>
      <div class="m-ruler-mount"></div>
    </div>
  `
}

/** The Route Planner's Edit strip, in the manner of the Shape strip: a switch
 *  chooses the object, the chips one value, and the ruler sets it while both
 *  orbits stay in view. Swap trades the two; Choose opens the examples and the
 *  catalogue for the object chosen. */
export class RouteEditPanelView {
  readonly root: HTMLElement
  readonly chooseButton: HTMLButtonElement
  private readonly ruler: RulerView<RouteSnap>
  private readonly chips: readonly HTMLButtonElement[]
  private readonly sides: readonly HTMLButtonElement[]
  private side: RouteSide = 'own'
  private parameter: RouteEditParameter = 'height'
  private spec: RulerSpec<RouteSnap> | null = null
  private specKey = ''
  private headingKey = ''

  constructor(documentRef: Document, callbacks: RouteEditCallbacks, environment: RulerEnvironment) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-shape m-route-edit'
    this.root.innerHTML = routeEditMarkup()
    this.chips = [...this.root.querySelectorAll<HTMLButtonElement>('.m-shape-chip')]
    this.sides = [...this.root.querySelectorAll<HTMLButtonElement>('[data-side]')]
    this.chooseButton = this.root.querySelector<HTMLButtonElement>('.m-route-choose-button')!
    this.ruler = new RulerView<RouteSnap>(documentRef, { onChange: (value) => callbacks.onValue(this.parameter, value), onAdjust: () => {} }, environment)
    this.root.querySelector('.m-ruler-mount')!.append(this.ruler.root)
    for (const chip of this.chips) chip.addEventListener('click', () => callbacks.onParameter(chip.dataset.parameter as RouteEditParameter))
    for (const button of this.sides) button.addEventListener('click', () => callbacks.onSide(button.dataset.side as RouteSide))
    this.root.querySelector('.m-route-swap')!.addEventListener('click', () => callbacks.onSwap())
    this.chooseButton.addEventListener('click', () => callbacks.onChoose())
  }

  sync(model: RoutePanelModel | null, side: RouteSide, parameter: RouteEditParameter, loading: boolean): void {
    this.side = side
    this.parameter = parameter
    const disabled = loading || model === null
    for (const control of this.root.querySelectorAll<HTMLButtonElement>('button')) control.disabled = disabled
    this.ruler.setDisabled(disabled)
    for (const button of this.sides) button.setAttribute('aria-pressed', String(button.dataset.side === side))
    for (const chip of this.chips) chip.setAttribute('aria-pressed', String(chip.dataset.parameter === parameter))
    if (!model) return
    const t = text().mobile.route
    // Ahead belongs to the pair: it reads the same for either object.
    const name = parameter === 'ahead' ? '' : sideTitle(model[side])
    const nameElement = this.root.querySelector<HTMLElement>('.m-route-name')!
    if (nameElement.textContent !== name) nameElement.textContent = name
    const self = model[side].values
    const other = model[otherSide(side)].values
    const aheadDeg = model.separation.phaseAheadRad * 180 / Math.PI
    const value = routeRulerValue(parameter, self, aheadDeg)
    const round = (number: number) => Math.round(number * 10)
    const key = [parameter, side, round(other.perigeeAltitudeKm + other.apogeeAltitudeKm), round(other.inclinationDeg), round(other.raanDeg), parameter === 'tilt' ? round(self.perigeeAltitudeKm + self.apogeeAltitudeKm) : 0, parameter === 'tilt' ? round(self.raanDeg) : parameter === 'node' ? round(self.inclinationDeg) : 0].join('|')
    if (key !== this.specKey || this.spec === null) {
      this.specKey = key
      this.spec = routeRulerSpec(parameter, { self, other })
      this.ruler.setSpec(this.spec, value, (snap) => routeSnapText(snap, this.side))
    } else this.ruler.setValue(value)
    const headingKey = `${parameter}|${t.terms[parameter]}`
    if (headingKey !== this.headingKey) {
      this.headingKey = headingKey
      const term = TERMS[parameter]
      this.root.querySelector('.m-shape-term')!.innerHTML = term ? termLabelMarkup(t.terms[parameter], term) : html`${t.terms[parameter]}`
    }
    const valueText = routeValueText(parameter, value)
    this.setText('.m-shape-value', valueText)
    // A setup that cannot be planned says why here, where it is changed.
    this.setText('.m-shape-line', model.blocked !== null ? blockedText(model.blocked) : routeConsequence(parameter, model, side))
    const snap = snapAt(this.spec, value)
    const snapName = snap ? routeSnapText(snap, side) : ''
    this.ruler.setAccessibleText(t.terms[parameter], text().mobile.shape.valueText(valueText, snapName))
  }

  dispose(): void { this.ruler.dispose() }

  private setText(selector: string, value: string): void {
    const element = this.root.querySelector(selector)!
    if (element.textContent !== value) element.textContent = value
  }
}
