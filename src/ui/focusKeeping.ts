/** The same control in new markup: by its id, or else by its tag and data
 *  attributes (a route row, a burn box). */
function controlSelector(element: HTMLElement): string | null {
  if (element.id) return `[id="${quoted(element.id)}"]`
  const data = [...element.attributes].filter((attribute) => attribute.name.startsWith('data-')).map((attribute) => `[${attribute.name}="${quoted(attribute.value)}"]`).join('')
  return data === '' ? null : `${element.localName}${data}`
}

function quoted(value: string): string { return value.replace(/["\\]/g, '\\$&') }

/** Replaces a container's content without losing the keyboard focus: a control
 *  focused inside it is focused again in the new content, or the container
 *  itself (give it `tabindex="-1"`) when that control is gone. */
export function replaceKeepingFocus(container: HTMLElement, markup: string): void {
  const focused = container.ownerDocument.activeElement
  const inside = focused instanceof HTMLElement && focused !== container && container.contains(focused)
  const selector = inside ? controlSelector(focused) : null
  container.innerHTML = markup
  if (!inside) return
  const again = selector === null ? null : container.querySelector<HTMLElement>(selector)
  ;(again ?? container).focus({ preventScroll: true })
}

/** Whether the focus has nowhere to be: on the page itself, or on a control
 *  that a closed dialog or a hidden region has just taken away. */
export function focusIsLost(documentRef: Document): boolean {
  const focused = documentRef.activeElement
  if (!(focused instanceof HTMLElement) || focused === documentRef.body) return true
  return !focused.isConnected || focused.closest('[hidden], dialog:not([open])') !== null
}
