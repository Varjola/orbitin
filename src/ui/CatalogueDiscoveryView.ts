import type { CatalogueDiscoveryPresentation } from './catalogueDiscoveryModel.ts'
import { GROUP_ADD_CONFIRMATION_THRESHOLD } from './catalogueWording.ts'
import { format, text } from '../i18n/index.ts'
import { html } from './markup.ts'
import type { AddCatalogueRecordsOutcome } from '../state/catalogueAdditionOutcome.ts'
import { sceneStatusMessage } from './sceneStatusWording.ts'

/** Structurally the pure index/scene addition preview; computed by the
 *  workspace, so this view needs no scene or catalogue client. */
export interface GroupAddPreview {
  readonly totalSelected: number
  readonly alreadyInScene: number
  readonly newRecordsToAdd: number
  readonly slotsRemaining: number
}

export interface CatalogueDiscoveryCallbacks {
  onOpenPage(pageId: string): void
  onOpenLegacyGroup(groupId: string): void
  onBrowseAll(): void
  /** Whole-group add with the ordered present member ids. */
  onAddGroup?(groupId: string, memberIds: readonly string[]): Promise<AddCatalogueRecordsOutcome>
  previewGroupAdd?(memberIds: readonly string[]): GroupAddPreview
  /** The group's education page. */
  onOpenGroupEducation?(groupId: string): void
}

/** Active Discovery Page header. It is mounted above the results it scopes,
 * so its copy and index-derived facts stay beside the member window. An
 * official-system page also shows its membership provenance, any reviewed
 * members missing from the current index, and the previewed,
 * atomic Add all to scene action for its present members. */
export function catalogueDiscoveryPageMarkup(): string {
  const t = text().catalogue
  return html`
  <section id="catalogue-active-page" class="catalogue-active-page" aria-labelledby="catalogue-active-page-heading" hidden>
    <p id="catalogue-active-page-kind" class="catalogue-eyebrow"></p>
    <h3 id="catalogue-active-page-heading" tabindex="-1"></h3>
    <p id="catalogue-active-page-summary" class="catalogue-page-summary"></p>
    <p id="catalogue-active-page-why" class="teaching-note is-visible" hidden></p>
    <p id="catalogue-active-page-count" class="catalogue-page-count"></p>
    <dl id="catalogue-active-page-facts" class="catalogue-page-facts"></dl>
    <p id="catalogue-active-page-missing" class="time-note" hidden></p>
    <div id="catalogue-group-add" class="catalogue-group-add" hidden>
      <dl id="catalogue-group-add-preview" class="catalogue-page-facts"></dl>
      <div class="catalogue-group-add-actions"><button id="catalogue-group-add-button" class="action-button primary-action" type="button"></button><button id="catalogue-group-education" class="link-button" type="button">${text().groupPages.open}</button></div>
      <p id="catalogue-group-add-capacity" class="time-note" role="status"></p>
      <div id="catalogue-group-add-confirm" class="scene-objects-confirm" role="group" aria-label="${t.confirmGroupAdd}" hidden>
        <p id="catalogue-group-add-confirm-text"></p>
        <div class="scene-objects-confirm-actions"><button id="catalogue-group-add-confirm-add" class="action-button primary-action" type="button">${t.add}</button><button id="catalogue-group-add-confirm-cancel" class="action-button" type="button">${t.cancel}</button></div>
      </div>
      <p id="catalogue-group-add-status" class="time-note" role="status"></p>
    </div>
    <div id="catalogue-active-page-provenance" class="catalogue-page-provenance" hidden>
      <h4 id="catalogue-active-page-provenance-heading">${t.membershipProvenance}</h4>
      <dl id="catalogue-active-page-provenance-rows" class="catalogue-page-facts" aria-labelledby="catalogue-active-page-provenance-heading"></dl>
      <a id="catalogue-active-page-source" class="catalogue-page-source" target="_blank" rel="noopener noreferrer" hidden>${t.provenanceSource}</a>
    </div>
  </section>
`
}

/** Explore entry points: the six broad pages, or labelled legacy groups,
 *  then the official satellite groups in a list of their own, each with its
 *  education page one click away. */
