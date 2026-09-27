import { radToDeg } from '../core/angles.ts'
import { format, text } from '../i18n/index.ts'
import type { ElementConstraint } from '../orbital/geometry.ts'
import type { OrbitalObject, PropagationModel } from '../simulation/OrbitalObject.ts'
import type { SunSynchronousStatus } from '../simulation/propagationTransitions.ts'
import { geometryControlDefinitions, type GeometryControlField } from './controlDefinitions.ts'
import { lockStatusMessage, modelNote } from './driftWording.ts'
import { html, trusted } from './markup.ts'
import { displayNote } from './noteText.ts'
import { termAccessibleName, termLabelMarkup } from './termLabel.ts'
import type { ShapeAdjustParameter, UiCallbacks } from './uiTypes.ts'

/** The orbit guides each element control shows. */
const GUIDES: Readonly<Record<GeometryControlField, ShapeAdjustParameter>> = {
  semiMajorAxisKm: 'size', eccentricity: 'shape', inclinationRad: 'tilt', raanRad: 'node', argOfPeriapsisRad: 'periapsis',
}

export class OrbitLabAuthoringView {
  readonly root: HTMLElement
  private readonly callbacks: UiCallbacks
  private readonly sliders = new Map<string, HTMLInputElement>()
  /** The element control under the pointer, pressed, or focused. */
  private hovered: ShapeAdjustParameter | null = null
  private pressed: ShapeAdjustParameter | null = null
  private focused: ShapeAdjustParameter | null = null

  constructor(container: HTMLElement, callbacks: UiCallbacks) {
    this.root = container
    this.callbacks = callbacks
    this.root.dataset.region = 'orbitLabAuthoring'
    const t = text().orbitLab
    this.root.innerHTML = html`
      <div id="authoring-empty" class="empty-state" hidden>
        <strong>${t.selectOneTitle}</strong><p>${t.selectOneText}</p>
      </div>
      <div id="authoring-fields" hidden>
        <p id="starting-example" class="starting-example"></p>
        <section class="field-group" id="geometry-group">
          <div class="group-heading"><span>${trusted(termLabelMarkup(t.geometryHeading, 'orbitalElements'))}</span><span class="group-hint">${t.geometryHint}</span></div>
          <div id="geometry-controls"></div>
          <div class="teaching-note" id="constraint-note" role="status"></div>
        </section>
        <section class="field-group" id="model-group" data-guide="drift">
          <div class="group-heading"><span>${trusted(termLabelMarkup(t.modelHeading, 'propagation'))}</span><span class="group-hint">${t.modelHint}</span></div>
          <label class="mode-label">${t.modelLabel} <select id="propagation-select" aria-label="${t.modelLabel}"><option value="idealTwoBody">${t.models.idealTwoBody}</option><option value="j2Secular">${t.models.j2Secular}</option></select></label>
          <label id="sso-lock-row" class="toggle-row" title="${t.lockTitle}" hidden><span>${trusted(termLabelMarkup(t.lockLabel, 'sunSynchronousOrbit'))}</span><input id="sso-lock-toggle" type="checkbox" aria-label="${termAccessibleName(t.lockLabel, 'sunSynchronousOrbit')}" /><span class="toggle-ui" aria-hidden="true"></span></label>
          <p class="teaching-note is-visible" id="propagation-note"></p><p class="teaching-note" id="lock-note" role="status"></p>
        </section>
        <section class="field-group" id="phase-group" data-guide="position">
          <div class="group-heading"><span>${t.positionHeading}</span><span class="group-hint">${t.positionHint}</span></div>
          <label class="slider-row" title="${t.phaseTitle}"><span class="slider-label"><span>${trusted(termLabelMarkup(t.trueAnomaly, 'trueAnomaly'))}</span><output id="phase-value">—</output></span><input id="phase-slider" type="range" min="0" max="360" step="0.5" value="0" aria-label="${termAccessibleName(t.trueAnomaly, 'trueAnomaly')}" /></label>
        </section>
      </div>
    `
    this.buildGeometryControls()
    this.bindEvents()
    this.trackGuides()
  }

