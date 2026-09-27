import type { ApplicationBuildInfo } from '../app/applicationBuildInfo.ts'
import { activeLocale, LANGUAGE_GROUP_LABEL, LANGUAGE_NAMES, languageTag, SUPPORTED_LOCALES, text, type Locale } from '../i18n/index.ts'
import { ABOUT_CREDITS, appendAboutProject, renderAboutVersion } from '../ui/aboutWording.ts'
import { html, trusted } from '../ui/markup.ts'
import type { UiCallbacks } from '../ui/uiTypes.ts'
import { icon } from './mobileIcons.ts'
import { SCENE_EXAMPLES } from '../data/sceneExamples.ts'

/** The Web Share API surface this view uses, injectable for tests. */
export interface SharePort {
  readonly share?: (data: { readonly title: string; readonly url: string }) => Promise<void>
  readonly copy?: (value: string) => Promise<void>
}

export type ShareResult = 'shared' | 'cancelled' | 'copied' | 'too-large' | 'failed'

/** Share scene builds the link with the existing
 *  codec. The system share sheet opens where `navigator.share` exists, and a
 *  cancelled share does nothing; otherwise, or when sharing fails, the link
 *  is copied. A scene over the link limits cannot be shared as a link. */
export async function shareSceneLink(createLink: UiCallbacks['onCopySceneLink'], port: SharePort): Promise<ShareResult> {
  const link = await createLink()
  if (!link.ok) return 'too-large'
  if (port.share) {
    try {
      await port.share({ title: text().mobile.share.title, url: link.url })
      return 'shared'
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
    }
  }
  if (!port.copy) return 'failed'
  try { await port.copy(link.url); return 'copied' } catch { return 'failed' }
}

export function browserSharePort(view: Window | null): SharePort {
  const navigator = view?.navigator
  return {
    share: navigator && typeof navigator.share === 'function' ? (data) => navigator.share(data) : undefined,
    copy: navigator?.clipboard ? (value) => navigator.clipboard.writeText(value) : undefined,
  }
}

export interface MenuCallbacks {
  onShare(): void
  onDownload(): void
  onLocale(locale: Locale): void
  onHelp(): void
  onAbout(): void
  onExamples(): void
}

export function menuMarkup(): string {
  const t = text().mobile.menu
  const current = languageTag(activeLocale())
  const language = (locale: Locale) => html`<button type="button" data-locale="${locale}" lang="${locale}" aria-pressed="${String(locale === current)}">${LANGUAGE_NAMES[locale]}</button>`
  return html`
    <button class="m-menu-item m-menu-share" type="button">${trusted(icon('share'))}<span>${t.share}</span></button>
    <p class="m-line m-share-status" role="status"></p>
    <button class="m-button m-share-download" type="button" hidden>${text().mobile.share.download}</button>
    <div class="m-menu-language" role="group" aria-label="${LANGUAGE_GROUP_LABEL}">
      <span class="m-menu-language-label">${trusted(icon('language'))}<span>${LANGUAGE_GROUP_LABEL}</span></span>
      <div class="m-segments">${trusted(SUPPORTED_LOCALES.map(language).join(''))}</div>
    </div>
    <button class="m-menu-item m-menu-examples" type="button">${trusted(icon('list'))}<span>${text().examples.heading}</span></button>
    <button class="m-menu-item m-menu-help" type="button">${trusted(icon('help'))}<span>${t.help}</span></button>
    <button class="m-menu-item m-menu-about" type="button">${trusted(icon('info'))}<span>${t.about}</span></button>
  `
}

/** Share scene, Language · Kieli, How to use and
 *  About Orbitin. Open scene file stays on desktop. */
export class MenuView {
  readonly root: HTMLElement
  private readonly status: HTMLElement
  private readonly download: HTMLButtonElement
  private readonly shareButton: HTMLButtonElement

