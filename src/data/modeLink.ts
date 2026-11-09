import type { ProductMode, SceneMode } from '../state/AppState.ts'

/** A mode without a scene: its link opens it at its starting view and carries
 *  nothing else. */
export type LinkedMode = Exclude<ProductMode, SceneMode>

const MODE_LINK_FRAGMENT_KEY = 'mode'
const LINK_VALUES: Readonly<Record<LinkedMode, string>> = { maneuvers: 'interception', routePlanner: 'route-planner' }

function fragmentEntries(hash: string): string[] { const text = hash.startsWith('#') ? hash.slice(1) : hash; return text === '' ? [] : text.split('&') }
function entryKey(entry: string): string { const equals = entry.indexOf('='); return equals < 0 ? entry : entry.slice(0, equals) }

/** The link to a mode's starting view, for example `https://orbitin.net/#mode=interception`. */
export function modeLinkUrl(base: { readonly origin: string; readonly pathname: string }, mode: LinkedMode): string {
  return `${base.origin}${base.pathname}#${MODE_LINK_FRAGMENT_KEY}=${LINK_VALUES[mode]}`
}

/** The mode a location hash links to; null when it names none or an unknown one. */
export function modeLinkTarget(hash: string): LinkedMode | null {
  const entry = fragmentEntries(hash).find((candidate) => entryKey(candidate) === MODE_LINK_FRAGMENT_KEY)
  if (entry === undefined) return null
  const value = entry.slice(MODE_LINK_FRAGMENT_KEY.length + 1)
  return (Object.keys(LINK_VALUES) as LinkedMode[]).find((mode) => LINK_VALUES[mode] === value) ?? null
}

/** The hash with every `mode` key removed and other keys kept; '' when none remain. */
export function hashWithoutModeKey(hash: string): string {
  const kept = fragmentEntries(hash).filter((entry) => entryKey(entry) !== MODE_LINK_FRAGMENT_KEY)
  return kept.length === 0 ? '' : `#${kept.join('&')}`
}
