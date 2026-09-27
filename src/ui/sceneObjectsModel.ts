import { text } from '../i18n/index.ts'
import { officialGroupTitle } from './catalogueWording.ts'
import { isSgp4Source } from '../simulation/OrbitalObject.ts'
import type { OrbitalObject } from '../simulation/OrbitalObject.ts'
import type { SceneSelection, SceneState } from '../state/AppState.ts'

/** Session-only group provenance of one scene object.
 *  An object may belong to several groups, so it is always a list. */
export interface GroupMembership {
  readonly groupId: string
  readonly title: string
  readonly revision: string
}
export type GroupProvenance = ReadonlyMap<string, readonly GroupMembership[]>
export const NO_GROUP_PROVENANCE: GroupProvenance = new Map()

export interface SceneObjectRowModel {
  readonly id: string
  readonly name: string
  readonly colorHex: number
  readonly selected: boolean
  readonly primary: boolean
  /** State in words, so colour and style are never the only signal. */
  readonly stateLabel: '' | 'selected' | 'primary'
}

export interface SceneObjectsHeaderModel {
  readonly checked: boolean
  readonly indeterminate: boolean
  /** Accessible name stating the scope: all scene objects or the matches. */
  readonly label: string
  readonly action: 'select' | 'deselect'
  readonly scopeIds: readonly string[]
}

export interface SceneObjectsModel {
  readonly countLabel: string
  readonly selectedLabel: string
  readonly rows: readonly SceneObjectRowModel[]
  readonly header: SceneObjectsHeaderModel
  readonly emptySearchMessage: string | null
  readonly selectedIds: readonly string[]
}

/** Search is language-independent: one fixed locale. */
export function normalizeSearchText(value: string): string { return value.trim().toLocaleLowerCase('en') }

/** Case-insensitive match on the name, the NORAD catalogue id of an SGP4
 *  source, and every recorded group title. */
export function sceneObjectMatches(object: OrbitalObject, normalizedText: string, provenance: GroupProvenance = NO_GROUP_PROVENANCE): boolean {
  if (normalizedText === '') return true
  if (object.name.toLocaleLowerCase('en').includes(normalizedText)) return true
  if (isSgp4Source(object.source) && object.source.definition.meanElements.catalogId.includes(normalizedText)) return true
  // Group titles match as the learner reads them, in the active language.
  return (provenance.get(object.id) ?? []).some((membership) => officialGroupTitle(membership.groupId, membership.title).toLocaleLowerCase('en').includes(normalizedText))
}

export function buildSceneObjectsModel(scene: SceneState, searchText: string, capacity: number, provenance: GroupProvenance = NO_GROUP_PROVENANCE): SceneObjectsModel {
  const query = normalizeSearchText(searchText)
  const selected = new Set(scene.selection.ids)
  const rows = scene.objects.filter((object) => sceneObjectMatches(object, query, provenance)).map((object): SceneObjectRowModel => {
    const primary = scene.selection.primaryId === object.id
    const isSelected = selected.has(object.id)
    return { id: object.id, name: object.name, colorHex: object.style.colorHex, selected: isSelected, primary, stateLabel: primary ? 'primary' : isSelected ? 'selected' : '' }
  })
  const scopeIds = rows.map((row) => row.id)
  const selectedInScope = rows.filter((row) => row.selected).length
  const all = scopeIds.length > 0 && selectedInScope === scopeIds.length
  const filtered = query !== ''
  const t = text().sceneObjects
  const label = filtered
    ? all ? t.deselectMatching(scopeIds.length) : t.selectMatching(scopeIds.length)
    : all ? t.deselectAll : t.selectAll(scopeIds.length)
  return {
    countLabel: t.count(scene.objects.length, capacity),
    selectedLabel: t.selected(scene.selection.ids.length),
    rows,
    header: { checked: all, indeterminate: selectedInScope > 0 && !all, label, action: all ? 'deselect' : 'select', scopeIds },
    emptySearchMessage: filtered && rows.length === 0 ? t.noMatch(searchText.trim()) : null,
    selectedIds: scene.selection.ids,
  }
}

/** The scoped header action: adds or removes only the listed rows. Adding
 *  keeps the primary (the first listed becomes primary when none existed);
 *  removing the primary moves it to the last remaining member. */
export function applyHeaderAction(selection: SceneSelection, header: SceneObjectsHeaderModel): SceneSelection {
  if (header.action === 'select') {
    const ids = [...selection.ids, ...header.scopeIds.filter((id) => !selection.ids.includes(id))]
    return { ids, primaryId: selection.primaryId ?? ids[0] ?? null }
  }
  const scope = new Set(header.scopeIds)
  const ids = selection.ids.filter((id) => !scope.has(id))
  return { ids, primaryId: selection.primaryId !== null && !scope.has(selection.primaryId) ? selection.primaryId : ids[ids.length - 1] ?? null }
}

/** The Scene Objects toggle bar: the active object -
 *  the primary selection - and how many further objects are selected. */
export interface ActiveObjectSummary {
  readonly name: string
  readonly colorHex: number | null
  readonly moreSelected: number
  /** Visible text: `<name>`, `<name> +<k>` or the no-selection wording. */
  readonly label: string
}
export function activeObjectSummary(scene: SceneState): ActiveObjectSummary {
  const primary = scene.selection.primaryId === null ? undefined : scene.objects.find((object) => object.id === scene.selection.primaryId)
  if (!primary) return { name: '', colorHex: null, moreSelected: 0, label: text().sceneObjects.noActive }
  const moreSelected = Math.max(0, scene.selection.ids.length - 1)
  return { name: primary.name, colorHex: primary.style.colorHex, moreSelected, label: moreSelected > 0 ? text().sceneObjects.activeWithMore(primary.name, moreSelected) : primary.name }
}
export function sceneObjectsToggleLabel(expanded: boolean): string { return expanded ? text().sceneObjects.collapse : text().sceneObjects.expand }

export function removeSelectedConfirmation(count: number): string { return text().sceneObjects.removeConfirmation(count) }
export function removeSelectedLabel(count: number): string { return text().sceneObjects.removeSelected(count) }
