import { activeLocale, catalogueFor, type MessageCatalogue } from '../i18n/index.ts'
import { escapeHtml } from './markup.ts'

/** A taught term. */
export type TermId = keyof MessageCatalogue['terms']

/** The English term shown beside a non-English label, from the English
 *  catalogue so it cannot drift from the English interface. */
export function englishTerm(term: TermId): string { return catalogueFor('en').terms[term] }

function showsEnglishTerm(): boolean { return activeLocale() === 'fi' }

/** Escaped markup for a label that names a taught term: the label alone in
 *  English, the label and its English term otherwise. */
export function termLabelMarkup(label: string, term: TermId): string {
  if (!showsEnglishTerm()) return escapeHtml(label)
  return `<span class="term"><span class="term-label">${escapeHtml(label)}</span> <span class="term-en" lang="en">${escapeHtml(englishTerm(term))}</span></span>`
}

/** The same label as an element, for views that build nodes. */
export function termLabel(documentRef: Document, label: string, term: TermId): HTMLElement {
  const element = documentRef.createElement('span')
  if (!showsEnglishTerm()) { element.textContent = label; return element }
  element.className = 'term'
  const local = documentRef.createElement('span')
  local.className = 'term-label'
  local.textContent = label
  const english = documentRef.createElement('span')
  english.className = 'term-en'
  english.lang = 'en'
  english.textContent = englishTerm(term)
  element.append(local, ' ', english)
  return element
}

/** An accessible name that includes both parts, for `aria-label`. */
export function termAccessibleName(label: string, term: TermId): string {
  return showsEnglishTerm() ? `${label} (${englishTerm(term)})` : label
}
