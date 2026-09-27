import { hashWithoutSceneKey, sceneLinkPayload } from '../data/sceneLink.ts'
import type { SceneLinkLocation } from '../app/sceneLinkLocation.ts'

/** An in-memory location for tests. */
export function memorySceneLinkLocation(initial: { readonly origin?: string; readonly pathname?: string; readonly search?: string; readonly hash?: string } = {}): SceneLinkLocation & { hash: string; navigate(hash: string): void; readonly clears: number } {
  const listeners = new Set<() => void>()
  let clears = 0
  const memory = {
    origin: initial.origin ?? 'https://orbitin.test', pathname: initial.pathname ?? '/', search: initial.search ?? '', hash: initial.hash ?? '',
    get clears() { return clears },
    currentHash: () => memory.hash,
    clearSceneFragment: () => { clears++; memory.hash = hashWithoutSceneKey(memory.hash) },
    onSceneHashChange: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    navigate: (hash: string) => { memory.hash = hash; if (sceneLinkPayload(hash)) for (const listener of [...listeners]) listener() },
  }
  return memory
}
