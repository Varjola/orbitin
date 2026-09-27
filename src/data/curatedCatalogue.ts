/** The curated members the catalogue producer fetches by id every sweep,
 *  and the single source of the frontend's reviewed group
 *  memberships and featured-pick ids. Data only: no imports, so the producer
 *  bundle does not pull in frontend code. Change membership here, after
 *  reviewing it against each group's named source.
 *
 *  The frontend uses this list when the frontend is deployed and the producer
 *  when the producer is deployed; a member the producer does not yet fetch is
 *  simply absent, which groups already handle. */
export const CURATED_CATALOGUE = {
  /** Oldest element set the supplement asks for. */
  maxSupplementEpochAgeDays: 30,
  /** Revision of the whole official-group set; bump with any member change. */
  officialGroupsRevision: 'official-groups-2026-09-26',
  /** One entry per official group, keyed by group id, in the order of
   *  `OFFICIAL_GROUP_BUNDLES`. */
  groups: {
    'gps-operational': {
      revision: 'gps-operational-2026-09-24',
      catalogIds: [
        '26407', '27663', '28190', '28474', '28874', '29486', '29601', '32260', '32384', '32711', '35752', '36585',
        '38833', '39166', '39533', '39741', '40105', '40294', '40534', '40730', '41019', '41328', '43873', '44506',
        '45854', '46826', '48859', '55268', '62339', '64202', '67588', '68791',
      ],
    },
    'galileo-operational': {
      revision: 'galileo-operational-2026-09-26',
      catalogIds: [
        '37846', '37847', '38857', '40128', '40129', '40544', '40890', '41174', '41175', '41549', '41859', '41860',
        '41861', '41862', '43055', '43056', '43057', '43058', '43564', '43565', '43566', '43567', '49809', '49810',
        '59598', '59600', '61182', '61183', '67160', '67162',
      ],
    },
    'glonass-operational': {
      revision: 'glonass-operational-2026-09-26',
      catalogIds: [
        '32275', '32393', '32395', '36111', '36112', '36402', '37867', '37868', '37869', '39155', '39620', '40001',
        '40315', '41330', '42939', '43508', '43687', '44299', '44850', '45358', '46805', '52984', '54031', '54377',
        '57517', '63130', '65590', '100460',
      ],
    },
    'beidou-operational': {
      revision: 'beidou-operational-2026-09-26',
      catalogIds: [
        '41434', '43001', '43002', '43107', '43108', '43207', '43208', '43245', '43246', '43539', '43581', '43582',
        '43602', '43603', '43622', '43623', '43647', '43648', '43683', '43706', '43707', '44204', '44337', '44542',
        '44543', '44709', '44793', '44794', '44864', '44865', '45344', '45807', '56564', '58654', '58655', '61186',
        '61187',
      ],
    },
    'crewed-space-stations': {
      revision: 'space-stations-2026-09-26',
      catalogIds: ['25544', '48274'],
    },
    'geostationary-weather': {
      revision: 'geo-weather-2026-09-26',
      catalogIds: [
        '28912', '40367', '40732', '41105', '41752', '41836', '41882', '43491', '43823', '48808', '51850', '54743',
        '55506', '58990', '60133',
      ],
    },
    'copernicus-sentinels': {
      revision: 'copernicus-sentinels-2026-09-26',
      catalogIds: ['40697', '41335', '42063', '42969', '43437', '46984', '60989', '62261', '66315', '66514', '100690'],
    },
    'arctic-heo': {
      revision: 'arctic-heo-2026-09-26',
      catalogIds: ['60422', '60423'],
    },
  },
  /** Featured picks in presentation order. */
  featured: ['25544', '48274', '20580', '49260', '60989', '60133', '25847', '5'],
} as const

/** Canonical ids sort by length, then as strings: numeric order. */
const byCatalogId = (a: string, b: string): number => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)

/** Sorted (numeric), de-duplicated union of every official-group member:
 *  what the producer counts as absent group members. */
export function curatedGroupMemberIds(): readonly string[] {
  const ids = new Set<string>()
  for (const group of Object.values(CURATED_CATALOGUE.groups)) for (const id of group.catalogIds) ids.add(id)
  return [...ids].sort(byCatalogId)
}

/** Sorted (numeric), de-duplicated union of every group member and featured
 *  pick: exactly the ids the supplement requests. */
export function curatedSupplementIds(): readonly string[] {
  return [...new Set<string>([...curatedGroupMemberIds(), ...CURATED_CATALOGUE.featured])].sort(byCatalogId)
}
