import { createFormatter, type LocaleFormat } from './format.ts'
import { DEFAULT_LOCALE, type DisplayLocale, type Locale } from './locale.ts'
import { english, englishUnits } from './messages/en.ts'
import { finnish, finnishUnits } from './messages/fi.ts'
import type { MessageCatalogue } from './messages/types.ts'

/** The active catalogue and formatter. Views and
 *  wording helpers read them; only the locale owner changes them. */

interface ActiveLocale {
  readonly locale: DisplayLocale
  readonly messages: MessageCatalogue
  readonly format: LocaleFormat
}

const cache = new Map<Locale, ActiveLocale>()

function build(locale: Locale): ActiveLocale {
  const cached = cache.get(locale)
  if (cached) return cached
  const format = locale === 'fi' ? createFormatter('fi', finnishUnits) : createFormatter('en', englishUnits)
  const built: ActiveLocale = { locale, format, messages: locale === 'fi' ? finnish(format) : english(format) }
  cache.set(locale, built)
  return built
}

let active: ActiveLocale = build(DEFAULT_LOCALE)

/** The active message catalogue. */
export function text(): MessageCatalogue { return active.messages }
/** The active locale's formatter. */
export function format(): LocaleFormat { return active.format }
export function activeLocale(): DisplayLocale { return active.locale }

/** The catalogue of one supported locale, whatever is active: taught terms
 *  read their English from here. */
export function catalogueFor(locale: Locale): MessageCatalogue { return build(locale).messages }

/** Changes the active locale. Only `app/LocaleController.ts` and tests may
 *  call it (architecture test). The development-only pseudo-locale passes its
 *  own catalogue, built from English, so production never imports it. */
export function setActiveLocale(locale: DisplayLocale, messages?: MessageCatalogue): void {
  if (locale === 'pseudo') {
    if (!messages) throw new Error('The pseudo-locale needs its catalogue.')
    active = { locale, messages, format: build('en').format }
    return
  }
  active = build(locale)
}
