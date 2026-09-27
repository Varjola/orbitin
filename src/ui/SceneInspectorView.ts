import type { OrbitalObject } from '../simulation/OrbitalObject.ts'
import { isSgp4Source } from '../simulation/OrbitalObject.ts'
import type { SphericalSensorCap } from '../simulation/sensorFootprint.ts'
import { format, text } from '../i18n/index.ts'
import { conditioningNotes } from './driftWording.ts'
import { formatGroundTrackLatitude, formatGroundTrackLongitude } from './groundTrackWording.ts'
import type { ReadoutValues, UiCallbacks } from './uiTypes.ts'
import type { ShellModel } from './shellModel.ts'
import { ColorPaletteView } from './ColorPaletteView.ts'
import { catalogueSourceLabel } from './catalogueWording.ts'
import { formatUtcDisplay } from '../core/timeFormat.ts'
import type { TleDefinition } from '../data/tle.ts'
import type { OmmDefinition } from '../data/omm.ts'
import type { BudgetedLayer } from '../state/sceneComplexity.ts'
import { bulkLayerTarget, type BulkInspectorModel, type TriState } from './bulkInspectorModel.ts'
import { removeSelectedConfirmation } from './sceneObjectsModel.ts'
import { html, trusted } from './markup.ts'
import { displayNote } from './noteText.ts'
import { termLabel, termLabelMarkup, type TermId } from './termLabel.ts'

/** One readout row: its label, its value and the taught term it names. */
type Readout = readonly [label: string, value: string, term?: TermId]

export class SceneInspectorView {
  readonly root: HTMLElement
  readonly sensorHost: HTMLElement
  private readonly callbacks: UiCallbacks
  private readonly readoutValues = new Map<string, HTMLElement>()
  private singleId: string | null = null
  private bulkIds: readonly string[] = []
  private readonly colorPalette: ColorPaletteView
  private readonly bulkColorPalette: ColorPaletteView
  private bulkLayers: Readonly<Record<BudgetedLayer, TriState>> = { orbitPath: 'off', groundTrack: 'off', groundTrackHistory: 'off', sensorGeometry: 'off' }

