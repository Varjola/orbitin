/** Which presentation renders the one application.
 *
 * Phones get the mobile presentation, tablets and desktops keep
 * the desktop one. Mobile applies at most 699 CSS px wide, or at most 500 CSS
 * px high with a coarse pointer (a phone turned to landscape). There is no
 * learner switch; development builds may force one with `?presentation=`. */

export type Presentation = 'desktop' | 'mobile'

export const MOBILE_PRESENTATION_QUERY = '(max-width: 699px), (pointer: coarse) and (max-height: 500px)'

export interface PresentationEnvironment {
  readonly matchMedia: (query: string) => MediaQueryList | null
}

export function browserPresentationEnvironment(): PresentationEnvironment {
  return { matchMedia: (query) => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null }
}

/** `mobile` or `desktop` from a `?presentation=` value; anything else is no override. */
export function parsePresentationOverride(value: string | null): Presentation | null {
  return value === 'mobile' || value === 'desktop' ? value : null
}

/** The single owner of the active presentation. */
export class PresentationController {
  private readonly query: MediaQueryList | null
  private readonly override: Presentation | null
  private current: Presentation
  private listener: ((presentation: Presentation) => void) | null = null
  private listening = false
  private readonly onQueryChange = (event: MediaQueryListEvent): void => {
    const next: Presentation = event.matches ? 'mobile' : 'desktop'
    if (next === this.current) return
    this.current = next
    this.listener?.(next)
  }

  constructor(environment: PresentationEnvironment = browserPresentationEnvironment(), override: Presentation | null = null) {
    this.override = override
    this.query = override ? null : environment.matchMedia(MOBILE_PRESENTATION_QUERY)
    this.current = override ?? (this.query?.matches ? 'mobile' : 'desktop')
    if (this.query) {
      this.query.addEventListener('change', this.onQueryChange)
      this.listening = true
    }
  }

  get presentation(): Presentation { return this.current }

  /** True when a development override fixes the presentation. */
  get forced(): boolean { return this.override !== null }

  /** The application rebuilds its interface through this listener. */
  onChange(listener: ((presentation: Presentation) => void) | null): void { this.listener = listener }

  /** Removes the media listener; the architecture test keeps it balanced. */
  dispose(): void {
    this.listener = null
    if (!this.listening || !this.query) return
    this.listening = false
    this.query.removeEventListener('change', this.onQueryChange)
  }
}
