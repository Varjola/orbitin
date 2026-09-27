import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const targets = {
  orbitin: { frontend: true, allowed: ['workers/frontend/index.ts', 'workers/frontend/usageEventSchema.ts', 'workers/shared/serve.ts', 'workers/shared/types.ts'] },
  'orbitin-dev': { frontend: true, allowed: ['workers/frontend/index.ts', 'workers/frontend/usageEventSchema.ts', 'workers/shared/serve.ts', 'workers/shared/types.ts'] },
  'orbitin-catalogue': { frontend: false },
  'orbitin-catalogue-fixture': { frontend: false },
  'orbitin-catalogue-monitor': { monitor: true, allowed: ['workers/catalogue-monitor/index.ts', 'workers/catalogue-monitor/monitor.ts', 'workers/shared/alertMail.ts', 'workers/shared/types.ts'] },
}
/** The monitor never carries producer, provider or catalogue code. */
const forbiddenMonitor = ['SPACETRACK_', 'space-track.org', 'runIngestion', 'runGpSweepStep', 'publishSnapshotParts', 'CATALOGUE_BUCKET', 'catalog/v1/']
const forbiddenFrontend = ['SPACETRACK_', 'space-track.org', 'runIngestion', 'runGpSweepStep', 'publishSnapshotParts', 'acquireLease', 'cleanupOldSnapshots', 'satellite.js', 'catalog/v1/control']
const buildStartedAt = Number(process.env.ORBITIN_BUILD_WORKER_STARTED_AT ?? Date.now() - 10 * 60_000)

function relative(input) {
  const absolute = path.isAbsolute(input) ? input : path.resolve(root, input)
  return path.relative(root, absolute).split(path.sep).join('/')
}
function metaFor(name) {
  const file = path.join(root, '.wrangler', 'dry-run', name, 'bundle-meta.json')
  assert.ok(statSync(file).mtimeMs >= buildStartedAt, `${name} metafile is stale`)
  return { file, meta: JSON.parse(readFileSync(file, 'utf8')) }
}
function outputText(meta, name) {
  const output = Object.keys(meta.outputs ?? {}).find((key) => key.endsWith('index.js') && !key.endsWith('.map'))
  assert.ok(output, `${name} has no index.js output`)
  return readFileSync(path.isAbsolute(output) ? output : path.resolve(root, output), 'utf8')
}

for (const [name, options] of Object.entries(targets)) {
  const { meta } = metaFor(name)
  const inputs = Object.keys(meta.inputs ?? {}).map(relative)
  if (options.monitor) {
    assert.ok(inputs.includes('workers/catalogue-monitor/index.ts'), `${name} monitor entry missing`)
    assert.ok(inputs.every((input) => options.allowed.includes(input)), `${name} has an unexpected bundle input`)
    const output = outputText(meta, name)
    for (const token of forbiddenMonitor) assert.equal(output.includes(token), false, `${name} bundle contains ${token}`)
  } else if (options.frontend) {
    assert.ok(inputs.includes('workers/frontend/index.ts'), `${name} frontend entry missing`)
    assert.ok(inputs.includes('workers/shared/serve.ts'), `${name} shared serving module missing`)
    assert.ok(inputs.every((input) => options.allowed.includes(input)), `${name} has an unexpected bundle input`)
    const output = outputText(meta, name)
    for (const token of forbiddenFrontend) assert.equal(output.includes(token), false, `${name} bundle contains ${token}`)
  } else {
    for (const required of ['workers/catalogue/index.ts', 'workers/catalogue/gpSweep.ts', 'workers/catalogue/publish.ts', 'workers/catalogue/provider/spaceTrack.ts']) assert.ok(inputs.includes(required), `${name} missing ${required}`)
    assert.equal(inputs.includes('workers/shared/serve.ts'), false, `${name} bundles frontend serving`)
    assert.equal(inputs.some((input) => input.startsWith('workers/frontend/')), false, `${name} bundles frontend code`)
  }
  console.log(`${name}: ${inputs.sort().join(', ')}`)
}