  constructor(container: HTMLElement, callbacks: UiCallbacks) {
    this.root = container
    this.callbacks = callbacks
    this.root.dataset.region = 'sceneInspector'
    const t = text().inspector
    const drift = text().drift
    const term = (label: string, id: TermId) => trusted(termLabelMarkup(label, id))
    const layerToggle = (layer: BudgetedLayer, id: TermId | null) => trusted(html`<label class="toggle-row"><span>${id ? term(t.layers[layer], id) : t.layers[layer]}</span><input id="bulk-layer-${layer}" data-bulk-layer="${layer}" type="checkbox" aria-label="${t.layersForAll[layer]}" /><span class="toggle-ui" aria-hidden="true"></span></label>`)
    this.root.innerHTML = html`
      <div id="inspector-empty" class="empty-state"><strong>${t.emptyTitle}</strong><p>${t.emptyText}</p></div>
      <div id="inspector-multiple" hidden>
        <section class="inspector-bulk-identity"><strong id="inspector-selection-count"></strong><p id="inspector-selection-names" class="time-note"></p></section>
        <section class="field-group inspector-bulk-display"><div class="group-heading"><span>${t.bulkDisplay}</span></div>
          ${layerToggle('orbitPath', 'orbit')}
          ${layerToggle('groundTrack', 'groundTrack')}
          ${layerToggle('groundTrackHistory', 'groundTrack')}
          ${layerToggle('sensorGeometry', null)}
          <div class="color-control"><span>${t.colour}</span><div id="bulk-color-palette"></div></div>
          <p id="inspector-bulk-budget-status" class="time-note" role="status"></p>
        </section>
        <div class="inspector-bulk-actions">
          <button id="inspector-reveal-selected" class="action-button" type="button">${t.revealSelected}</button>
          <button id="inspector-fit-selected" class="action-button" type="button">${t.fitSelected}</button>
          <button id="inspector-remove-selected" class="action-button" type="button">${t.removeSelected}</button>
          <button id="inspector-clear-selection" class="action-button" type="button">${t.clearSelection}</button>
        </div>
        <div id="inspector-bulk-confirm" class="scene-objects-confirm" role="group" aria-label="${t.confirmRemoval}" hidden><p id="inspector-bulk-confirm-text" role="status"></p><div class="scene-objects-confirm-actions"><button id="inspector-bulk-confirm-remove" class="action-button danger-action" type="button">${t.remove}</button><button id="inspector-bulk-confirm-cancel" class="action-button" type="button">${t.cancel}</button></div></div>
        <p class="time-note">${t.bulkNote}</p>
      </div>
      <div id="inspector-single" hidden>
        <section class="inspector-identity"><label class="text-row inspector-name-label">${t.nameLabel}<input id="inspector-name" type="text" maxlength="80" autocomplete="off" aria-label="${t.nameAccessible}" /></label><p id="inspector-source"></p><p id="inspector-notes" class="time-note"></p><div class="inspector-single-actions"><button id="inspector-reveal" class="action-button" type="button">${t.reveal}</button><button id="inspector-focus" class="action-button" type="button" title="${t.focusTitle}">${t.focus}</button></div></section>
        <section class="field-group inspector-display"><div class="group-heading"><span>${t.display}</span></div><div class="color-control"><span>${t.colour}</span><div id="color-palette"></div></div><label class="slider-row" title="${t.markerTitle}"><span class="slider-label"><span>${t.markerSize}</span><output id="marker-size-value">${format().number(0.02, 3)}</output></span><input id="marker-size-slider" type="range" min="0.005" max="0.05" step="0.001" value="0.02" aria-label="${t.markerSize}" /></label><label class="toggle-row"><span>${term(t.layers.orbitPath, 'orbit')}</span><input id="path-toggle" type="checkbox" checked aria-label="${t.showOrbitPath}" /><span class="toggle-ui" aria-hidden="true"></span></label><label class="toggle-row"><span>${term(t.layers.groundTrack, 'groundTrack')}</span><input id="ground-track-toggle" type="checkbox" aria-label="${t.showGroundTrack}" /><span class="toggle-ui" aria-hidden="true"></span></label><label class="toggle-row" title="${t.historyTitle}"><span>${term(t.layers.groundTrackHistory, 'groundTrack')}</span><input id="ground-track-history-toggle" type="checkbox" aria-label="${t.layers.groundTrackHistory}" /><span class="toggle-ui" aria-hidden="true"></span></label><p id="inspector-budget-status" class="time-note" role="status"></p></section>
        <section id="drift-group" class="field-group" hidden><div class="group-heading"><span>${term(drift.heading, 'nodalDrift')}</span><span class="group-hint">${drift.hint}</span></div><div class="readout-grid" id="drift-grid"></div><p class="teaching-note" id="drift-note"></p></section>
        <section id="ground-track-readouts" class="field-group" hidden><div class="group-heading"><span>${term(t.earthRelativeHeading, 'subSatellitePoint')}</span><span class="group-hint">${t.earthRelativeHint}</span></div><div class="readout-grid"><span>${term(t.geocentricLatitude, 'geocentricLatitude')}</span><strong id="ground-track-latitude">—</strong><span>${term(t.eastLongitude, 'longitude')}</span><strong id="ground-track-longitude">—</strong><span>${term(t.trackWindow, 'groundTrack')}</span><strong id="ground-track-window">${t.windowNominal}</strong></div><p class="teaching-note is-visible">${t.groundTrackModelNote}</p></section>
        <section id="sensor-readouts" class="field-group" hidden><div class="group-heading"><span>${t.sensorReadouts}</span><span class="group-hint">${t.sensorReadoutsHint}</span></div><div class="readout-grid" id="sensor-readout-grid"></div></section>
        <section class="field-group readouts-group"><div class="group-heading"><span>${t.liveReadouts}</span><span class="live-dot">${t.live}</span></div><div class="readout-grid"><span>${term(t.period, 'orbitalPeriod')}</span><strong data-readout="period">—</strong><span>${term(t.periapsisAltitude, 'periapsis')}</span><strong data-readout="periapsis">—</strong><span>${term(t.apoapsisAltitude, 'apoapsis')}</span><strong data-readout="apoapsis">—</strong><span>${term(t.currentAltitude, 'altitude')}</span><strong data-readout="currentAltitude">—</strong><span>${t.currentSpeed}</span><strong data-readout="currentSpeed">—</strong></div></section>
        <section id="tle-metadata" class="field-group" hidden><div class="group-heading"><span>${term(t.sgp4Heading, 'elementSet')}</span><span class="group-hint">${t.sgp4Hint}</span></div><div class="readout-grid" id="tle-metadata-grid"></div><p class="time-note" id="tle-warning"></p><p class="time-note" id="tle-status"></p></section>
        <div id="inspector-sensor-host" class="sensor-host"></div>
        <p class="model-note" id="model-note">${t.modelNote}</p>
      </div>
    `
    this.sensorHost = this.root.querySelector<HTMLElement>('#inspector-sensor-host')!
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-readout]')) this.readoutValues.set(element.dataset.readout!, element)
    this.colorPalette = new ColorPaletteView(this.root.querySelector<HTMLElement>('#color-palette')!, { label: t.orbitColour, onPick: (colorHex) => this.callbacks.onColorChange(colorHex) })
    const name = this.root.querySelector<HTMLInputElement>('#inspector-name')!
    name.addEventListener('input', () => this.callbacks.onNameChange(name.value))
    name.addEventListener('blur', () => this.callbacks.onNameChange(name.value))
    this.root.querySelector('#inspector-clear-selection')!.addEventListener('click', () => this.callbacks.onClearSceneSelection())
    this.root.querySelector('#inspector-reveal')!.addEventListener('click', () => { if (this.singleId) this.callbacks.onRevealSceneObjects([this.singleId]) })
    this.root.querySelector('#inspector-focus')!.addEventListener('click', () => this.callbacks.onFocusSelected())
    this.root.querySelector('#inspector-reveal-selected')!.addEventListener('click', () => this.callbacks.onRevealSceneObjects(this.bulkIds))
    this.root.querySelector('#inspector-fit-selected')!.addEventListener('click', () => this.callbacks.onFitSelected())
    // Individual colours are kept until a colour is picked for all selected.
    this.bulkColorPalette = new ColorPaletteView(this.root.querySelector<HTMLElement>('#bulk-color-palette')!, { label: t.colourForAll, onPick: (colorHex) => this.callbacks.onBulkColorChange(colorHex) })
    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-bulk-layer]')) {
      input.addEventListener('change', () => {
        const layer = input.dataset.bulkLayer as BudgetedLayer
        // The control's own checked flip is ignored: the target comes from the
        // tri-state (mixed or off turns on, on turns off), then the committed
        // state is synced back.
        this.callbacks.onBulkLayerChange(layer, bulkLayerTarget(this.bulkLayers[layer]))
      })
    }
    const confirm = this.root.querySelector<HTMLElement>('#inspector-bulk-confirm')!
    this.root.querySelector('#inspector-remove-selected')!.addEventListener('click', () => {
      this.root.querySelector('#inspector-bulk-confirm-text')!.textContent = removeSelectedConfirmation(this.bulkIds.length)
      confirm.hidden = false
      this.root.querySelector<HTMLButtonElement>('#inspector-bulk-confirm-cancel')!.focus()
    })
    this.root.querySelector('#inspector-bulk-confirm-remove')!.addEventListener('click', () => { confirm.hidden = true; this.callbacks.onRemoveSceneObjects(this.bulkIds) })
    this.root.querySelector('#inspector-bulk-confirm-cancel')!.addEventListener('click', () => { confirm.hidden = true; this.root.querySelector<HTMLButtonElement>('#inspector-remove-selected')!.focus() })
    this.root.querySelector<HTMLInputElement>('#marker-size-slider')!.addEventListener('input', (event) => this.callbacks.onMarkerSizeChange(Number((event.currentTarget as HTMLInputElement).value)))
    this.root.querySelector<HTMLInputElement>('#path-toggle')!.addEventListener('change', (event) => this.callbacks.onOrbitPathVisibilityChange((event.currentTarget as HTMLInputElement).checked))
    this.root.querySelector<HTMLInputElement>('#ground-track-toggle')!.addEventListener('change', (event) => this.callbacks.onGroundTrackVisibilityChange((event.currentTarget as HTMLInputElement).checked))
    this.root.querySelector<HTMLInputElement>('#ground-track-history-toggle')!.addEventListener('change', (event) => this.callbacks.onGroundTrackHistoryChange((event.currentTarget as HTMLInputElement).checked))
  }

  sync(model: ShellModel['inspector'], object: OrbitalObject | undefined, loading: boolean, bulk: BulkInspectorModel | null = null, groupTitles: readonly string[] = []): void {
    this.root.dataset.content = model.content
    this.root.dataset.selectedCount = String(model.selectedCount)
    this.root.toggleAttribute('aria-busy', loading)
    this.root.querySelector<HTMLElement>('#inspector-empty')!.hidden = model.content !== 'empty'
    this.root.querySelector<HTMLElement>('#inspector-multiple')!.hidden = model.content !== 'multiple'
    this.root.querySelector<HTMLElement>('#inspector-single')!.hidden = model.content !== 'single'
    this.singleId = object?.id ?? null
    this.syncBulk(model.content === 'multiple' ? bulk : null, loading)
    if (!object) return
    const t = text().inspector
    const name = this.root.querySelector<HTMLInputElement>('#inspector-name')!
    if (this.root.ownerDocument.activeElement !== name) name.value = object.name
    // Group provenance is session-only display data.
    const source = model.identity?.sourceLabel ?? ''
    this.root.querySelector('#inspector-source')!.textContent = groupTitles.length > 0 ? t.sourceWithGroups(source, groupTitles) : source
    this.root.querySelector('#inspector-notes')!.textContent = displayNote(object.notes) ?? ''
    this.colorPalette.sync(object.style.colorHex, loading || model.content !== 'single')
    const marker = this.root.querySelector<HTMLInputElement>('#marker-size-slider')!
    if (this.root.ownerDocument.activeElement !== marker) marker.value = String(object.style.markerSizeRenderUnits)
    this.root.querySelector('#marker-size-value')!.textContent = format().number(object.style.markerSizeRenderUnits, 3)
    this.root.querySelector<HTMLInputElement>('#path-toggle')!.checked = object.display.orbitPathVisible
    const track = this.root.querySelector<HTMLInputElement>('#ground-track-toggle')!
    track.checked = object.display.groundTrackVisible
    const history = this.root.querySelector<HTMLInputElement>('#ground-track-history-toggle')!
    history.checked = object.display.groundTrackHistoryRecording
    history.disabled = loading || !object.display.groundTrackVisible
    const sgp4 = isSgp4Source(object.source)
    this.root.querySelector<HTMLElement>('#tle-metadata')!.hidden = !sgp4
    if (sgp4 && object.source.kind !== 'keplerian') this.renderTleMetadata(object.source.definition)
    this.root.querySelector('#model-note')!.textContent = sgp4 ? t.sgp4ModelNote : t.modelNote
    for (const input of this.root.querySelector<HTMLElement>('#inspector-single')!.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) input.disabled = loading || model.content !== 'single'
    history.disabled = loading || !object.display.groundTrackVisible
    // Real Objects keep their catalogue names; only Orbit Lab orbits are renamed.
    name.readOnly = sgp4
    name.classList.toggle('is-readonly', sgp4)
  }

  updateReadouts(values: ReadoutValues | null): void {
    if (!values) {
      for (const element of this.readoutValues.values()) element.textContent = '—'
      this.root.querySelector<HTMLElement>('#drift-group')!.hidden = true
      this.root.querySelector<HTMLElement>('#ground-track-readouts')!.hidden = true
      this.root.querySelector<HTMLElement>('#sensor-readouts')!.hidden = true
      return
    }
    const f = format()
    const speed = text().inspector.speed(f.number(values.currentSpeedKmPerSecond, 2))
    if (values.sgp4) {
      this.setReadout('period', f.duration(values.sgp4.definition.meanElements.nominalPeriodSeconds)); this.setReadout('periapsis', '—'); this.setReadout('apoapsis', '—'); this.setReadout('currentAltitude', f.km(values.currentAltitudeKm)); this.setReadout('currentSpeed', speed)
      this.root.querySelector<HTMLElement>('#drift-group')!.hidden = true
      this.root.querySelector<HTMLElement>('#ground-track-readouts')!.hidden = !(values.groundTrackVisible && values.subSatellitePoint)
      if (values.groundTrackVisible && values.subSatellitePoint) this.renderGroundTrack(values)
      this.renderSensorReadouts(values.sensorGeometry)
      return
    }
    if (!values.derived) return
    this.setReadout('period', f.duration(values.derived.periodSeconds)); this.setReadout('periapsis', f.km(values.derived.periapsisAltitudeKm)); this.setReadout('apoapsis', f.km(values.derived.apoapsisAltitudeKm)); this.setReadout('currentAltitude', f.km(values.currentAltitudeKm)); this.setReadout('currentSpeed', speed)
    this.renderDrift(values.drift)
    this.root.querySelector<HTMLElement>('#ground-track-readouts')!.hidden = !(values.groundTrackVisible && values.subSatellitePoint)
    if (values.groundTrackVisible && values.subSatellitePoint) this.renderGroundTrack(values)
    this.renderSensorReadouts(values.sensorGeometry)
  }

  setLayerBudgetMessage(message: string, bulkMessage = ''): void {
    const status = this.root.querySelector('#inspector-budget-status')!
    if (status.textContent !== message) status.textContent = message
    const bulk = this.root.querySelector('#inspector-bulk-budget-status')!
    if (bulk.textContent !== bulkMessage) bulk.textContent = bulkMessage
  }

  private syncBulk(bulk: BulkInspectorModel | null, loading: boolean): void {
    this.bulkIds = bulk?.ids ?? []
    if (!bulk) { this.root.querySelector<HTMLElement>('#inspector-bulk-confirm')!.hidden = true; return }
    this.bulkLayers = bulk.layers
    this.root.querySelector('#inspector-selection-count')!.textContent = bulk.countLabel
    this.root.querySelector('#inspector-selection-names')!.textContent = bulk.namesLabel
    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-bulk-layer]')) {
      const state = bulk.layers[input.dataset.bulkLayer as BudgetedLayer]
      input.checked = state === 'on'
      input.indeterminate = state === 'mixed'
      input.setAttribute('aria-checked', state === 'mixed' ? 'mixed' : String(state === 'on'))
      input.disabled = loading
    }
    this.bulkColorPalette.sync(bulk.commonColorHex, loading)
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.inspector-bulk-actions button')) button.disabled = loading
    const confirm = this.root.querySelector<HTMLElement>('#inspector-bulk-confirm')!
    if (!confirm.hidden) this.root.querySelector('#inspector-bulk-confirm-text')!.textContent = removeSelectedConfirmation(bulk.ids.length)
  }
  showTleRuntimeError(message: string): void { this.root.querySelector('#tle-status')!.textContent = text().inspector.propagationError(message) }
  dispose(): void { this.root.textContent = '' }

  private setReadout(key: string, value: string): void { this.readoutValues.get(key)!.textContent = value }

  private renderGroundTrack(values: ReadoutValues): void {
    const point = values.subSatellitePoint!
    const t = text().inspector
    this.root.querySelector('#ground-track-latitude')!.textContent = formatGroundTrackLatitude(point)
    this.root.querySelector('#ground-track-longitude')!.textContent = formatGroundTrackLongitude(point)
    this.root.querySelector('#ground-track-window')!.textContent = values.groundTrackHistoryRecording ? t.windowRecording : t.windowNominal
  }

  private renderSensorReadouts(geometry: ReadoutValues['sensorGeometry']): void {
    const group = this.root.querySelector<HTMLElement>('#sensor-readouts')!
    const grid = this.root.querySelector<HTMLElement>('#sensor-readout-grid')!
    group.hidden = geometry === null
    if (!geometry) { grid.textContent = ''; return }
    const t = text().inspector
    const f = format()
    const rows: Readout[] = [
      [t.fieldOfViewHalfAngle, f.degrees(geometry.fieldOfViewHalfAngleRad, 2), 'fieldOfView'],
      [t.fullConeAngle, f.degrees(geometry.fieldOfViewHalfAngleRad * 2, 2)],
      [t.pointing, t.nadir, 'nadir'],
      [t.steeringLimit, f.degrees(geometry.maxOffNadirSteeringRad, 2), 'steeringLimit'],
      [t.horizonHalfAngle, f.degrees(geometry.horizonOffNadirAngleRad, 2), 'horizon'],
      [t.minimumGroundElevation, geometry.minimumGroundElevationRad > 0 ? t.elevationReached(f.degrees(geometry.minimumGroundElevationRad, 1), f.degrees(geometry.elevationOffNadirAngleRad, 2)) : t.noElevationLimit, 'elevationAngle'],
      ...this.capRows('footprint', geometry.footprint),
      ...this.capRows('fieldOfRegard', geometry.fieldOfRegard),
    ]
    this.appendRows(grid, rows)
  }

  private capRows(kind: 'footprint' | 'fieldOfRegard', cap: SphericalSensorCap): Readout[] {
    const t = text().inspector
    const labels = t.caps[kind]
    const f = format()
    return [
      [labels.surfaceRadius, f.km(cap.surfaceRadiusKm), kind],
      [labels.centralAngle, f.degrees(cap.angularRadiusRad, 1), kind],
      [labels.area, t.capArea(f.km2(cap.areaKm2), f.percent(cap.fractionOfEarth, 1)), kind],
      [labels.edgeElevation, f.degrees(cap.edgeElevationRad, 1), 'elevationAngle'],
      [labels.slantRange, f.km(cap.slantRangeKm), 'slantRange'],
      [labels.highestLatitude, f.degrees(cap.maxGeocentricLatitudeRad, 1), kind],
      [labels.limitedBy, t.limitedBy[cap.limitedBy], kind],
    ]
  }

  private renderDrift(drift: ReadoutValues['drift']): void {
    const group = this.root.querySelector<HTMLElement>('#drift-group')!
    group.hidden = drift === null
    if (!drift) return
    const t = text().drift
    const f = format()
    const rows: Readout[] = []
    const node = drift.conditioning.node.kind === 'defined'; const periapsis = drift.conditioning.periapsis.kind === 'defined'
    if (node) rows.push([t.nodalDrift, f.degreesPerDay(drift.angleRates.raanRadPerSecond), 'nodalDrift'])
    if (periapsis) rows.push([t.apsidalDrift, f.degreesPerDay(drift.angleRates.argOfPeriapsisRadPerSecond), 'apsidalDrift'])
    for (const readout of drift.readouts) rows.push([t.angleReadouts[readout.kind], f.degrees(readout.valueRad, 1), readout.kind === 'raan' ? 'raan' : readout.kind === 'argOfPeriapsis' ? 'argumentOfPeriapsis' : readout.kind === 'argOfLatitude' ? 'argumentOfLatitude' : undefined])
    if (drift.sun.node.kind === 'defined') rows.push([t.solarTimeAscending, f.solarTime(drift.sun.node.meanLocalTimeAscendingNodeHours), 'localMeanSolarTime'], [t.solarTimeDescending, f.solarTime(drift.sun.node.meanLocalTimeDescendingNodeHours), 'localMeanSolarTime'])
    rows.push([t.betaAngle, f.signedDegrees(drift.sun.betaAngleRad, 1), 'betaAngle'])
    this.appendRows(this.root.querySelector<HTMLElement>('#drift-grid')!, rows)
    const notes = conditioningNotes(drift.conditioning, drift.readouts); if (node) notes.push(t.nodalSignNote); notes.push(t.betaNote); if (!node && !periapsis) notes.push(t.equatorialDriftNote)
    const note = this.root.querySelector<HTMLElement>('#drift-note')!; note.textContent = notes.join(' '); note.classList.add('is-visible')
  }

  private renderTleMetadata(definition: TleDefinition | OmmDefinition): void {
    const t = text().inspector
    const labels = t.metadata
    const f = format()
    const elements = definition.meanElements
    const rows: Readout[] = [
      [labels.format, definition.format === 'tle' ? t.formats.tle : t.formats.omm],
      [labels.name, definition.name ?? t.noradName(elements.catalogId)],
      [labels.catalogueId, elements.catalogId],
      [labels.internationalDesignator, definition.internationalDesignator ?? '—'],
      [labels.classification, definition.format === 'tle' ? definition.classification : definition.classification ?? '—'],
      [labels.epoch, formatUtcDisplay(elements.epoch), 'epoch'],
      [labels.ephemerisType, String(definition.ephemerisType)],
      [labels.elementSet, String(definition.elementSetNumber ?? '—'), 'elementSet'],
      [labels.revolution, definition.revolutionNumberAtEpoch === null || definition.revolutionNumberAtEpoch === undefined ? '—' : f.integer(definition.revolutionNumberAtEpoch)],
      [labels.nominalPeriod, f.duration(elements.nominalPeriodSeconds), 'orbitalPeriod'],
      [labels.inclination, f.degrees(elements.inclinationRad, 4), 'inclination'],
      [labels.eccentricity, f.number(elements.eccentricity, 7), 'eccentricity'],
      [labels.raan, f.degrees(elements.raanRad, 4), 'raan'],
      [labels.argumentOfPerigee, f.degrees(elements.argumentOfPerigeeRad, 4), 'argumentOfPeriapsis'],
      [labels.meanAnomaly, f.degrees(elements.meanAnomalyRad, 4), 'meanAnomaly'],
    ]
    if (definition.format === 'tle') rows.push([labels.source, t.manualTle])
    else if (definition.provenance.kind === 'catalogue') { const provenance = definition.provenance; rows.push([labels.source, catalogueSourceLabel(provenance.providerId)], [labels.snapshot, provenance.snapshotId], [labels.sourceRetrieved, provenance.providerRetrievedAtUtc], [labels.cataloguePublication, provenance.cataloguePublishedAtUtc]) }
    else rows.push([labels.source, t.manualOmm])
    this.appendRows(this.root.querySelector<HTMLElement>('#tle-metadata-grid')!, rows)
  }

  private appendRows(grid: HTMLElement, rows: readonly Readout[]): void {
    const documentRef = this.root.ownerDocument
    grid.textContent = ''
    for (const [label, value, term] of rows) {
      const name = term ? termLabel(documentRef, label, term) : documentRef.createElement('span')
      if (!term) name.textContent = label
      const strong = documentRef.createElement('strong'); strong.textContent = value
      grid.append(name, strong)
    }
  }
}
