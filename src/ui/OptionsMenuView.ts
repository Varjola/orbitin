import type { ApplicationBuildInfo } from '../app/applicationBuildInfo.ts'
import { activeLocale, LANGUAGE_GROUP_LABEL, LANGUAGE_NAMES, languageTag, SUPPORTED_LOCALES, text, type Locale } from '../i18n/index.ts'
import { ABOUT_CREDITS, appendAboutProject, renderAboutVersion } from './aboutWording.ts'
import { html, trusted } from './markup.ts'
import { SCENE_EXAMPLES } from '../data/sceneExamples.ts'

export interface OptionsMenuCallbacks {
  /** Open scene file… asks the scene-open view for its file picker. */
  onChooseSceneFile(): void
  /** The learner chose another interface language. */
  onLocaleChange(locale: Locale): void
  /** Open a curated example. */
  onOpenExample(exampleId: string): void
}

const MENU_ITEMS = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)'

/** The Options menu at the top bar's right end and the
 *  About Orbitin dialog it opens. The menu is the home for future
 *  application-level options; it holds no application state. */
export class OptionsMenuView {
  readonly root: HTMLElement
  private readonly trigger: HTMLButtonElement
  private readonly menu: HTMLElement
  private readonly dialog: HTMLDialogElement
  private readonly examples: HTMLDialogElement
  private readonly onDocumentPointerDown: (event: PointerEvent) => void

