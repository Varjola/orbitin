import { afterEach, describe, expect, it, vi } from 'vitest'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { setActiveLocale } from '../i18n/active.ts'
import { createDefaultOrbitLabObject } from '../state/initialState.ts'
import { buildAutomaticSnapshotFixture } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { decodeCatalogueManifest, decodeCatalogueShard } from '../data/catalogueSchema.ts'
import { sceneObjectFromCatalogueRecord } from '../app/catalogueToScene.ts'
import type { ReadoutValues } from '../ui/uiTypes.ts'
import { mobileTopBarMarkup } from './MobileTopBarView.ts'
import { mobileClockDate, mobileClockTime, mobileDockMarkup, MOBILE_SPEED_CYCLE, mobileSpeedLabel, nextMobileSpeed } from './MobileDockView.ts'
import { panelHostMarkup } from './PanelHost.ts'
import { timePanelMarkup } from './TimePanelView.ts'
import { objectChipMarkup } from './ObjectChipView.ts'
import { objectCardMarkup } from './ObjectCardView.ts'
import { objectsListMarkup } from './ObjectsListView.ts'
import { viewToolsMarkup } from './ViewToolsView.ts'
import { layersPanelMarkup } from './LayersPanelView.ts'
import { aboutPanelMarkup, menuMarkup, shareSceneLink } from './MenuView.ts'
import { noticeMarkup } from './NoticeView.ts'
import { rulerMarkup } from './RulerView.ts'
import { consequenceLine, lockLine, rulerValueText, shapeStripMarkup } from './ShapeStripView.ts'
import { newOrbitMarkup } from './NewOrbitPanelView.ts'
import { addSheetMarkup, groupTileTitle, searchRowLine } from './AddSheetView.ts'
import { objectCardModel, objectRowLine } from './objectSummaryModel.ts'
import { sceneChangeMessage } from './MobileUiRoot.ts'
import { rulerSpec } from './shapeRulerModel.ts'
import { BackGesture, isPanelEntry, type BackGestureWindow } from './backGesture.ts'
import mobileRootSource from './MobileUiRoot.ts?raw'
import chooserSource from '../ui/SceneObjectChooserView.ts?raw'

afterEach(() => setActiveLocale('en'))

const MARKUP: ReadonlyArray<readonly [string, () => string]> = [
  ['top bar', mobileTopBarMarkup], ['dock', mobileDockMarkup], ['panel', () => panelHostMarkup('m-panel-heading-1')],
  ['time', () => timePanelMarkup({ status: 'm-a-1', faded: 'm-b-2' })], ['chip', objectChipMarkup], ['card', objectCardMarkup],
  ['list', objectsListMarkup], ['view tools', viewToolsMarkup], ['layers', layersPanelMarkup], ['menu', menuMarkup],
  ['about', aboutPanelMarkup], ['notice', noticeMarkup], ['ruler', rulerMarkup], ['shape', shapeStripMarkup],
  ['new orbit', newOrbitMarkup], ['add', addSheetMarkup],
]

