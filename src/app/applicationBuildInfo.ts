export interface ApplicationBuildInfo {
  readonly version: string
  readonly revision: string
  readonly environment: string
}

/** Build-time identity injected by Vite. VERSION is the sole manually
 * maintained value; revision and environment are derived during the build. */
export const applicationBuildInfo: ApplicationBuildInfo = Object.freeze({
  version: __ORBITIN_VERSION__,
  revision: __ORBITIN_REVISION__,
  environment: __ORBITIN_ENVIRONMENT__,
})

/** True for a version the interface labels BETA: any 0.y.z version, and any
 *  version with a pre-release suffix such as 1.1.0-rc.1. The label is derived
 *  here so a release needs no message change. */
export function isPreReleaseVersion(version: string): boolean {
  return /^0\./.test(version) || /^\d+\.\d+\.\d+-/.test(version)
}
