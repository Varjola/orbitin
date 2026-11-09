import { describe, expect, it } from 'vitest'
import { hashWithoutModeKey, modeLinkTarget, modeLinkUrl } from './modeLink.ts'

const base = { origin: 'https://orbitin.net', pathname: '/' }

describe('mode links', () => {
  it('builds a link that names the mode and nothing else', () => {
    expect(modeLinkUrl(base, 'maneuvers')).toBe('https://orbitin.net/#mode=interception')
    expect(modeLinkUrl({ origin: 'https://example.test', pathname: '/app/' }, 'routePlanner')).toBe('https://example.test/app/#mode=route-planner')
  })

  it('reads the mode back from a hash, beside other keys', () => {
    expect(modeLinkTarget('#mode=interception')).toBe('maneuvers')
    expect(modeLinkTarget('#other=1&mode=route-planner')).toBe('routePlanner')
    expect(modeLinkTarget(modeLinkUrl(base, 'routePlanner').slice(base.origin.length + 1))).toBe('routePlanner')
  })

  it('ignores a missing, empty or unknown mode, and the scene modes', () => {
    expect(modeLinkTarget('')).toBeNull()
    expect(modeLinkTarget('#mode=')).toBeNull()
    expect(modeLinkTarget('#mode')).toBeNull()
    expect(modeLinkTarget('#mode=orbitLab')).toBeNull()
    expect(modeLinkTarget('#mode=maneuvers')).toBeNull()
    expect(modeLinkTarget('#scene=b.abc')).toBeNull()
  })

  it('removes only the mode key', () => {
    expect(hashWithoutModeKey('#mode=interception')).toBe('')
    expect(hashWithoutModeKey('#a=1&mode=interception&b')).toBe('#a=1&b')
    expect(hashWithoutModeKey('#scene=b.abc')).toBe('#scene=b.abc')
  })
})
