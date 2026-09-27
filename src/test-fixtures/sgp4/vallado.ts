/**
 * Fixed SGP4 verification records from Vallado et al., AIAA 2006-6753,
 * Appendix D / Appendix C. The values are deliberately kept in the test
 * fixture rather than fetched at test time.
 */
export const VANGUARD_1_LINE1 = '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753'
export const VANGUARD_1_LINE2 = '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667'

export const VANGUARD_1_TEME_AT_EPOCH = {
  positionKm: { x: 7022.46529266, y: -1400.08296755, z: 0.03995155 },
  velocityKmPerSecond: { x: 1.893841015, y: 6.405893759, z: 4.534807250 },
}

export const VANGUARD_1_TEME_AT_PLUS_THREE_DAYS = {
  positionKm: { x: -9060.47373569, y: 4658.70952502, z: 813.68673153 },
  velocityKmPerSecond: { x: -2.232832783, y: -4.110453490, z: -3.157345433 },
}

/** Deep-space/resonant verification record from the same Appendix D listing. */
export const MOLNIYA_2_14_LINE1 = '1 08195U 75081A   06176.33215444  .00000099  00000-0  11873-3 0   813'
export const MOLNIYA_2_14_LINE2 = '2 08195  64.1586 279.0717 6877146 264.7651  20.2257  2.00491383225656'

/** High-drag community-decay regression from satellite.js issue #152. */
export const HIGH_DRAG_LINE1 = '1 45110U 20007A   23232.80903846  .00110000  00000-0  32750-2 0    04'
export const HIGH_DRAG_LINE2 = '2 45110  69.9913 111.5649 0009740 159.9373 200.0626 15.34502222    06'