export function catalogueDiscoveryMarkup(): string {
  const t = text().catalogue
  return html`
  <div class="catalogue-explore-heading">
    <h3 id="catalogue-explore-heading">${t.exploreHeading}</h3>
    <button id="catalogue-browse-all" class="action-button" type="button">${t.browseAll}</button>
  </div>
  <p id="catalogue-legacy-intro" class="time-note" hidden></p>
  <ul id="catalogue-explore-list" class="catalogue-explore-list" aria-labelledby="catalogue-explore-heading"></ul>
  <h4 id="catalogue-explore-groups-heading" class="catalogue-explore-subheading" hidden>${t.exploreGroups}</h4>
  <ul id="catalogue-explore-groups" class="catalogue-explore-list catalogue-explore-groups" aria-labelledby="catalogue-explore-groups-heading" hidden></ul>
`
}

/** Explore cards and the active Discovery Page header. Membership, counts and
 * facts arrive precomputed from the controller; this view never inspects page
 * ids to decide membership and never requests catalogue records. */
export class CatalogueDiscoveryView {
  readonly root: HTMLElement
  private readonly pageRoot: HTMLElement
  private readonly callbacks: CatalogueDiscoveryCallbacks
  private readonly list: HTMLUListElement
  private readonly groupList: HTMLUListElement
  private readonly activePage: HTMLElement
  private readonly legacyIntro: HTMLElement
  private listSignature = ''
  private groupAdd: { readonly groupId: string; readonly memberIds: readonly string[] } | null = null
  private groupAddPending = false

