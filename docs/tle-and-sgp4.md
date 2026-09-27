# TLE, OMM and SGP4

TLE is one of the source paths of the **Real Objects** mode, alongside manual
OMM keyed JSON and records imported from the published catalogue. See [catalogue-and-omm.md](./catalogue-and-omm.md) for
the catalogue contract and provider boundary.

The TLE Inspector accepts one standard two-line element set (2LE), or a
three-line set (3LE) with an optional object name. Input is validated locally
before it can change the scene. The element lines keep their fixed 69-column
format, checksums, catalogue identifier, implied-decimal exponent notation and printed
field conventions. Pasted text is not uploaded, persisted, logged or placed in
a URL.

## What a TLE means

A TLE is an input record for the SGP4 family of propagators. Its angles,
eccentricity and mean motion are SGP4 mean fields at the TLE epoch; they are
not the same thing as the application's editable osculating Keplerian elements
or its secular-J2 mean elements. The Inspector therefore never converts a TLE
into an educational conic and does not expose current true anomaly, RAAN,
periapsis or J2-rate readouts for it.

The displayed metadata includes the catalogue identifier, international
designator, classification, epoch, element-set and revolution numbers,
ephemeris type, B*, the conventionally divided mean-motion derivative fields,
and the printed SGP4 mean fields. A nominal period is derived from printed mean
motion only for sampling and ground-track cadence; it is not an osculating
period claim.

TLE catalogue identifiers are five-character fields and may use the Alpha-5
convention. The format is not a six-digit catalogue format. Manual OMM keyed
JSON accepts catalogue numbers of up to nine digits and is the input path for
a record that a TLE cannot represent.

## Time, frames and age

The shared application clock is the source of time. Propagation uses

```text
minutes since epoch = (simulation UTC seconds - TLE epoch UTC seconds) / 60
```

Negative time, reverse playback, date jumps and Reset are ordinary inputs to
SGP4. Selecting **Go to element epoch after adding** moves the shared clock for
every object; it does not create a second TLE clock. A signed epoch offset is
always shown. The near-epoch, caution and old-data messages at approximately
3 and 14 days are qualitative warnings, not accuracy guarantees or rejection
rules.

`satellite.js` returns position and velocity in TEME (True Equator, Mean
Equinox), not project J2000 inertial coordinates. The application brands the
library boundary as TEME and explicitly converts both vectors through the
true-of-date/mean-of-date chain, local IAU-1980 nutation and the IAU 1976
precession model before publishing its project-inertial state. No Earth
rotation cross product is added at this boundary: that term belongs to an
Earth-fixed velocity conversion. UTC is used as an approximation of
UT1; leap-second and Earth-orientation-parameter corrections are not
available in this offline inspector.

Against the published Vanguard-1 future-date example, the UTC/EOP
approximation gives under 1.2 m of position residual and under
`1e-6 km/s` of velocity residual in the checked fixture. The residual is a
property of the deliberately omitted UT1/EOP inputs, not a general TLE
accuracy promise.

The altitude readout is **spherical altitude above rendered Earth**:
the norm of the published inertial position minus the rendered Earth radius.
It is geocentric, not WGS-84 geodetic height. Speed is the norm of the
published project-inertial velocity.

## Paths and ground tracks

A TLE path is a bounded time-sampled window covering one nominal period with
256 intervals. The already evaluated current state is injected at the window
centre, so the marker and path share that sample. Failed off-centre samples
clip the path into contiguous segments rather than bridging through an
invented line. The window is rebuilt only after a period/32 recenter threshold,
with one rebuild scheduled per frame and a selected-object priority.

The sampled inertial path and the Earth-fixed ground-track window are separate
caches. The ground track reuses the same source-independent sampling and seam
handling as educational objects. **Record history** uses the same bounded,
fixed simulation-time grid as educational objects; it replaces the computed
window while recording and retains gaps across propagation failures.

## Failures and privacy

Malformed records are rejected atomically with field-specific validation
messages. Runtime SGP4 errors are translated into stable application codes,
including the distinction between mean- and perturbed-eccentricity failures.
One failed object hides only its own body/path and clears its current point and
computed windows; other objects and the clock continue, and later instants can
recover it. There is no silent Keplerian fallback.

The adapter also runs satellite.js's optional community decay check after a
successful scalar SGP4 call. This is a separate application policy for
historically decayed records, not part of the official SGP4 verification
output, so it is reported separately.

## Library and references

This implementation pins `satellite.js` **7.1.0**. The library is MIT-licensed
and its SGP4 implementation is used here through the scalar `twoline2satrec`
and `sgp4` API. The implementation and frame choices were checked against:

- [satellite.js](https://github.com/shashwatak/satellite-js)
- [satellite.js propagation documentation](https://shashwatak.github.io/satellite-js/docs/propagation)
- [CelesTrak SGP4 verification tutorial](https://celestrak.org/software/tutorials/sgp4-verification.php)
- [Vallado et al., “Revisiting Spacetrack Report #3”](https://celestrak.org/publications/AIAA/2006-6753/)
- [CelesTrak TLE format documentation](https://celestrak.org/NORAD/documentation/tle-fmt.php)

The Inspector is an offline manual source and makes no network request. The
published catalogue and OMM input are described in
[catalogue-and-omm.md](./catalogue-and-omm.md). Covariance, conjunction
analysis and observer passes are not supported.
