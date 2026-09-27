import { text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'
import { icon } from './mobileIcons.ts'
import type { ObjectCardModel } from './objectSummaryModel.ts'

/** Footprints have no switch on mobile: their sensor cannot be set here. */
export type CardLayer = 'orbit' | 'groundTrack'

export interface ObjectCardCallbacks {
  onLayer(layer: CardLayer, on: boolean): void
  onFocus(): void
  onEdit(): void
  onRemove(): void
  onStep(delta: -1 | 1): void
  onExpandedChange(expanded: boolean): void
}

const LAYERS: readonly CardLayer[] = ['orbit', 'groundTrack']

export function objectCardMarkup(): string {
  const t = text().mobile.card
  const layer = (name: CardLayer) => html`<button class="m-toggle" type="button" role="switch" aria-checked="false" data-layer="${name}"><span class="m-toggle-mark" aria-hidden="true"></span><span class="m-toggle-label">${t[name]}</span></button>`
  return html`
    <div class="m-card-top">
      <p class="m-card-source"><span class="m-dot" aria-hidden="true"></span><span class="m-card-source-text"></span></p>
      <button class="m-card-more" type="button" aria-expanded="false"><span class="m-card-more-text"></span>${trusted(icon('expand'))}</button>
    </div>
    <dl class="m-live">
      <div><dt>${t.altitude}</dt><dd class="m-card-altitude"></dd></div>
      <div><dt>${t.speed}</dt><dd class="m-card-speed"></dd></div>
      <div><dt>${t.period}</dt><dd class="m-card-period"></dd></div>
    </dl>
    <p class="m-line m-card-horizon" role="status"></p>
    <div class="m-card-switches">${trusted(LAYERS.map((name) => layer(name)).join(''))}</div>
    <p class="m-line m-card-budget" role="status"></p>
    <div class="m-card-actions">
      <button class="m-icon-button m-card-previous" type="button" aria-label="${t.previous}">${trusted(icon('previous'))}</button>
      <button class="m-card-action m-card-focus" type="button" aria-label="${t.focusName}">${t.focus}</button>
      <button class="m-card-action m-card-edit" type="button">${t.edit}</button>
      <button class="m-card-action m-card-remove" type="button">${t.remove}</button>
      <button class="m-icon-button m-card-next" type="button" aria-label="${t.next}">${trusted(icon('next'))}</button>
    </div>
    <div class="m-card-details" hidden>
      <dl class="m-detail-rows"></dl>
      <p class="m-line m-card-age"></p>
    </div>
  `
}

/** The object card. Compact: source, three live
 *  values, the Orbit and Ground track switches, and Focus, Edit,
 *  Remove and ‹ ›. Expanded (drag the handle up, or More details): the point
 *  below the object and the orbit's or record's key facts. Colour, names,
 *  marker size, sensor parameters and SGP4 fields stay on desktop. */
export class ObjectCardView {
  readonly root: HTMLElement
  private readonly switches: ReadonlyMap<CardLayer, HTMLButtonElement>
  private readonly details: HTMLElement
  private readonly rows: HTMLElement
  private readonly more: HTMLButtonElement
  private readonly edit: HTMLButtonElement
  private readonly remove: HTMLButtonElement
  private readonly budget: HTMLElement
  private detailsKey = ''
  private expanded = false

  constructor(documentRef: Document, callbacks: ObjectCardCallbacks) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-card'
    this.root.innerHTML = objectCardMarkup()
    const switches = new Map<CardLayer, HTMLButtonElement>()
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('button[data-layer]')) {
      const layer = button.dataset.layer as CardLayer
      switches.set(layer, button)
      button.addEventListener('click', () => callbacks.onLayer(layer, button.getAttribute('aria-checked') !== 'true'))
    }
    this.switches = switches
    this.details = this.root.querySelector<HTMLElement>('.m-card-details')!
    this.rows = this.root.querySelector<HTMLElement>('.m-detail-rows')!
    this.more = this.root.querySelector<HTMLButtonElement>('.m-card-more')!
    this.edit = this.root.querySelector<HTMLButtonElement>('.m-card-edit')!
    this.remove = this.root.querySelector<HTMLButtonElement>('.m-card-remove')!
    this.budget = this.root.querySelector<HTMLElement>('.m-card-budget')!
    this.root.querySelector('.m-card-focus')!.addEventListener('click', () => callbacks.onFocus())
    this.edit.addEventListener('click', () => callbacks.onEdit())
    this.remove.addEventListener('click', () => callbacks.onRemove())
    this.root.querySelector('.m-card-previous')!.addEventListener('click', () => callbacks.onStep(-1))
    this.root.querySelector('.m-card-next')!.addEventListener('click', () => callbacks.onStep(1))
    this.more.addEventListener('click', () => callbacks.onExpandedChange(!this.expanded))
  }

  /** Structure that changes with the object, the switches and the height. */
  sync(model: ObjectCardModel | null, expanded: boolean, loading: boolean, canStep: boolean): void {
    const t = text().mobile.card
    this.expanded = expanded
    this.root.classList.toggle('is-expanded', expanded)
    this.details.hidden = !expanded
    this.more.setAttribute('aria-expanded', String(expanded))
    this.root.querySelector('.m-card-more-text')!.textContent = expanded ? t.less : t.more
    if (!model) return
    this.root.querySelector<HTMLElement>('.m-card-source .m-dot')!.style.backgroundColor = model.color
    this.root.querySelector('.m-card-source-text')!.textContent = model.source
    for (const [layer, button] of this.switches) { button.setAttribute('aria-checked', String(model.layers[layer])); button.disabled = loading }
    this.edit.hidden = !model.editable
    this.remove.setAttribute('aria-label', t.removeNamed(model.name))
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.m-card-previous, .m-card-next')) button.disabled = loading || !canStep
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.m-card-action')) button.disabled = loading
    this.update(model)
  }

  /** Live values and rows, with the readouts; text is replaced only when it changes. */
  update(model: ObjectCardModel): void {
    const set = (selector: string, value: string) => { const element = this.root.querySelector<HTMLElement>(selector)!; if (element.textContent !== value) element.textContent = value }
    set('.m-card-altitude', model.altitude)
    set('.m-card-speed', model.speed)
    set('.m-card-period', model.period)
    set('.m-card-horizon', model.horizon)
    set('.m-card-age', model.ageWarning)
    if (!this.expanded) return
    const key = model.details.map((row) => `${row.label}\u0000${row.value}`).join('\u0001')
    if (key === this.detailsKey) return
    this.detailsKey = key
    const documentRef = this.root.ownerDocument
    this.rows.replaceChildren(...model.details.map((row) => {
      const item = documentRef.createElement('div')
      if (row.label) { const term = documentRef.createElement('dt'); term.textContent = row.label; item.append(term) } else item.className = 'm-detail-note'
      const value = documentRef.createElement('dd')
      value.textContent = row.value
      item.append(value)
      return item
    }))
  }

  /** A layer-budget refusal, beside the switches; empty clears it. */
  setBudgetMessage(message: string): void { this.budget.textContent = message }
}
