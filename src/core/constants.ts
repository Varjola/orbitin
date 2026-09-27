export const EARTH_RADIUS_KM = 6378.137
export const EARTH_MU_KM3_S2 = 398600.4418
/** Second dynamic form factor, unnormalized. EGM96 (NASA/NIMA TR-1998-206861),
 *  matching the EGM96 gravitational parameter above and the WGS-84 radius.
 *  The original WGS-84 value 1.08262999e-3 differs in the seventh significant
 *  figure; see docs/orbit-perturbation-model.md for the measured consequences. */
export const EARTH_J2 = 1.08262668e-3
/** WGS-84 flattening, and the polar radius and first eccentricity squared it
 *  implies. These describe the reference ellipsoid used for geodetic latitude
 *  on the 2D map. The rendered 3D Earth remains the sphere of EARTH_RADIUS_KM;
 *  see docs/ground-track-map.md. */
export const EARTH_FLATTENING = 1 / 298.257223563
export const EARTH_POLAR_RADIUS_KM = EARTH_RADIUS_KM * (1 - EARTH_FLATTENING)
export const EARTH_ECCENTRICITY_SQUARED = EARTH_FLATTENING * (2 - EARTH_FLATTENING)

export const RENDER_UNITS_PER_KM = 1 / EARTH_RADIUS_KM
export const MIN_PERIAPSIS_ALTITUDE_KM = 200
export const MIN_PERIAPSIS_RADIUS_KM = EARTH_RADIUS_KM + MIN_PERIAPSIS_ALTITUDE_KM
export const MAX_APOAPSIS_RADIUS_KM = 60000
export const MAX_DEVICE_PIXEL_RATIO = 2
/** Keep interactive playback legible: one simulated hour per real second. */
export const MAX_SPEED_MULTIPLIER = 3600

/** Learner-authored idealized sensor bounds and defaults.
 *
 *  The authored angles are off-nadir ray angles: the physical sensor property,
 *  and the quantity the learner compares between altitudes. The floor is a
 *  hundredth of a degree so any value the angle box accepts is storable; zero
 *  stays reserved for the pure domain function's degenerate-cap tests. */
export const SENSOR_MIN_FIELD_OF_VIEW_HALF_ANGLE_RAD = 0.01 * Math.PI / 180
export const SENSOR_MAX_FIELD_OF_VIEW_HALF_ANGLE_RAD = 80 * Math.PI / 180
export const SENSOR_MIN_OFF_NADIR_STEERING_RAD = 0
export const SENSOR_MAX_OFF_NADIR_STEERING_RAD = 80 * Math.PI / 180
/** One hypothetical sensor for every orbit. A 5 deg
 *  half-angle with 3 deg of steering stays inside the horizon at LEO, MEO and
 *  GEO (8.70 deg), so the first comparison shows a 44 km footprint at 500 km
 *  against a 3,360 km footprint at GEO from the same instrument. Only the field
 *  of regard near the elliptical preset's apoapsis, where the horizon is
 *  7.92 deg, reaches the limb, and it says so. */
export const SENSOR_DEFAULT_FIELD_OF_VIEW_HALF_ANGLE_RAD = 5 * Math.PI / 180
export const SENSOR_DEFAULT_OFF_NADIR_STEERING_RAD = 3 * Math.PI / 180
/** Ground reach constraint, not a sensor property: the lowest elevation above
 *  the local horizon at which a surface location still counts as reachable.
 *  The default is zero, pure geometric visibility, so the basic lesson reads
 *  field of view -> footprint -> horizon; a learner raises it to 5-10 deg to
 *  compare a practical ground-link reach with the geometric one. */
export const SENSOR_MIN_GROUND_ELEVATION_RAD = 0
export const SENSOR_MAX_GROUND_ELEVATION_RAD = 20 * Math.PI / 180
export const SENSOR_DEFAULT_GROUND_ELEVATION_RAD = 0
/** Resolution of the angle sliders, which are input devices over the authored
 *  angle. With the pacing in `sensorControlRange.ts`, 1000 steps give about
 *  0.11 deg per step near nadir at 500 km and under 0.15 percent of Earth's
 *  area per step at the GEO limb. */
export const SENSOR_ANGLE_SLIDER_STEPS = 1000
export const SENSOR_BOUNDARY_INTERVALS = 96
export const SENSOR_SURFACE_LIFT_RENDER_UNITS = 0.004

export const SIMULATION_START_INSTANT = { unixSeconds: Date.UTC(2026, 2, 20, 12) / 1000 } as const // 1774008000
export const MIN_SIMULATION_INSTANT = { unixSeconds: Date.UTC(1950, 0, 1) / 1000 } as const // -631152000
export const MAX_SIMULATION_INSTANT = { unixSeconds: Date.UTC(2050, 0, 1) / 1000 } as const // 2524608000
