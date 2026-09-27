import type { ScreenPoint } from '../core/screenGeometry.ts'
import { CHOOSER_MAX_ENTRIES, type PickHitKind } from '../interaction/pickRanking.ts'
import { text } from '../i18n/index.ts'

/** One chooser row, already worded by the caller. */
export interface ChooserEntry {
  readonly id: string
  readonly name: string
  readonly colorHex: number
  readonly kind: PickHitKind
  readonly selection: 'primary' | 'selected' | 'none'
}

export type ChooserLayout = 'anchored' | 'sheet'

export interface ChooserCallbacks {
  onChoose(id: string): void
  /** Hover or keyboard focus previews an entry; null ends the preview. */
  onPreview(id: string | null): void
  onDismiss(): void
}

export function chooserMoreLabel(count: number): string { return text().sceneObjects.chooserMore(count) }

/** Arrow, Home and End movement between chooser entries; null for other keys.
 *  Arrows wrap; with no focused entry, Down starts at the first. */
export function nextChooserIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'Home': return 0
    case 'End': return count - 1
    case 'ArrowDown': return current < 0 ? 0 : (current + 1) % count
    case 'ArrowUp': return current < 0 ? count - 1 : (current - 1 + count) % count
    default: return null
  }
}

/** The deterministic ambiguity chooser: a popover at
 *  the pointer, clamped inside the view, listing ranked candidates. It
 *  applies nothing itself; the controller owns the captured intent. */
export class SceneObjectChooserView {
  readonly element: HTMLElement
  private readonly list: HTMLElement
  private readonly more: HTMLElement
  private readonly callbacks: ChooserCallbacks
  private entries: readonly ChooserEntry[] = []
  private layout: ChooserLayout = 'anchored'

  constructor(container: HTMLElement, callbacks: ChooserCallbacks) {
    this.callbacks = callbacks
    const documentRef = container.ownerDocument
    this.element = documentRef.createElement('div')
    this.element.className = 'scene-chooser'
    this.element.setAttribute('role', 'dialog')
    this.element.setAttribute('aria-label', text().sceneObjects.chooserHeading)
    this.element.hidden = true
    const heading = documentRef.createElement('p')
    heading.className = 'scene-chooser-heading'
    heading.textContent = text().sceneObjects.chooserHeading
    this.list = documentRef.createElement('ul')
    this.list.className = 'scene-chooser-list'
    this.more = documentRef.createElement('p')
    this.more.className = 'scene-chooser-more'
    this.element.append(heading, this.list, this.more)
    container.append(this.element)
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event))
    this.element.addEventListener('focusin', (event) => this.callbacks.onPreview(this.entryIdOf(event.target)))
    this.element.addEventListener('pointerover', (event) => { const id = this.entryIdOf(event.target); if (id) this.callbacks.onPreview(id) })
    this.element.addEventListener('pointerleave', () => this.callbacks.onPreview(this.entryIdOf(this.element.ownerDocument.activeElement)))
    this.list.addEventListener('click', (event) => { const id = this.entryIdOf(event.target); if (id) this.callbacks.onChoose(id) })
  }

  /** The heading follows a language change; entries are worded when opened. */
  applyLocale(): void {
    const heading = this.layout === 'sheet' ? text().mobile.chooser : text().sceneObjects.chooserHeading
    this.element.setAttribute('aria-label', heading)
    this.element.querySelector('.scene-chooser-heading')!.textContent = heading
  }

  /** The phone presentation lists the candidates in a
   *  bottom sheet with 48 px rows; keyboard behaviour is the same. */
  setLayout(layout: ChooserLayout): void {
    if (layout === this.layout) return
    this.close()
    this.layout = layout
    this.element.classList.toggle('is-sheet', layout === 'sheet')
    this.element.style.left = ''
    this.element.style.top = ''
    this.applyLocale()
  }

  get isOpen(): boolean { return !this.element.hidden }
  get listedIds(): readonly string[] { return this.entries.map((entry) => entry.id) }
  contains(target: EventTarget | null): boolean { return target instanceof Node && this.element.contains(target) }

  /** `anchor` and `bounds` in viewport CSS px. Focus moves to the first entry. */
  open(anchor: ScreenPoint, bounds: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }, entries: readonly ChooserEntry[]): void {
    this.entries = entries.slice(0, CHOOSER_MAX_ENTRIES)
    const documentRef = this.element.ownerDocument
    this.list.textContent = ''
    for (const entry of this.entries) {
      const item = documentRef.createElement('li')
      const button = documentRef.createElement('button')
      button.type = 'button'
      button.className = 'scene-chooser-entry'
      button.dataset.objectId = entry.id
      const swatch = documentRef.createElement('span')
      swatch.className = 'object-swatch'
      swatch.setAttribute('aria-hidden', 'true')
      swatch.style.backgroundColor = `#${(entry.colorHex >>> 0 & 0xffffff).toString(16).padStart(6, '0')}`
      const name = documentRef.createElement('span')
      name.className = 'scene-chooser-name'
      name.textContent = entry.name
      const detail = documentRef.createElement('span')
      detail.className = 'scene-chooser-detail'
      const t = text().sceneObjects
      const kind = t.chooserKinds[entry.kind satisfies PickHitKind]
      detail.textContent = entry.selection === 'none' ? kind : t.chooserEntry(kind, t.chooserSelection[entry.selection])
      button.append(swatch, name, detail)
      item.append(button)
      this.list.append(item)
    }
    const hidden = entries.length - this.entries.length
    this.more.hidden = hidden <= 0
    this.more.textContent = hidden > 0 ? this.layout === 'sheet' ? text().map.more(hidden) : chooserMoreLabel(hidden) : ''
    this.element.hidden = false
    if (this.layout === 'sheet') { this.buttons()[0]?.focus(); return }
    // Clamp inside the surface the click happened on.
    const width = this.element.offsetWidth || 240
    const height = this.element.offsetHeight || 40 + this.entries.length * 34
    const left = Math.max(bounds.left + 4, Math.min(anchor.x + 8, bounds.right - width - 4))
    const top = Math.max(bounds.top + 4, Math.min(anchor.y + 8, bounds.bottom - height - 4))
    this.element.style.left = `${Math.round(left)}px`
    this.element.style.top = `${Math.round(top)}px`
    this.buttons()[0]?.focus()
  }

  close(): void {
    if (this.element.hidden) return
    this.element.hidden = true
    this.entries = []
    this.list.textContent = ''
  }

  dispose(): void { this.element.remove() }

  private buttons(): HTMLButtonElement[] { return [...this.list.querySelectorAll<HTMLButtonElement>('button[data-object-id]')] }

  private entryIdOf(target: EventTarget | null): string | null {
    const button = target instanceof Element ? target.closest<HTMLElement>('[data-object-id]') : null
    return button?.dataset.objectId ?? null
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.callbacks.onDismiss(); return }
    const buttons = this.buttons()
    const next = nextChooserIndex(event.key, buttons.indexOf(this.element.ownerDocument.activeElement as HTMLButtonElement), buttons.length)
    if (next === null) return
    event.preventDefault()
    buttons[next].focus()
  }
}
