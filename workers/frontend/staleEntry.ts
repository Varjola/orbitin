/** Recovery for a page that asks for a page bundle which no longer exists.
 *
 * Each release gives the page bundle a new name (`/assets/index-<hash>.js`)
 * and the previous release's files are no longer served. A browser that shows
 * a page from its own cache without asking for a fresh copy, as iOS Safari
 * does when it restores a tab or opens a Home Screen icon, then asks for the
 * old name. The 404 page it would get is HTML, which the browser refuses to
 * run as a script, so the page stays on its first loading screen until the
 * learner reloads it.
 *
 * In its place the Worker answers with a short script that does that reload
 * once. A reload asks for a fresh page, which names the current bundle. If the
 * page was already a reload, or the browser cannot say, it shows a message
 * with a Reload button instead, so it can never reload in a loop. */

/** The page bundle Vite names after `index.html`. Other scripts (Web Worker
 * and transcoder chunks) keep their 404: they are not run by the page. */
const PAGE_BUNDLE_PATH = /^\/assets\/index-[\w-]+\.js$/

export function isPageBundlePath(pathname: string): boolean {
  return PAGE_BUNDLE_PATH.test(pathname)
}

/** Plain browser script, no imports: it runs as the old page's module. It
 * reads the language the learner chose, never writes anything, and builds
 * its message with DOM calls and inline styles that the site's
 * Content-Security-Policy allows. */
export const STALE_PAGE_RECOVERY_SCRIPT = `// Orbitin has been updated since this page was saved by the browser.
(() => {
  if (typeof document === 'undefined') return
  const entry = typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('navigation')[0] : undefined
  const legacy = performance.navigation
  const type = entry ? entry.type : legacy ? (legacy.type === 1 ? 'reload' : 'navigate') : null
  if (type !== null && type !== 'reload') { location.reload(); return }
  let fi = false
  try { fi = localStorage.getItem('orbitin.locale') === 'fi' } catch { fi = false }
  const words = fi
    ? { title: 'Orbitin on päivittynyt', detail: 'Lataa sivu uudelleen avataksesi uuden version.', action: 'Lataa uudelleen' }
    : { title: 'Orbitin has been updated', detail: 'Reload the page to open the new version.', action: 'Reload' }
  const show = () => {
    const root = document.getElementById('app') || document.body
    const card = document.createElement('div')
    card.setAttribute('role', 'alert')
    card.style.cssText = 'position:fixed;inset:0;display:grid;place-content:center;justify-items:center;gap:12px;padding:24px;background:#01050b;color:#edf4ff;font:16px/1.5 system-ui,-apple-system,sans-serif;text-align:center'
    const title = document.createElement('strong'); title.textContent = words.title
    const detail = document.createElement('p'); detail.textContent = words.detail; detail.style.cssText = 'margin:0;color:#b9c9da'
    const button = document.createElement('button'); button.type = 'button'; button.textContent = words.action
    button.style.cssText = 'margin-top:8px;padding:10px 22px;border:1px solid #72d7e5;border-radius:999px;background:transparent;color:#a9f3fa;font:inherit;cursor:pointer'
    button.addEventListener('click', () => location.reload())
    card.append(title, detail, button)
    root.replaceChildren(card)
    button.focus()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show()
})()
`

export function stalePageRecoveryResponse(method: string): Response {
  return new Response(method === 'HEAD' ? null : STALE_PAGE_RECOVERY_SCRIPT, {
    status: 200,
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
