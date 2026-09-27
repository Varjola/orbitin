import { text } from '../i18n/index.ts'

/** Why Orbitin could not start or stopped. The screen
 *  words each kind for people, never with a library's raw message; the
 *  technical detail goes to the console and an anonymous error event. */
export type FailureKind = 'webgl' | 'textures' | 'contextLost' | 'frame'

export interface FailureAction {
  readonly kind: 'retry' | 'reload'
  readonly run: () => void
}

/** The default action of each failure: textures can be fetched again; the
 *  others need a fresh page. */
export function defaultFailureAction(kind: FailureKind, reload: () => void, retry?: () => void): FailureAction {
  return kind === 'textures' && retry ? { kind: 'retry', run: retry } : { kind: 'reload', run: reload }
}

/** True when this browser can create a WebGL2 context at all. */
export function webgl2Available(documentRef: Document): boolean {
  try {
    const canvas = documentRef.createElement('canvas')
    return canvas.getContext('webgl2') !== null
  } catch {
    return false
  }
}

/** A startup error from the renderer is a WebGL failure; anything else is a
 *  general one. */
export function classifyStartupError(error: unknown, webglAvailable: boolean): FailureKind {
  if (!webglAvailable) return 'webgl'
  const message = error instanceof Error ? error.message : String(error)
  return /webgl|context/i.test(message) ? 'webgl' : 'frame'
}

/** The card shared by the loading overlay and the bare startup failure. */
function failureCard(documentRef: Document, kind: FailureKind, action: FailureAction | null): HTMLElement {
  const t = text().loading
  const words = t.failures[kind]
  const card = documentRef.createElement('div')
  card.className = 'loading-card'
  card.setAttribute('role', 'alert')
  const title = documentRef.createElement('strong'); title.textContent = words.title
  const detail = documentRef.createElement('p'); detail.textContent = words.detail
  card.append(title, detail)
  if (words.hint) { const hint = documentRef.createElement('small'); hint.textContent = words.hint; card.append(hint) }
  if (action) {
    const button = documentRef.createElement('button')
    button.type = 'button'
    button.className = 'loading-action'
    button.textContent = action.kind === 'retry' ? t.retry : t.reload
    button.addEventListener('click', () => action.run())
    card.append(button)
  }
  return card
}

export class LoadingOverlay {
  private readonly element: HTMLElement
  private message!: HTMLElement
  private progress!: HTMLElement
  private lastProgress: { readonly loaded: number; readonly total: number } | null = null
  private failure: { readonly kind: FailureKind; readonly action: FailureAction | null } | null = null

  constructor(container: HTMLElement) {
    this.element = document.createElement('div')
    this.element.id = 'loading-overlay'
    this.element.className = 'loading-overlay'
    this.renderLoading()
    container.appendChild(this.element)
  }

  setProgress(loaded: number, total: number): void {
    this.lastProgress = { loaded, total }
    this.message.textContent = text().loading.texturesProgress(loaded, total)
    this.progress.style.width = `${(loaded / total) * 100}%`
  }

  hide(): void {
    this.element.classList.add('is-hidden')
  }

  /** Back to the loading card, for a retry. */
  showLoading(): void {
    this.failure = null
    this.lastProgress = null
    this.element.classList.remove('is-hidden', 'is-error')
    this.renderLoading()
  }

  /** The overlay follows a language change while shown. */
  applyLocale(): void {
    if (this.failure) { this.showFailure(this.failure.kind, this.failure.action); return }
    this.renderLoading()
    if (this.lastProgress) this.setProgress(this.lastProgress.loaded, this.lastProgress.total)
  }

  showFailure(kind: FailureKind, action: FailureAction | null): void {
    this.failure = { kind, action }
    this.element.classList.remove('is-hidden')
    this.element.classList.add('is-error')
    this.element.textContent = ''
    this.element.append(failureCard(this.element.ownerDocument, kind, action))
    this.element.querySelector<HTMLButtonElement>('.loading-action')?.focus()
  }

  private renderLoading(): void {
    const t = text().loading
    this.element.textContent = ''
    const card = document.createElement('div')
    card.className = 'loading-card'
    const orbit = document.createElement('div'); orbit.className = 'loading-orbit'; orbit.setAttribute('aria-hidden', 'true')
    const title = document.createElement('strong'); title.textContent = t.title
    this.message = document.createElement('span'); this.message.className = 'loading-message'; this.message.textContent = t.textures
    this.message.setAttribute('role', 'status')
    const bar = document.createElement('div'); bar.className = 'loading-progress'; bar.setAttribute('aria-hidden', 'true')
    this.progress = document.createElement('i')
    bar.append(this.progress)
    card.append(orbit, title, this.message, bar)
    this.element.append(card)
  }
}

/** A failure before the application could build its interface: the same
 *  card, directly in the mount point. */
export function renderStartupFailure(root: HTMLElement, kind: FailureKind, action: FailureAction | null): void {
  const main = root.ownerDocument.createElement('main')
  main.className = 'fatal-error'
  main.append(failureCard(root.ownerDocument, kind, action))
  root.replaceChildren(main)
}
