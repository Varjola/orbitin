/** Wording that is mandatory rather than optional, kept
 *  pure so it can be tested directly.
 *
 * The distinction this file exists to preserve (INV-6): "this orbit has no such
 * direction" and "this model cannot report that direction reliably here" are
 * different statements, and the UI must not use the first where the second is
 * true. A bare dash or "not applicable" teaches nothing and is not acceptable in
 * either case.
 */
import { radToDeg } from '../core/angles.ts'
import { format, text } from '../i18n/index.ts'
import type { AngleReadout, ElementConditioning } from '../orbital/elementConditioning.ts'
import type { PropagationModel } from '../simulation/OrbitalObject.ts'
import type { SunSynchronousStatus } from '../simulation/propagationTransitions.ts'

/** The sentence naming what *is* meaningful comes from the substitution actually
 *  displayed rather than being attached to each element separately: a circular
 *  equatorial orbit suppresses both elements, and its meaningful quantity is the
 *  mean longitude, not the argument of latitude a merely circular orbit gets. */
export function conditioningNotes(
  conditioning: ElementConditioning,
  readouts: readonly AngleReadout[],
): string[] {
  const t = text().drift
  const notes: string[] = []
  if (conditioning.node.kind === 'singular') {
    notes.push(t.nodeSingular)
  } else if (conditioning.node.kind === 'illConditioned') {
    notes.push(t.nodeIllConditioned(format().number(radToDeg(conditioning.node.thresholdRad), 1)))
  }
  if (conditioning.periapsis.kind === 'singular') {
    notes.push(t.periapsisSingular)
  } else if (conditioning.periapsis.kind === 'illConditioned') {
    notes.push(t.periapsisIllConditioned(format().exact(conditioning.periapsis.threshold)))
  }
  const substituted = readouts.find((readout) => readout.kind !== 'raan' && readout.kind !== 'argOfPeriapsis')
  if (notes.length > 0 && substituted) {
    notes.push(t.meaningfulQuantity(t.substitutedQuantities[substituted.kind]))
  }
  return notes
}

/** Per-object, because the old blanket "Two-body orbits, no drag or
 *  perturbations." became false for some objects. */
export function modelNote(kind: PropagationModel['kind']): string {
  return text().drift.modelNotes[kind]
}

export function lockStatusMessage(status: SunSynchronousStatus): string {
  const t = text().drift
  const f = format()
  switch (status.kind) {
    case 'none': return ''
    case 'applied': return t.lockApplied(f.number(radToDeg(status.inclinationRad), 2))
    case 'unattainable': return t.lockUnattainable(f.number(status.maximumSemiMajorAxisKm), f.number(status.maximumAltitudeKm))
    case 'releasedByInclinationEdit': return t.lockReleasedByInclination
    case 'releasedByPropagationChange': return t.lockReleasedByPropagation
    case 'requiresJ2Drift': return t.lockRequiresJ2
  }
}
