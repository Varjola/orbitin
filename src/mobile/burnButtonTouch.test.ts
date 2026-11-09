import { expect, it } from 'vitest'

// Vitest stubs CSS modules, even with ?raw, so the stylesheet is read from disk.
const nodeFs = 'node:fs'
const { readFileSync } = await import(/* @vite-ignore */ nodeFs) as { readFileSync(path: URL, encoding: 'utf8'): string }
const css = readFileSync(new URL('../styles/mobile.css', import.meta.url), 'utf8')

it('keeps a burn held while the finger slides off the button', () => {
  // The shell gives every button `touch-action: manipulation`, which lets the
  // browser take a moving touch and cancel the burn. The burn buttons' own rule
  // must outrank it: same root prefix, later in the file.
  const shell = css.indexOf('.mobile-ui-root :is(button, input, label, select) { touch-action: manipulation; }')
  const burn = css.search(/\.mobile-ui-root \.m-burn-button \{[^}]*touch-action: none;[^}]*-webkit-touch-callout: none;/)
  expect(shell).toBeGreaterThan(-1)
  expect(burn).toBeGreaterThan(shell)
})
