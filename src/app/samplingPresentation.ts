/** How the body marker is presented at high playback rates.
 *
 * At 200,000x a 16.7 ms frame advances 3,340 s of simulated time, more than
 * half a LEO orbit. Every rendered position is still exactly correct at its own
 * instant; what fails is the eye's ability to interpolate between them. So the
 * physics is not special-cased, no substepping is added, and no interpolated
 * position the simulation did not evaluate is ever drawn (INV-1, INV-8). Only
 * the marker's presentation changes.
 *
 * The metric is the object's **unwrapped true-anomaly advance between rendered
 * frames**, which is a direct measure of how far along its orbit it actually
 * moved. Mean motion alone would be the wrong control: the highly elliptical
 * preset's angular rate near periapsis is 9.95 times its mean rate and near
 * apoapsis 0.22 times, a ratio of 44.8 between the two ends of one orbit, and
 * that contrast is itself part of the lesson.
 *
 * Four properties this gets right:
 *
 *  - **It cannot alias.** unwrappedTrueAnomalyRad counts whole revolutions, so
 *    an interval spanning 3.5 revolutions yields about 22 rad rather than the
 *    sub-PI residue a wrapped-endpoint subtraction would return.
 *  - **It is measured, not assumed.** The interval is whatever simulated time
 *    actually elapsed between the last two rendered frames, so the policy stays
 *    correct through pauses, reversal (hence the absolute value),
 *    tab-throttling and frame hitches, with no reference to the speed
 *    multiplier.
 *  - **It is per object**, keyed on that object's own conic.
 *  - **It introduces no substeps and no interpolation.** It reads two values
 *    the simulation already evaluated at two instants it already rendered.
 */
import { degToRad } from '../core/angles.ts'
import { text } from '../i18n/index.ts'

export type SamplingBand = 'tracking' | 'sampled' | 'planeOnly'

/** Upward edges. 6 deg/frame is 60 frames per orbit locally; 60 deg/frame is
 *  fewer than 6. */
const SAMPLED_ENTRY_RAD = degToRad(6)
const PLANE_ONLY_ENTRY_RAD = degToRad(60)
/** Downward edges carry 20% hysteresis, so an object sitting on a boundary
 *  fades rather than flickers. */
const SAMPLED_EXIT_RAD = degToRad(5)
const PLANE_ONLY_EXIT_RAD = degToRad(50)
/** Exponential moving average weight for the newest measurement. */
const SMOOTHING = 0.25

/** Opacity of a faded marker in the `planeOnly` band: low enough that the
 *  orbital planes and the readouts are the visualization, high enough that the
 *  object is not simply gone. */
export const PLANE_ONLY_MARKER_OPACITY = 0.15

/** Runtime-local, one per object, never in AppState (INV-10). */
export interface SamplingState {
  readonly band: SamplingBand
  readonly smoothedAdvanceRad: number
  readonly previousUnwrappedTrueAnomalyRad: number | null
}

export function initialSamplingState(): SamplingState {
  return { band: 'tracking', smoothedAdvanceRad: 0, previousUnwrappedTrueAnomalyRad: null }
}

/** Discard the measurement anchor but **keep the band**, for use when
 *  re-anchoring, an element edit or a propagation-model change shifts the
 *  origin of `unwrappedTrueAnomalyRad` discontinuously. Resetting to
 *  `initialSamplingState` there would drop a faded marker back to full opacity
 *  for one frame; this keeps the previous band until a real interval is
 *  available again. */
export function resetSamplingMeasurement(previous: SamplingState): SamplingState {
  return { ...previous, previousUnwrappedTrueAnomalyRad: null }
}

function bandFor(previous: SamplingBand, advanceRad: number): SamplingBand {
  if (advanceRad > PLANE_ONLY_ENTRY_RAD) return 'planeOnly'
  if (advanceRad > SAMPLED_ENTRY_RAD) return previous === 'planeOnly' && advanceRad > PLANE_ONLY_EXIT_RAD ? 'planeOnly' : 'sampled'
  if (advanceRad > SAMPLED_EXIT_RAD) return previous === 'tracking' ? 'tracking' : 'sampled'
  return 'tracking'
}

/** Pure. On the first call after initialisation there is no previous sample, so
 *  the band is unchanged and only the anchor is recorded: a re-anchor or a model
 *  change shifts the origin of `unwrappedTrueAnomalyRad` discontinuously, and
 *  discarding one frame's measurement is what keeps that from reading as a
 *  sudden jump. */
export function advanceSamplingState(previous: SamplingState, unwrappedTrueAnomalyRad: number): SamplingState {
  if (previous.previousUnwrappedTrueAnomalyRad === null) {
    return { ...previous, previousUnwrappedTrueAnomalyRad: unwrappedTrueAnomalyRad }
  }
  const rawAdvanceRad = Math.abs(unwrappedTrueAnomalyRad - previous.previousUnwrappedTrueAnomalyRad)
  const smoothedAdvanceRad = previous.smoothedAdvanceRad + SMOOTHING * (rawAdvanceRad - previous.smoothedAdvanceRad)
  return {
    band: bandFor(previous.band, smoothedAdvanceRad),
    smoothedAdvanceRad,
    previousUnwrappedTrueAnomalyRad: unwrappedTrueAnomalyRad,
  }
}

export function samplingBandNote(band: SamplingBand): string {
  switch (band) {
    case 'tracking': return ''
    case 'sampled': return text().time.samplingSampled
    case 'planeOnly': return text().time.samplingPlaneOnly
  }
}
