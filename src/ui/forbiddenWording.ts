import type { Locale } from '../i18n/index.ts'

/** Words the catalogue record details must never use, per locale: the
 *  catalogue does not describe whether an object is active or operational
 *  (Gate 4 determination). The Finnish expression is reviewed with the
 *  glossary; whole-word `tila` never matches a word such as "tilanne". */
export const FORBIDDEN_CATALOGUE_WORDING: Readonly<Record<Locale, RegExp>> = {
  en: /\bactive\b|operational|status/i,
  fi: /\baktiivi|toiminnassa|operatiivi|\btila\b/i,
}
