/** Reviewed featured picks: a few well-known single
 *  objects offered with one-action add once the catalogue is loaded, on the
 *  desktop empty state and in the mobile Add sheet. Their words are in the
 *  message catalogues under `featured`.
 *  A pick absent from the loaded catalogue is not shown.
 *  The catalogue ids, in this order, are also `CURATED_CATALOGUE.featured`,
 *  which the catalogue producer fetches; a test holds the two
 *  equal, so change a pick in both. */
export interface FeaturedPick {
  readonly id: string
  readonly catalogId: string
  /** The common name, a proper name shown in every language. */
  readonly name: string
}

export const FEATURED_PICKS: readonly FeaturedPick[] = [
  { id: 'iss', catalogId: '25544', name: 'ISS' },
  { id: 'tiangong', catalogId: '48274', name: 'Tiangong' },
  { id: 'hubble', catalogId: '20580', name: 'Hubble' },
  { id: 'landsat-9', catalogId: '49260', name: 'Landsat 9' },
  { id: 'sentinel-2c', catalogId: '60989', name: 'Sentinel-2C' },
  { id: 'goes-19', catalogId: '60133', name: 'GOES-19' },
  { id: 'molniya-3-50', catalogId: '25847', name: 'Molniya 3-50' },
  { id: 'vanguard-1', catalogId: '5', name: 'Vanguard 1' },
]
