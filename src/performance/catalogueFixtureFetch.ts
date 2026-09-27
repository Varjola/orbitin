import { buildAutomaticSnapshotFixture, servedSnapshotPayloads, type SyntheticRecordSpec } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { FEATURED_PICKS } from '../data/featuredPicks.ts'
import { OFFICIAL_GROUP_BUNDLES } from '../data/officialGroups/index.ts'

declare global {
  interface Window {
    /** Catalogue paths requested while the fixture is served (browser checks). */
    __orbitinCatalogueRequests?: string[]
  }
}

/** The kind of orbit each official group's synthetic members fly, so the
 *  local development catalogue looks like the real one without copying any
 *  provider record. Values are rounded textbook elements. */
type OrbitTemplate = (member: number) => Omit<SyntheticRecordSpec, 'catalogId' | 'name'>

const circular = (meanMotion: number, inclinationDeg: number, planes: number): OrbitTemplate => (member) => ({
  meanMotion, eccentricity: 0.001, inclinationDeg, raanDeg: (member % planes) * (360 / planes), argumentOfPerigeeDeg: 0, meanAnomalyDeg: (member * 47) % 360,
})

const GROUP_ORBITS: Readonly<Record<string, OrbitTemplate>> = {
  'gps-operational': circular(2.00563, 55, 6),
  'galileo-operational': circular(1.70475, 56, 3),
  'glonass-operational': circular(2.13102, 64.8, 3),
  'beidou-operational': (member) => member < 4
    ? { meanMotion: 1.00272, eccentricity: 0.0005, inclinationDeg: 1, raanDeg: 0, argumentOfPerigeeDeg: 0, meanAnomalyDeg: (60 + member * 30) % 360 }
    : member < 9
      ? { meanMotion: 1.00272, eccentricity: 0.003, inclinationDeg: 55, raanDeg: (member % 3) * 120, argumentOfPerigeeDeg: 180, meanAnomalyDeg: (90 + member * 20) % 360 }
      : circular(1.86231, 55, 3)(member),
  'crewed-space-stations': (member) => member === 0
    ? { meanMotion: 15.5, eccentricity: 0.0004, inclinationDeg: 51.6, raanDeg: 40, argumentOfPerigeeDeg: 60, meanAnomalyDeg: 10 }
    : { meanMotion: 15.6, eccentricity: 0.0006, inclinationDeg: 41.5, raanDeg: 200, argumentOfPerigeeDeg: 30, meanAnomalyDeg: 150 },
  'geostationary-weather': (member) => ({ meanMotion: 1.00272, eccentricity: 0.0002, inclinationDeg: member % 4 === 0 ? 4 : 0.05, raanDeg: 70, argumentOfPerigeeDeg: 0, meanAnomalyDeg: (member * 24) % 360 }),
  'copernicus-sentinels': (member) => member === 5 || member === 9
    ? { meanMotion: 12.8093, eccentricity: 0.0008, inclinationDeg: 66.04, raanDeg: 120, argumentOfPerigeeDeg: 270, meanAnomalyDeg: (member * 20) % 360 }
    : { meanMotion: 14.3, eccentricity: 0.0001, inclinationDeg: 98.6, raanDeg: 300 + member * 3, argumentOfPerigeeDeg: 90, meanAnomalyDeg: (member * 36) % 360 },
  'arctic-heo': (member) => ({ meanMotion: 1.504, eccentricity: 0.5645, inclinationDeg: 62.9, raanDeg: 100 + member * 180, argumentOfPerigeeDeg: 269, meanAnomalyDeg: member * 180 }),
}

/** Featured picks outside every group, with their kind of orbit. */
const PICK_ORBITS: Readonly<Record<string, Omit<SyntheticRecordSpec, 'catalogId' | 'name'>>> = {
  hubble: { meanMotion: 15.28, eccentricity: 0.0002, inclinationDeg: 28.5, raanDeg: 150, argumentOfPerigeeDeg: 80, meanAnomalyDeg: 200 },
  'landsat-9': { meanMotion: 14.57, eccentricity: 0.0001, inclinationDeg: 98.2, raanDeg: 330, argumentOfPerigeeDeg: 90, meanAnomalyDeg: 40 },
  'molniya-3-50': { meanMotion: 2.00562, eccentricity: 0.676, inclinationDeg: 63.5, raanDeg: 250, argumentOfPerigeeDeg: 270, meanAnomalyDeg: 10 },
  'vanguard-1': { meanMotion: 10.85, eccentricity: 0.184, inclinationDeg: 34.2, raanDeg: 20, argumentOfPerigeeDeg: 110, meanAnomalyDeg: 300 },
}

/** Local development catalogue: every official group member and featured
 *  pick under its real catalogue id, with synthetic elements and a
 *  `SYNTHETIC` name, so groups, featured picks and common-name search all
 *  work offline. */
export function localDevelopmentRecords(): SyntheticRecordSpec[] {
  const specs = new Map<string, SyntheticRecordSpec>()
  for (const bundle of OFFICIAL_GROUP_BUNDLES) {
    const template = GROUP_ORBITS[bundle.group.id] ?? circular(2, 55, 3)
    bundle.group.membership.catalogIds.forEach((catalogId, member) => {
      specs.set(catalogId, { catalogId, name: `SYNTHETIC ${bundle.group.title.toUpperCase()} ${member + 1}`, ...template(member) })
    })
  }
  for (const pick of FEATURED_PICKS) {
    const orbit = PICK_ORBITS[pick.id]
    if (orbit && !specs.has(pick.catalogId)) specs.set(pick.catalogId, { catalogId: pick.catalogId, name: `SYNTHETIC ${pick.name.toUpperCase()}`, ...orbit })
  }
  return [...specs.values()]
}

/** Development only: serves the automatic catalogue fixture from
 *  `/catalog/v1/` inside the page, so a clean clone's `npm run dev` has a
 *  working catalogue without credentials or a Worker, and records every
 *  catalogue request. `main.ts` imports this module only behind
 *  `import.meta.env.DEV`; no build ever contains it.
 *  `?catalogue-fixture=fail` answers every catalogue request with 503;
 *  `?catalogue-fixture=off` leaves `/catalog/v1/` to the network. */
export async function installCatalogueFixtureFetch(mode: string | null): Promise<void> {
  const payloads = await servedSnapshotPayloads(buildAutomaticSnapshotFixture({ syntheticRecords: localDevelopmentRecords() }))
  const original = globalThis.fetch.bind(globalThis)
  const requests: string[] = []
  window.__orbitinCatalogueRequests = requests
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
    if (!url.pathname.startsWith('/catalog/v1/')) return original(input, init)
    requests.push(url.pathname)
    if (mode === 'fail') return new Response('unavailable', { status: 503 })
    const bytes = payloads.get(url.pathname)
    if (!bytes) return new Response('not found', { status: 404 })
    // A little latency, so progress states are visible.
    await new Promise((resolve) => setTimeout(resolve, 300))
    return new Response(bytes.slice().buffer, { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}
