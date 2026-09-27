/** The interface languages. English is the product language and the
 *  default; Finnish is an optional learner language. */
export type Locale = 'en' | 'fi'

/** `pseudo` is a development-only display locale. It renders
 *  English wrapped and lengthened, and never reaches a production bundle. */
export type DisplayLocale = Locale | 'pseudo'

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'fi']
export const DEFAULT_LOCALE: Locale = 'en'

/** The `Intl` tag of a display locale. English is British English, matching
 *  the copy ("catalogue", "licence"); the pseudo-locale formats as English. */
export function intlTag(locale: DisplayLocale): string {
  return locale === 'fi' ? 'fi-FI' : 'en-GB'
}

/** The `lang` attribute of a display locale. */
export function languageTag(locale: DisplayLocale): Locale {
  return locale === 'fi' ? 'fi' : 'en'
}

/** A stored value is honoured only when it is exactly a supported locale. */
export function parseStoredLocale(value: unknown): Locale | null {
  return value === 'en' || value === 'fi' ? value : null
}

/** Each language's name in its own language, and the bilingual label of the
 *  language choice, so a learner in the wrong language can always find it.
 *  These never translate. */
export const LANGUAGE_NAMES: Readonly<Record<Locale, string>> = { en: 'English', fi: 'Suomi' }
export const LANGUAGE_GROUP_LABEL = 'Language · Kieli'