  /** The element whose guides show: the control being dragged, else the one
   *  under the pointer, else the focused one; null while none is in use. */
  get activeParameter(): ShapeAdjustParameter | null {
    return this.root.querySelector<HTMLElement>('#authoring-fields')!.hidden ? null : this.pressed ?? this.hovered ?? this.focused
  }

  sync(object: OrbitalObject | undefined, constraint: ElementConstraint, lockStatus: SunSynchronousStatus, loading: boolean): void {
    const empty = this.root.querySelector<HTMLElement>('#authoring-empty')!
    const fields = this.root.querySelector<HTMLElement>('#authoring-fields')!
    const keplerian = object?.source.kind === 'keplerian'
    empty.hidden = !!object
    fields.hidden = !object
    this.root.toggleAttribute('aria-busy', loading)
    for (const control of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) control.disabled = loading || !object || (!!object && !keplerian)
    if (!object) return
    const note = displayNote(object.notes)
    this.root.querySelector('#starting-example')!.textContent = note ? text().orbitLab.startingExample(note) : ''
    if (!keplerian) {
      this.root.querySelector<HTMLElement>('#geometry-group')!.hidden = true
      this.root.querySelector<HTMLElement>('#model-group')!.hidden = true
      this.root.querySelector<HTMLElement>('#phase-group')!.hidden = true
      return
    }
    this.root.querySelector<HTMLElement>('#geometry-group')!.hidden = false
    this.root.querySelector<HTMLElement>('#model-group')!.hidden = false
    this.root.querySelector<HTMLElement>('#phase-group')!.hidden = false
    if (object.source.kind !== 'keplerian') return
    const geometry = object.source.geometry
    const f = format()
    this.setSlider('semiMajorAxisKm', geometry.semiMajorAxisKm.toString(), f.km(geometry.semiMajorAxisKm))
    this.setSlider('eccentricity', geometry.eccentricity.toString(), f.number(geometry.eccentricity, 3))
    this.setSlider('inclinationRad', radToDeg(geometry.inclinationRad).toString(), f.degrees(geometry.inclinationRad, 1))
    this.setSlider('raanRad', radToDeg(geometry.raanRad).toString(), f.degrees(geometry.raanRad, 1))
    this.setSlider('argOfPeriapsisRad', radToDeg(geometry.argOfPeriapsisRad).toString(), f.degrees(geometry.argOfPeriapsisRad, 1))
    const propagation = this.root.querySelector<HTMLSelectElement>('#propagation-select')!
    propagation.value = object.propagation.kind
    const lock = this.root.querySelector<HTMLInputElement>('#sso-lock-toggle')!
    lock.checked = object.editingLock.kind === 'sunSynchronous'
    lock.disabled = loading || object.propagation.kind !== 'j2Secular'
    this.root.querySelector<HTMLElement>('#sso-lock-row')!.hidden = object.propagation.kind !== 'j2Secular'
    this.root.querySelector('#propagation-note')!.textContent = modelNote(object.propagation.kind)
    const lockNote = this.root.querySelector<HTMLElement>('#lock-note')!
    lockNote.textContent = lockStatusMessage(lockStatus)
    lockNote.classList.toggle('is-visible', lockNote.textContent !== '')
    this.renderConstraint(geometry.eccentricity, geometry.inclinationRad, constraint)
  }

  setPhase(valueRad: number): void {
    const slider = this.root.querySelector<HTMLInputElement>('#phase-slider')!
    if (this.root.ownerDocument.activeElement !== slider) slider.value = String(radToDeg(valueRad))
    this.root.querySelector('#phase-value')!.textContent = format().degrees(valueRad, 1)
  }

  dispose(): void { this.root.textContent = '' }

