import { text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'
import { icon } from './mobileIcons.ts'

export interface ObjectChipCallbacks {
  onList(): void
  onOpen(): void
  onClear(): void
  /** A horizontal swipe: -1 for the previous object, +1 for the next. */
  onStep(delta: -1 | 1): void
}

/** The horizontal travel that counts as a swipe on the chip. */
const SWIPE_PX = 40

export function objectChipMarkup(): string {
  const t = text().mobile
  return html`
    <button class="m-chip-count" type="button" aria-haspopup="dialog">${trusted(icon('list'))}<span class="m-chip-count-value"></span></button>
    <button class="m-chip-object" type="button" aria-haspopup="true"><span class="m-dot" aria-hidden="true"></span><span class="m-chip-name"></span><span class="m-chip-value"></span></button>
    <button class="m-icon-button m-chip-clear" type="button" aria-label="${t.chip.clear}">${trusted(icon('close'))}</button>
  `
}

/** The object chip above the panel or dock. The count
 *  opens the objects list; the selected object's name and live altitude open
 *  its card; ✕ clears the selection; a horizontal swipe steps through the
 *  scene. With objects but no selection it shows the count only; with an
 *  empty scene it is hidden. */
export class ObjectChipView {
  readonly root: HTMLElement
  readonly countButton: HTMLButtonElement
  readonly objectButton: HTMLButtonElement
  private readonly countValue: HTMLElement
  private readonly dot: HTMLElement
  private readonly name: HTMLElement
  private readonly value: HTMLElement
  private readonly clear: HTMLButtonElement
  private swipe: { readonly pointerId: number; readonly x: number; readonly y: number } | null = null
  private swiped = false

  constructor(container: HTMLElement, callbacks: ObjectChipCallbacks) {
    this.root = container.ownerDocument.createElement('div')
    this.root.className = 'm-chip'
    this.root.dataset.frames = ''
    this.root.setAttribute('role', 'group')
    this.root.setAttribute('aria-label', text().mobile.chip.region)
    this.root.innerHTML = objectChipMarkup()
    this.countButton = this.root.querySelector<HTMLButtonElement>('.m-chip-count')!
    this.objectButton = this.root.querySelector<HTMLButtonElement>('.m-chip-object')!
    this.countValue = this.root.querySelector<HTMLElement>('.m-chip-count-value')!
    this.dot = this.root.querySelector<HTMLElement>('.m-dot')!
    this.name = this.root.querySelector<HTMLElement>('.m-chip-name')!
    this.value = this.root.querySelector<HTMLElement>('.m-chip-value')!
    this.clear = this.root.querySelector<HTMLButtonElement>('.m-chip-clear')!
    this.countButton.addEventListener('click', () => callbacks.onList())
    this.objectButton.addEventListener('click', () => { if (this.swiped) { this.swiped = false; return } callbacks.onOpen() })
    this.clear.addEventListener('click', () => callbacks.onClear())
    this.objectButton.addEventListener('pointerdown', (event) => { this.swipe = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }; this.swiped = false })
    this.objectButton.addEventListener('pointercancel', () => { this.swipe = null })
    this.objectButton.addEventListener('pointerup', (event) => {
      const swipe = this.swipe
      this.swipe = null
      if (!swipe || swipe.pointerId !== event.pointerId) return
      const dx = event.clientX - swipe.x
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(event.clientY - swipe.y) * 1.5) return
      this.swiped = true
      callbacks.onStep(dx < 0 ? 1 : -1)
    })
    container.append(this.root)
  }

  sync(input: { readonly count: number; readonly selected: { readonly name: string; readonly color: string } | null; readonly loading: boolean; readonly cardOpen: boolean; readonly listOpen: boolean }): void {
    const t = text().mobile.chip
    this.root.hidden = input.count === 0
    this.countValue.textContent = String(input.count)
    this.countButton.setAttribute('aria-label', t.count(input.count))
    this.countButton.setAttribute('aria-expanded', String(input.listOpen))
    this.objectButton.hidden = input.selected === null
    this.clear.hidden = input.selected === null
    if (input.selected) {
      this.dot.style.backgroundColor = input.selected.color
      this.name.textContent = input.selected.name
      this.objectButton.setAttribute('aria-label', t.open(input.selected.name))
      this.objectButton.setAttribute('aria-expanded', String(input.cardOpen))
    }
    for (const button of [this.countButton, this.objectButton, this.clear]) button.disabled = input.loading
  }

  /** The live altitude, updated with the readouts. */
  setValue(value: string): void { if (this.value.textContent !== value) this.value.textContent = value }

  dispose(): void { this.root.remove() }
}
