import { expect, it } from 'vitest'
import { shareSceneMarkup } from './ShareSceneView.ts'
import { sceneOpenMarkup } from './SceneOpenView.ts'
import shareSource from './ShareSceneView.ts?raw'
import openSource from './SceneOpenView.ts?raw'
import optionsSource from './OptionsMenuView.ts?raw'

// Vitest stubs CSS modules, even with ?raw, so the stylesheets are read from
// disk. The app tsconfig has no Node types, hence the typed dynamic import.
const nodeFs = 'node:fs'
const { readFileSync } = await import(/* @vite-ignore */ nodeFs) as { readFileSync(path: URL, encoding: 'utf8'): string }
const uiCss = readFileSync(new URL('../styles/ui.css', import.meta.url), 'utf8')
const baseCss = readFileSync(new URL('../styles/base.css', import.meta.url), 'utf8')

const SHARE_SCENE_MARKUP = shareSceneMarkup()
const SCENE_OPEN_MARKUP = sceneOpenMarkup()
const tag = (markup: string, id: string) => markup.match(new RegExp(`<[a-z0-9]+ id="${id}"[^>]*>`))?.[0] ?? ''

it('gives the Share button an accessible name and a modal dialog with a live region', () => {
  const trigger = tag(SHARE_SCENE_MARKUP, 'share-scene-button')
  expect(trigger).toContain('aria-label="Share scene"')
  expect(trigger).toContain('aria-haspopup="dialog"')
  expect(SHARE_SCENE_MARKUP).toContain('<span class="share-trigger-label">Share</span>')
  expect(tag(SHARE_SCENE_MARKUP, 'share-scene-dialog')).toContain('aria-labelledby="share-scene-title"')
  expect(tag(SHARE_SCENE_MARKUP, 'share-status')).toContain('aria-live="polite"')
  expect(tag(SHARE_SCENE_MARKUP, 'share-link-field')).toContain('readonly')
  // Actions in the specified order.
  const order = ['share-copy-link', 'share-download-file', 'share-close'].map((id) => SHARE_SCENE_MARKUP.indexOf(`id="${id}"`))
  expect(order).toEqual([...order].sort((a, b) => a - b))
  // The Options trigger stays right-most; Share is inserted before it.
  expect(shareSource).toContain('container.prepend(')
  // Focus returns to Share when the dialog closes; the clipboard failure shows the link.
  expect(shareSource).toContain("this.dialog.addEventListener('close', () => this.trigger.focus())")
  expect(shareSource).toContain('this.fallback.hidden = false')
})

it('confirms with Open scene focused, announces status politely and never needs a catalogue', () => {
  expect(tag(SCENE_OPEN_MARKUP, 'scene-file-input')).toContain('accept=".json,application/json"')
  expect(tag(SCENE_OPEN_MARKUP, 'scene-open-dialog')).toContain('aria-describedby="scene-open-message"')
  expect(openSource).toContain("this.dialog.querySelector<HTMLButtonElement>('#scene-open-confirm')!.focus()")
  expect(tag(SCENE_OPEN_MARKUP, 'scene-open-status-text')).toContain('aria-live="polite"')
  // Escape on the dialog is a cancel, and a hidden panel gives focus back.
  expect(openSource).toContain("this.dialog.addEventListener('cancel'")
  expect(openSource).toContain('this.focusFallback()')
  for (const source of [shareSource, openSource]) expect(source).not.toMatch(/CatalogueClient|resolveRecords|loadCatalogue/)
})

it('renders scene-derived text only as text', () => {
  // Dynamic content goes through textContent; the only innerHTML is the fixed markup template.
  for (const source of [shareSource, openSource]) {
    expect(source.match(/innerHTML/g)).toHaveLength(1)
    expect(source).toContain('.textContent = ')
  }
  expect(openSource).toContain('paragraph.textContent = line')
})

it('puts Open scene file… before About Orbitin and cycles only enabled items', () => {
  expect(optionsSource.indexOf('id="options-open-scene-file"')).toBeLessThan(optionsSource.indexOf('id="options-about"'))
  expect(optionsSource).toContain(`const MENU_ITEMS = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)'`)
  expect(optionsSource).toContain('callbacks.onChooseSceneFile()')
})

it('keeps the Open scene dialog clickable inside the pass-through UI root', () => {
  // SceneOpenView mounts in .ui-root, which lets pointer events through to the
  // scene; without its own rule the dialog buttons ignore the mouse.
  expect(baseCss).toMatch(/\.ui-root \{[^}]*pointer-events: none/)
  expect(uiCss).toContain('.scene-open-dialog { pointer-events: auto; }')
  expect(uiCss).toMatch(/\.scene-open-status \{[^}]*pointer-events: auto/)
  // A hovered primary action keeps its gradient rather than turning dark.
  expect(uiCss).toContain('.dialog-action:not(.is-primary):hover:not(:disabled)')
})
