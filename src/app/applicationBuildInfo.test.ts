import { describe, expect, it } from 'vitest'
import { applicationBuildInfo, isPreReleaseVersion } from './applicationBuildInfo.ts'

describe('applicationBuildInfo', () => {
  it('exposes the build-time product and build identity', () => {
    expect(applicationBuildInfo.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(applicationBuildInfo.revision).toMatch(/^(?:[0-9a-f]+|unknown)$/)
    expect(applicationBuildInfo.environment).not.toBe('')
  })

  it('labels 0.y.z and pre-release suffixes as BETA, and releases from 1.0.0 without it', () => {
    expect(isPreReleaseVersion('0.26.0')).toBe(true)
    expect(isPreReleaseVersion('1.0.0-rc.1')).toBe(true)
    expect(isPreReleaseVersion('1.0.0')).toBe(false)
    expect(isPreReleaseVersion('1.2.3+build.5')).toBe(false)
    expect(isPreReleaseVersion('10.0.0')).toBe(false)
  })
})
