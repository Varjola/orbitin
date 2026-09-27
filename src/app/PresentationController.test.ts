import { describe, expect, it } from 'vitest'
import { MOBILE_PRESENTATION_QUERY, parsePresentationOverride, PresentationController, type Presentation, type PresentationEnvironment } from './PresentationController.ts'

/** A media query double that records its listeners. */
function fakeMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const queries: string[] = []
  const list = {
    matches,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { listeners.add(listener) },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { listeners.delete(listener) },
  }
  const environment: PresentationEnvironment = { matchMedia: (query) => { queries.push(query); return list as unknown as MediaQueryList } }
  const change = (next: boolean) => { list.matches = next; for (const listener of [...listeners]) listener({ matches: next } as MediaQueryListEvent) }
  return { environment, listeners, queries, change }
}

describe('PresentationController', () => {
  it('asks exactly the D1 query and follows its result', () => {
    expect(MOBILE_PRESENTATION_QUERY).toBe('(max-width: 699px), (pointer: coarse) and (max-height: 500px)')
    const phone = fakeMedia(true)
    expect(new PresentationController(phone.environment).presentation).toBe('mobile')
    expect(phone.queries).toEqual([MOBILE_PRESENTATION_QUERY])
    expect(new PresentationController(fakeMedia(false).environment).presentation).toBe('desktop')
  })

  it('reports each crossing once, and none when nothing changed', () => {
    const media = fakeMedia(false)
    const controller = new PresentationController(media.environment)
    const seen: Presentation[] = []
    controller.onChange((presentation) => seen.push(presentation))
    media.change(true)
    media.change(true)
    media.change(false)
    expect(seen).toEqual(['mobile', 'desktop'])
    expect(controller.presentation).toBe('desktop')
  })

  it('keeps its media listener balanced', () => {
    const media = fakeMedia(false)
    const controller = new PresentationController(media.environment)
    expect(media.listeners.size).toBe(1)
    controller.dispose()
    controller.dispose()
    expect(media.listeners.size).toBe(0)
  })

  it('lets a development override fix the presentation without listening', () => {
    const media = fakeMedia(false)
    const controller = new PresentationController(media.environment, 'mobile')
    expect(controller.presentation).toBe('mobile')
    expect(controller.forced).toBe(true)
    expect(media.queries).toEqual([])
    expect(media.listeners.size).toBe(0)
  })

  it('falls back to desktop without matchMedia', () => {
    expect(new PresentationController({ matchMedia: () => null }).presentation).toBe('desktop')
  })

  it('parses only the two presentation names as an override', () => {
    expect(parsePresentationOverride('mobile')).toBe('mobile')
    expect(parsePresentationOverride('desktop')).toBe('desktop')
    for (const value of [null, '', 'Mobile', 'tablet', 'mobile ']) expect(parsePresentationOverride(value)).toBeNull()
  })
})
