import type { ProductMode, SceneState } from '../state/AppState.ts'
import { MAX_SCENE_OBJECTS } from '../state/sceneActions.ts'
import { text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'
import { icon } from './mobileIcons.ts'
import { colorCss, objectRowLine } from './objectSummaryModel.ts'

export interface ObjectsListCallbacks {
  onSelect(id: string): void
  onRemove(id: string): void
  onRemoveAll(): void
  onAdd(): void
}

/** Above this many objects the list offers a filter field. */
export const LIST_FILTER_THRESHOLD = 12
/** Remove all sits at the top; above this many objects it repeats below the list. */
export const LIST_BOTTOM_REMOVE_ALL_THRESHOLD = 8

export function objectsListMarkup(): string {
  const t = text().mobile.list
  return html`
    <div class="m-list-head">
      <span class="m-list-count"></span>
      <span class="m-list-actions">
        <button class="m-button is-danger m-list-remove-all" type="button">${t.removeAll}</button>
        <button class="m-button m-list-add" type="button">${trusted(icon('plus'))}<span class="m-list-add-label"></span></button>
      </span>
    </div>
    <label class="m-field m-list-filter" hidden><span class="sr-only">${t.filter}</span><input type="search" enterkeyhint="search" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${t.filter}" /></label>
    <ul class="m-list"></ul>
    <p class="m-line m-list-empty"></p>
    <button class="m-button is-danger m-list-remove-all is-bottom" type="button">${t.removeAll}</button>
  `
}

/** The objects of the active scene, one row each with
 *  a remove button that is always visible. A row tap selects that object
 *  only, closes the list and turns the view towards it. No checkboxes, select
 *  all or bulk actions. */
export class ObjectsListView {
  readonly root: HTMLElement
  private readonly list: HTMLElement
  private readonly filterField: HTMLElement
  private readonly filter: HTMLInputElement
  private readonly empty: HTMLElement
  private readonly addButton: HTMLButtonElement
  private scene: SceneState | null = null
  private rowsKey = ''

  constructor(documentRef: Document, callbacks: ObjectsListCallbacks) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-objects'
    this.root.innerHTML = objectsListMarkup()
    this.list = this.root.querySelector<HTMLElement>('.m-list')!
    this.filterField = this.root.querySelector<HTMLElement>('.m-list-filter')!
    this.filter = this.filterField.querySelector<HTMLInputElement>('input')!
    this.empty = this.root.querySelector<HTMLElement>('.m-list-empty')!
    this.addButton = this.root.querySelector<HTMLButtonElement>('.m-list-add')!
    this.addButton.addEventListener('click', () => callbacks.onAdd())
    for (const button of this.root.querySelectorAll('.m-list-remove-all')) button.addEventListener('click', () => callbacks.onRemoveAll())
    this.filter.addEventListener('input', () => this.renderRows(true))
    this.list.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null
      const id = target?.closest<HTMLElement>('[data-id]')?.dataset.id
      if (!target || !id) return
      if (target.dataset.action === 'remove') callbacks.onRemove(id)
      else callbacks.onSelect(id)
    })
  }

  sync(scene: SceneState, mode: ProductMode, loading: boolean): void {
    const t = text().mobile
    this.scene = scene
    this.root.querySelector('.m-list-count')!.textContent = t.list.count(scene.objects.length, MAX_SCENE_OBJECTS)
    this.root.querySelector('.m-list-add-label')!.textContent = mode === 'orbitLab' ? t.dock.newOrbitName : t.dock.add
    this.addButton.setAttribute('aria-label', mode === 'orbitLab' ? t.dock.newOrbitName : t.dock.addName)
    this.addButton.disabled = loading || scene.objects.length >= MAX_SCENE_OBJECTS
    const filterable = scene.objects.length > LIST_FILTER_THRESHOLD
    this.filterField.hidden = !filterable
    if (!filterable) this.filter.value = ''
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.m-list-remove-all, .m-list [data-action]')) button.disabled = loading
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.m-list-remove-all')) {
      button.hidden = scene.objects.length === 0 || (button.classList.contains('is-bottom') && scene.objects.length <= LIST_BOTTOM_REMOVE_ALL_THRESHOLD)
    }
    this.renderRows(false)
  }

  private renderRows(force: boolean): void {
    const scene = this.scene
    if (!scene) return
    const query = this.filter.value.trim().toLowerCase()
    const shown = query ? scene.objects.filter((object) => object.name.toLowerCase().includes(query)) : scene.objects
    const key = `${query}\u0001${shown.map((object) => `${object.id}\u0000${object.name}\u0000${object.style.colorHex}\u0000${scene.selection.primaryId === object.id}`).join('\u0001')}`
    if (!force && key === this.rowsKey) return
    this.rowsKey = key
    const t = text().mobile
    const documentRef = this.root.ownerDocument
    this.list.replaceChildren(...shown.map((object) => {
      const item = documentRef.createElement('li')
      item.dataset.id = object.id
      item.innerHTML = html`<button class="m-row" type="button" data-action="select" aria-current="${String(scene.selection.primaryId === object.id)}"><span class="m-dot" aria-hidden="true"></span><span class="m-row-text"><span class="m-row-name"></span><span class="m-row-line"></span></span></button><button class="m-icon-button m-row-remove" type="button" data-action="remove">${trusted(icon('remove'))}</button>`
      item.querySelector<HTMLElement>('.m-dot')!.style.backgroundColor = colorCss(object.style.colorHex)
      item.querySelector('.m-row-name')!.textContent = object.name
      item.querySelector('.m-row-line')!.textContent = objectRowLine(object)
      item.querySelector<HTMLButtonElement>('.m-row')!.setAttribute('aria-label', t.list.select(object.name))
      item.querySelector<HTMLButtonElement>('.m-row-remove')!.setAttribute('aria-label', t.card.removeNamed(object.name))
      return item
    }))
    this.empty.textContent = query && shown.length === 0 ? t.list.noMatch(this.filter.value.trim()) : ''
  }
}
