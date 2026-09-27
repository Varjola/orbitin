import { EARTH_RADIUS_KM } from '../core/constants.ts'
import { deriveOrbitValues, type EditedGeometryField, type ElementConstraint } from '../orbital/geometry.ts'
import { classifyElements } from '../orbital/elementConditioning.ts'
import type { OrbitalObject, PropagationModel } from '../simulation/OrbitalObject.ts'
import type { SunSynchronousStatus } from '../simulation/propagationTransitions.ts'
import { format, text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'
import { termLabelMarkup, type TermId } from '../ui/termLabel.ts'
import { icon } from './mobileIcons.ts'
import { SHAPE_PARAMETERS, type ShapeParameter } from './mobileShellState.ts'
import { RulerView, type RulerEnvironment } from './RulerView.ts'
import { rulerSpec, snapAt, type RulerParameter, type RulerSpec, type SnapPoint } from './shapeRulerModel.ts'

export interface ShapeStripCallbacks {
  onParameter(parameter: ShapeParameter): void
  onGeometryChange(field: EditedGeometryField, value: number): void
  onPhaseChange(trueAnomalyRad: number): void
  onPropagationChange(kind: PropagationModel['kind']): void
  onSunSynchronousLockChange(enabled: boolean): void
  onAdjust(phase: 'start' | 'end', parameter: ShapeParameter): void
  onNewOrbit(): void
}

export interface ShapeStripInput {
  /** The selected Orbit Lab orbit, or null. */
  readonly object: OrbitalObject | null
  readonly sceneEmpty: boolean
  readonly parameter: ShapeParameter
  readonly constraint: ElementConstraint
  readonly lockStatus: SunSynchronousStatus
  readonly loading: boolean
}

const TERMS: Readonly<Record<ShapeParameter, TermId | null>> = {
  size: 'semiMajorAxis', shape: 'eccentricity', tilt: 'inclination', node: 'raan', periapsis: 'argumentOfPeriapsis', position: 'trueAnomaly', drift: null,
}
const FIELDS: Readonly<Record<Exclude<RulerParameter, 'position'>, EditedGeometryField>> = {
  size: 'semiMajorAxisKm', shape: 'eccentricity', tilt: 'inclinationRad', node: 'raanRad', periapsis: 'argOfPeriapsisRad',
}
const DEG = 180 / Math.PI
/** "At periapsis" and "At apoapsis" within this many degrees of true anomaly. */
const APSIS_NEAR_DEG = 5

/** The ruler value of one chip, in the ruler's unit. */
export function rulerValueOf(parameter: RulerParameter, object: OrbitalObject, trueAnomalyRad: number): number {
  if (object.source.kind !== 'keplerian') return 0
  const geometry = object.source.geometry
  switch (parameter) {
    case 'size': return geometry.semiMajorAxisKm
    case 'shape': return geometry.eccentricity
    case 'tilt': return geometry.inclinationRad * DEG
    case 'node': return geometry.raanRad * DEG
    case 'periapsis': return geometry.argOfPeriapsisRad * DEG
    case 'position': return trueAnomalyRad * DEG
  }
}

/** A ruler value as the heading shows it. */
export function rulerValueText(spec: RulerSpec, value: number): string {
  const f = format()
  if (spec.unit === 'km') return f.km(value)
  if (spec.unit === 'deg') return `${f.number(value, 1)}°`
  return f.number(value, 3)
}

/** The short lock status line. */
export function lockLine(status: SunSynchronousStatus): string {
  const t = text().mobile.shape
  switch (status.kind) {
    case 'none': return ''
    case 'applied': return t.lockOn(`${format().number(status.inclinationRad * DEG, 1)}°`)
    case 'unattainable': return t.lockOff
    case 'releasedByInclinationEdit': return t.lockReleased
    case 'releasedByPropagationChange': return t.lockReleasedByModel
    case 'requiresJ2Drift': return t.lockRequiresJ2
  }
}

/** The one consequence line under the heading. */
export function consequenceLine(parameter: ShapeParameter, object: OrbitalObject, constraint: ElementConstraint, lockStatus: SunSynchronousStatus, trueAnomalyRad: number, snap: SnapPoint | null): string {
  const t = text().mobile.shape
  const f = format()
  if (object.source.kind !== 'keplerian') return ''
  const geometry = object.source.geometry
  const field = parameter === 'size' || parameter === 'shape' ? FIELDS[parameter] : null
  if (field && constraint.kind !== 'none' && constraint.adjustedField === field) return constraint.kind === 'minimumPeriapsis' ? t.minPeriapsis : t.maxApoapsis
  const conditioning = classifyElements(geometry)
  const derived = deriveOrbitValues(geometry)
  const circular = conditioning.periapsis.kind === 'singular'
  const extremes = t.elliptical(f.km(derived.periapsisAltitudeKm), f.km(derived.apoapsisAltitudeKm))
  switch (parameter) {
    case 'size': return circular ? t.circular(f.km(geometry.semiMajorAxisKm - EARTH_RADIUS_KM), f.duration(derived.periodSeconds)) : extremes
    case 'shape': return circular ? t.isCircular : extremes
    case 'tilt': return snap?.label ? t.snaps[snap.label] : ''
    case 'node': return conditioning.node.kind === 'singular' ? t.noNode : ''
    case 'periapsis': return circular ? t.noPeriapsis : ''
    case 'position': {
      if (circular) return ''
      const degrees = ((trueAnomalyRad * DEG) % 360 + 360) % 360
      if (Math.min(degrees, 360 - degrees) <= APSIS_NEAR_DEG) return t.atPeriapsis
      return Math.abs(degrees - 180) <= APSIS_NEAR_DEG ? t.atApoapsis : ''
    }
    case 'drift': return lockLine(lockStatus)
  }
}

export function shapeStripMarkup(): string {
  const t = text().mobile.shape
  const chip = (parameter: ShapeParameter) => html`<button class="m-shape-chip" type="button" data-parameter="${parameter}" aria-pressed="false">${t.chips[parameter]}</button>`
  return html`
    <div class="m-shape-chips" role="group" aria-label="${t.region}">${trusted(SHAPE_PARAMETERS.map(chip).join(''))}</div>
    <div class="m-shape-editor">
      <p class="m-shape-heading"><span class="m-shape-term"></span><span class="m-shape-value"></span></p>
      <p class="m-line m-shape-line" role="status"></p>
      <div class="m-ruler-mount"></div>
      <div class="m-drift" hidden>
        <div class="m-segments" role="group" aria-label="${text().orbitLab.modelLabel}">
          <button type="button" data-model="idealTwoBody" aria-pressed="false">${t.ideal}</button>
          <button type="button" data-model="j2Secular" aria-pressed="false">${t.j2}</button>
        </div>
        <label class="m-switch"><input class="m-drift-lock" type="checkbox" role="switch" /><span class="m-switch-track" aria-hidden="true"></span><span class="m-switch-label">${t.lock}</span></label>
      </div>
    </div>
    <div class="m-shape-empty" hidden>
      <p class="m-line m-shape-empty-text"></p>
      <button class="m-button is-primary m-shape-new" type="button">${trusted(icon('plus'))}<span>${text().mobile.dock.newOrbitName}</span></button>
    </div>
  `
}

/** The Shape strip. A chip row picks one element; the
 *  heading names it with the taught-term treatment and its value; one short
 *  consequence line follows; the ruler edits it. Drift is a two-way choice
 *  with the Sun-synchronous lock. Values go through the existing callbacks,
 *  which keep every existing constraint and the lock. */
export class ShapeStripView {
  readonly root: HTMLElement
  private readonly callbacks: ShapeStripCallbacks
  private readonly ruler: RulerView
  private readonly chips: readonly HTMLButtonElement[]
  private readonly editor: HTMLElement
  private readonly empty: HTMLElement
  private readonly drift: HTMLElement
  private readonly rulerMount: HTMLElement
  private readonly lock: HTMLInputElement
  private input: ShapeStripInput | null = null
  private spec: RulerSpec | null = null
  private specKey = ''
  private headingKey = ''
  private trueAnomalyRad = 0

  constructor(documentRef: Document, callbacks: ShapeStripCallbacks, environment: RulerEnvironment) {
    this.callbacks = callbacks
    this.root = documentRef.createElement('div')
    this.root.className = 'm-shape'
    this.root.innerHTML = shapeStripMarkup()
    this.chips = [...this.root.querySelectorAll<HTMLButtonElement>('.m-shape-chip')]
    this.editor = this.root.querySelector<HTMLElement>('.m-shape-editor')!
    this.empty = this.root.querySelector<HTMLElement>('.m-shape-empty')!
    this.drift = this.root.querySelector<HTMLElement>('.m-drift')!
    this.rulerMount = this.root.querySelector<HTMLElement>('.m-ruler-mount')!
    this.lock = this.root.querySelector<HTMLInputElement>('.m-drift-lock')!
    this.ruler = new RulerView(documentRef, {
      onChange: (value, snap) => this.onRulerChange(value, snap),
      onAdjust: (phase) => { const parameter = this.input?.parameter; if (parameter) callbacks.onAdjust(phase, parameter) },
    }, environment)
    this.rulerMount.append(this.ruler.root)
    for (const chip of this.chips) chip.addEventListener('click', () => callbacks.onParameter(chip.dataset.parameter as ShapeParameter))
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-model]')) button.addEventListener('click', () => callbacks.onPropagationChange(button.dataset.model as PropagationModel['kind']))
    this.lock.addEventListener('change', () => callbacks.onSunSynchronousLockChange(this.lock.checked))
    this.root.querySelector('.m-shape-new')!.addEventListener('click', () => callbacks.onNewOrbit())
  }

  sync(input: ShapeStripInput): void {
    this.input = input
    const t = text().mobile.shape
    const object = input.object?.source.kind === 'keplerian' ? input.object : null
    for (const chip of this.chips) {
      chip.setAttribute('aria-pressed', String(chip.dataset.parameter === input.parameter))
      chip.disabled = input.loading || !object
    }
    this.editor.hidden = !object
    this.empty.hidden = object !== null
    if (!object) {
      this.root.querySelector('.m-shape-empty-text')!.textContent = input.sceneEmpty ? t.noOrbit : t.selectOrbit
      this.root.querySelector<HTMLElement>('.m-shape-new')!.hidden = !input.sceneEmpty
      this.ruler.setDisabled(true)
      return
    }
    const geometry = object.source.kind === 'keplerian' ? object.source.geometry : null
    const conditioning = geometry ? classifyElements(geometry) : null
    for (const chip of this.chips) {
      const degenerate = (chip.dataset.parameter === 'node' && conditioning?.node.kind === 'singular') || (chip.dataset.parameter === 'periapsis' && conditioning?.periapsis.kind === 'singular')
      chip.classList.toggle('is-degenerate', degenerate)
    }
    const isDrift = input.parameter === 'drift'
    this.drift.hidden = !isDrift
    this.rulerMount.hidden = isDrift
    if (isDrift) {
      for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-model]')) {
        button.setAttribute('aria-pressed', String(button.dataset.model === object.propagation.kind))
        button.disabled = input.loading
      }
      this.lock.checked = object.editingLock.kind === 'sunSynchronous'
      this.lock.disabled = input.loading || object.propagation.kind !== 'j2Secular'
      this.ruler.setDisabled(true)
    } else {
      this.ruler.setDisabled(input.loading)
      this.syncRuler(input.parameter as RulerParameter, object)
    }
    this.renderHeading(object)
  }

  /** The live true anomaly, for the Position chip. */
  updateReadouts(trueAnomalyRad: number): void {
    this.trueAnomalyRad = trueAnomalyRad
    const input = this.input
    const object = input?.object
    if (!input || !object || input.parameter !== 'position' || this.ruler.dragging) return
    this.syncRuler('position', object)
    this.renderHeading(object)
  }

  dispose(): void { this.ruler.dispose() }

  private syncRuler(parameter: RulerParameter, object: OrbitalObject): void {
    if (object.source.kind !== 'keplerian') return
    const geometry = object.source.geometry
    const orbit = { semiMajorAxisKm: geometry.semiMajorAxisKm, eccentricity: geometry.eccentricity, j2Drift: object.propagation.kind === 'j2Secular' }
    const key = parameter === 'tilt' ? `${parameter}|${orbit.semiMajorAxisKm}|${orbit.eccentricity}|${orbit.j2Drift}` : parameter
    const value = rulerValueOf(parameter, object, this.trueAnomalyRad)
    if (key !== this.specKey || !this.spec) {
      this.specKey = key
      this.spec = rulerSpec(parameter, orbit)
      this.ruler.setSpec(this.spec, value, (snap) => snap.label ? text().mobile.shape.snaps[snap.label] : '')
    } else this.ruler.setValue(value)
  }

  private renderHeading(object: OrbitalObject): void {
    const input = this.input
    if (!input) return
    const t = text().mobile.shape
    const parameter = input.parameter
    const spec = parameter === 'drift' ? null : this.spec
    const value = spec ? rulerValueOf(spec.parameter, object, this.trueAnomalyRad) : 0
    const snap = spec ? snapAt(spec, value) : null
    const valueText = spec ? rulerValueText(spec, value) : ''
    const term = TERMS[parameter]
    const headingKey = `${parameter}|${text().mobile.shape.terms[parameter]}`
    if (headingKey !== this.headingKey) {
      this.headingKey = headingKey
      this.root.querySelector('.m-shape-term')!.innerHTML = term ? termLabelMarkup(t.terms[parameter], term) : html`${t.terms[parameter]}`
    }
    const valueElement = this.root.querySelector<HTMLElement>('.m-shape-value')!
    if (valueElement.textContent !== valueText) valueElement.textContent = valueText
    const line = consequenceLine(parameter, object, input.constraint, input.lockStatus, this.trueAnomalyRad, snap)
    const lineElement = this.root.querySelector<HTMLElement>('.m-shape-line')!
    if (lineElement.textContent !== line) lineElement.textContent = line
    if (spec) this.ruler.setAccessibleText(t.terms[parameter], t.valueText(valueText, snap?.label ? t.snaps[snap.label] : ''))
  }

  private onRulerChange(value: number, _snap: SnapPoint | null): void {
    const parameter = this.input?.parameter
    if (!parameter || parameter === 'drift') return
    if (parameter === 'position') { this.trueAnomalyRad = value / DEG; this.callbacks.onPhaseChange(value / DEG); return }
    const field = FIELDS[parameter]
    this.callbacks.onGeometryChange(field, field === 'semiMajorAxisKm' || field === 'eccentricity' ? value : value / DEG)
  }
}
