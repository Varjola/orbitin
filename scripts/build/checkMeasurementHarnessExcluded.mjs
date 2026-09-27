import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** The development-only scene-scale harness must never reach a `vite build`
 *  bundle. `main.ts` guards its dynamic import with `import.meta.env.DEV`,
 *  which every build replaces with `false`; this check proves the result. */
export const HARNESS_MARKERS = ['__orbitinSceneHarness', '__orbitinSceneMeasurement', 'sceneScaleHarness', 'Synthetic scale measurement object', '__orbitinCatalogueRequests', '__orbitinInspect', 'SYNTHETIC NAV', 'localDevelopmentRecords']
/** The development-only pseudo-locale is guarded the same way;
 *  its wrapper characters and builder never reach a bundle. */
export const PSEUDO_LOCALE_MARKERS = ['pseudoCatalogue', '⟦', '⟧']
/** Both interface languages ship in the main bundle. */
export const LANGUAGE_MARKERS = ['Kiertoradan mekaniikat', 'Kiertoratojen kappaleet', 'orbitin.locale']
/** The reviewed official groups ship in every build (approved
 *  2026-09-25); a bundle without it has lost the official group. */
export const OFFICIAL_GROUP_MARKERS = ['gps-operational-2026-09-24', 'GPS Constellation Status', 'official-groups-2026-09-26', 'arctic-heo-2026-09-26']

export function findHarnessMarkers(directory, markers = HARNESS_MARKERS) {
  const findings = []
  const visit = (path) => {
    for (const name of readdirSync(path)) {
      const child = join(path, name)
      if (statSync(child).isDirectory()) { visit(child); continue }
      if (!/\.(js|mjs|html|map)$/.test(name)) continue
      const text = readFileSync(child, 'utf8')
      for (const marker of markers) if (text.includes(marker)) findings.push(`${relative(directory, child)} contains ${marker}`)
    }
  }
  visit(directory)
  return findings
}

if (process.argv[1]?.endsWith('checkMeasurementHarnessExcluded.mjs')) {
  const directory = process.argv[2] ?? 'dist'
  const findings = findHarnessMarkers(directory)
  if (findings.length > 0) {
    console.error(`The development measurement harness leaked into ${directory}:\n${findings.join('\n')}`)
    process.exit(1)
  }
  const pseudo = findHarnessMarkers(directory, PSEUDO_LOCALE_MARKERS)
  if (pseudo.length > 0) {
    console.error(`The development pseudo-locale leaked into ${directory}:\n${pseudo.join('\n')}`)
    process.exit(1)
  }
  const languages = new Set(findHarnessMarkers(directory, LANGUAGE_MARKERS).map((finding) => finding.split(' contains ')[1]))
  const missingLanguage = LANGUAGE_MARKERS.filter((marker) => !languages.has(marker))
  if (missingLanguage.length > 0) {
    console.error(`The Finnish interface or its language key is missing from ${directory}: ${missingLanguage.join(', ')}`)
    process.exit(1)
  }
  const found = new Set(findHarnessMarkers(directory, OFFICIAL_GROUP_MARKERS).map((finding) => finding.split(' contains ')[1]))
  const missing = OFFICIAL_GROUP_MARKERS.filter((marker) => !found.has(marker))
  if (missing.length > 0) {
    console.error(`The official GPS group is missing from ${directory}: ${missing.join(', ')}`)
    process.exit(1)
  }
  console.log(`Measurement harness and pseudo-locale absent from ${directory}; official GPS group and both languages present.`)
}
