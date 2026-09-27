import { text } from '../i18n/index.ts'
import { objectColorCss, OBJECT_SWATCHES } from '../state/objectActions.ts'

/** The palette name of a colour in the active language, else its `#rrggbb`. */
export function objectColorName(value: number): string { return text().colours.names[value] ?? objectColorCss(value) }

export interface ColorPaletteOptions {
  /** Accessible name of the swatch group, for example `Orbit colour`. */
  readonly label: string
  readonly onPick: (colorHex: number) => void
}

/** One row of swatches plus a free custom colour. The
 *  row is one tab stop (roving tabindex); arrow keys, Home and End move
 *  between swatches, and Enter or Space applies one.
 *  `null` as the current colour means a mixed selection: no swatch pressed. */
export class ColorPaletteView {
  readonly root: HTMLElement
  private readonly swatches: HTMLButtonElement[] = []
  private readonly custom: HTMLInputElement
  private readonly current: HTMLElement
  private focusIndex = 0

  constructor(host: HTMLElement, options: ColorPaletteOptions) {
    const documentRef = host.ownerDocument
    this.root = documentRef.createElement('div')
    this.root.className = 'color-palette'
    const grid = documentRef.createElement('div')
    grid.className = 'color-swatches'
    grid.setAttribute('role', 'group')
    grid.setAttribute('aria-label', options.label)
    OBJECT_SWATCHES.forEach((value, index) => {
      const label = objectColorName(value)
      const swatch = documentRef.createElement('button')
      swatch.type = 'button'
      swatch.className = 'color-swatch'
      swatch.dataset.color = String(value)
      swatch.style.setProperty('--swatch-color', objectColorCss(value))
      swatch.setAttribute('aria-label', label)
      swatch.setAttribute('aria-pressed', 'false')
      swatch.title = label
      swatch.tabIndex = index === 0 ? 0 : -1
      swatch.addEventListener('click', () => { this.focusIndex = index; options.onPick(value) })
      swatch.addEventListener('keydown', (event) => this.onKeyDown(event, index))
      this.swatches.push(swatch)
      grid.append(swatch)
    })
    const footer = documentRef.createElement('div')
    footer.className = 'color-palette-footer'
    const customLabel = documentRef.createElement('label')
    customLabel.className = 'color-custom'
    this.custom = documentRef.createElement('input')
    this.custom.type = 'color'
    this.custom.setAttribute('aria-label', text().colours.customFor(options.label))
    this.custom.addEventListener('change', () => {
      const value = Number.parseInt(this.custom.value.slice(1), 16)
      if (Number.isInteger(value)) options.onPick(value)
    })
    const customText = documentRef.createElement('span')
    customText.textContent = text().colours.custom
    customLabel.append(this.custom, customText)
    this.current = documentRef.createElement('span')
    this.current.className = 'color-current'
    footer.append(customLabel, this.current)
    this.root.append(grid, footer)
    host.append(this.root)
  }

  sync(colorHex: number | null, disabled: boolean): void {
    let pressedIndex = -1
    this.swatches.forEach((swatch, index) => {
      const pressed = colorHex !== null && Number(swatch.dataset.color) === colorHex
      if (pressed) pressedIndex = index
      swatch.setAttribute('aria-pressed', String(pressed))
      swatch.disabled = disabled
    })
    // The tab stop follows the applied colour unless focus is already inside.
    if (!this.root.contains(this.root.ownerDocument.activeElement)) this.setTabStop(pressedIndex >= 0 ? pressedIndex : 0)
    this.custom.disabled = disabled
    if (colorHex !== null) this.custom.value = objectColorCss(colorHex)
    this.custom.classList.toggle('is-active', colorHex !== null && pressedIndex < 0)
    this.current.textContent = colorHex === null ? text().colours.mixed : objectColorName(colorHex)
  }

  private setTabStop(index: number): void {
    this.swatches[this.focusIndex].tabIndex = -1
    this.focusIndex = index
    this.swatches[index].tabIndex = 0
  }

  private onKeyDown(event: KeyboardEvent, index: number): void {
    const last = this.swatches.length - 1
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? Math.min(last, index + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? Math.max(0, index - 1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : null
    if (next === null) return
    event.preventDefault()
    this.setTabStop(next)
    this.swatches[next].focus()
  }
}
