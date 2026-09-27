import type { CatalogueDiscoveryPage } from '../catalogueDiscoveryPages.ts'
import type { CatalogueGroupDefinition } from '../catalogueGroups.ts'
import type { OrbitPresetId } from '../../simulation/orbitPresets.ts'

/** A public page about the group, named as its publisher names it. Names
 *  are proper names and are not translated. */
export interface OfficialGroupLink {
  readonly label: string
  readonly url: string
}

/** The structure of a group's education page. Its
 *  words live in the message catalogues under the group id; the live facts
 *  are computed from the loaded catalogue when the page opens. */
export interface OfficialGroupEducation {
  /** The operator's public pages, opened in a new tab. */
  readonly links: readonly OfficialGroupLink[]
  /** The Orbit Lab example that shows the same kind of orbit. */
  readonly orbitLabExample: OrbitPresetId
}

/** One reviewed group: its membership and provenance, its Discovery Page and
 *  its education page, reviewed together. */
export interface OfficialGroupBundle {
  /** This group's own membership revision. */
  readonly revision: string
  readonly group: CatalogueGroupDefinition
  readonly page: CatalogueDiscoveryPage
  readonly education: OfficialGroupEducation
}
