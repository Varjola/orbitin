import type { SceneMeasurementTarget } from '../app/sceneMeasurementTarget.ts'
import { createSyntheticScene } from '../test-fixtures/syntheticScene.ts'

/** Dev-only browser frame harness.
 *
 * Loaded only by a development build whose URL carries `?measure-scene=<N>`;
 * `npm run build` contains no trace of it (checked by
 * `scripts/build/checkMeasurementHarnessExcluded.mjs`).
 *
 * Two modes:
 * - `raf` (default): the application's own render loop runs and the harness
 *   records `requestAnimationFrame` intervals. This is the frame evidence the
 *   performance thresholds refer to, captured in a real desktop browser.
 * - `step`: the render loop is paused and frames are driven synchronously,
 *   each followed by a one-pixel GPU read-back. It reports per-frame work
 *   time, a proxy that works in browser panes that do not paint continuously.
 */

export type HarnessLayer = 'paths' | 'tracks' | 'history' | 'sensors'
export interface HarnessOptions {
  readonly objects: number
  /** Layers turned on. `paths` applies to every object; the other layers to
   *  the first `budget` objects (all when omitted). */
  readonly layers: readonly HarnessLayer[]
  readonly budget?: number
  readonly speed: number
  readonly map: 'closed' | 'open' | 'maximized'
  readonly mode: 'raf' | 'step'
  /** raf: measured seconds. step: measured frames = seconds * 60. */
  readonly seconds: number
  readonly warmupSeconds: number
  readonly label?: string
  /** Select every object and run Reveal selected before measuring. */
  readonly revealAll?: boolean
}

export interface HarnessResult {
  readonly label: string
  readonly options: HarnessOptions
  readonly metric: 'frame interval (rAF)' | 'frame work incl. GPU sync (step)'
  readonly samples: number
  readonly medianMs: number
  readonly p95Ms: number
  readonly maxMs: number
  readonly overBudgetShare: number
  /** Step mode only: median milliseconds per frame phase. */
  readonly phaseMediansMs: Record<string, number> | null
  readonly renderer: { readonly calls: number; readonly geometries: number; readonly textures: number }
  readonly map: { readonly canvases: number; readonly backingBytes: number }
  readonly heapBytes: number | null
  readonly environment: HarnessEnvironment
  readonly recordedAtUtc: string
}

export interface HarnessEnvironment {
  readonly userAgent: string
  readonly gpu: string
  readonly viewportCssPx: string
  readonly devicePixelRatio: number
  readonly hardwareConcurrency: number | null
}

declare global {
  interface Window {
    __orbitinSceneMeasurement?: HarnessResult[]
    __orbitinSceneHarness?: { run(options: Partial<HarnessOptions>): Promise<HarnessResult>; readonly results: HarnessResult[]; readonly target: SceneMeasurementTarget }
  }
}

const DEFAULTS: HarnessOptions = { objects: 100, layers: ['paths'], speed: 1, map: 'closed', mode: 'raf', seconds: 30, warmupSeconds: 2 }

export function harnessOptionsFromUrl(params: URLSearchParams): HarnessOptions {
  const number = (key: string, fallback: number): number => { const value = Number(params.get(key)); return params.has(key) && Number.isFinite(value) ? value : fallback }
  const layers = (params.get('layers') ?? 'paths').split(',').map((value) => value.trim()).filter((value): value is HarnessLayer => ['paths', 'tracks', 'history', 'sensors'].includes(value))
  const map = params.get('map')
  return {
    objects: number('measure-scene', DEFAULTS.objects),
    layers,
    ...(params.has('budget') ? { budget: number('budget', DEFAULTS.objects) } : {}),
    speed: number('speed', DEFAULTS.speed),
    map: map === 'open' || map === 'maximized' ? map : 'closed',
    mode: params.get('mode') === 'step' ? 'step' : 'raf',
    seconds: number('seconds', DEFAULTS.seconds),
    warmupSeconds: number('warmup', DEFAULTS.warmupSeconds),
  }
}

export function installSceneScaleHarness(target: SceneMeasurementTarget, initial: HarnessOptions | null): void {
  const results: HarnessResult[] = []
  const panel = createPanel()
  let queue = Promise.resolve()
  const run = (partial: Partial<HarnessOptions>): Promise<HarnessResult> => {
    const options: HarnessOptions = { ...DEFAULTS, ...partial }
    const next = queue.then(() => measure(target, options))
    queue = next.then(() => undefined, () => undefined)
    return next.then((result) => {
      results.push(result)
      window.__orbitinSceneMeasurement = results
      panel.textContent = JSON.stringify(results, null, 2)
      return result
    })
  }
  window.__orbitinSceneHarness = { run, results, target }
  if (initial) void run(initial)
}

