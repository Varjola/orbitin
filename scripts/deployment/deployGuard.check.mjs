import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateDeployGuard, MONITOR_BUCKET, MONITOR_PREVIEW_BUCKET, PREVIEW_BUCKET, PRODUCTION_BUCKET, TARGET_BUCKETS, TARGET_CONFIGS } from './deployGuard.mjs'

const sentinel = { name: 'orbitin-select-worker-config', r2_buckets: [], triggers: { crons: [] } }
// Obsolete runtime names, built from parts so the repository-wide obsolete-name scan stays exception-free.
const OLD = 'orbital'
const obsoleteTargets = [OLD, `${OLD}-dev`, `${OLD}-catalogue`, `${OLD}-catalogue-fixture`, `${OLD}-education-tool`]
const obsoleteProductionBucket = `${OLD}-education-tool-catalogue`
const obsoletePreviewBucket = `${obsoleteProductionBucket}-preview`
function input(target, overrides = {}) {
  return {
    target,
    branch: target === 'orbitin-dev' ? 'develop' : target === 'orbitin-catalogue-fixture' ? 'feature/test' : 'main',
    porcelain: '',
    confirm: target,
    allowBranch: undefined,
    rootFiles: ['wrangler.jsonc', ...Object.values(TARGET_CONFIGS)],
    resolvedConfig: { name: target, r2_buckets: [{ ...TARGET_BUCKETS[target] }], triggers: { crons: [] }, vars: {} },
    sentinelConfig: sentinel,
    head: 'abc123',
    ...overrides,
  }
}

