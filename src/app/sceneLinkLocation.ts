import { hashWithoutModeKey, modeLinkTarget, type LinkedMode } from '../data/modeLink.ts'
import { hashWithoutSceneKey, sceneLinkPayload } from '../data/sceneLink.ts'

/** The only production code that writes history. The
 *  application never tracks state in the URL; it only removes the `scene`
 *  fragment key once a shared link has been handled, and the `mode` key of a
 *  mode link. */
export interface SceneLinkLocation {
  readonly origin: string
  readonly pathname: string
  readonly search: string
  currentHash(): string
  clearSceneFragment(): void
  onSceneHashChange(listener: () => void): () => void
}

/** Path, query and other fragment keys are kept; no history entry is added. */
function replaceHash(win: Window, hash: string): void {
  const location = win.location
  if (hash === location.hash) return
  win.history.replaceState(win.history.state, '', `${location.pathname}${location.search}${hash}`)
}

export function browserSceneLinkLocation(win: Window): SceneLinkLocation {
  const location = win.location
  return {
    get origin() { return location.origin },
    get pathname() { return location.pathname },
    get search() { return location.search },
    currentHash: () => location.hash,
    clearSceneFragment: () => replaceHash(win, hashWithoutSceneKey(location.hash)),
    onSceneHashChange: (listener) => {
      const handle = (): void => { if (sceneLinkPayload(location.hash)) listener() }
      win.addEventListener('hashchange', handle)
      return () => win.removeEventListener('hashchange', handle)
    },
  }
}

/** A mode link (`#mode=interception`): the mode it names, its key removed from
 *  the address once read. A scene in the same link wins, so the mode is then
 *  ignored. */
export function takeModeLink(win: Window): LinkedMode | null {
  const hash = win.location.hash
  const mode = modeLinkTarget(hash)
  if (mode === null) return null
  replaceHash(win, hashWithoutModeKey(hash))
  return sceneLinkPayload(hash) === null ? mode : null
}

/** Calls `listener` when a mode link is pasted into an open page. */
export function onModeHashChange(win: Window, listener: () => void): () => void {
  const handle = (): void => { if (modeLinkTarget(win.location.hash) !== null) listener() }
  win.addEventListener('hashchange', handle)
  return () => win.removeEventListener('hashchange', handle)
}
