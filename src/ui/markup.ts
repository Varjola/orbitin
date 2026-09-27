/** Text inserted into markup templates is escaped, so
 *  a translation can never add markup and learner text never becomes HTML. */

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character])
}

/** Markup that is already safe, such as another `html` template's result. */
export interface TrustedHtml { readonly trustedHtml: string }
export function trusted(markup: string): TrustedHtml { return { trustedHtml: markup } }

/** A template whose interpolations are escaped unless marked `trusted`. */
export function html(strings: TemplateStringsArray, ...values: readonly (string | number | TrustedHtml)[]): string {
  let result = strings[0]
  values.forEach((value, index) => {
    result += typeof value === 'object' ? value.trustedHtml : escapeHtml(String(value))
    result += strings[index + 1]
  })
  return result
}
