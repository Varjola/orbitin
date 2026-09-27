import { isPreReleaseVersion, type ApplicationBuildInfo } from '../app/applicationBuildInfo.ts'
import { text, type MessageCatalogue } from '../i18n/index.ts'
import { AUTHOR_NAME, PROJECT_LINKS } from '../app/projectLinks.ts'

/** The About Orbitin credits. ATTRIBUTION.md remains
 *  the authority for provenance and licences. The credit text is a citation
 *  or a proper name and is never translated; only its
 *  subject is. */
export interface AboutCredit {
  readonly subject: keyof MessageCatalogue['about']['creditSubjects']
  readonly text: string
  readonly href?: string
}

export const ABOUT_CREDITS: readonly AboutCredit[] = [
  // No provider URL may reach the browser bundle; the name is the citation.
  { subject: 'orbitalData', text: 'USSPACECOM / 18th Space Defense Squadron, accessed via Space-Track.org' },
  { subject: 'earthImagery', text: 'NASA Earth Observatory: Blue Marble Next Generation and Black Marble', href: 'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/' },
  { subject: 'milkyWay', text: 'NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC', href: 'https://svs.gsfc.nasa.gov/4851/' },
  { subject: 'stars', text: 'HYG Database v4.1 by David Nash / astronexus, CC BY-SA 4.0', href: 'https://github.com/astronexus/HYG-Database' },
  { subject: 'coastlines', text: 'Made with Natural Earth', href: 'https://www.naturalearthdata.com/' },
  { subject: 'sgp4', text: 'satellite.js, MIT License', href: 'https://github.com/shashwatak/satellite-js' },
]

/** The project links of About, in order. */
export function aboutLinks(): readonly { readonly text: string; readonly href: string }[] {
  const t = text().about.links
  return [
    { text: t.source, href: PROJECT_LINKS.repository },
    { text: t.models, href: PROJECT_LINKS.modelsAndLimitations },
    { text: t.feedback, href: PROJECT_LINKS.issues },
  ]
}

/** About's author line and privacy line, with their links. */
export function appendAboutProject(documentRef: Document, container: HTMLElement): void {
  const t = text().about
  const link = (href: string, label: string) => {
    const anchor = documentRef.createElement('a')
    anchor.href = href
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    anchor.textContent = label
    return anchor
  }
  const list = documentRef.createElement('ul')
  list.className = 'about-links'
  for (const entry of aboutLinks()) { const item = documentRef.createElement('li'); item.append(link(entry.href, entry.text)); list.append(item) }
  const author = documentRef.createElement('p')
  author.className = 'about-author'
  author.append(`${t.madeBy} `, link(PROJECT_LINKS.author, AUTHOR_NAME))
  const privacy = documentRef.createElement('p')
  privacy.className = 'about-privacy'
  privacy.append(`${t.privacyLine} `, link(PROJECT_LINKS.privacy, t.links.privacy))
  container.append(list, author, privacy)
}

/** About's version line: the version links to the overview changelog page
 *  (English only); the revision and environment follow as text. */
export function aboutVersionParts(info: ApplicationBuildInfo): { readonly label: string; readonly details: string; readonly href: string } {
  const t = text().about
  return {
    label: t.versionLabel(info.version, isPreReleaseVersion(info.version)),
    details: t.versionDetails(info.revision, info.environment),
    href: PROJECT_LINKS.changelog,
  }
}

export function renderAboutVersion(documentRef: Document, container: HTMLElement, info: ApplicationBuildInfo): void {
  const parts = aboutVersionParts(info)
  const anchor = documentRef.createElement('a')
  anchor.href = parts.href
  anchor.target = '_blank'
  anchor.rel = 'noopener'
  anchor.title = text().about.changelogTitle
  anchor.textContent = parts.label
  container.replaceChildren(anchor, ` · ${parts.details}`)
}
