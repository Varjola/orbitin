import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { experimental_readRawConfig, unstable_readConfig } from 'wrangler'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const configs = ['wrangler.jsonc', 'wrangler.orbitin.jsonc', 'wrangler.orbitin-dev.jsonc', 'wrangler.catalogue.jsonc', 'wrangler.catalogue-fixture.jsonc', 'wrangler.catalogue-monitor.jsonc']
const frontendConfigs = ['wrangler.orbitin.jsonc', 'wrangler.orbitin-dev.jsonc']
const expectedNames = { 'wrangler.orbitin.jsonc': 'orbitin', 'wrangler.orbitin-dev.jsonc': 'orbitin-dev', 'wrangler.catalogue.jsonc': 'orbitin-catalogue', 'wrangler.catalogue-fixture.jsonc': 'orbitin-catalogue-fixture', 'wrangler.catalogue-monitor.jsonc': 'orbitin-catalogue-monitor' }
const permanentWorkers = ['orbitin', 'orbitin-dev', 'orbitin-catalogue', 'orbitin-catalogue-monitor']
const productionBucket = { binding: 'CATALOGUE_BUCKET', bucket_name: 'orbitin-catalogue', preview_bucket_name: 'orbitin-catalogue-preview' }
const previewBucket = { binding: 'CATALOGUE_BUCKET', bucket_name: 'orbitin-catalogue-preview', preview_bucket_name: 'orbitin-catalogue-preview' }
const monitorBucket = { binding: 'MONITOR_BUCKET', bucket_name: 'orbitin-catalogue-monitor', preview_bucket_name: 'orbitin-catalogue-monitor-preview' }
/** The alert binding carries no address. */
const alertBinding = [{ name: 'CATALOGUE_ALERT_EMAIL' }]
// Obsolete runtime names, built from parts so this file does not match its own scan.
const OLD = 'orbital'
const obsoleteBuckets = [`${OLD}-education-tool-catalogue`, `${OLD}-education-tool-catalogue-preview`]
const obsoleteRuntimePatterns = [
  new RegExp(`${OLD}-education-tool`),
  new RegExp(`\\b${OLD}-(?:dev|catalogue)\\b`),
  new RegExp(`wrangler\\.${OLD}`),
  new RegExp(`(?:deploy|build:worker|dry-run)[:/]${OLD}\\b`),
  new RegExp(`--name ${OLD}\\b`),
  new RegExp(`//${OLD}(?:-dev)?\\.`),
  new RegExp(`\\b${OLD}\\.[a-z0-9<>-]+\\.workers\\.dev`),
]

function raw(name) {
  return experimental_readRawConfig({ config: path.join(root, name) }).rawConfig
}
async function resolved(name) { return unstable_readConfig({ config: path.join(root, name) }) }
function withoutName(value) { const copy = structuredClone(value); delete copy.name; return copy }
function withoutFrontendPreviewSettings(value) {
  const copy = withoutName(value)
  delete copy.workers_dev
  delete copy.preview_urls
  delete copy.previews
  delete copy.analytics_engine_datasets
  return copy
}
function assertNoKeys(value, keys, label) { for (const key of keys) assert.equal(Object.hasOwn(value, key), false, `${label} unexpectedly declares ${key}`) }

test('C1 sentinel is present and undeployable', async () => {
  const config = raw('wrangler.jsonc')
  const result = await resolved('wrangler.jsonc')
  assert.equal(config.name, 'orbitin-select-worker-config')
  assert.equal(result.name, 'orbitin-select-worker-config')
  assert.equal(result.main, undefined)
  assert.equal(result.assets, undefined)
  assert.deepEqual(result.r2_buckets, [])
  assert.deepEqual(result.triggers?.crons ?? [], [])
})

test('C2 root Wrangler files are exactly the sentinel and five worker configs', () => {
  const files = readdirSync(root).filter((name) => /^wrangler.*\.(jsonc?|toml)$/.test(name)).sort()
  assert.deepEqual(files, configs.slice().sort())
})

test('C3 each worker config resolves to its canonical Orbitin name', async () => {
  for (const name of configs.slice(1)) {
    assert.equal(raw(name).name, expectedNames[name])
    assert.equal((await resolved(name)).name, expectedNames[name])
  }
})

