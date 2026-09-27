import { expect, it } from 'vitest'

// The Worker tsconfig has no Node types, hence the typed dynamic import.
interface DirectoryEntry { readonly name: string; isDirectory(): boolean }
const nodeFs = 'node:fs'
const { readdirSync, readFileSync } = await import(/* @vite-ignore */ nodeFs) as {
  readdirSync(path: URL, options: { withFileTypes: true }): DirectoryEntry[]
  readFileSync(path: URL, encoding: 'utf8'): string
}

const ROOT = new URL('../../', import.meta.url)
const SCANNED_DIRECTORIES = ['workers/', 'scripts/', 'docs/', 'src/', 'public/']
const EXCLUDED = new Set(['node_modules', 'dist', 'dist-ssr', '.wrangler', '.git'])
const TEXT = /\.(?:[cm]?[jt]s|jsonc?|md|html|css|toml|ya?ml|txt|example)$/
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
/** Reserved documentation and test domains (RFC 2606). */
const PLACEHOLDER = /@example\.(?:com|org|net|invalid)$/

function files(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (EXCLUDED.has(entry.name)) return []
    if (entry.isDirectory()) return files(new URL(`${entry.name}/`, directory))
    return TEXT.test(entry.name) ? [new URL(entry.name, directory)] : []
  })
}

/** The alert recipient and sender are Worker secrets.
 *  No real address may reach the public repository, so a clone can never
 *  learn, or mail, the operator's. */
it('contains no e-mail address other than reserved placeholders', () => {
  const rootFiles = readdirSync(ROOT, { withFileTypes: true }).filter((entry) => !entry.isDirectory() && (/^wrangler.*\.jsonc?$/.test(entry.name) || /\.md$/.test(entry.name) || entry.name === 'package.json')).map((entry) => new URL(entry.name, ROOT))
  const scanned = [...rootFiles, ...SCANNED_DIRECTORIES.flatMap((directory) => files(new URL(directory, ROOT)))]
  expect(scanned.length).toBeGreaterThan(100)
  const hits = scanned.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(ADDRESS)].map((match) => match[0]).filter((address) => !PLACEHOLDER.test(address)).map((address) => `${file.pathname.slice(ROOT.pathname.length)}: ${address}`))
  expect(hits).toEqual([])
})
