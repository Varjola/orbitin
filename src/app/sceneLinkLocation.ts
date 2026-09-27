import { hashWithoutSceneKey, sceneLinkPayload } from '../data/sceneLink.ts'

/** The only production code that writes history. The
 *  application never tracks state in the URL; it only removes the `scene`
 *  fragment key once a shared link has been handled. */
export interface SceneLinkLocation {
  readonly origin: string
  readonly pathname: string
  readonly search: string
  currentHash(): string
  clearSceneFragment(): void
  onSceneHashChange(listener: () => void): () => void
}

export function browserSceneLinkLocation(win: Window): SceneLinkLocation {
  const location = win.location
  return {
    get origin() { return location.origin },
    get pathname() { return location.pathname },
    get search() { return location.search },
    currentHash: () => location.hash,
    // Path, query and other fragment keys are kept; no history entry is added.
    clearSceneFragment: () => {
      const hash = hashWithoutSceneKey(location.hash)
      if (hash === location.hash) return
      win.history.replaceState(win.history.state, '', `${location.pathname}${location.search}${hash}`)
    },
    onSceneHashChange: (listener) => {
      const handle = (): void => { if (sceneLinkPayload(location.hash)) listener() }
      win.addEventListener('hashchange', handle)
      return () => win.removeEventListener('hashchange', handle)
    },
  }
}
