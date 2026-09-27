import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const projectRoot = dirname(fileURLToPath(import.meta.url))
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function readProductVersion(root = projectRoot) {
  const path = resolve(root, 'VERSION')
  let version
  try {
    version = readFileSync(path, 'utf8').trim()
  } catch (error) {
    throw new Error(`Orbitin product version could not be read from ${path}. Add a VERSION file containing a semantic version such as 0.14.0.`, { cause: error })
  }
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid Orbitin product version in ${path}: ${JSON.stringify(version)}. VERSION must contain only a semantic version such as 0.14.0.`)
  }
  return version
}

function runGit(root) {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

export function resolveGitRevision(root = projectRoot, git = runGit) {
  try {
    const revision = git(root).trim()
    return /^[0-9a-f]+$/i.test(revision) ? revision : 'unknown'
  } catch {
    return 'unknown'
  }
}

export function buildEnvironment(mode) {
  return mode === 'development' ? 'development' : mode === 'production' ? 'production' : mode
}

/** Anonymous usage and error events are on in builds unless
 * `VITE_ORBITIN_USAGE_EVENTS=off`; they only ever go to the site's own
 * `/events/v1`, which stores nothing without an Analytics Engine binding. */
export function usageEventsEnabled(value) {
  return value === undefined || value === '' ? true : value !== 'off'
}

const WEB_ANALYTICS_TOKEN = /^[0-9a-f]{32}$/

/** The Cloudflare Web Analytics beacon, only when a site token is supplied at
 * build time (`VITE_CF_WEB_ANALYTICS_TOKEN`). The token is not committed, so
 * development servers, tests and forks never report to Orbitin's site. */
export function webAnalyticsSnippet(token) {
  if (!token) return ''
  if (!WEB_ANALYTICS_TOKEN.test(token)) throw new Error('VITE_CF_WEB_ANALYTICS_TOKEN must be the 32-character hexadecimal site token.')
  return `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${token}"}'></script>`
}

export default ({ command, mode }) => {
  const env = loadEnv(mode, projectRoot, 'VITE_')
  const metadata = {
    version: readProductVersion(),
    revision: resolveGitRevision(),
    environment: buildEnvironment(mode),
  }
  const beacon = command === 'build' ? webAnalyticsSnippet(env.VITE_CF_WEB_ANALYTICS_TOKEN) : ''
  return {
    define: {
      __ORBITIN_VERSION__: JSON.stringify(metadata.version),
      __ORBITIN_REVISION__: JSON.stringify(metadata.revision),
      __ORBITIN_ENVIRONMENT__: JSON.stringify(metadata.environment),
      __ORBITIN_USAGE_EVENTS__: JSON.stringify(usageEventsEnabled(env.VITE_ORBITIN_USAGE_EVENTS)),
    },
    plugins: [{
      name: 'orbitin-web-analytics',
      transformIndexHtml: (html) => beacon ? html.replace('</body>', `  ${beacon}\n  </body>`) : html,
    }],
  }
}