  constructor(container: HTMLElement, buildInfo: ApplicationBuildInfo, callbacks: OptionsMenuCallbacks) {
    this.root = container
    this.root.dataset.region = 'options'
    const t = text()
    const current = languageTag(activeLocale())
    const language = (locale: Locale) => trusted(html`<button id="options-language-${locale}" type="button" role="menuitemradio" class="options-menu-item options-language-item" lang="${locale}" data-locale="${locale}" aria-checked="${String(locale === current)}">${LANGUAGE_NAMES[locale]}</button>`)
    this.root.innerHTML = html`
      <button id="options-menu-button" class="icon-button options-trigger" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="options-menu" aria-label="${t.options.label}" title="${t.options.label}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="12" cy="19" r="1.6"></circle></svg></button>
      <div id="options-menu" class="options-menu" role="menu" aria-label="${t.options.label}" hidden>
        <div class="options-menu-group" role="group" aria-labelledby="options-language-label">
          <span id="options-language-label" class="options-menu-group-label">${LANGUAGE_GROUP_LABEL}</span>
          ${trusted(SUPPORTED_LOCALES.map((locale) => language(locale).trustedHtml).join(''))}
        </div>
        <button id="options-open-scene-file" type="button" role="menuitem" class="options-menu-item">${t.sharing.openSceneFile}</button>
        <button id="options-examples" type="button" role="menuitem" class="options-menu-item">${t.examples.menu}</button>
        <button id="options-about" type="button" role="menuitem" class="options-menu-item">${t.options.about}</button>
      </div>
      <dialog id="examples-dialog" class="about-dialog examples-dialog" aria-labelledby="examples-dialog-title">
        <header class="about-dialog-header">
          <h2 id="examples-dialog-title">${t.examples.heading}</h2>
          <button id="examples-dialog-close" class="icon-button about-dialog-close" type="button" aria-label="${t.examples.close}" title="${t.about.closeTitle}"><span aria-hidden="true">×</span></button>
        </header>
        <p class="about-privacy">${t.examples.intro}</p>
        <ul id="examples-list" class="examples-list"></ul>
      </dialog>
      <dialog id="about-dialog" class="about-dialog" aria-labelledby="about-dialog-title">
        <header class="about-dialog-header">
          <h2 id="about-dialog-title">${t.about.title}</h2>
          <button id="about-dialog-close" class="icon-button about-dialog-close" type="button" aria-label="${t.about.close}" title="${t.about.closeTitle}"><span aria-hidden="true">×</span></button>
        </header>
        <img class="about-wordmark" src="/assets/branding/orbitin-wordmark.svg" width="291" height="64" alt="Orbitin" />
        <p class="about-version"></p>
        <p>${t.about.summary}</p>
        <p class="about-note">${t.about.educationalNote}</p>
        <div class="about-project"></div>
        <h3>${t.about.creditsHeading}</h3>
        <dl class="about-credits"></dl>
        <p class="about-licence">${t.about.licence}</p>
      </dialog>
    `
    this.trigger = this.root.querySelector<HTMLButtonElement>('#options-menu-button')!
    this.menu = this.root.querySelector<HTMLElement>('#options-menu')!
    this.dialog = this.root.querySelector<HTMLDialogElement>('#about-dialog')!
    this.examples = this.root.querySelector<HTMLDialogElement>('#examples-dialog')!
    const exampleList = this.root.querySelector<HTMLElement>('#examples-list')!
    for (const example of SCENE_EXAMPLES) {
      const item = container.ownerDocument.createElement('li')
      const button = container.ownerDocument.createElement('button')
      button.type = 'button'
      button.className = 'example-open'
      button.dataset.exampleId = example.id
      const name = container.ownerDocument.createElement('span'); name.className = 'example-name'; name.textContent = t.examples.names[example.id] ?? example.id
      const line = container.ownerDocument.createElement('span'); line.className = 'example-line'; line.textContent = t.examples.lines[example.id] ?? ''
      button.append(name, line)
      button.addEventListener('click', () => { this.closeDialog(this.examples); callbacks.onOpenExample(example.id) })
      item.append(button)
      exampleList.append(item)
    }
    this.root.querySelector('#examples-dialog-close')!.addEventListener('click', () => this.closeDialog(this.examples))
    this.examples.addEventListener('close', () => this.trigger.focus())
    renderAboutVersion(container.ownerDocument, this.root.querySelector<HTMLElement>('.about-version')!, buildInfo)
    appendAboutProject(container.ownerDocument, this.root.querySelector<HTMLElement>('.about-project')!)
    const credits = this.root.querySelector<HTMLElement>('.about-credits')!
    for (const credit of ABOUT_CREDITS) {
      const term = container.ownerDocument.createElement('dt')
      term.textContent = t.about.creditSubjects[credit.subject]
      const detail = container.ownerDocument.createElement('dd')
      if (credit.href) {
        const link = container.ownerDocument.createElement('a')
        link.href = credit.href
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.textContent = credit.text
        detail.append(link)
      } else detail.textContent = credit.text
      credits.append(term, detail)
    }

    this.trigger.addEventListener('click', () => this.setMenuOpen(this.menu.hasAttribute('hidden')))
    this.menu.addEventListener('keydown', (event) => {
      const items = [...this.menu.querySelectorAll<HTMLButtonElement>(MENU_ITEMS)]
      const index = items.indexOf(event.target as HTMLButtonElement)
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
      }
    })
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.menu.hasAttribute('hidden')) return
      event.preventDefault()
      this.setMenuOpen(false)
      this.trigger.focus()
    })
    this.onDocumentPointerDown = (event) => { if (!this.menu.hasAttribute('hidden') && !this.root.contains(event.target as Node)) this.setMenuOpen(false) }
    container.ownerDocument.addEventListener('pointerdown', this.onDocumentPointerDown)
    for (const item of this.root.querySelectorAll<HTMLButtonElement>('[data-locale]')) {
      item.addEventListener('click', () => {
        const locale = item.dataset.locale as Locale
        this.setMenuOpen(false)
        this.trigger.focus()
        // Choosing the current language only closes the menu.
        if (locale !== languageTag(activeLocale())) callbacks.onLocaleChange(locale)
      })
    }
    this.root.querySelector('#options-open-scene-file')!.addEventListener('click', () => {
      this.setMenuOpen(false)
      this.trigger.focus()
      callbacks.onChooseSceneFile()
    })
    this.root.querySelector('#options-examples')!.addEventListener('click', () => {
      this.setMenuOpen(false)
      this.trigger.focus()
      if (this.examples.open) return
      if (typeof this.examples.showModal === 'function') this.examples.showModal()
      else this.examples.setAttribute('open', '')
      this.examples.querySelector<HTMLButtonElement>('.example-open')?.focus()
    })
    this.root.querySelector('#options-about')!.addEventListener('click', () => {
      this.setMenuOpen(false)
      // The dialog restores focus to whatever was focused when it opened; the
      // menu item is hidden by then, so Options is focused first.
      this.trigger.focus()
      this.openAbout()
    })
    this.root.querySelector('#about-dialog-close')!.addEventListener('click', () => this.closeAbout())
    // A click on the backdrop (outside the dialog box) closes it.
    this.dialog.addEventListener('click', (event) => {
      if (event.target !== this.dialog) return
      const rect = this.dialog.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.closeAbout()
    })
    // Escape closes a modal dialog natively; focus then returns to Options.
    this.dialog.addEventListener('close', () => this.trigger.focus())
  }

  /** Open scene file… stays unavailable while a shared scene is opening. */
  setOpenSceneFileEnabled(enabled: boolean): void { this.root.querySelector<HTMLButtonElement>('#options-open-scene-file')!.disabled = !enabled }
  focusTrigger(): void { this.trigger.focus() }

  dispose(): void {
    this.root.ownerDocument.removeEventListener('pointerdown', this.onDocumentPointerDown)
    if (this.dialog.open) this.dialog.close()
    if (this.examples.open) this.examples.close()
    this.root.textContent = ''
  }

  private setMenuOpen(open: boolean): void {
    this.menu.hidden = !open
    this.trigger.setAttribute('aria-expanded', String(open))
    if (open) this.menu.querySelector<HTMLButtonElement>(MENU_ITEMS)?.focus()
  }

  private openAbout(): void {
    if (this.dialog.open) return
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal()
    else this.dialog.setAttribute('open', '')
    this.root.querySelector<HTMLButtonElement>('#about-dialog-close')!.focus()
  }

  private closeDialog(dialog: HTMLDialogElement): void {
    if (typeof dialog.close === 'function') { if (dialog.open) dialog.close() }
    else { dialog.removeAttribute('open'); this.trigger.focus() }
  }

  private closeAbout(): void {
    if (typeof this.dialog.close === 'function') this.dialog.close()
    else { this.dialog.removeAttribute('open'); this.trigger.focus() }
  }
}