  private buildGeometryControls(): void {
    const host = this.root.querySelector<HTMLElement>('#geometry-controls')!
    const elements = text().elements
    for (const definition of geometryControlDefinitions) {
      const id = `geometry-${definition.field}`
      const { label, help } = elements[definition.field]
      host.insertAdjacentHTML('beforeend', html`<label class="slider-row" data-guide="${GUIDES[definition.field]}" title="${help}"><span class="slider-label"><span>${trusted(termLabelMarkup(label, definition.term))}</span><output id="${id}-value">—</output></span><input id="${id}" type="range" min="${definition.min}" max="${definition.max}" step="${definition.step}" value="${definition.min}" aria-label="${termAccessibleName(label, definition.term)}" /></label>`)
      this.sliders.set(definition.field, host.querySelector<HTMLInputElement>(`#${id}`)!)
    }
  }

  private bindEvents(): void {
    for (const definition of geometryControlDefinitions) {
      const slider = this.sliders.get(definition.field)!
      slider.addEventListener('input', () => {
        const raw = Number(slider.value)
        const value = definition.field === 'semiMajorAxisKm' || definition.field === 'eccentricity' ? raw : raw * Math.PI / 180
        this.callbacks.onGeometryChange(definition.field as GeometryControlField, value)
      })
    }
    this.root.querySelector<HTMLInputElement>('#phase-slider')!.addEventListener('input', (event) => this.callbacks.onPhaseChange(Number((event.currentTarget as HTMLInputElement).value) * Math.PI / 180))
    this.root.querySelector('#propagation-select')!.addEventListener('change', (event) => this.callbacks.onPropagationChange((event.target as HTMLSelectElement).value as PropagationModel['kind']))
    this.root.querySelector('#sso-lock-toggle')!.addEventListener('change', (event) => this.callbacks.onSunSynchronousLockChange((event.target as HTMLInputElement).checked))
  }

  private trackGuides(): void {
    const guideOf = (target: EventTarget | null) => target instanceof Element ? (target.closest<HTMLElement>('[data-guide]')?.dataset.guide ?? null) as ShapeAdjustParameter | null : null
    this.root.addEventListener('pointerover', (event) => { this.hovered = guideOf(event.target) })
    this.root.addEventListener('pointerleave', () => { this.hovered = null })
    this.root.addEventListener('pointerdown', (event) => {
      this.pressed = guideOf(event.target)
      if (!this.pressed) return
      const view = this.root.ownerDocument.defaultView
      const release = () => { this.pressed = null; view?.removeEventListener('pointerup', release, true); view?.removeEventListener('pointercancel', release, true) }
      view?.addEventListener('pointerup', release, true)
      view?.addEventListener('pointercancel', release, true)
    })
    this.root.addEventListener('focusin', (event) => { this.focused = guideOf(event.target) })
    this.root.addEventListener('focusout', () => { this.focused = null })
  }

  private setSlider(field: string, value: string, output: string): void {
    const slider = this.sliders.get(field)
    if (slider && this.root.ownerDocument.activeElement !== slider) slider.value = value
    this.root.querySelector(`#geometry-${field}-value`)!.textContent = output
  }

  private renderConstraint(eccentricity: number, inclinationRad: number, constraint: ElementConstraint): void {
    const t = text().orbitLab
    const messages: string[] = []
    if (constraint.kind === 'minimumPeriapsis') messages.push(t.minimumPeriapsis)
    if (constraint.kind === 'maximumApoapsis') messages.push(t.maximumApoapsis)
    if (eccentricity < 1e-4) messages.push(t.circular)
    if (Math.abs(Math.sin(inclinationRad)) < 1e-4) messages.push(t.equatorial)
    const note = this.root.querySelector<HTMLElement>('#constraint-note')!
    note.textContent = messages.join(' ')
    note.classList.toggle('is-visible', messages.length > 0)
  }
}
