/** Calls `onFrame` once per animation frame. `deltaSeconds` is capped so a
 * stalled or throttled frame never leaps the simulation at high speed;
 * `wallNowMs` is the wall-clock time of the frame, which still advances while
 * the browser suspends frames in a background tab or during sleep.
 *
 * A frame that throws stops the loop and hands the error to `onError` once,
 * instead of repeating the failure every frame or freezing silently. */
export function startRenderLoop(onFrame: (deltaSeconds: number, nowMs: number, wallNowMs: number) => void, onError?: (error: unknown) => void): () => void {
  let animationFrame = 0
  let previousMs = performance.now()
  let running = true
  const frame = (nowMs: number) => {
    if (!running) return
    const deltaSeconds = Math.min(0.1, Math.max(0, (nowMs - previousMs) / 1000))
    previousMs = nowMs
    try {
      onFrame(deltaSeconds, nowMs, Date.now())
    } catch (error) {
      running = false
      onError?.(error)
      return
    }
    animationFrame = requestAnimationFrame(frame)
  }
  animationFrame = requestAnimationFrame(frame)
  return () => {
    running = false
    cancelAnimationFrame(animationFrame)
  }
}
