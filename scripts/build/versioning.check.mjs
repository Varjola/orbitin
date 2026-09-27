import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildEnvironment, readProductVersion, resolveGitRevision, usageEventsEnabled, webAnalyticsSnippet } from '../../vite.config.mjs'

function withTemporaryRoot(run) {
  const root = mkdtempSync(join(tmpdir(), 'orbitin-version-'))
  try { run(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

test('VERSION is trimmed and validated', () => withTemporaryRoot((root) => {
  writeFileSync(join(root, 'VERSION'), ' 1.2.3-rc.1+build.4 \n')
  assert.equal(readProductVersion(root), '1.2.3-rc.1+build.4')
}))

test('a missing VERSION fails clearly', () => withTemporaryRoot((root) => {
  assert.throws(() => readProductVersion(root), /product version could not be read.*VERSION/i)
}))

test('a malformed VERSION fails clearly', () => withTemporaryRoot((root) => {
  writeFileSync(join(root, 'VERSION'), 'release-next\n')
  assert.throws(() => readProductVersion(root), /Invalid Orbitin product version.*VERSION/i)
}))

test('Git revision uses the short hash and falls back when Git is unavailable', () => {
  assert.equal(resolveGitRevision('.', () => '8f37ac2\n'), '8f37ac2')
  assert.equal(resolveGitRevision('.', () => { throw new Error('git unavailable') }), 'unknown')
  assert.equal(resolveGitRevision('.', () => 'not a hash'), 'unknown')
})

test('Vite modes supply the build environment', () => {
  assert.equal(buildEnvironment('development'), 'development')
  assert.equal(buildEnvironment('production'), 'production')
  assert.equal(buildEnvironment('staging'), 'staging')
})

test('usage events are on in builds unless explicitly switched off', () => {
  assert.equal(usageEventsEnabled(undefined), true)
  assert.equal(usageEventsEnabled('on'), true)
  assert.equal(usageEventsEnabled('off'), false)
})

test('the Web Analytics beacon appears only with a valid site token', () => {
  assert.equal(webAnalyticsSnippet(undefined), '')
  assert.equal(webAnalyticsSnippet(''), '')
  assert.match(webAnalyticsSnippet('0123456789abcdef0123456789abcdef'), /static\.cloudflareinsights\.com\/beacon\.min\.js.*"token": "0123456789abcdef0123456789abcdef"/)
  assert.throws(() => webAnalyticsSnippet('"><script>'), /32-character/)
})

test('package.json carries the same version as VERSION', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.version, readProductVersion())
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'))
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].version, pkg.version)
})