  constructor(documentRef: Document, callbacks: MenuCallbacks) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-menu'
    this.root.innerHTML = menuMarkup()
    this.status = this.root.querySelector<HTMLElement>('.m-share-status')!
    this.download = this.root.querySelector<HTMLButtonElement>('.m-share-download')!
    this.shareButton = this.root.querySelector<HTMLButtonElement>('.m-menu-share')!
    this.shareButton.dataset.autofocus = ''
    this.shareButton.addEventListener('click', () => callbacks.onShare())
    this.download.addEventListener('click', () => callbacks.onDownload())
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-locale]')) {
      button.addEventListener('click', () => { const locale = button.dataset.locale as Locale; if (locale !== languageTag(activeLocale())) callbacks.onLocale(locale) })
    }
    this.root.querySelector('.m-menu-help')!.addEventListener('click', () => callbacks.onHelp())
    this.root.querySelector('.m-menu-examples')!.addEventListener('click', () => callbacks.onExamples())
    this.root.querySelector('.m-menu-about')!.addEventListener('click', () => callbacks.onAbout())
  }

  /** The outcome of Share scene, as one line and, when the scene is over the
   *  link limits, the Download scene file fallback. */
  showShareResult(result: ShareResult | 'downloaded' | null): void {
    const t = text().mobile.share
    this.status.textContent = result === 'copied' ? t.copied : result === 'too-large' ? t.tooLarge : result === 'failed' ? t.failed : result === 'downloaded' ? t.downloaded : ''
    this.download.hidden = result !== 'too-large' && result !== 'downloaded'
  }

  setOpening(opening: boolean): void { this.shareButton.disabled = opening }
}

export function aboutPanelMarkup(): string {
  const t = text().about
  return html`
    <img class="m-about-wordmark" src="/assets/branding/orbitin-wordmark.svg" width="291" height="64" alt="Orbitin" />
    <p class="m-caption m-about-version"></p>
    <p>${t.summary}</p>
    <p class="m-line">${t.educationalNote}</p>
    <div class="m-about-project"></div>
    <p class="m-line">${text().mobile.about.larger}</p>
    <h3 class="m-subheading">${t.creditsHeading}</h3>
    <dl class="m-about-credits"></dl>
    <p class="m-caption">${t.licence}</p>
  `
}

/** About Orbitin: the existing summary, educational note,
 *  credits, licence and version, and the one line about larger screens. */
export class AboutPanelView {
  readonly root: HTMLElement

  constructor(documentRef: Document, buildInfo: ApplicationBuildInfo) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-about'
    this.root.innerHTML = aboutPanelMarkup()
    renderAboutVersion(documentRef, this.root.querySelector<HTMLElement>('.m-about-version')!, buildInfo)
    appendAboutProject(documentRef, this.root.querySelector<HTMLElement>('.m-about-project')!)
    const credits = this.root.querySelector<HTMLElement>('.m-about-credits')!
    for (const credit of ABOUT_CREDITS) {
      const term = documentRef.createElement('dt')
      term.textContent = text().about.creditSubjects[credit.subject]
      const detail = documentRef.createElement('dd')
      if (credit.href) {
        const link = documentRef.createElement('a')
        link.href = credit.href
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.textContent = credit.text
        detail.append(link)
      } else detail.textContent = credit.text
      credits.append(term, detail)
    }
  }
}

/** The curated examples, one tap each. */
export class ExamplesPanelView {
  readonly root: HTMLElement

  constructor(documentRef: Document, onOpen: (exampleId: string) => void) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-examples'
    const t = text().examples
    const intro = documentRef.createElement('p')
    intro.className = 'm-line'
    intro.textContent = t.intro
    const list = documentRef.createElement('div')
    list.className = 'm-example-list'
    for (const example of SCENE_EXAMPLES) {
      const button = documentRef.createElement('button')
      button.type = 'button'
      button.className = 'm-example-row'
      const name = documentRef.createElement('span'); name.className = 'm-example-name'; name.textContent = t.names[example.id] ?? example.id
      const line = documentRef.createElement('span'); line.className = 'm-example-line'; line.textContent = t.lines[example.id] ?? ''
      button.append(name, line)
      button.addEventListener('click', () => onOpen(example.id))
      list.append(button)
    }
    this.root.append(intro, list)
  }
}

/** How to use: a short gesture card. */
export class HelpPanelView {
  readonly root: HTMLElement

  constructor(documentRef: Document) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-help'
    const list = documentRef.createElement('ul')
    list.className = 'm-help-lines'
    for (const line of text().mobile.help.lines) {
      const item = documentRef.createElement('li')
      item.textContent = line
      list.append(item)
    }
    this.root.append(list)
  }
}
