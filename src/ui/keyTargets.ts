/** Where a key moves or edits a control, or belongs to a dialog. */
const CONTROL_SELECTOR = [
  'input', 'select', 'textarea',
  '[role="slider"]', '[role="listbox"]', '[role="menu"]', '[role="radiogroup"]', '[role="tablist"]',
  'dialog', '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
].join(', ')

/** Controls that a key presses. */
const PRESSABLE_SELECTOR = 'button, summary, a[href]'

/** Whether a key pressed on this target belongs to the control or dialog it is
 *  in, so a page-wide shortcut leaves it alone. With `pressable`, a key on a
 *  button or link belongs to it too, for shortcuts that Space or Enter share. */
export function keyBelongsToControl(target: EventTarget | null, options: { readonly pressable?: boolean } = {}): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const selector = options.pressable ? `${CONTROL_SELECTOR}, ${PRESSABLE_SELECTOR}` : CONTROL_SELECTOR
  return target.closest(selector) !== null
}
