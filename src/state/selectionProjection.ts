import { activeScene, type AppState } from './AppState.ts'
export interface SelectionProjection { readonly selectedIds: ReadonlySet<string>; readonly primaryId: string | null }
export function selectionProjection(state: AppState): SelectionProjection { const selection = activeScene(state).selection; return { selectedIds: new Set(selection.ids), primaryId: selection.primaryId } }
