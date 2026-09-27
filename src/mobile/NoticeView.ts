import { text } from '../i18n/index.ts'
import { html } from '../ui/markup.ts'

/** A notice stays this long, and longer while touched or focused. */
export const NOTICE_DURATION_MS = 5000

export interface NoticeTimers {
  setTimeout(handler: () => void, ms: number): number
  clearTimeout(id: number): void
}

export function noticeMarkup(): string {
  return html`<div class="m-notice" hidden><span class="m-notice-text"></span><button class="m-notice-undo" type="button" hidden>${text().mobile.notice.undo}</button></div>`
}

/** One notice at a time, above the dock, in a polite
 *  live region, with an Undo action while the change can still be undone. */
export class NoticeView {
  readonly root: HTMLElement
  private readonly notice: HTMLElement
  private readonly message: HTMLElement
  private readonly undo: HTMLButtonElement
  private readonly timers: NoticeTimers
  private timer: number | null = null
  private held = false
  private onUndo: (() => void) | null = null

  constructor(container: HTMLElement, timers: NoticeTimers) {
    this.timers = timers
    this.root = container.ownerDocument.createElement('div')
    this.root.className = 'm-notice-slot'
    // The live region exists before any notice, so screen readers announce it.
    this.root.setAttribute('role', 'status')
    this.root.setAttribute('aria-live', 'polite')
    this.root.innerHTML = noticeMarkup()
    this.notice = this.root.querySelector<HTMLElement>('.m-notice')!
    this.message = this.root.querySelector<HTMLElement>('.m-notice-text')!
    this.undo = this.root.querySelector<HTMLButtonElement>('.m-notice-undo')!
    this.undo.addEventListener('click', () => { const action = this.onUndo; this.hide(); action?.() })
    const hold = () => { this.held = true; this.clearTimer() }
    const release = () => { this.held = false; this.startTimer() }
    this.notice.addEventListener('pointerdown', hold)
    this.notice.addEventListener('pointerup', release)
    this.notice.addEventListener('pointercancel', release)
    this.notice.addEventListener('focusin', hold)
    this.notice.addEventListener('focusout', release)
    container.append(this.root)
  }

  get visible(): boolean { return !this.notice.hidden }

  /** Replaces any notice. `onUndo` adds the Undo action. */
  show(message: string, onUndo: (() => void) | null = null): void {
    this.message.textContent = message
    this.onUndo = onUndo
    this.undo.hidden = onUndo === null
    this.notice.hidden = false
    this.held = false
    this.startTimer()
  }

  /** The change can no longer be undone: the notice stays, without Undo. */
  withdrawUndo(): void {
    if (!this.onUndo) return
    const hadFocus = this.undo.contains(this.root.ownerDocument.activeElement)
    this.onUndo = null
    this.undo.hidden = true
    if (hadFocus) { this.held = false; this.startTimer() }
  }

  hide(): void {
    this.clearTimer()
    this.notice.hidden = true
    this.message.textContent = ''
    this.onUndo = null
    this.undo.hidden = true
  }

  dispose(): void { this.clearTimer(); this.root.remove() }

  private startTimer(): void {
    this.clearTimer()
    if (this.held || this.notice.hidden) return
    this.timer = this.timers.setTimeout(() => { this.timer = null; if (!this.held) this.hide() }, NOTICE_DURATION_MS)
  }

  private clearTimer(): void {
    if (this.timer === null) return
    this.timers.clearTimeout(this.timer)
    this.timer = null
  }
}
