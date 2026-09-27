import { expect, it } from 'vitest'
import { LANGUAGE_GROUP_LABEL, LANGUAGE_NAMES } from '../i18n/index.ts'
import optionsSource from './OptionsMenuView.ts?raw'
import uiRootSource from './UiRoot.ts?raw'
import applicationSource from '../app/Application.ts?raw'

const sources = import.meta.glob(['../ui/**/*.ts', '../app/**/*.ts', '../map/**/*.ts', '../scene/**/*.ts', '../mobile/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const production = Object.entries(sources).filter(([path]) => !path.endsWith('.test.ts') && !path.includes('/performance/'))

/** Text allowed to appear literally in markup: the product name. */
const ALLOWED_TEXT = new Set(['Orbitin'])

/** Every word a learner reads comes from the message
 *  catalogue. Markup templates hold structure only - no literal text nodes
 *  and no literal accessible names, titles, placeholders or alternatives. */
it('keeps literal copy out of markup templates and DOM text assignments', () => {
  const findings: string[] = []
  for (const [path, source] of production) {
    // Markup lives in template literals and strings that contain a tag.
    const markup = [...source.matchAll(/`([^`]*)`|'([^'\n]*<[a-z][^'\n]*)'/g)]
      .map((match) => (match[1] ?? match[2]).replace(/\$\{[^}]*\}/g, '§'))
      .filter((literal) => /<[a-z][a-z0-9-]*[\s>]/.test(literal))
    for (const literal of markup) for (const match of literal.matchAll(/>([^<>]*[A-Za-zÀ-ÿ][^<>]*)</g)) {
      const textNode = match[1].replace(/§/g, '').trim()
      if (textNode && !ALLOWED_TEXT.has(textNode) && !/^[\s×›‹▴▾—]*$/.test(textNode)) findings.push(`${path}: text "${textNode}"`)
    }
    for (const match of source.matchAll(/\b(aria-label|title|placeholder|alt|aria-valuetext)="([^"$]*[A-Za-z][^"]*)"/g)) {
      if (!ALLOWED_TEXT.has(match[2])) findings.push(`${path}: ${match[1]}="${match[2]}"`)
    }
    for (const match of source.matchAll(/(?:textContent|title|placeholder)\s*=\s*['`]([A-Za-z][^'`]*)['`]/g)) findings.push(`${path}: assigned "${match[1]}"`)
    for (const match of source.matchAll(/setAttribute\('(?:aria-label|title|placeholder|alt|aria-valuetext)', ['`]([A-Za-z][^'`]*)['`]\)/g)) findings.push(`${path}: attribute "${match[1]}"`)
  }
  expect(findings).toEqual([])
})

it('offers the language choice in the Options menu before Open scene file, each name in its own language', () => {
  expect(LANGUAGE_NAMES).toEqual({ en: 'English', fi: 'Suomi' })
  expect(LANGUAGE_GROUP_LABEL).toBe('Language · Kieli')
  expect(optionsSource).toContain('role="group" aria-labelledby="options-language-label"')
  expect(optionsSource).toContain('role="menuitemradio"')
  expect(optionsSource).toContain('lang="${locale}"')
  expect(optionsSource).toContain('aria-checked="${String(locale === current)}"')
  expect(optionsSource.indexOf('options-menu-group')).toBeLessThan(optionsSource.indexOf('id="options-open-scene-file"'))
  // Choosing the current language only closes the menu.
  expect(optionsSource).toContain('if (locale !== languageTag(activeLocale())) callbacks.onLocaleChange(locale)')
})

it('rebuilds the interface in place, replaying the state it holds, and hands focus to Options', () => {
  const rebuild = uiRootSource.slice(uiRootSource.indexOf('  rebuild(): void {'), uiRootSource.indexOf('  setLoading(loading: boolean): void {'))
  for (const step of ['this.disposeViews()', 'this.views = this.build()', 'this.applyLoading()', 'this.renderShell()', 'this.views.objectList.setProvenance(this.provenance)', 'this.syncState(this.state, this.lockStatus)', 'this.setSceneOpening(this.sceneOpening)', 'this.views.optionsMenu.focusTrigger()']) expect(rebuild, step).toContain(step)
  // Controller-owned content is republished; readouts are forced; nothing is fetched here.
  const relocalize = applicationSource.slice(applicationSource.indexOf('  private relocalize(): void {'), applicationSource.indexOf('  private replayInterface(): void {'))
  for (const step of ['this.overlay.applyLocale()', 'this.sceneRoot.applyLocale()', 'this.map.applyLocale()', 'this.chooser.applyLocale()', 'this.ui.rebuild()', 'this.replayInterface()']) expect(relocalize, step).toContain(step)
  // The replay a language change and a presentation switch share.
  const replay = applicationSource.slice(applicationSource.indexOf('  private replayInterface(): void {'), applicationSource.indexOf('  private createUi('))
  for (const step of ['this.catalogue.republish()', 'this.publishOfficialGroups()', 'this.sharing.republish()', 'performance.now(), true)']) expect(replay, step).toContain(step)
  const switched = applicationSource.slice(applicationSource.indexOf('  private switchPresentation('), applicationSource.indexOf('  private applyFraming('))
  for (const step of ['this.interaction.reset()', 'this.ui.dispose()', 'shellAfterPresentationChange(', 'this.chooser.setLayout(', 'this.ui = this.createUi(next)', 'this.ui.setLoading(!this.ready)', 'this.ui.syncShell(this.shell)', 'this.ui.setGroupProvenance(', 'this.ui.syncState(', 'this.replayInterface()', 'this.requestFit()']) expect(switched, step).toContain(step)
  for (const source of [relocalize, replay, switched]) expect(source).not.toMatch(/load\(|refresh\(|resolveRecords|fetch/)
})