/** Every button and field in a markup string, with its accessible name source. */
function controls(markup: string): { tag: string; named: boolean }[] {
  const found: { tag: string; named: boolean }[] = []
  for (const match of markup.matchAll(/<(button|input)\b([^>]*)>([\s\S]*?)(?:<\/button>|$)/g)) {
    const [, tag, attributes, inner] = match
    if (/\btype="checkbox"/.test(attributes) || /\btype="datetime-local"|type="search"/.test(attributes)) { found.push({ tag, named: true }); continue }
    const text = tag === 'button' ? inner.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim() : ''
    found.push({ tag, named: /aria-label="[^"]+"/.test(attributes) || text !== '' || /class="[^"]*m-(?:mode|time|chip-count|chip-object|result|group-tile|view-map|card-more|load-button|list-add)\b/.test(attributes) })
  }
  return found
}

describe('mobile view markup', () => {
  it('names every control, in both languages', () => {
    for (const locale of ['en', 'fi'] as const) {
      setActiveLocale(locale)
      for (const [name, markup] of MARKUP) for (const control of controls(markup())) expect(control.named, `${locale} ${name} ${control.tag}`).toBe(true)
    }
  })

  it('uses the short mode names, with Finnish Radat and Satelliitit', () => {
    expect(mobileTopBarMarkup()).toContain('>Orbit Lab</button>')
    expect(mobileTopBarMarkup()).toContain('>Real Objects</button>')
    setActiveLocale('fi')
    expect(mobileTopBarMarkup()).toContain('>Radat</button>')
    expect(mobileTopBarMarkup()).toContain('>Satelliitit</button>')
    expect(mobileTopBarMarkup()).toContain('role="group" aria-label="Osio"')
  })

  it('makes the ruler a keyboard slider with named one-step buttons', () => {
    const ruler = rulerMarkup()
    expect(ruler).toContain('role="slider" tabindex="0" aria-orientation="horizontal"')
    expect(ruler).toContain('aria-label="Decrease"')
    expect(ruler).toContain('aria-label="Increase"')
    setActiveLocale('fi')
    expect(rulerMarkup()).toContain('aria-label="Pienennä"')
  })

  it('keeps the search field from zooming, correcting or capitalizing', () => {
    const field = addSheetMarkup().match(/<input[^>]*>/)![0]
    for (const attribute of ['type="search"', 'enterkeyhint="search"', 'autocapitalize="off"', 'autocorrect="off"', 'spellcheck="false"', 'placeholder="Search satellites"']) expect(field).toContain(attribute)
  })

  it('offers the four quick tiles and the six examples as a list', () => {
    const markup = newOrbitMarkup()
    expect([...markup.matchAll(/data-kind="(\w+)"/g)].map((match) => match[1])).toEqual(['leo', 'meo', 'geo', 'heo'])
    expect([...markup.matchAll(/data-example="(\w+)"/g)].map((match) => match[1])).toEqual(['leo', 'meo', 'geo', 'polar', 'elliptical', 'sso'])
    expect(markup).toContain('Crosses both poles')
  })

  it('offers Share, the language choice in both languages, How to use and About, and no Open scene file', () => {
    const markup = menuMarkup()
    expect(markup).toContain('Language · Kieli')
    expect(markup).toContain('lang="fi"')
    expect(markup).toContain('>Suomi</button>')
    expect(markup).not.toMatch(/open-scene|Open scene file/)
    expect(aboutPanelMarkup()).toContain('Orbitin has more tools on a larger screen.')
  })

  it('offers no footprint switch, since mobile cannot set the sensor', () => {
    expect([...objectCardMarkup().matchAll(/data-layer="(\w+)"/g)].map((match) => match[1])).toEqual(['orbit', 'groundTrack'])
    expect([...layersPanelMarkup().matchAll(/data-layer="(\w+)"/g)].map((match) => match[1])).toEqual(['orbitPath', 'groundTrack'])
  })

  it('puts Remove all at the top of the objects list, before the rows', () => {
    const markup = objectsListMarkup()
    expect(markup.indexOf('m-list-remove-all')).toBeLessThan(markup.indexOf('class="m-list"'))
    expect(markup).toContain('m-list-remove-all is-bottom')
  })

  it('leaves the data credit to About, and keeps the Shape chips on a row of their own', () => {
    expect(addSheetMarkup()).not.toContain('m-citation')
    expect(shapeStripMarkup()).not.toContain('m-shape-close')
    expect(shapeStripMarkup().trimStart()).toMatch(/^<div class="m-shape-chips"/)
  })

  it('puts the chooser in a bottom sheet with 48 px rows on mobile and keeps its keyboard handling', () => {
    expect(chooserSource).toContain("this.element.classList.toggle('is-sheet', layout === 'sheet')")
    expect(chooserSource).toContain("if (this.layout === 'sheet') { this.buttons()[0]?.focus(); return }")
    expect(chooserSource).toContain("this.element.addEventListener('keydown', (event) => this.onKeyDown(event))")
  })
})

describe('mobile dock time and speed', () => {
  it('cycles every existing speed step', () => {
    expect(MOBILE_SPEED_CYCLE).toEqual([1, 60, 600, 3600])
    expect([1, 60, 600, 3600, 120].map(nextMobileSpeed)).toEqual([60, 600, 3600, 1, 1])
    expect(mobileSpeedLabel(3600)).toBe('1 h/s')
  })

  it('shows hours and minutes, truncated, and the ISO date', () => {
    const instant = { unixSeconds: Date.UTC(2026, 2, 20, 12, 4, 59) / 1000 }
    expect(mobileClockTime(instant)).toBe('12:04')
    expect(mobileClockDate(instant)).toBe('2026-03-20')
    setActiveLocale('fi')
    expect(mobileClockTime(instant)).toBe('12.04')
  })
})

describe('the object card and list models', () => {
  const readouts = (patch: Partial<ReadoutValues> = {}): ReadoutValues => ({
    derived: { periodSeconds: 5700, meanMotionRadPerSecond: 0.0011, periapsisRadiusKm: 6900, apoapsisRadiusKm: 7100, periapsisAltitudeKm: 522, apoapsisAltitudeKm: 722 },
    currentAltitudeKm: 600, currentSpeedKmPerSecond: 7.61, trueAnomalyRad: 0,
    subSatellitePoint: { instant: SIMULATION_START_INSTANT, directionEarthFixed: { x: 1, y: 0, z: 0 }, geocentricLatitudeRad: 0.5, geodeticLatitudeRad: 0.5, longitudeRad: -0.2 } as never,
    groundTrackVisible: false, groundTrackHistoryRecording: false, sensorGeometry: null, samplingBand: 'tracking', drift: null, ...patch,
  })

  it('shows three live values and the orbit facts for an Orbit Lab orbit', () => {
    const object = createDefaultOrbitLabObject('orbit-1', 0xffc857, SIMULATION_START_INSTANT, 'Explorer')
    const model = objectCardModel(object, readouts(), SIMULATION_START_INSTANT.unixSeconds)
    expect(model).toMatchObject({ name: 'Explorer', color: '#ffc857', source: 'Orbit Lab orbit', editable: true, altitude: '600 km', speed: '7.61 km/s', period: '1h 35m', ageWarning: '', horizon: '' })
    expect(model.details.map((row) => row.label)).toEqual(['Point below', 'Lowest', 'Highest', 'Inclination'])
    expect(objectCardModel(object, null, 0).altitude).toBe('—')
    expect(objectRowLine(object)).toBe('3,622 km')
  })

  it('shows the record facts, an element-age warning and the citation for a catalogue object', () => {
    const fixture = buildAutomaticSnapshotFixture()
    const manifest = decodeCatalogueManifest(fixture.manifest)
    const record = Object.values(decodeCatalogueShard(fixture.shards[0], manifest, 0).records)[0]
    const converted = sceneObjectFromCatalogueRecord(record, manifest, 0x56b4e9)
    if (!converted.ok) throw new Error(converted.message)
    const epoch = converted.object.source.kind === 'omm' ? converted.object.source.definition.meanElements.epoch.unixSeconds : 0
    const fresh = objectCardModel(converted.object, readouts({ derived: null }), epoch + 86_400, 'Orbital data: X, accessed via Y')
    expect(fresh).toMatchObject({ source: 'Real object', editable: false, ageWarning: '' })
    expect(fresh.details.map((row) => row.label)).toEqual(['Point below', 'NORAD id', 'Designator', 'Element epoch', ''])
    expect(fresh.details.at(-1)!.value).toBe('Orbital data: X, accessed via Y')
    expect(objectCardModel(converted.object, null, epoch + 12 * 86_400).ageWarning).toBe('These orbit data are 12 days old.')
    // A curated member supplemented at 10 to 30 days old.
    expect(objectCardModel(converted.object, null, epoch + 20 * 86_400).ageWarning).toBe('These orbit data are 20 days old.')
    expect(objectCardModel(converted.object, null, epoch + 29 * 86_400).ageWarning).toBe('These orbit data are 29 days old.')
    setActiveLocale('fi')
    try {
      expect(objectCardModel(converted.object, null, epoch + 29 * 86_400).ageWarning).toBe('Ratatiedot ovat 29 päivää vanhoja.')
    } finally {
      setActiveLocale('en')
    }
  })

  it('says whether the object is above the learner’s horizon', () => {
    const object = createDefaultOrbitLabObject('orbit-1', 0xffc857, SIMULATION_START_INSTANT, 'Explorer')
    expect(objectCardModel(object, readouts({ observerElevationRad: 23 * Math.PI / 180 }), 0).horizon).toBe('Above your horizon · 23°')
    expect(objectCardModel(object, readouts({ observerElevationRad: -0.1 }), 0).horizon).toBe('Below your horizon')
    expect(objectCardModel(object, readouts({ observerElevationRad: null }), 0).horizon).toBe('')
  })
})

describe('Shape strip wording', () => {
  const orbit = (patch: Partial<{ semiMajorAxisKm: number; eccentricity: number; inclinationRad: number }> = {}) => {
    const object = createDefaultOrbitLabObject('orbit-1', 0xffc857, SIMULATION_START_INSTANT, 'Explorer')
    if (object.source.kind === 'keplerian') object.source.geometry = { ...object.source.geometry, ...patch }
    return object
  }

  it('gives the circular and elliptical size lines, and the clamp reason', () => {
    expect(consequenceLine('size', orbit({ eccentricity: 0, semiMajorAxisKm: 6898.137 }), { kind: 'none' }, { kind: 'none' }, 0, null)).toBe('Altitude 520 km · Period 1h 35m')
    expect(consequenceLine('shape', orbit({ eccentricity: 0.1 }), { kind: 'none' }, { kind: 'none' }, 0, null)).toBe('Lowest 2,622 km · Highest 4,622 km')
    expect(consequenceLine('shape', orbit({ eccentricity: 0 }), { kind: 'none' }, { kind: 'none' }, 0, null)).toBe('Circular')
    expect(consequenceLine('shape', orbit(), { kind: 'minimumPeriapsis', adjustedField: 'eccentricity', boundKm: 6578, adjustedValue: 0.3 }, { kind: 'none' }, 0, null)).toBe('The lowest point stops at 200 km.')
    expect(consequenceLine('size', orbit(), { kind: 'maximumApoapsis', adjustedField: 'semiMajorAxisKm', boundKm: 60000, adjustedValue: 50000 }, { kind: 'none' }, 0, null)).toBe('The highest point stops at 60,000 km from Earth’s centre.')
  })

  it('explains degenerate elements, snap labels, apsides and the lock', () => {
    expect(consequenceLine('node', orbit({ inclinationRad: 0 }), { kind: 'none' }, { kind: 'none' }, 0, null)).toBe('An equatorial orbit has no node.')
    expect(consequenceLine('periapsis', orbit({ eccentricity: 0 }), { kind: 'none' }, { kind: 'none' }, 0, null)).toBe('A circular orbit has no periapsis direction.')
    expect(consequenceLine('tilt', orbit(), { kind: 'none' }, { kind: 'none' }, 0, { value: 90, label: 'polar' })).toBe('Polar')
    expect(consequenceLine('position', orbit(), { kind: 'none' }, { kind: 'none' }, 3 * Math.PI / 180, null)).toBe('At periapsis')
    expect(consequenceLine('position', orbit(), { kind: 'none' }, { kind: 'none' }, Math.PI, null)).toBe('At apoapsis')
    expect(consequenceLine('position', orbit(), { kind: 'none' }, { kind: 'none' }, 1, null)).toBe('')
    expect(lockLine({ kind: 'applied', inclinationRad: 98.6 * Math.PI / 180 })).toBe('Sun-synchronous: tilt set to 98.6°.')
    expect(lockLine({ kind: 'releasedByInclinationEdit' })).toBe('Sun-synchronous released: you set the tilt.')
    expect(rulerValueText(rulerSpec('tilt', { semiMajorAxisKm: 7000, eccentricity: 0, j2Drift: false }), 51.5)).toBe('51.5°')
    expect(rulerValueText(rulerSpec('shape', { semiMajorAxisKm: 7000, eccentricity: 0, j2Drift: false }), 0.1)).toBe('0.100')
  })
})

describe('Add sheet wording', () => {
  it('reads each result as orbit kind and object type, and titles group tiles', () => {
    const entry = { catalogId: '1', name: 'X', normalizedName: 'x', internationalDesignator: null, epochUtc: '', groups: [], shard: 0 }
    expect(searchRowLine(entry)).toBe('')
    expect(groupTileTitle({ groupId: 'gps-operational', title: 'GPS constellation' })).toBe('GPS satellites')
    expect(groupTileTitle({ groupId: 'other', title: 'Galileo' })).toBe('Galileo')
    setActiveLocale('fi')
    expect(groupTileTitle({ groupId: 'gps-operational', title: 'GPS constellation' })).toBe('GPS-satelliitit')
  })
})

describe('notices', () => {
  it('words every undoable change', () => {
    expect(sceneChangeMessage({ kind: 'added', name: 'ISS (ZARYA)' })).toBe('Added ISS (ZARYA)')
    expect(sceneChangeMessage({ kind: 'addedGroup', groupId: 'gps-operational', title: 'GPS constellation', count: 32 })).toBe('Added 32 GPS satellites')
    expect(sceneChangeMessage({ kind: 'created', name: 'Curious Explorer' })).toBe('Created Curious Explorer')
    expect(sceneChangeMessage({ kind: 'removed', names: ['Curious Explorer'], all: false })).toBe('Removed Curious Explorer')
    expect(sceneChangeMessage({ kind: 'removed', names: ['A', 'B'], all: true })).toBe('Removed all objects')
    setActiveLocale('fi')
    expect(sceneChangeMessage({ kind: 'addedGroup', groupId: 'gps-operational', title: 'GPS constellation', count: 32 })).toBe('Lisätty 32 GPS-satelliittia')
  })

  it('offers Undo only through the application’s recorded change', () => {
    expect(mobileRootSource).toContain('this.views.notice.show(sceneChangeMessage(change), () => this.callbacks.onUndoSceneChange())')
    expect(mobileRootSource).toContain('withdrawUndo(): void { this.views.notice.withdrawUndo() }')
  })
})

describe('Share scene', () => {
  const link = async () => ({ ok: true as const, url: 'https://orbitin.example/#s1.abc' })
  it('opens the system share sheet where it exists and does nothing when cancelled', async () => {
    const share = vi.fn(async () => {})
    expect(await shareSceneLink(link, { share, copy: vi.fn() })).toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: 'Orbitin', url: 'https://orbitin.example/#s1.abc' })
    const copy = vi.fn(async () => {})
    expect(await shareSceneLink(link, { share: async () => { throw Object.assign(new Error('cancel'), { name: 'AbortError' }) }, copy })).toBe('cancelled')
    expect(copy).not.toHaveBeenCalled()
  })

  it('copies the link without a share sheet, or when sharing fails', async () => {
    const copy = vi.fn(async () => {})
    expect(await shareSceneLink(link, { copy })).toBe('copied')
    expect(copy).toHaveBeenCalledWith('https://orbitin.example/#s1.abc')
    expect(await shareSceneLink(link, { share: async () => { throw new Error('not allowed') }, copy })).toBe('copied')
    expect(await shareSceneLink(link, {})).toBe('failed')
    expect(await shareSceneLink(link, { copy: async () => { throw new Error('denied') } })).toBe('failed')
  })

  it('offers the scene file instead of a link over the link limits', async () => {
    const share = vi.fn(async () => {})
    expect(await shareSceneLink(async () => ({ ok: false as const, reason: { kind: 'too-long' } as never }), { share })).toBe('too-large')
    expect(share).not.toHaveBeenCalled()
  })
})

