import type { UiCallbacks } from './uiTypes.ts'
import { text } from '../i18n/index.ts'
import { html } from './markup.ts'

type OpenCallbacks = Pick<UiCallbacks, 'onOpenSceneFile' | 'onConfirmSceneOpen' | 'onCancelSceneOpen' | 'onRetrySceneOpen' | 'onDismissSceneNotice'>

export function sceneOpenMarkup(): string {
  const t = text().sharing
  return html`
  <input id="scene-file-input" type="file" accept=".json,application/json" hidden />
  <dialog id="scene-open-dialog" class="about-dialog scene-open-dialog" aria-labelledby="scene-open-title" aria-describedby="scene-open-message">
    <h2 id="scene-open-title">${t.openTitle}</h2>
    <p id="scene-open-message"></p>
    <p id="scene-open-incoming" class="scene-open-incoming"></p>
    <div class="dialog-actions">
      <button id="scene-open-confirm" class="dialog-action is-primary" type="button">${t.openConfirm}</button>
      <button id="scene-open-cancel" class="dialog-action" type="button">${t.cancel}</button>
    </div>
  </dialog>
  <section id="scene-open-status" class="scene-open-status" aria-label="${t.sharedScene}" hidden>
    <div id="scene-open-status-text" class="scene-open-status-text" role="status" aria-live="polite"></div>
    <div class="scene-open-status-actions">
      <button id="scene-open-retry" class="dialog-action is-primary" type="button" hidden>${t.retry}</button>
      <button id="scene-open-status-cancel" class="dialog-action" type="button" hidden>${t.cancel}</button>
      <button id="scene-open-dismiss" class="dialog-action" type="button" hidden>${t.dismiss}</button>
    </div>
  </section>
`
}

type StatusKind = 'progress' | 'notice' | 'error' | 'retryable-error'

/** The file picker, the Open scene?
 *  confirmation and one non-blocking status panel for progress, the result
 *  notice and errors. Scene content is only ever set as text. */
export class SceneOpenView {
  private readonly callbacks: OpenCallbacks
  private readonly focusFallback: () => void
  private readonly elements: Element[]
  private readonly input: HTMLInputElement
  private readonly dialog: HTMLDialogElement
  private readonly panel: HTMLElement
  private readonly text: HTMLElement
  private readonly retry: HTMLButtonElement
  private readonly cancel: HTMLButtonElement
  private readonly dismiss: HTMLButtonElement
  private returnFocus: HTMLElement | null = null
  /** A dialog closed by the view itself, not by the learner's Escape. */
  private closingQuietly = false

  constructor(container: HTMLElement, callbacks: OpenCallbacks, focusFallback: () => void) {
    this.callbacks = callbacks
    this.focusFallback = focusFallback
    const template = container.ownerDocument.createElement('template')
    template.innerHTML = sceneOpenMarkup()
    this.elements = [...template.content.children]
    container.append(...this.elements)
    const find = <T extends HTMLElement>(id: string): T => this.elements.map((element) => element.id === id ? element : element.querySelector(`#${id}`)).find(Boolean) as T
    this.input = find<HTMLInputElement>('scene-file-input')
    this.dialog = find<HTMLDialogElement>('scene-open-dialog')
    this.panel = find('scene-open-status')
    this.text = find('scene-open-status-text')
    this.retry = find<HTMLButtonElement>('scene-open-retry')
    this.cancel = find<HTMLButtonElement>('scene-open-status-cancel')
    this.dismiss = find<HTMLButtonElement>('scene-open-dismiss')

    this.input.addEventListener('change', () => {
      const file = this.input.files?.[0]
      this.input.value = ''
      if (file) this.callbacks.onOpenSceneFile(file)
    })
    find('scene-open-confirm').addEventListener('click', () => { this.closeDialog(); this.callbacks.onConfirmSceneOpen() })
    find('scene-open-cancel').addEventListener('click', () => { this.closeDialog(); this.callbacks.onCancelSceneOpen() })
    // Escape cancels the pending open like the Cancel button.
    this.dialog.addEventListener('cancel', () => { if (!this.closingQuietly) this.callbacks.onCancelSceneOpen() })
    this.dialog.addEventListener('close', () => { this.closingQuietly = false; this.restoreFocus() })
    this.retry.addEventListener('click', () => this.callbacks.onRetrySceneOpen())
    this.cancel.addEventListener('click', () => this.callbacks.onCancelSceneOpen())
    this.dismiss.addEventListener('click', () => this.callbacks.onDismissSceneNotice())
  }

  chooseFile(): void { this.input.click() }

  showConfirmation(confirmation: { readonly message: string; readonly incoming: string }): void {
    this.hidePanel()
    this.dialog.querySelector('#scene-open-message')!.textContent = confirmation.message
    this.dialog.querySelector('#scene-open-incoming')!.textContent = confirmation.incoming
    this.captureFocus()
    if (!this.dialog.open) {
      if (typeof this.dialog.showModal === 'function') this.dialog.showModal()
      else this.dialog.setAttribute('open', '')
    }
    this.dialog.querySelector<HTMLButtonElement>('#scene-open-confirm')!.focus()
  }

  showProgress(message: string): void { this.showPanel('progress', [message]) }
  showNotice(lines: readonly string[]): void { this.showPanel('notice', lines) }
  showError(message: string, retryable: boolean): void { this.showPanel(retryable ? 'retryable-error' : 'error', [message]) }

  hide(): void {
    this.closeDialog()
    this.hidePanel()
  }

  dispose(): void {
    this.closingQuietly = true
    if (this.dialog.open) this.dialog.close()
    for (const element of this.elements) element.remove()
  }

  private showPanel(kind: StatusKind, lines: readonly string[]): void {
    this.closeDialog()
    const hadFocus = this.panel.contains(this.panel.ownerDocument.activeElement)
    this.panel.dataset.kind = kind
    this.text.replaceChildren(...lines.map((line) => { const paragraph = this.panel.ownerDocument.createElement('p'); paragraph.textContent = line; return paragraph }))
    this.retry.hidden = kind !== 'retryable-error'
    this.cancel.hidden = kind !== 'progress' && kind !== 'retryable-error'
    this.dismiss.hidden = kind === 'progress' || kind === 'retryable-error'
    this.dismiss.textContent = kind === 'error' ? text().sharing.close : text().sharing.dismiss
    this.panel.hidden = false
    // Keyboard users keep their place: focus moves only if it was in the panel.
    if (hadFocus) (this.retry.hidden ? this.cancel.hidden ? this.dismiss : this.cancel : this.retry).focus()
  }

  private hidePanel(): void {
    if (this.panel.hidden) return
    const hadFocus = this.panel.contains(this.panel.ownerDocument.activeElement)
    this.panel.hidden = true
    this.text.replaceChildren()
    if (hadFocus) this.focusFallback()
  }

  private closeDialog(): void {
    if (!this.dialog.open) return
    this.closingQuietly = true
    if (typeof this.dialog.close === 'function') this.dialog.close()
    else { this.dialog.removeAttribute('open'); this.closingQuietly = false; this.restoreFocus() }
  }

  private captureFocus(): void {
    const active = this.dialog.ownerDocument.activeElement
    this.returnFocus = active instanceof HTMLElement && !this.dialog.contains(active) ? active : null
  }

  private restoreFocus(): void {
    const target = this.returnFocus
    this.returnFocus = null
    if (target && target.isConnected && target.offsetParent !== null) target.focus()
    else this.focusFallback()
  }
}
