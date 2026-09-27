import { setActiveLocale } from '../i18n/active.ts'
import { DEFAULT_LOCALE, languageTag, parseStoredLocale, type DisplayLocale, type Locale } from '../i18n/locale.ts'
import type { MessageCatalogue } from '../i18n/messages/types.ts'

/** The one browser-storage key Orbitin writes. It holds
 *  only `en` or `fi`, lives in the learner's own browser and is never sent
 *  anywhere: no cookie, request, URL, scene link, Worker or R2 object. */
export const LOCALE_STORAGE_KEY = 'orbitin.locale'

/** English unless this browser remembers Finnish. The browser's own language
 *  settings are deliberately not consulted. */
export function resolveInitialLocale(stored: string | null): Locale {
  return parseStoredLocale(stored) === 'fi' ? 'fi' : DEFAULT_LOCALE
}

export interface LocaleStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface LocaleEnvironment {
  /** The storage, or null. Reaching it may throw where storage is blocked. */
  readonly storage: () => LocaleStorage | null
  readonly documentElement: { lang: string } | null
}

export function browserLocaleEnvironment(): LocaleEnvironment {
  return {
    storage: () => globalThis.localStorage ?? null,
    documentElement: typeof document === 'undefined' ? null : document.documentElement,
  }
}

/** The single owner of the active interface language. */
export class LocaleController {
  private readonly environment: LocaleEnvironment
  private current: DisplayLocale
  private listener: ((locale: DisplayLocale) => void) | null = null

  constructor(environment: LocaleEnvironment = browserLocaleEnvironment()) {
    this.environment = environment
    let stored: string | null = null
    try { stored = environment.storage()?.getItem(LOCALE_STORAGE_KEY) ?? null } catch { stored = null }
    this.current = resolveInitialLocale(stored)
    this.apply(this.current)
  }

  get locale(): DisplayLocale { return this.current }

  /** The interface rebuilds itself through this listener. */
  onChange(listener: ((locale: DisplayLocale) => void) | null): void { this.listener = listener }

  /** Applies a language at once and remembers it in this browser. A blocked
   *  storage keeps the choice for this page only. */
  change(locale: Locale): void {
    if (locale === this.current) return
    this.apply(locale)
    try { this.environment.storage()?.setItem(LOCALE_STORAGE_KEY, locale) } catch { /* the choice lasts for this page */ }
    this.listener?.(locale)
  }

  /** Development only: the pseudo-locale, built by the caller
   *  from English so production never imports it. Nothing is remembered. */
  usePseudo(messages: MessageCatalogue): void {
    setActiveLocale('pseudo', messages)
    this.current = 'pseudo'
    if (this.environment.documentElement) this.environment.documentElement.lang = languageTag('pseudo')
  }

  private apply(locale: Locale): void {
    setActiveLocale(locale)
    this.current = locale
    if (this.environment.documentElement) this.environment.documentElement.lang = languageTag(locale)
  }
}
