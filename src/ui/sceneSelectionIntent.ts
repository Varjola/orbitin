export type SelectionIntent = 'only' | 'toggle'
/** `membership` is the Scene Objects checkbox: toggle without moving the primary. */
export type SceneSelectionIntent = SelectionIntent | 'include' | 'exclude' | 'membership'
export function selectionIntentFromClick(event: { readonly ctrlKey: boolean; readonly metaKey: boolean }): SelectionIntent { return event.ctrlKey || event.metaKey ? 'toggle' : 'only' }
