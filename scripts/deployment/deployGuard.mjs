import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { unstable_readConfig } from 'wrangler'

export const TARGET_CONFIGS = Object.freeze({
  orbitin: 'wrangler.orbitin.jsonc',
  'orbitin-dev': 'wrangler.orbitin-dev.jsonc',
  'orbitin-catalogue': 'wrangler.catalogue.jsonc',
  'orbitin-catalogue-fixture': 'wrangler.catalogue-fixture.jsonc',
  'orbitin-catalogue-monitor': 'wrangler.catalogue-monitor.jsonc',
})

export const PRODUCTION_BUCKET = 'orbitin-catalogue'
export const PREVIEW_BUCKET = 'orbitin-catalogue-preview'
/** The monitor's own buckets. It never binds the
 *  catalogue bucket. */
export const MONITOR_BUCKET = 'orbitin-catalogue-monitor'
export const MONITOR_PREVIEW_BUCKET = 'orbitin-catalogue-monitor-preview'

/** The only R2 binding each target may deploy with. The fixture never names
 * the production bucket, not even as its local preview bucket, and the
 * monitor binds only its own bucket. */
export const TARGET_BUCKETS = Object.freeze({
  orbitin: { binding: 'CATALOGUE_BUCKET', bucket_name: PRODUCTION_BUCKET, preview_bucket_name: PREVIEW_BUCKET },
  'orbitin-dev': { binding: 'CATALOGUE_BUCKET', bucket_name: PRODUCTION_BUCKET, preview_bucket_name: PREVIEW_BUCKET },
  'orbitin-catalogue': { binding: 'CATALOGUE_BUCKET', bucket_name: PRODUCTION_BUCKET, preview_bucket_name: PREVIEW_BUCKET },
  'orbitin-catalogue-fixture': { binding: 'CATALOGUE_BUCKET', bucket_name: PREVIEW_BUCKET, preview_bucket_name: PREVIEW_BUCKET },
  'orbitin-catalogue-monitor': { binding: 'MONITOR_BUCKET', bucket_name: MONITOR_BUCKET, preview_bucket_name: MONITOR_PREVIEW_BUCKET },
})

const TARGET_BRANCHES = Object.freeze({ orbitin: 'main', 'orbitin-dev': 'develop', 'orbitin-catalogue': 'main', 'orbitin-catalogue-monitor': 'main' })
const SENTINEL = 'wrangler.jsonc'

/** Pure deploy pairing and safety checks. It performs no filesystem, Git or
 * network access; the CLI gathers the inputs and this function decides. */
export function evaluateDeployGuard({ target, branch, porcelain, confirm, allowBranch, rootFiles, resolvedConfig, sentinelConfig, head = 'unknown' }) {
  if (typeof target === 'string' && target.startsWith('orbital')) return { ok: false, reason: `obsolete target ${target}; Orbitin Worker targets are ${Object.keys(TARGET_CONFIGS).join(', ')}` }
  if (!Object.hasOwn(TARGET_CONFIGS, target)) return { ok: false, reason: `unknown target ${target}` }
  const configFile = TARGET_CONFIGS[target]
  const files = new Set(rootFiles)
  if (!files.has(configFile)) return { ok: false, reason: `missing target config ${configFile}` }
  if (!resolvedConfig || resolvedConfig.name !== target) return { ok: false, reason: `config ${configFile} resolves to ${resolvedConfig?.name ?? 'no name'}, expected ${target}` }
  const buckets = resolvedConfig.r2_buckets ?? []
  const expectedBucket = TARGET_BUCKETS[target]
  if (buckets.length !== 1 || buckets[0].binding !== expectedBucket.binding || buckets[0].bucket_name !== expectedBucket.bucket_name || buckets[0].preview_bucket_name !== expectedBucket.preview_bucket_name) return { ok: false, reason: `config ${configFile} must bind only ${expectedBucket.binding} to ${expectedBucket.bucket_name} (preview ${expectedBucket.preview_bucket_name})` }
  if (!files.has(SENTINEL) || files.has('wrangler.json') || files.has('wrangler.toml')) return { ok: false, reason: 'root Wrangler config set is not the sentinel plus target configs' }
  if (!sentinelConfig || sentinelConfig.name !== 'orbitin-select-worker-config' || sentinelConfig.main || sentinelConfig.assets || (sentinelConfig.r2_buckets?.length ?? 0) > 0 || (sentinelConfig.triggers?.crons?.length ?? 0) > 0) return { ok: false, reason: 'wrangler.jsonc is not an undeployable sentinel' }

  const requiredBranch = TARGET_BRANCHES[target]
  if (requiredBranch && branch !== requiredBranch && allowBranch !== branch) return { ok: false, reason: `${target} requires branch ${requiredBranch}, current branch is ${branch}` }
  const warnings = requiredBranch && branch !== requiredBranch ? [`WARNING: branch override ${branch} for ${target}`] : []
  if (porcelain && target !== 'orbitin-catalogue-fixture') return { ok: false, reason: 'working tree is dirty' }
  if (confirm !== target) return { ok: false, reason: `ORBITIN_DEPLOY_CONFIRM must equal ${target}` }

  const bindings = buckets.map((binding) => `${binding.binding}=${binding.bucket_name ?? '<preview>'}`).join(', ') || 'none'
  const crons = resolvedConfig.triggers?.crons?.join(', ') || 'none'
  const varNames = Object.keys(resolvedConfig.vars ?? {}).join(', ') || 'none'
  const summary = [`target: ${target}`, `config: ${configFile}`, `branch: ${branch}`, `commit: ${head}`, `R2: ${bindings}`, `crons: ${crons}`, `vars: ${varNames}`].join('\n')
  return { ok: true, summary, warnings }
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

async function main() {
  const target = process.argv[2]
  const configFile = TARGET_CONFIGS[target]
  if (!configFile) {
    console.error(`DEPLOY BLOCKED: ${target?.startsWith('orbital') ? 'obsolete' : 'unknown'} target ${target ?? '<missing>'}`)
    process.exitCode = 1
    return
  }
  try {
    const rootFiles = readdirSync(process.cwd())
    if (!existsSync(path.resolve(process.cwd(), configFile))) throw new Error(`missing target config ${configFile}`)
    const resolvedConfig = await unstable_readConfig({ config: configFile })
    const sentinelConfig = await unstable_readConfig({ config: SENTINEL })
    const result = evaluateDeployGuard({
      target,
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      porcelain: git(['status', '--porcelain']),
      confirm: process.env.ORBITIN_DEPLOY_CONFIRM,
      allowBranch: process.env.ORBITIN_DEPLOY_ALLOW_BRANCH,
      rootFiles,
      resolvedConfig,
      sentinelConfig,
      head: git(['rev-parse', 'HEAD']),
    })
    if (!result.ok) {
      console.error(`DEPLOY BLOCKED: ${result.reason}`)
      process.exitCode = 1
      return
    }
    for (const warning of result.warnings) console.warn(warning)
    console.log(result.summary)
  } catch (error) {
    console.error(`DEPLOY BLOCKED: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
