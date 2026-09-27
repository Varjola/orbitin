import { degToRad, radToDeg } from '../core/angles.ts'
import { SENSOR_ANGLE_SLIDER_STEPS, SENSOR_MAX_FIELD_OF_VIEW_HALF_ANGLE_RAD, SENSOR_MAX_GROUND_ELEVATION_RAD, SENSOR_MAX_OFF_NADIR_STEERING_RAD, SENSOR_MIN_FIELD_OF_VIEW_HALF_ANGLE_RAD, SENSOR_MIN_GROUND_ELEVATION_RAD } from '../core/constants.ts'
import type { OrbitalObject } from '../simulation/OrbitalObject.ts'
import { fieldOfViewForSliderPosition, fieldOfViewSliderScale, sensorControlEccentricity, sensorControlRadiusKm, sliderPositionForAngle, sliderPositionForSteeringLimit, steeringLimitForSliderPosition, steeringSliderScale, type SensorAngleSliderScale } from '../simulation/sensorControlRange.ts'
import type { UiCallbacks } from './uiTypes.ts'
import { format, text } from '../i18n/index.ts'
import { html, trusted } from './markup.ts'
import { sensorFieldOfViewRangeNote, sensorNoteForSource, sensorSteeringRangeNote } from './sensorWording.ts'
import { termAccessibleName, termLabelMarkup } from './termLabel.ts'

export class SensorSettingsView {
  readonly root: HTMLElement
  private readonly callbacks: UiCallbacks
  private sensorControl: { fieldOfView: SensorAngleSliderScale; steering: SensorAngleSliderScale } | null = null

  constructor(documentRef: Document, callbacks: UiCallbacks) {
    this.callbacks = callbacks
    this.root = documentRef.createElement('section')
    this.root.className = 'field-group sensor-settings'
    this.root.dataset.region = 'sensorSettings'
    const t = text().sensor
    this.root.innerHTML = html`
      <div class="group-heading"><span>${t.heading}</span><span class="group-hint">${t.hint}</span></div>
      <label class="toggle-row"><span>${t.toggle}</span><input id="sensor-geometry-toggle" type="checkbox" aria-label="${t.show}" /><span class="toggle-ui" aria-hidden="true"></span></label>
      <div class="slider-row" title="${t.fieldOfViewHint}"><span class="slider-label"><label for="sensor-fov-input">${trusted(termLabelMarkup(t.viewHalfAngle, 'fieldOfView'))}</label><span class="angle-entry"><input id="sensor-fov-input" class="angle-input" type="number" inputmode="decimal" min="${radToDeg(SENSOR_MIN_FIELD_OF_VIEW_HALF_ANGLE_RAD).toFixed(2)}" max="${radToDeg(SENSOR_MAX_FIELD_OF_VIEW_HALF_ANGLE_RAD).toFixed(0)}" step="0.01" aria-describedby="sensor-fov-range" />°</span></span><input id="sensor-fov-slider" type="range" min="0" max="${SENSOR_ANGLE_SLIDER_STEPS}" step="1" value="0" aria-label="${termAccessibleName(t.viewHalfAngle, 'fieldOfView')}" aria-describedby="sensor-fov-range" /><span class="slider-note" id="sensor-fov-range"></span></div>
      <div class="slider-row" title="${t.steeringHint}"><span class="slider-label"><label for="sensor-steering-input">${trusted(termLabelMarkup(t.steeringLimit, 'steeringLimit'))}</label><span class="angle-entry"><input id="sensor-steering-input" class="angle-input" type="number" inputmode="decimal" min="0" max="${radToDeg(SENSOR_MAX_OFF_NADIR_STEERING_RAD).toFixed(0)}" step="0.01" aria-describedby="sensor-steering-range" />°</span></span><input id="sensor-steering-slider" type="range" min="0" max="${SENSOR_ANGLE_SLIDER_STEPS}" step="1" value="0" aria-label="${termAccessibleName(t.steeringLimit, 'steeringLimit')}" aria-describedby="sensor-steering-range" /><span class="slider-note" id="sensor-steering-range"></span></div>
      <div class="control-subheading">${t.reachHeading}</div>
      <label class="slider-row" title="${t.elevationHint}"><span class="slider-label"><span>${trusted(termLabelMarkup(t.minimumGroundElevation, 'elevationAngle'))}</span><output id="sensor-elevation-value">—</output></span><input id="sensor-elevation-slider" type="range" min="${radToDeg(SENSOR_MIN_GROUND_ELEVATION_RAD)}" max="${radToDeg(SENSOR_MAX_GROUND_ELEVATION_RAD)}" step="0.5" value="0" aria-label="${termAccessibleName(t.minimumGroundElevation, 'elevationAngle')}" /></label>
      <p class="teaching-note is-visible" id="sensor-note">${t.keplerianNote}</p>
    `
    this.bindEvents()
  }

  mountIn(host: HTMLElement): void { if (this.root.parentElement !== host) host.append(this.root) }