describe('the back gesture', () => {
  function fakeWindow() {
    const entries: unknown[] = [null]
    let listener: ((event: PopStateEvent) => void) | null = null
    const view: BackGestureWindow & { pops: () => void; readonly entries: unknown[] } = {
      entries,
      history: {
        get state() { return entries.at(-1) },
        pushState: (data: unknown) => { entries.push(data) },
        back: () => { entries.pop(); queueMicrotask(() => listener?.({} as PopStateEvent)) },
      },
      addEventListener: (_type, handler) => { listener = handler },
      removeEventListener: () => { listener = null },
      // The learner's Back: the browser pops the entry and reports it.
      pops: () => { entries.pop(); listener?.({} as PopStateEvent) },
    }
    return view
  }

  it('holds one same-URL entry while a panel is open and closes the panel on Back', () => {
    const view = fakeWindow()
    const onBack = vi.fn()
    const back = new BackGesture(view, onBack, () => false)
    back.panelOpened()
    back.panelOpened()
    expect(view.entries).toHaveLength(2)
    expect(isPanelEntry(view.history.state)).toBe(true)
    view.pops()
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(back.holdsEntry).toBe(false)
    // Back with no panel open leaves the page as usual: nothing here reacts.
    view.pops()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('steps back over its entry once when the panel closes another way, ignoring that pop', async () => {
    const view = fakeWindow()
    const onBack = vi.fn()
    const back = new BackGesture(view, onBack, () => false)
    back.panelOpened()
    back.panelClosed()
    back.panelClosed()
    expect(view.entries).toEqual([null])
    await Promise.resolve()
    expect(onBack).not.toHaveBeenCalled()
  })

  it('does nothing while a shared scene is opening', () => {
    const view = fakeWindow()
    const back = new BackGesture(view, vi.fn(), () => true)
    back.panelOpened()
    expect(view.entries).toEqual([null])
    back.dispose()
  })
})

describe('the back gesture and shared links', () => {
  it('writes no history entry while loading, opening a scene, or with a scene link in the address', () => {
    expect(mobileRootSource).toContain("return this.loading || this.sceneOpening || /[#&]scene=/.test(this.view?.location.hash ?? '')")
    expect(mobileRootSource).toContain('new BackGesture(this.view, () => this.changeShell(closeSurface(this.shell)), () => this.historyBlocked())')
  })
})