test('C4 frontend configurations are explicit apart from approved preview settings', async () => {
  for (const name of frontendConfigs) {
    const config = raw(name)
    const result = await resolved(name)
    const isDevelopment = name === 'wrangler.orbitin-dev.jsonc'
    assert.match(result.main, /workers[\\/]frontend[\\/]index\.ts$/)
    assert.deepEqual(result.assets, { directory: './dist', binding: 'ASSETS', not_found_handling: '404-page', run_worker_first: ['/catalog/*', '/events/*'] })
    // The anonymous event sink writes to one dataset per Worker.
    assert.deepEqual(config.analytics_engine_datasets, [{ binding: 'USAGE_EVENTS', dataset: isDevelopment ? 'orbitin_dev_events' : 'orbitin_events' }])
    assert.deepEqual(config.triggers?.crons, [])
    assert.deepEqual(result.vars, {})
    assert.deepEqual(result.r2_buckets, [productionBucket])
    // Production is served only on its custom domain; the development
    // frontend has no domain and stays on workers.dev.
    assert.equal(result.workers_dev, isDevelopment)
    assert.equal(result.preview_urls, isDevelopment)
    if (isDevelopment) {
      assert.deepEqual(config.previews, { r2_buckets: [{ binding: 'CATALOGUE_BUCKET', bucket_name: 'orbitin-catalogue' }] })
    } else {
      assert.equal(Object.hasOwn(config, 'previews'), false)
    }
    assertNoKeys(config, ['routes', 'route', 'services', 'kv_namespaces', 'd1_databases', 'durable_objects', 'queues', 'env'], name)
  }
})

test('C5 frontend raw configurations otherwise differ only by name', () => {
  assert.deepEqual(withoutFrontendPreviewSettings(raw('wrangler.orbitin.jsonc')), withoutFrontendPreviewSettings(raw('wrangler.orbitin-dev.jsonc')))
})

test('C6 catalogue configuration owns the production producer settings', async () => {
  const config = raw('wrangler.catalogue.jsonc')
  const result = await resolved('wrangler.catalogue.jsonc')
  assert.match(result.main, /workers[\\/]catalogue[\\/]index\.ts$/)
  assert.equal(result.assets, undefined)
  assert.deepEqual(config.triggers?.crons, ['17 * * * *'])
  // The curated supplement changes the sweep, so its revision.
  assert.deepEqual(config.vars, { CATALOGUE_ENABLED: 'true', CATALOGUE_PROVIDER: 'space-track', CATALOGUE_RETRIEVAL: 'gp-sweep', CATALOGUE_CONFIG_REVISION: 'space-track-gp-sweep-2' })
  assert.deepEqual(result.r2_buckets, [productionBucket])
  assert.equal(result.workers_dev, false)
  assert.equal(result.preview_urls, false)
  assert.deepEqual(config.send_email, alertBinding)
  assert.deepEqual(config.tail_consumers, [{ service: 'orbitin-catalogue-monitor' }])
  assertNoKeys(config, ['routes', 'route', 'env'], 'catalogue')
})

test('C6a monitor configuration binds only its own bucket and the alert binding', async () => {
  const config = raw('wrangler.catalogue-monitor.jsonc')
  const result = await resolved('wrangler.catalogue-monitor.jsonc')
  assert.match(result.main, /workers[\\/]catalogue-monitor[\\/]index\.ts$/)
  assert.equal(result.assets, undefined)
  assert.deepEqual(config.triggers?.crons, ['47 * * * *'])
  assert.deepEqual(result.vars, {})
  assert.deepEqual(result.r2_buckets, [monitorBucket])
  assert.deepEqual(config.send_email, alertBinding)
  assert.equal(result.workers_dev, false)
  assert.equal(result.preview_urls, false)
  assert.equal(readFileSync(path.join(root, 'wrangler.catalogue-monitor.jsonc'), 'utf8').includes('"orbitin-catalogue"'), false)
  assertNoKeys(config, ['routes', 'route', 'env', 'tail_consumers', 'services', 'kv_namespaces', 'd1_databases', 'durable_objects', 'queues'], 'monitor')
})

test('C6b no configuration puts an address in an alert binding, and only the producer and monitor declare one', () => {
  for (const name of configs) {
    const config = raw(name)
    for (const binding of config.send_email ?? []) assertNoKeys(binding, ['destination_address', 'allowed_destination_addresses', 'allowed_sender_addresses'], name)
  }
  assert.deepEqual(configs.filter((name) => raw(name).send_email !== undefined), ['wrangler.catalogue.jsonc', 'wrangler.catalogue-monitor.jsonc'])
  assert.deepEqual(configs.filter((name) => raw(name).tail_consumers !== undefined), ['wrangler.catalogue.jsonc'])
})

test('C7 fixture configuration is preview-only and fixture-backed', async () => {
  const text = readFileSync(path.join(root, 'wrangler.catalogue-fixture.jsonc'), 'utf8')
  const config = raw('wrangler.catalogue-fixture.jsonc')
  const result = await resolved('wrangler.catalogue-fixture.jsonc')
  assert.equal(config.name, 'orbitin-catalogue-fixture')
  assert.match(result.main, /workers[\\/]catalogue[\\/]index\.ts$/)
  assert.deepEqual(config.triggers?.crons, [])
  assert.equal(config.vars.CATALOGUE_PROVIDER, 'fixture')
  assert.equal(Object.hasOwn(config.vars, 'CATALOGUE_TEST_FAULT'), false)
  assert.deepEqual(result.r2_buckets, [previewBucket])
  assert.equal(text.includes('"orbitin-catalogue"'), false)
  for (const bucket of result.r2_buckets) for (const value of [bucket.bucket_name, bucket.preview_bucket_name]) assert.equal(value, 'orbitin-catalogue-preview')
  assert.equal(result.workers_dev, false)
})

