import type { GroundTrackViewPort } from './OrbitalObjectRuntime.ts'

/** Fan one runtime publication out to the 3D and 2D ground-track views.
 *
 * `OrbitalObjectRuntime` stays the single publisher: it gains no second cache,
 * no `mapWindow`/`mapHistory` field and no map-specific dirty scheduling. Each
 * child receives the same call with the **same object reference**, which is why
 * the globe and the map cannot drift apart or disagree about an instant.
 *
 * Construction is ordered and reversible. The children are built through
 * factories rather than passed in, so a failure while building the second one
 * can dispose the first instead of leaking a three.js line group into a scene
 * whose object was never registered.
 */
export function combineGroundTrackViewPorts(
  createPrimary: () => GroundTrackViewPort,
  createSecondary: () => GroundTrackViewPort,
  /** The colour the 3D child draws with (the Lab backdrop
   *  darkens light colours); the map child keeps the stored colour. */
  primaryColor: (colorHex: number) => number = (colorHex) => colorHex,
): GroundTrackViewPort {
  const primary = createPrimary()
  let secondary: GroundTrackViewPort
  try {
    secondary = createSecondary()
  } catch (error) {
    primary.dispose()
    throw error
  }
  let disposed = false
  return {
    setCurrent: (point) => { primary.setCurrent(point); secondary.setCurrent(point) },
    setWindow: (window) => { primary.setWindow(window); secondary.setWindow(window) },
    // Optional on a child, because a minimal non-rendering port may omit it;
    // always present here so the runtime's history publication has one seam.
    setHistory: (segments) => { primary.setHistory?.(segments); secondary.setHistory?.(segments) },
    setBodyVisible: (visible) => { primary.setBodyVisible?.(visible); secondary.setBodyVisible?.(visible) },
    setName: (name) => { primary.setName?.(name); secondary.setName?.(name) },
    setVisible: (visible) => { primary.setVisible(visible); secondary.setVisible(visible) },
    setColor: (colorHex) => { primary.setColor(primaryColor(colorHex)); secondary.setColor(colorHex) },
    setSelected: (selected) => { primary.setSelected(selected); secondary.setSelected(selected) },
    dispose: () => {
      if (disposed) return
      disposed = true
      primary.dispose()
      secondary.dispose()
    },
  }
}
