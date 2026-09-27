import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { formatUtcDisplay } from '../core/timeFormat.ts'
import type { SharedSceneSummary } from '../data/sharedScene.ts'
import { MAX_LINK_MANUAL_REAL_OBJECTS, MAX_LINK_ORBIT_LAB_OBJECTS, MAX_LINK_REAL_OBJECTS, type SceneLinkAvailability, type SceneLinkUnavailable, type SceneTextFailure } from '../data/sceneLink.ts'
import type { SceneResolutionProblem } from '../app/resolveSceneDocument.ts'
import { text } from '../i18n/index.ts'
import type { ProductMode } from '../state/AppState.ts'
import { MAX_SCENE_OBJECTS } from '../state/sceneActions.ts'

/** The logic of every learner-facing sentence of scene
 *  sharing; the words are in the message catalogue. */

export function linkUnavailableReason(reason: SceneLinkUnavailable): string {
  const t = text().sharing
  if (reason.kind === 'outside-bounds') return t.linkTooLong
  if (reason.mode === 'orbitLab') return t.linkOrbitLabLimit(MAX_LINK_ORBIT_LAB_OBJECTS, reason.objectCount)
  return t.linkRealObjectsLimit(MAX_LINK_REAL_OBJECTS, MAX_LINK_MANUAL_REAL_OBJECTS, reason.objectCount > MAX_LINK_REAL_OBJECTS ? reason.objectCount : null, reason.manualObjectCount)
}

export interface ShareDialogModel {
  readonly summary: string
  readonly timeNote: string
  readonly catalogueNote: string | null
  readonly privacyNote: string
  /** Null when Copy link is available; otherwise why it is disabled. */
  readonly linkUnavailable: string | null
}
export function shareDialogModel(summary: SharedSceneSummary, link: SceneLinkAvailability): ShareDialogModel {
  const t = text().sharing
  return {
    summary: summary.objectCount === 0 ? t.summaryEmpty(summary.mode) : t.summary(summary.mode, summary.objectCount),
    timeNote: summary.mode === 'orbitLab' ? t.timeNoteOrbitLab(formatUtcDisplay(SIMULATION_START_INSTANT)) : t.timeNoteRealObjects,
    catalogueNote: summary.catalogueObjectCount > 0 ? t.catalogueNote : null, privacyNote: t.privacyNote,
    linkUnavailable: link.ok ? null : linkUnavailableReason(link.reason),
  }
}

export function openConfirmationMessage(mode: ProductMode, replacedCount: number): string { return text().sharing.openConfirmation(mode, replacedCount) }
export function openIncomingLine(mode: ProductMode, count: number): string { return text().sharing.openIncoming(mode, count) }
export function openProgressMessage(catalogueObjectCount: number): string { return text().sharing.openProgress(catalogueObjectCount) }

export function sceneOpenFailureMessage(source: 'link' | 'file', failure: SceneTextFailure): string {
  const t = text().sharing
  if (failure.kind === 'newer-version') return source === 'link' ? t.linkNewer : t.fileNewer
  if (failure.kind === 'unsupported-browser') return t.unsupportedBrowser
  if (source === 'file' && failure.kind === 'too-large') return t.fileTooLarge
  return source === 'link' ? t.linkInvalid : t.fileInvalid
}

const MAX_LISTED_NORAD_IDS = 5
/** The result notice: one opening line, then one line per problem kind present. */
export function openResultLines(mode: ProductMode, openedCount: number, problems: readonly SceneResolutionProblem[]): string[] {
  const t = text().sharing
  const lines = [t.opened(mode, openedCount)]
  const missing = problems.flatMap((problem) => problem.kind === 'catalogue-missing' ? [problem.catalogId] : [])
  if (missing.length > 0) {
    const listed = missing.slice(0, MAX_LISTED_NORAD_IDS).map((id) => text().catalogue.noradId(id))
    lines.push(t.missing(missing.length, listed, Math.max(0, missing.length - MAX_LISTED_NORAD_IDS)))
  }
  const changed = problems.filter((problem) => problem.kind === 'element-set-changed').length
  if (changed > 0) lines.push(t.changed(changed))
  const invalid = problems.filter((problem) => problem.kind === 'source-invalid').length
  if (invalid > 0) lines.push(t.unreadable(invalid))
  for (const problem of problems) {
    if (problem.kind === 'scene-capacity') lines.push(t.capacity(MAX_SCENE_OBJECTS, problem.droppedIds.length))
  }
  for (const problem of problems) {
    if (problem.kind === 'layer-budget') lines.push(t.layerBudget(problem.layer, problem.budget, problem.changedIds.length))
  }
  return lines
}