  sync(object: OrbitalObject | undefined, loading: boolean, forceInputs = false): void {
    this.lastObject = object
    this.root.hidden = !object
    this.root.toggleAttribute('aria-busy', loading)
    if (!object) {
      this.sensorControl = null
      this.root.querySelector<HTMLInputElement>('#sensor-geometry-toggle')!.checked = false
      this.root.querySelector<HTMLInputElement>('#sensor-fov-input')!.value = ''
      this.root.querySelector<HTMLInputElement>('#sensor-steering-input')!.value = ''
      this.root.querySelector('#sensor-fov-range')!.textContent = ''
      this.root.querySelector('#sensor-steering-range')!.textContent = ''
      this.root.querySelector('#sensor-elevation-value')!.textContent = '—'
      return
    }
    const radiusKm = sensorControlRadiusKm(object.source)
    const elevationRad = object.reachConstraint.minimumGroundElevationRad
    const fieldOfView = fieldOfViewSliderScale(radiusKm, elevationRad)
    const steering = steeringSliderScale(radiusKm, elevationRad, object.sensor.fieldOfViewHalfAngleRad)
    this.sensorControl = { fieldOfView, steering }
    const fovInput = this.root.querySelector<HTMLInputElement>('#sensor-fov-input')!
    const steeringInput = this.root.querySelector<HTMLInputElement>('#sensor-steering-input')!
    const fovSlider = this.root.querySelector<HTMLInputElement>('#sensor-fov-slider')!
    const steeringSlider = this.root.querySelector<HTMLInputElement>('#sensor-steering-slider')!
    const elevationSlider = this.root.querySelector<HTMLInputElement>('#sensor-elevation-slider')!
    this.root.querySelector<HTMLInputElement>('#sensor-geometry-toggle')!.checked = object.display.sensorGeometryVisible
    if (this.root.ownerDocument.activeElement !== fovSlider) fovSlider.value = String(sliderPositionForAngle(fieldOfView, object.sensor.fieldOfViewHalfAngleRad))
    if (this.root.ownerDocument.activeElement !== steeringSlider) steeringSlider.value = String(sliderPositionForSteeringLimit(steering, object.sensor.maxOffNadirSteeringRad))
    const f = format()
    fovSlider.setAttribute('aria-valuetext', text().sensor.degreesValue(f.number(radToDeg(object.sensor.fieldOfViewHalfAngleRad), 2)))
    steeringSlider.setAttribute('aria-valuetext', text().sensor.degreesValue(f.number(radToDeg(object.sensor.maxOffNadirSteeringRad), 2)))
    if (forceInputs || this.root.ownerDocument.activeElement !== fovInput) fovInput.value = radToDeg(object.sensor.fieldOfViewHalfAngleRad).toFixed(2)
    if (forceInputs || this.root.ownerDocument.activeElement !== steeringInput) steeringInput.value = radToDeg(object.sensor.maxOffNadirSteeringRad).toFixed(2)
    if (this.root.ownerDocument.activeElement !== elevationSlider) elevationSlider.value = String(radToDeg(elevationRad))
    this.root.querySelector('#sensor-elevation-value')!.textContent = f.degrees(elevationRad, 1)
    const range = { usefulLimitRad: fieldOfView.usefulLimitRad, minimumGroundElevationRad: elevationRad, eccentric: sensorControlEccentricity(object.source) >= 0.01 }
    this.root.querySelector('#sensor-fov-range')!.textContent = sensorFieldOfViewRangeNote({ ...range, authoredRad: object.sensor.fieldOfViewHalfAngleRad })
    this.root.querySelector('#sensor-steering-range')!.textContent = sensorSteeringRangeNote({ ...range, authoredRad: object.sensor.maxOffNadirSteeringRad, fieldOfViewHalfAngleRad: object.sensor.fieldOfViewHalfAngleRad })
    this.root.querySelector('#sensor-note')!.textContent = sensorNoteForSource(object.source)
    for (const input of this.root.querySelectorAll<HTMLInputElement>('input')) input.disabled = loading
  }

  dispose(): void { this.root.remove() }

  private bindEvents(): void {
    this.root.querySelector<HTMLInputElement>('#sensor-geometry-toggle')!.addEventListener('change', (event) => this.callbacks.onSensorGeometryVisibilityChange((event.currentTarget as HTMLInputElement).checked))
    this.root.querySelector<HTMLInputElement>('#sensor-fov-slider')!.addEventListener('input', (event) => { if (this.sensorControl) this.callbacks.onSensorFieldOfViewHalfAngleChange(fieldOfViewForSliderPosition(this.sensorControl.fieldOfView, Number((event.currentTarget as HTMLInputElement).value))) })
    this.root.querySelector<HTMLInputElement>('#sensor-steering-slider')!.addEventListener('input', (event) => { if (this.sensorControl) this.callbacks.onSensorSteeringLimitChange(steeringLimitForSliderPosition(this.sensorControl.steering, Number((event.currentTarget as HTMLInputElement).value))) })
    const commit = (input: HTMLInputElement, update: (valueRad: number) => void): void => {
      const degrees = input.value.trim() === '' ? Number.NaN : Number(input.value)
      if (Number.isFinite(degrees)) update(degToRad(degrees))
      this.lastObject && this.sync(this.lastObject, false, true)
    }
    const fov = this.root.querySelector<HTMLInputElement>('#sensor-fov-input')!
    const steering = this.root.querySelector<HTMLInputElement>('#sensor-steering-input')!
    fov.addEventListener('keydown', (event) => { if (event.key === 'Enter') commit(fov, (value) => this.callbacks.onSensorFieldOfViewHalfAngleChange(value)) })
    fov.addEventListener('change', () => commit(fov, (value) => this.callbacks.onSensorFieldOfViewHalfAngleChange(value)))
    steering.addEventListener('keydown', (event) => { if (event.key === 'Enter') commit(steering, (value) => this.callbacks.onSensorSteeringLimitChange(value)) })
    steering.addEventListener('change', () => commit(steering, (value) => this.callbacks.onSensorSteeringLimitChange(value)))
    this.root.querySelector<HTMLInputElement>('#sensor-elevation-slider')!.addEventListener('input', (event) => this.callbacks.onMinimumGroundElevationChange(degToRad(Number((event.currentTarget as HTMLInputElement).value))))
  }

  private lastObject: OrbitalObject | undefined
}
