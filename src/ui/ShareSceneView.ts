import type { UiCallbacks } from './uiTypes.ts'
import { text } from '../i18n/index.ts'
import { html } from './markup.ts'
import { linkUnavailableReason, shareDialogModel } from './sceneSharingWording.ts'

type ShareCallbacks = Pick<UiCallbacks, 'onShareSceneRequested' | 'onCopySceneLink' | 'onSceneFileRequested'>

export function shareSceneMarkup(): string {
  const t = text().sharing
  return html`
  <button id="share-scene-button" class="share-trigger" type="button" aria-haspopup="dialog" aria-controls="share-scene-dialog" aria-label="${t.shareScene}" title="${t.shareScene}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.6"></circle><circle cx="6" cy="12" r="2.6"></circle><circle cx="18" cy="19" r="2.6"></circle><path d="M8.3 10.8 15.7 6.2M8.3 13.2l7.4 4.6"></path></svg><span class="share-trigger-label">${t.share}</span></button>
  <dialog id="share-scene-dialog" class="about-dialog share-dialog" aria-labelledby="share-scene-title">
    <h2 id="share-scene-title">${t.title}</h2>
    <p id="share-scene-summary" class="share-summary"></p>
    <p id="share-scene-time"></p>
    <p id="share-scene-catalogue" hidden></p>
    <p id="share-scene-privacy" class="about-note"></p>
    <div class="dialog-actions">
      <button id="share-copy-link" class="dialog-action is-primary" type="button">${t.copyLink}</button>
      <button id="share-download-file" class="dialog-action" type="button">${t.downloadFile}</button>
      <button id="share-close" class="dialog-action" type="button">${t.close}</button>
    </div>
    <p id="share-link-reason" class="share-link-reason" hidden></p>
    <p id="share-status" class="share-status" role="status" aria-live="polite"></p>
    <div id="share-link-fallback" class="share-link-fallback" hidden>
      <label class="sr-only" for="share-link-field">${t.linkField}</label>
      <input id="share-link-field" type="text" readonly spellcheck="false" />
    </div>
  </dialog>
`
}

/** The Share button left of Options and the Share
 *  scene dialog. Every action encodes the scene when it is pressed. */
export class ShareSceneView {
  private readonly callbacks: ShareCallbacks
  private readonly trigger: HTMLButtonElement
  private readonly dialog: HTMLDialogElement
  private readonly copyButton: HTMLButtonElement
  private readonly reason: HTMLElement
  private readonly fallback: HTMLElement
  private readonly field: HTMLInputElement
  private readonly status: HTMLElement
  private readonly elements: Element[]
  private opening = false

  constructor(container: HTMLElement, callbacks: ShareCallbacks) {
    this.callbacks = callbacks
    const template = container.ownerDocument.createElement('template')
    template.innerHTML = shareSceneMarkup()
    this.elements = [...template.content.children]
    // The Options trigger stays the right-most control of the top bar.
    container.prepend(...this.elements)
    const find = <T extends HTMLElement>(id: string): T => this.elements.map((element) => element.id === id ? element : element.querySelector(`#${id}`)).find(Boolean) as T
    this.trigger = find<HTMLButtonElement>('share-scene-button')
    this.dialog = find<HTMLDialogElement>('share-scene-dialog')
    this.copyButton = find<HTMLButtonElement>('share-copy-link')
    this.reason = find('share-link-reason')
    this.fallback = find('share-link-fallback')
    this.field = find<HTMLInputElement>('share-link-field')
    this.status = find('share-status')

    this.trigger.addEventListener('click', () => this.open())
    this.copyButton.addEventListener('click', () => { void this.copyLink() })
    find('share-download-file').addEventListener('click', () => this.download())
    find('share-close').addEventListener('click', () => this.dialog.close())
    this.field.addEventListener('focus', () => this.field.select())
    this.dialog.addEventListener('click', (event) => {
      if (event.target !== this.dialog) return
      const rect = this.dialog.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.dialog.close()
    })
    this.dialog.addEventListener('close', () => this.trigger.focus())
  }

  /** Share stays unavailable while a shared scene is opening. */
  setOpening(opening: boolean): void {
    this.opening = opening
    this.trigger.disabled = opening
    if (opening && this.dialog.open) this.dialog.close()
  }

  dispose(): void {
    if (this.dialog.open) this.dialog.close()
    for (const element of this.elements) element.remove()
  }

  private open(): void {
    if (this.opening || this.dialog.open) return
    const request = this.callbacks.onShareSceneRequested()
    const model = shareDialogModel(request, request.link)
    this.find('share-scene-summary').textContent = model.summary
    this.find('share-scene-time').textContent = model.timeNote
    const catalogue = this.find('share-scene-catalogue')
    catalogue.hidden = model.catalogueNote === null
    catalogue.textContent = model.catalogueNote ?? ''
    this.find('share-scene-privacy').textContent = model.privacyNote
    this.setLinkUnavailable(model.linkUnavailable)
    this.fallback.hidden = true
    this.field.value = ''
    this.status.textContent = ''
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal()
    else this.dialog.setAttribute('open', '')
    ;(this.copyButton.disabled ? this.find<HTMLButtonElement>('share-download-file') : this.copyButton).focus()
  }

  private find<T extends HTMLElement = HTMLElement>(id: string): T { return this.dialog.querySelector<T>(`#${id}`)! }

  private setLinkUnavailable(reason: string | null): void {
    this.copyButton.disabled = reason !== null
    this.reason.hidden = reason === null
    this.reason.textContent = reason ?? ''
    if (reason === null) this.copyButton.removeAttribute('aria-describedby')
    else this.copyButton.setAttribute('aria-describedby', 'share-link-reason')
  }

  private async copyLink(): Promise<void> {
    this.status.textContent = ''
    const link = await this.callbacks.onCopySceneLink()
    if (!this.dialog.open) return
    if (!link.ok) {
      this.setLinkUnavailable(linkUnavailableReason(link.reason))
      this.find<HTMLButtonElement>('share-download-file').focus()
      return
    }
    try {
      const clipboard = this.trigger.ownerDocument.defaultView?.navigator.clipboard
      if (!clipboard) throw new Error('No clipboard.')
      await clipboard.writeText(link.url)
      this.fallback.hidden = true
      this.status.textContent = text().sharing.linkCopied
    } catch {
      // Clipboard unavailable or refused: the link is shown pre-selected.
      this.fallback.hidden = false
      this.field.value = link.url
      this.field.focus()
      this.field.select()
      this.status.textContent = text().sharing.copyFallback
    }
  }

  private download(): void {
    const documentRef = this.trigger.ownerDocument
    const saved = this.callbacks.onSceneFileRequested()
    const url = URL.createObjectURL(new Blob([saved.text], { type: 'application/json' }))
    const anchor = documentRef.createElement('a')
    anchor.href = url
    anchor.download = saved.name
    anchor.hidden = true
    documentRef.body.append(anchor)
    anchor.click()
    anchor.remove()
    // Revoked once the browser has taken the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    this.status.textContent = text().sharing.fileDownloaded
  }
}
