import './styles/base.css'
import './styles/ui.css'
import './styles/mobile.css'
import { Application } from './app/Application.ts'
import { classifyStartupError, defaultFailureAction, renderStartupFailure, webgl2Available } from './app/loadingOverlay.ts'
import { recordUsage } from './app/usageEvents.ts'
import { LocaleController } from './app/LocaleController.ts'
import { parsePresentationOverride, PresentationController } from './app/PresentationController.ts'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('Missing #app mount point')
const mount = root

// The language is resolved before anything renders, so the loading
// overlay and an initialization error are already in it.
const locale = new LocaleController()

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search)
  // The dev-only pseudo-locale. `import.meta.env.DEV`
  // is false in every `vite build`, so the module never reaches a bundle.
  if (import.meta.env.DEV && params.get('locale') === 'pseudo') {
    const { pseudoCatalogue } = await import('./i18n/messages/pseudo.ts')
    locale.usePseudo(pseudoCatalogue())
  }
  // No learner switch. Development builds may force a
  // presentation with `?presentation=mobile` or `?presentation=desktop`.
  // `import.meta.env.DEV` is false in every `vite build`.
  // The development server has no catalogue Worker, so it serves the local
  // development catalogue inside the page; a clean
  // clone works without credentials. `?catalogue-fixture=off` turns it off.
  if (import.meta.env.DEV && params.get('catalogue-fixture') !== 'off') {
    const { installCatalogueFixtureFetch } = await import('./performance/catalogueFixtureFetch.ts')
    await installCatalogueFixtureFetch(params.get('catalogue-fixture'))
  }
  const presentation = new PresentationController(undefined, import.meta.env.DEV ? parsePresentationOverride(params.get('presentation')) : null)
  // One anonymous visit event. An example link carries
  // `?example=` beside its scene, so its visits can be told apart.
  const sceneInLink = /(?:^#|&)scene=/.test(location.hash)
  recordUsage({ type: 'visit', presentation: presentation.presentation, locale: locale.locale === 'fi' ? 'fi' : 'en', entry: sceneInLink ? (params.has('example') ? 'example' : 'scene-link') : 'plain' })
  // Without WebGL2 there is nothing to start; say so plainly.
  if (!webgl2Available(document)) {
    recordUsage({ type: 'error', kind: 'webgl' })
    renderStartupFailure(mount, 'webgl', defaultFailureAction('webgl', () => location.reload()))
    return
  }
  try {
    const application = new Application(mount, { locale, presentation })
    const started = application.start()
    // The scale harness. `import.meta.env.DEV` is false in every
    // `vite build`, so the dynamic import and the harness module are removed
    // from production and preview bundles alike.
    if (import.meta.env.DEV) {
      // Browser checks: the harness surface without running a measurement.
      if (params.has('inspect')) void started.then(() => { (window as unknown as Record<string, unknown>).__orbitinInspect = application.measurementTarget() })
      if (params.has('measure-scene')) {
        void started.then(() => import('./performance/sceneScaleHarness.ts')).then(({ harnessOptionsFromUrl, installSceneScaleHarness }) => {
          installSceneScaleHarness(application.measurementTarget(), harnessOptionsFromUrl(params))
        })
      }
    }
  } catch (error) {
    console.error(error)
    const kind = classifyStartupError(error, webgl2Available(document))
    recordUsage({ type: 'error', kind: kind === 'webgl' ? 'webgl' : 'frame' })
    renderStartupFailure(mount, kind, defaultFailureAction(kind, () => location.reload()))
  }
}

// Errors nothing else caught are counted, never shown or sent in detail.
window.addEventListener('error', () => recordUsage({ type: 'error', kind: 'uncaught' }))
window.addEventListener('unhandledrejection', () => recordUsage({ type: 'error', kind: 'rejection' }))

void start()