  constructor(pageContainer: HTMLElement, container: HTMLElement, callbacks: CatalogueDiscoveryCallbacks) {
    this.root = container
    this.pageRoot = pageContainer
    this.callbacks = callbacks
    this.pageRoot.innerHTML = catalogueDiscoveryPageMarkup()
    this.root.innerHTML = catalogueDiscoveryMarkup()
    this.root.hidden = true
    this.list = this.root.querySelector<HTMLUListElement>('#catalogue-explore-list')!
    this.groupList = this.root.querySelector<HTMLUListElement>('#catalogue-explore-groups')!
    this.activePage = this.pageRoot.querySelector<HTMLElement>('#catalogue-active-page')!
    this.legacyIntro = this.root.querySelector<HTMLElement>('#catalogue-legacy-intro')!
    this.root.querySelector('#catalogue-browse-all')!.addEventListener('click', () => this.callbacks.onBrowseAll())
    const confirm = this.pageRoot.querySelector<HTMLElement>('#catalogue-group-add-confirm')!
    this.pageRoot.querySelector('#catalogue-group-add-button')!.addEventListener('click', () => {
      const group = this.groupAdd
      if (!group || !this.callbacks.previewGroupAdd) return
      const preview = this.callbacks.previewGroupAdd(group.memberIds)
      if (preview.newRecordsToAdd >= GROUP_ADD_CONFIRMATION_THRESHOLD) {
        this.pageRoot.querySelector('#catalogue-group-add-confirm-text')!.textContent = text().catalogue.groupAddConfirmation(preview.newRecordsToAdd)
        confirm.hidden = false
        this.pageRoot.querySelector<HTMLButtonElement>('#catalogue-group-add-confirm-cancel')!.focus()
        return
      }
      void this.addGroup()
    })
    this.pageRoot.querySelector('#catalogue-group-add-confirm-add')!.addEventListener('click', () => { confirm.hidden = true; void this.addGroup() })
    this.pageRoot.querySelector('#catalogue-group-add-confirm-cancel')!.addEventListener('click', () => { confirm.hidden = true; this.pageRoot.querySelector<HTMLButtonElement>('#catalogue-group-add-button')!.focus() })
    this.pageRoot.querySelector('#catalogue-group-education')!.addEventListener('click', () => { if (this.groupAdd) this.callbacks.onOpenGroupEducation?.(this.groupAdd.groupId) })
    const openFromList = (event: Event) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button[data-page-id], button[data-legacy-group-id], button[data-education-group-id]')
      if (!button) return
      if (button.dataset.educationGroupId) this.callbacks.onOpenGroupEducation?.(button.dataset.educationGroupId)
      else if (button.dataset.pageId) this.callbacks.onOpenPage(button.dataset.pageId)
      else if (button.dataset.legacyGroupId) this.callbacks.onOpenLegacyGroup(button.dataset.legacyGroupId)
    }
    this.list.addEventListener('click', openFromList)
    this.groupList.addEventListener('click', openFromList)
  }

  render(model: CatalogueDiscoveryPresentation): void {
    this.root.hidden = false
    this.renderActivePage(model)
    this.legacyIntro.hidden = model.legacyIntro === null
    this.legacyIntro.textContent = model.legacyIntro ?? ''
    const signature = JSON.stringify([model.cards.map((card) => [card.id, card.countLabel]), model.legacyGroups.map((group) => group.id)])
    if (signature !== this.listSignature) { this.rebuildList(model); this.listSignature = signature }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.catalogue-explore-list button[data-page-id]')) {
      const active = model.cards.some((card) => card.id === button.dataset.pageId && card.active)
      button.closest('li')?.classList.toggle('is-active', active)
      if (active) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current')
    }
    for (const button of this.list.querySelectorAll<HTMLButtonElement>('button[data-legacy-group-id]')) {
      const active = model.legacyGroups.some((group) => group.id === button.dataset.legacyGroupId && group.active)
      button.closest('li')?.classList.toggle('is-active', active)
      if (active) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current')
    }
  }

  /** The Real Objects scene changed: refresh the group-add preview. */
  refreshGroupAdd(): void { this.renderGroupAdd() }

  dispose(): void { this.root.textContent = ''; this.pageRoot.textContent = '' }

  private async addGroup(): Promise<void> {
    const group = this.groupAdd
    if (!group || this.groupAddPending || !this.callbacks.onAddGroup) return
    this.groupAddPending = true
    this.renderGroupAdd()
    const status = this.pageRoot.querySelector('#catalogue-group-add-status')!
    try {
      status.textContent = sceneStatusMessage(await this.callbacks.onAddGroup(group.groupId, group.memberIds))
    } finally {
      this.groupAddPending = false
      this.renderGroupAdd()
    }
  }

  /** Preview, capacity refusal and the action, all from index identity and
   *  scene membership; no record or shard is requested here. */
  private renderGroupAdd(): void {
    const section = this.pageRoot.querySelector<HTMLElement>('#catalogue-group-add')!
    const group = this.groupAdd
    section.hidden = group === null || !this.callbacks.onAddGroup || !this.callbacks.previewGroupAdd || group.memberIds.length === 0
    if (!group || section.hidden || !this.callbacks.previewGroupAdd) return
    const preview = this.callbacks.previewGroupAdd(group.memberIds)
    const t = text().catalogue
    const f = format()
    this.appendRows(this.pageRoot.querySelector<HTMLElement>('#catalogue-group-add-preview')!, [
      { label: t.groupAddPreview.present, text: f.integer(preview.totalSelected) },
      { label: t.groupAddPreview.inScene, text: f.integer(preview.alreadyInScene) },
      { label: t.groupAddPreview.toAdd, text: f.integer(preview.newRecordsToAdd) },
      { label: t.groupAddPreview.slots, text: f.integer(preview.slotsRemaining) },
    ])
    const overCapacity = preview.newRecordsToAdd > preview.slotsRemaining
    const button = this.pageRoot.querySelector<HTMLButtonElement>('#catalogue-group-add-button')!
    button.textContent = t.groupAdd(preview.totalSelected)
    button.disabled = overCapacity || this.groupAddPending
    this.pageRoot.querySelector('#catalogue-group-add-capacity')!.textContent = overCapacity ? t.groupAddCapacity(preview.newRecordsToAdd, preview.slotsRemaining) : ''
    const education = this.pageRoot.querySelector<HTMLButtonElement>('#catalogue-group-education')!
    education.hidden = !this.callbacks.onOpenGroupEducation || !text().groupPages.groups[group.groupId]
    if (overCapacity) this.pageRoot.querySelector<HTMLElement>('#catalogue-group-add-confirm')!.hidden = true
  }

  private renderActivePage(model: CatalogueDiscoveryPresentation): void {
    const page = model.active
    this.activePage.hidden = page === null
    const nextGroup = page?.groupAdd ?? null
    if (nextGroup?.groupId !== this.groupAdd?.groupId) {
      this.pageRoot.querySelector('#catalogue-group-add-status')!.textContent = ''
      this.pageRoot.querySelector<HTMLElement>('#catalogue-group-add-confirm')!.hidden = true
    }
    this.groupAdd = nextGroup
    this.renderGroupAdd()
    if (!page) return
    this.pageRoot.querySelector('#catalogue-active-page-kind')!.textContent = page.kindLabel
    this.pageRoot.querySelector('#catalogue-active-page-heading')!.textContent = page.title
    this.pageRoot.querySelector('#catalogue-active-page-summary')!.textContent = page.summary
    const why = this.pageRoot.querySelector<HTMLElement>('#catalogue-active-page-why')!
    why.hidden = page.whyItMatters === null; why.textContent = page.whyItMatters ?? ''
    this.pageRoot.querySelector('#catalogue-active-page-count')!.textContent = page.memberCountLabel
    const facts = this.pageRoot.querySelector<HTMLElement>('#catalogue-active-page-facts')!
    facts.textContent = ''
    this.appendRows(facts, page.facts)
    const missing = this.pageRoot.querySelector<HTMLElement>('#catalogue-active-page-missing')!
    missing.hidden = page.missingMembersNote === null; missing.textContent = page.missingMembersNote ?? ''
    const provenance = this.pageRoot.querySelector<HTMLElement>('#catalogue-active-page-provenance')!
    provenance.hidden = page.provenance === null
    this.appendRows(this.pageRoot.querySelector<HTMLElement>('#catalogue-active-page-provenance-rows')!, page.provenance?.rows ?? [])
    const source = this.pageRoot.querySelector<HTMLAnchorElement>('#catalogue-active-page-source')!
    const sourceUrl = page.provenance?.sourceUrl ?? null
    source.hidden = sourceUrl === null
    if (sourceUrl === null) source.removeAttribute('href'); else source.href = sourceUrl
  }

  private appendRows(list: HTMLElement, rows: readonly { readonly label: string; readonly text: string }[]): void {
    list.textContent = ''
    for (const row of rows) {
      const term = this.element('dt'); term.textContent = row.label
      const value = this.element('dd'); value.textContent = row.text
      list.append(term, value)
    }
  }

  private rebuildList(model: CatalogueDiscoveryPresentation): void {
    const documentRef = this.root.ownerDocument
    const active = documentRef.activeElement
    const focused = active instanceof HTMLElement && this.root.contains(active) && active.closest('.catalogue-explore-list') ? { id: active.dataset.pageId ?? active.dataset.legacyGroupId ?? active.dataset.educationGroupId ?? null, education: active.dataset.educationGroupId !== undefined } : null
    this.list.textContent = ''
    this.groupList.textContent = ''
    for (const card of model.cards) {
      const official = card.kind === 'official-system'
      const item = this.element('li', official ? 'catalogue-explore-card is-group' : 'catalogue-explore-card')
      const button = this.element('button', 'catalogue-explore-open'); button.type = 'button'; button.dataset.pageId = card.id
      const title = this.element('span', 'catalogue-explore-title'); title.textContent = card.title
      const count = this.element('span', 'catalogue-explore-count'); count.textContent = card.countLabel
      button.append(title, count)
      const summary = this.element('p', 'catalogue-explore-summary'); summary.id = `catalogue-explore-summary-${card.id}`; summary.textContent = text().catalogue.cardSummary(card.kindLabel, card.summary)
      button.setAttribute('aria-describedby', summary.id)
      item.append(button, summary)
      if (official && this.callbacks.onOpenGroupEducation && text().groupPages.groups[card.id]) {
        const about = this.element('button', 'link-button catalogue-explore-about'); about.type = 'button'; about.dataset.educationGroupId = card.id
        about.textContent = text().groupPages.open
        about.setAttribute('aria-label', text().groupPages.openNamed(card.title))
        item.append(about)
      }
      if (official) this.groupList.append(item)
      else this.list.append(item)
    }
    const hasGroups = this.groupList.childElementCount > 0
    this.groupList.hidden = !hasGroups
    this.root.querySelector<HTMLElement>('#catalogue-explore-groups-heading')!.hidden = !hasGroups
    for (const group of model.legacyGroups) {
      const item = this.element('li', 'catalogue-explore-card')
      const button = this.element('button', 'catalogue-explore-open'); button.type = 'button'; button.dataset.legacyGroupId = group.id
      const title = this.element('span', 'catalogue-explore-title'); title.textContent = group.label
      const kind = this.element('span', 'catalogue-explore-count'); kind.textContent = text().catalogue.legacyGroup
      button.append(title, kind); item.append(button); this.list.append(item)
    }
    if (focused?.id) [...this.root.querySelectorAll<HTMLButtonElement>('.catalogue-explore-list button')].find((button) => focused.education ? button.dataset.educationGroupId === focused.id : (button.dataset.pageId ?? button.dataset.legacyGroupId) === focused.id)?.focus()
  }

  private element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const element = this.root.ownerDocument.createElement(tag); if (className) element.className = className; return element
  }
}