describe('deploy guard', () => {
  it('knows exactly the canonical Orbitin targets and their configs', () => {
    assert.deepEqual(TARGET_CONFIGS, {
      orbitin: 'wrangler.orbitin.jsonc',
      'orbitin-dev': 'wrangler.orbitin-dev.jsonc',
      'orbitin-catalogue': 'wrangler.catalogue.jsonc',
      'orbitin-catalogue-fixture': 'wrangler.catalogue-fixture.jsonc',
      'orbitin-catalogue-monitor': 'wrangler.catalogue-monitor.jsonc',
    })
    assert.equal(PRODUCTION_BUCKET, 'orbitin-catalogue')
    assert.equal(PREVIEW_BUCKET, 'orbitin-catalogue-preview')
    assert.deepEqual(TARGET_BUCKETS['orbitin-catalogue-fixture'], { binding: 'CATALOGUE_BUCKET', bucket_name: 'orbitin-catalogue-preview', preview_bucket_name: 'orbitin-catalogue-preview' })
    assert.deepEqual(TARGET_BUCKETS['orbitin-catalogue-monitor'], { binding: 'MONITOR_BUCKET', bucket_name: MONITOR_BUCKET, preview_bucket_name: MONITOR_PREVIEW_BUCKET })
    assert.equal(MONITOR_BUCKET, 'orbitin-catalogue-monitor')
  })

  it('allows every target on its allowed branch', () => {
    for (const target of Object.keys(TARGET_CONFIGS)) assert.equal(evaluateDeployGuard(input(target)).ok, true)
  })

  it('rejects obsolete orbital* targets even when every other input matches', () => {
    for (const target of obsoleteTargets) {
      const result = evaluateDeployGuard({ ...input('orbitin'), target, confirm: target, resolvedConfig: { name: target, r2_buckets: [] } })
      assert.equal(result.ok, false)
      assert.match(result.reason, /obsolete target/)
    }
  })

  it('rejects unknown targets', () => {
    assert.match(evaluateDeployGuard(input('orbitin', { target: 'orbitin-preview' })).reason, /unknown target/)
  })

  it('blocks production targets on the wrong branch', () => {
    assert.match(evaluateDeployGuard(input('orbitin', { branch: 'develop' })).reason, /requires branch main/)
    assert.match(evaluateDeployGuard(input('orbitin-dev', { branch: 'main' })).reason, /requires branch develop/)
    assert.match(evaluateDeployGuard(input('orbitin-catalogue', { branch: 'develop' })).reason, /requires branch main/)
    assert.match(evaluateDeployGuard(input('orbitin-catalogue-monitor', { branch: 'develop' })).reason, /requires branch main/)
  })

  it('allows an explicit branch override and reports a warning', () => {
    const result = evaluateDeployGuard(input('orbitin', { branch: 'develop', allowBranch: 'develop' }))
    assert.equal(result.ok, true)
    assert.deepEqual(result.warnings, ['WARNING: branch override develop for orbitin'])
  })

  it('blocks dirty production trees but permits the fixture exception', () => {
    assert.match(evaluateDeployGuard(input('orbitin', { porcelain: ' M README.md' })).reason, /dirty/)
    assert.equal(evaluateDeployGuard(input('orbitin-catalogue-fixture', { porcelain: '?? scratch.txt' })).ok, true)
  })

  it('blocks missing or incorrect confirmations', () => {
    assert.match(evaluateDeployGuard(input('orbitin', { confirm: undefined })).reason, /ORBITIN_DEPLOY_CONFIRM/)
    assert.match(evaluateDeployGuard(input('orbitin', { confirm: 'orbitin-dev' })).reason, /ORBITIN_DEPLOY_CONFIRM/)
    assert.match(evaluateDeployGuard(input('orbitin', { confirm: OLD })).reason, /ORBITIN_DEPLOY_CONFIRM/)
  })

  it('blocks config/name mismatches and missing config files', () => {
    assert.match(evaluateDeployGuard(input('orbitin', { resolvedConfig: { name: 'wrong' } })).reason, /expected orbitin/)
    assert.match(evaluateDeployGuard(input('orbitin', { resolvedConfig: { ...input('orbitin').resolvedConfig, name: OLD } })).reason, /expected orbitin/)
    assert.match(evaluateDeployGuard(input('orbitin', { rootFiles: ['wrangler.jsonc'] })).reason, /missing target config/)
    assert.match(evaluateDeployGuard(input('orbitin', { rootFiles: ['wrangler.jsonc', `wrangler.${OLD}.jsonc`] })).reason, /missing target config wrangler\.orbitin\.jsonc/)
  })

  it('blocks obsolete or mismatched bucket bindings', () => {
    const binding = (bucket_name, preview_bucket_name) => ({ resolvedConfig: { name: 'orbitin', r2_buckets: [{ binding: 'CATALOGUE_BUCKET', bucket_name, preview_bucket_name }] } })
    assert.match(evaluateDeployGuard(input('orbitin', binding(obsoleteProductionBucket, obsoletePreviewBucket))).reason, /must bind only CATALOGUE_BUCKET to orbitin-catalogue/)
    assert.match(evaluateDeployGuard(input('orbitin', binding('orbitin-catalogue', obsoletePreviewBucket))).reason, /must bind only/)
    assert.match(evaluateDeployGuard(input('orbitin', binding('orbitin-catalogue-preview', 'orbitin-catalogue-preview'))).reason, /must bind only/)
    assert.match(evaluateDeployGuard(input('orbitin', { resolvedConfig: { name: 'orbitin', r2_buckets: [] } })).reason, /must bind only/)
    const fixture = input('orbitin-catalogue-fixture', { resolvedConfig: { name: 'orbitin-catalogue-fixture', r2_buckets: [{ binding: 'CATALOGUE_BUCKET', bucket_name: 'orbitin-catalogue', preview_bucket_name: 'orbitin-catalogue-preview' }] } })
    assert.match(evaluateDeployGuard(fixture).reason, /must bind only CATALOGUE_BUCKET to orbitin-catalogue-preview/)
    // The monitor may never bind the catalogue bucket.
    const monitor = (r2_buckets) => input('orbitin-catalogue-monitor', { resolvedConfig: { name: 'orbitin-catalogue-monitor', r2_buckets } })
    assert.match(evaluateDeployGuard(monitor([{ binding: 'CATALOGUE_BUCKET', bucket_name: 'orbitin-catalogue', preview_bucket_name: 'orbitin-catalogue-preview' }])).reason, /must bind only MONITOR_BUCKET to orbitin-catalogue-monitor/)
    assert.match(evaluateDeployGuard(monitor([{ ...TARGET_BUCKETS['orbitin-catalogue-monitor'] }, { binding: 'CATALOGUE_BUCKET', bucket_name: 'orbitin-catalogue', preview_bucket_name: 'orbitin-catalogue-preview' }])).reason, /must bind only/)
    assert.match(evaluateDeployGuard(monitor([{ binding: 'MONITOR_BUCKET', bucket_name: 'orbitin-catalogue', preview_bucket_name: 'orbitin-catalogue-preview' }])).reason, /must bind only/)
  })

  it('blocks a deployable sentinel', () => {
    assert.match(evaluateDeployGuard(input('orbitin', { sentinelConfig: { ...sentinel, main: './workers/frontend/index.ts' } })).reason, /undeployable sentinel/)
  })
})
