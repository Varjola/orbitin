export interface SimulationInstant {
  /** POSIX seconds since 1970-01-01T00:00:00Z, UTC, without leap seconds. */
  unixSeconds: number
}

export function addSeconds(t: SimulationInstant, seconds: number): SimulationInstant {
  return { unixSeconds: t.unixSeconds + seconds }
}

export function secondsBetween(a: SimulationInstant, b: SimulationInstant): number {
  return a.unixSeconds - b.unixSeconds
}
