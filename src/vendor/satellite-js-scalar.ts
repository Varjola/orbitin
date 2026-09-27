/**
 * Scalar satellite.js entry point used by the application adapter. The
 * package root also exports the optional WASM bulk runtime; keep that runtime
 * out of the browser bundle because the application deliberately uses the scalar API.
 */
export { twoline2satrec } from '../../node_modules/satellite.js/dist/io.js'
export { sgp4init } from '../../node_modules/satellite.js/dist/propagation/sgp4init.js'
export { sgp4 } from '../../node_modules/satellite.js/dist/propagation/sgp4.js'
export { SatRecError } from '../../node_modules/satellite.js/dist/propagation/SatRec.js'
export { checkForDecay } from '../../node_modules/satellite.js/dist/propagation/check-for-decay.js'
export type { SatRec, SatRecInit } from '../../node_modules/satellite.js/dist/propagation/SatRec.js'
