/** The notes Orbitin stores on the objects it creates.
 *  They are canonical English literals in every language, so saved scenes,
 *  scene files and `s1` links never depend on the interface language; the
 *  interface translates them for display only. The Keplerian default and the
 *  preset notes are also entries of the frozen `SHARED_NOTES_V1` table. */
export const DEFAULT_ORBIT_NOTE = 'Ideal two-body Keplerian demonstration'
export const TLE_OBJECT_NOTE = 'Real-world TLE propagated with SGP4/SDP4'
export const OMM_OBJECT_NOTE = 'Real-world OMM propagated with SGP4/SDP4'
export const CATALOGUE_OBJECT_NOTE = 'Real-world catalogue record propagated with SGP4/SDP4'