async function measure(target: SceneMeasurementTarget, options: HarnessOptions): Promise<HarnessResult> {
  const budget = options.budget ?? options.objects
  const scene = createSyntheticScene(options.objects, { orbitPath: options.layers.includes('paths') }).map((item, index) => {
    if (index >= budget) return item.object
    const history = options.layers.includes('history')
    return {
      ...item.object,
      display: {
        ...item.object.display,
        groundTrackVisible: history || options.layers.includes('tracks'),
        groundTrackHistoryRecording: history,
        sensorGeometryVisible: options.layers.includes('sensors'),
      },
    }
  })
  target.syncViewportSize()
  target.replaceRealObjectsScene(scene)
  target.setSpeed(options.speed)
  target.setMapOpen(options.map !== 'closed')
  target.setMapMaximized(options.map === 'maximized')
  // Let shell transitions finish, then re-measure explicitly.
  await new Promise((resolve) => setTimeout(resolve, 350))
  target.syncViewportSize()
  if (options.revealAll) target.selectAllAndReveal()
  const phases: Record<string, number[]> = {}
  const samples = options.mode === 'step' ? await stepFrames(target, options, phases) : await rafFrames(options)
  const sorted = samples.slice().sort((a, b) => a - b)
  const quantile = (q: number): number => sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)]
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  return {
    label: options.label ?? describeOptions(options),
    options,
    metric: options.mode === 'step' ? 'frame work incl. GPU sync (step)' : 'frame interval (rAF)',
    samples: sorted.length,
    medianMs: round(quantile(0.5)),
    p95Ms: round(quantile(0.95)),
    maxMs: round(sorted.at(-1) ?? NaN),
    overBudgetShare: round(sorted.filter((value) => value > 16.7).length / Math.max(1, sorted.length)),
    phaseMediansMs: options.mode === 'step' ? Object.fromEntries(Object.entries(phases).map(([key, values]) => [key, round(values.sort((a, b) => a - b)[Math.ceil(values.length / 2) - 1] ?? NaN)])) : null,
    renderer: target.rendererInfo(),
    map: target.mapCanvasStats(),
    heapBytes: memory ? memory.usedJSHeapSize : null,
    environment: environment(target),
    recordedAtUtc: new Date().toISOString(),
  }
}

/** Frames are driven in slices that yield through a MessageChannel, which
 *  hidden pages do not throttle, so a long run never blocks the page. */
async function stepFrames(target: SceneMeasurementTarget, options: HarnessOptions, phases: Record<string, number[]>): Promise<number[]> {
  target.pauseRenderLoop()
  const frameMs = 1000 / 60
  let nowMs = performance.now()
  let wallNowMs = Date.now()
  const samples: number[] = []
  try {
    const warmup = Math.round(options.warmupSeconds * 60)
    const frames = Math.round(options.seconds * 60)
    for (let frame = 0; frame < warmup + frames; frame += 1) {
      if (frame % 20 === 19) await yieldToPage()
      nowMs += frameMs; wallNowMs += frameMs
      const started = performance.now()
      const times = target.stepFrame(frameMs / 1000, nowMs, wallNowMs)
      const gpuStarted = performance.now()
      target.finishGpu()
      if (frame >= warmup) {
        samples.push(performance.now() - started)
        for (const [key, value] of Object.entries({ ...times, gpuSync: performance.now() - gpuStarted })) (phases[key] ??= []).push(value)
      }
    }
  } finally {
    target.resumeRenderLoop()
  }
  return samples
}

function yieldToPage(): Promise<void> {
  return new Promise((resolve) => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); resolve() }; channel.port2.postMessage(null) })
}

function rafFrames(options: HarnessOptions): Promise<number[]> {
  return new Promise((resolve) => {
    const samples: number[] = []
    let previous: number | null = null
    let started: number | null = null
    const tick = (now: number): void => {
      started ??= now
      if (previous !== null && now - started >= options.warmupSeconds * 1000) samples.push(now - previous)
      previous = now
      if (now - started < (options.warmupSeconds + options.seconds) * 1000) requestAnimationFrame(tick)
      else resolve(samples)
    }
    requestAnimationFrame(tick)
  })
}

function environment(target: SceneMeasurementTarget): HarnessEnvironment {
  const viewport = target.viewport()
  let gpu = 'unknown'
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    if (gl && info) gpu = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
  } catch { /* the GPU name is optional evidence */ }
  return {
    userAgent: navigator.userAgent,
    gpu,
    viewportCssPx: `${viewport.width}x${viewport.height}`,
    devicePixelRatio: viewport.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
  }
}

function describeOptions(options: HarnessOptions): string {
  const budget = options.budget === undefined ? '' : ` B=${options.budget}`
  return `N=${options.objects} ${options.layers.join('+')}${budget} ${options.speed}x map=${options.map} ${options.mode}`
}

function round(value: number): number { return Math.round(value * 1000) / 1000 }

function createPanel(): HTMLElement {
  const panel = document.createElement('pre')
  panel.id = 'orbitin-scene-measurement'
  panel.setAttribute('aria-label', 'Scene measurement results (development only)')
  Object.assign(panel.style, {
    position: 'fixed', zIndex: '40', left: '0.5rem', bottom: '0.5rem', maxWidth: '32rem', maxHeight: '40vh', overflow: 'auto', margin: '0',
    padding: '0.5rem', font: '11px/1.35 ui-monospace, monospace', color: '#d8f3f7', background: 'rgba(0, 0, 0, 0.82)', userSelect: 'text',
  })
  panel.textContent = 'Scene measurement running…'
  document.body.append(panel)
  return panel
}
