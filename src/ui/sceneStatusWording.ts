import { text } from '../i18n/index.ts'
import type { AddCatalogueRecordsOutcome, AddFailureReason } from '../state/catalogueAdditionOutcome.ts'

export function addFailureMessage(reason: AddFailureReason): string {
  const t = text().errors
  switch (reason.kind) {
    case 'scene-changed': return t.addFailed.sceneChanged
    case 'record-not-added': return t.addFailed.recordNotAdded
    case 'record-invalid': return t.addFailed.recordInvalid(reason.catalogId, reason.message)
    case 'catalogue': return t.catalogue(reason.failure)
    case 'group-unavailable': return t.addFailed.groupUnavailable
    case 'not-ready': return t.addFailed.notReady
    case 'wait-for-open': return t.addFailed.waitForOpen
  }
}

export function sceneStatusMessage(outcome: AddCatalogueRecordsOutcome): string {
  const t = text().status
  switch (outcome.kind) {
    case 'nothing-requested': return ''
    case 'added': {
      const n = outcome.added.length, k = outcome.alreadyPresent.length, total = n + k
      if (n === 1 && k === 0) return t.addedOne(outcome.added[0].name)
      if (n === 1 && k > 0) return t.addedOneWithPresent(outcome.added[0].name, k, total)
      return t.addedMany(n, k, total)
    }
    case 'already-present': return outcome.objects.length === 1 ? t.alreadyPresentOne(outcome.objects[0].name) : t.alreadyPresentMany(outcome.objects.length)
    case 'in-progress': return t.inProgress
    case 'refused-capacity': return t.refusedCapacity(outcome.available, outcome.requested)
    case 'missing-records': return t.missingRecords(outcome.missingIds.length)
    case 'failed': return t.failed(addFailureMessage(outcome.reason))
  }
}

export function quickSearchSelectionMessage(name: string): string { return text().status.quickSearchSelected(name) }