test('C8 only the catalogue and monitor configs have a cron, and only the catalogue a live provider', () => {
  const nonEmptyCron = configs.filter((name) => (raw(name).triggers?.crons?.length ?? 0) > 0)
  assert.deepEqual(nonEmptyCron, ['wrangler.catalogue.jsonc', 'wrangler.catalogue-monitor.jsonc'])
  assert.deepEqual(configs.filter((name) => raw(name).vars?.CATALOGUE_PROVIDER === 'space-track'), ['wrangler.catalogue.jsonc'])
  for (const name of configs) {
    const config = raw(name)
    for (const bucket of config.r2_buckets ?? []) assert.notEqual(bucket.remote, true)
    assert.doesNotMatch(readFileSync(path.join(root, name), 'utf8'), /SPACETRACK_(?:IDENTITY|PASSWORD)=/)
  }
})

test('C9 worker configs share compatibility date and observability', async () => {
  const results = await Promise.all(configs.slice(1).map(resolved))
  assert.equal(new Set(results.map((config) => config.compatibility_date)).size, 1)
  for (const config of results) assert.equal(config.observability?.enabled, true)
})

test('C10 scripts always select an explicit worker config and guard deployments', () => {
  const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts
  for (const [name, command] of Object.entries(scripts)) {
    if (/wrangler (?:deploy|dev|versions|triggers)/.test(command)) assert.match(command, /-c wrangler\.(?:orbitin|orbitin-dev|catalogue|catalogue-fixture|catalogue-monitor)\.jsonc/)
    if (name.startsWith('deploy:')) {
      const target = name.startsWith('deploy:catalogue') ? `orbitin-${name.slice('deploy:'.length)}` : name.slice('deploy:'.length)
      assert.match(command, new RegExp(`^node scripts/deployment/deployGuard\\.mjs ${target}(?: |$)`))
    }
    assert.equal(/wrangler dev .*wrangler\.catalogue\.jsonc/.test(command), false)
  }
})

test('C11 Worker names are exactly the canonical Orbitin names', () => {
  const names = configs.slice(1).map((name) => raw(name).name)
  assert.deepEqual(names.slice().sort(), ['orbitin', 'orbitin-catalogue', 'orbitin-catalogue-fixture', 'orbitin-catalogue-monitor', 'orbitin-dev'])
  assert.deepEqual(names.filter((name) => !name.endsWith('-fixture')).sort(), permanentWorkers.slice().sort())
  for (const name of [raw('wrangler.jsonc').name, ...names]) assert.equal(name.startsWith(OLD), false, `${name} uses an obsolete Worker name`)
  assert.equal(readdirSync(root).some((name) => name.startsWith(`wrangler.${OLD}`)), false)
})

test('C12 no deployable config or script references an obsolete name; bindings use the canonical buckets', async () => {
  for (const name of configs) {
    const text = readFileSync(path.join(root, name), 'utf8')
    for (const bucket of obsoleteBuckets) assert.equal(text.includes(bucket), false, `${name} references ${bucket}`)
    assert.equal(new RegExp(`\\b${OLD}`).test(text), false, `${name} mentions an obsolete runtime name`)
    for (const bucket of (await resolved(name)).r2_buckets) {
      if (bucket.binding === 'MONITOR_BUCKET') {
        assert.deepEqual({ ...bucket }, monitorBucket)
        continue
      }
      assert.match(bucket.bucket_name, /^orbitin-catalogue(?:-preview)?$/)
      assert.equal(bucket.preview_bucket_name, 'orbitin-catalogue-preview')
    }
  }
  const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts
  for (const [name, command] of Object.entries(scripts)) {
    assert.equal(name.includes(OLD), false, `script ${name} uses an obsolete name`)
    assert.equal(command.includes(OLD), false, `script ${name} uses an obsolete name`)
  }
  for (const target of ['orbitin', 'orbitin-dev']) assert.match(scripts[`deploy:${target}`], new RegExp(`-c wrangler\\.${target}\\.jsonc$`))
})

const scanExcludedDirectories = new Set(['.git', 'node_modules', 'dist', 'dist-ssr', '.wrangler', 'assets-source', 'coverage'])
const scanExtensions = /\.(?:[cm]?[jt]s|jsonc?|md|html|css|toml|ya?ml|example)$/
function activeTextFiles(directory = root) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!scanExcludedDirectories.has(entry.name)) files.push(...activeTextFiles(full))
    } else if (scanExtensions.test(entry.name) && entry.name !== 'package-lock.json' && statSync(full).size < 2_000_000) {
      files.push(full)
    }
  }
  return files
}

test('C13 no active source, config, script, test or document uses an obsolete runtime name', () => {
  const hits = []
  for (const file of activeTextFiles()) {
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (obsoleteRuntimePatterns.some((pattern) => pattern.test(line))) hits.push(`${path.relative(root, file).split(path.sep).join('/')}:${index + 1}: ${line.trim()}`)
    })
  }
  assert.deepEqual(hits, [])
})
