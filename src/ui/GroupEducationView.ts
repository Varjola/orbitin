import type { GroupOrbitFacts } from '../data/groupOrbitFacts.ts'
import { officialGroupBundle } from '../data/officialGroups/index.ts'
import type { OrbitPresetId } from '../simulation/orbitPresets.ts'
import { format, text } from '../i18n/index.ts'
import { officialGroupTitle } from './catalogueWording.ts'
import { html } from './markup.ts'

export interface GroupEducationCallbacks {
  /** The live facts of a group's members present in the loaded catalogue. */
  loadFacts(groupId: string): Promise<GroupOrbitFacts | null>
  /** Opens Orbit Lab with a new orbit from this example. */
  tryExample(presetId: OrbitPresetId): void
}

/** A group's education page, readable in about a
 *  minute: what it is, how its orbit is designed, live facts from the loaded
 *  catalogue, what to try, and its sources. A modal dialog on desktop. */
export class GroupEducationView {
  readonly root: HTMLDialogElement
  private readonly callbacks: GroupEducationCallbacks
  private request = 0
  private returnFocus: HTMLElement | null = null

  constructor(container: HTMLElement, callbacks: GroupEducationCallbacks) {
    this.callbacks = callbacks
    const documentRef = container.ownerDocument
    this.root = documentRef.createElement('dialog')
    this.root.id = 'group-education-dialog'
    this.root.className = 'about-dialog group-education-dialog'
    this.root.setAttribute('aria-labelledby', 'group-education-title')
    const t = text().groupPages
    this.root.innerHTML = html`
      <header class="about-dialog-header">
        <h2 id="group-education-title"></h2>
        <button id="group-education-close" class="icon-button about-dialog-close" type="button" aria-label="${t.close}" title="${t.close}"><span aria-hidden="true">×</span></button>
      </header>
      <h3>${t.whatItIs}</h3>
      <p id="group-education-what"></p>
      <h3>${t.orbitDesign}</h3>
      <p id="group-education-design"></p>
      <h3>${t.liveFacts}</h3>
      <p id="group-education-facts-status" class="time-note" role="status"></p>
      <dl id="group-education-facts" class="catalogue-page-facts"></dl>
      <h3>${t.tryThis}</h3>
      <ul id="group-education-try" class="group-education-try"></ul>
      <button id="group-education-example" class="action-button" type="button"></button>
      <h3>${t.sources}</h3>
      <p id="group-education-reviewed" class="time-note"></p>
      <ul id="group-education-links" class="group-education-links"></ul>
    `
    container.append(this.root)
    this.root.querySelector('#group-education-close')!.addEventListener('click', () => this.close())
    this.root.addEventListener('click', (event) => {
      if (event.target !== this.root) return
      const rect = this.root.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.close()
    })
    this.root.addEventListener('close', () => { this.request += 1; this.returnFocus?.focus(); this.returnFocus = null })
  }

  /** Shows the page of `groupId`; unknown ids do nothing. */
  open(groupId: string): void {
    const bundle = officialGroupBundle(groupId)
    const words = text().groupPages.groups[groupId]
    if (!bundle || !words) return
    const t = text().groupPages
    const f = format()
    const documentRef = this.root.ownerDocument
    this.returnFocus = documentRef.activeElement instanceof HTMLElement ? documentRef.activeElement : null
    this.root.querySelector('#group-education-title')!.textContent = officialGroupTitle(groupId, bundle.group.title)
    this.root.querySelector('#group-education-what')!.textContent = `${words.lead} ${words.whatItIs}`
    this.root.querySelector('#group-education-design')!.textContent = words.orbitDesign
    const tries = this.root.querySelector<HTMLElement>('#group-education-try')!
    tries.replaceChildren(...words.tryThis.map((line) => { const item = documentRef.createElement('li'); item.textContent = line; return item }))
    const example = this.root.querySelector<HTMLButtonElement>('#group-education-example')!
    example.textContent = t.tryExample(text().mobile.newOrbit.exampleNames[bundle.education.orbitLabExample])
    example.onclick = () => { this.close(); this.callbacks.tryExample(bundle.education.orbitLabExample) }
    const provenance = bundle.group.provenance
    this.root.querySelector('#group-education-reviewed')!.textContent = t.reviewed(provenance.authority, provenance.reviewedAtUtc.slice(0, 10), bundle.revision)
    const links = this.root.querySelector<HTMLElement>('#group-education-links')!
    links.replaceChildren(...bundle.education.links.map((entry) => {
      const item = documentRef.createElement('li')
      const link = documentRef.createElement('a')
      link.href = entry.url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.textContent = entry.label
      item.append(link)
      return item
    }))
    const status = this.root.querySelector<HTMLElement>('#group-education-facts-status')!
    const facts = this.root.querySelector<HTMLElement>('#group-education-facts')!
    status.textContent = t.loadingFacts
    status.hidden = false
    facts.replaceChildren()
    const request = ++this.request
    void this.callbacks.loadFacts(groupId).then((result) => {
      if (request !== this.request) return
      if (!result) { status.textContent = t.noMembers; return }
      status.textContent = ''
      status.hidden = true
      const rows: readonly (readonly [string, string])[] = [
        [t.facts.members, f.integer(result.memberCount)],
        [t.facts.inclination, f.degrees(result.medianInclinationRad, 1)],
        [t.facts.period, f.duration(result.medianPeriodSeconds)],
        [t.facts.altitude, t.altitudeRange(f.integer(Math.round(result.lowestPerigeeKm / 10) * 10), f.km(Math.round(result.highestApogeeKm / 10) * 10, 0))],
      ]
      facts.replaceChildren(...rows.flatMap(([label, value]) => {
        const term = documentRef.createElement('dt'); term.textContent = label
        const detail = documentRef.createElement('dd'); detail.textContent = value
        return [term, detail]
      }))
    }, () => { if (request === this.request) status.textContent = t.factsFailed })
    if (!this.root.open) {
      if (typeof this.root.showModal === 'function') this.root.showModal()
      else this.root.setAttribute('open', '')
    }
    this.root.querySelector<HTMLButtonElement>('#group-education-close')!.focus()
  }

  close(): void {
    if (typeof this.root.close === 'function') { if (this.root.open) this.root.close() } else this.root.removeAttribute('open')
  }

  dispose(): void {
    this.request += 1
    this.returnFocus = null
    this.close()
    this.root.remove()
  }
}
