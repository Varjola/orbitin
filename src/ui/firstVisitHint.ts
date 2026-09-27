import { text } from '../i18n/index.ts'
import { html } from './markup.ts'

/** A first-visit hint with its dismiss button. */
export function firstVisitHintMarkup(id: string, message: string): string {
  return html`<p id="${id}" class="first-visit-hint" hidden><span>${message}</span><button class="first-visit-dismiss" type="button" aria-label="${text().firstVisit.dismiss}" title="${text().firstVisit.dismiss}"><span aria-hidden="true">×</span></button></p>`
}
