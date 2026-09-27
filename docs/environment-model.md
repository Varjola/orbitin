# Time-aware Sun and Earth orientation

One simulation instant drives every orbit, the Sun and Earth. It is POSIX UTC
seconds, without leap seconds, supported from 1950-01-01 through 2050-01-01
inclusive. Sessions start at 2026-03-20 12:00:00 UTC. Now and Reset jump the
instant without changing orbital elements or re-anchoring orbital phase.
Reverse changes the clock direction; playback stops at either supported limit.
Forward playback at 1× follows the wall clock: time that passes while the
browser tab is in the background is caught up when it returns, so after Now the
clock stays on real time. Faster and reversed playback advance by at most 0.1 s
of real time per frame, so a suspended tab pauses them instead of leaping ahead.

The solar model reproduces the complete current
[USNO approximate solar formulation](https://aa.usno.navy.mil/faq/sun_approx)
(retrieved 2026-09-08). USNO states approximately one arcminute accuracy within
two centuries of 2000. Its longitude includes an aberration adjustment, and
mean obliquity produces an approximate equator/equinox-of-date direction.
UTC is supplied directly. No independent TT conversion or nutation model is used.

Earth orientation uses IAU 1982 GMST and IAU 1976 precession from J2000.
`ProjectInertial` means the mean equator and equinox of J2000. `EarthFixed`
is the mean-of-date frame rotated by GMST, not ITRF. `Render` is the fixed
Y-up graphics axis convention. `TEME` is the SGP4 output frame; SGP4 states
are converted from it to `ProjectInertial` at the propagator boundary rather
than relabelled (see [tle-and-sgp4.md](./tle-and-sgp4.md)).

| Quantity or omission | Educational accuracy and consequence |
| --- | --- |
| Sun relative to Earth's surface | Approximately 0.03 degrees (3.3 km at the equator), conservatively allowing the source's 0.0167-degree solar error, approximate mean/apparent treatment and time approximation |
| Project-inertial relative to Earth-fixed registration | Approximately 0.015 degrees (1.7 km), including the omitted nutation, polar motion and time approximation; solar-model error is separate |
| Absolute satellite ground position | Limited by the ideal two-body orbit, potentially hundreds of kilometres for a real LEO object within a day; unsuitable for pass prediction |
| Precession | Modelled; removes the approximately 0.64-degree J2000/date mismatch at the range edges |
| Nutation | Not modelled; approximately 0.0047 degrees |
| UT1 minus UTC | Approximated as zero; modern UTC convention bounds DUT1 at 0.9 seconds, approximately 0.0038 degrees; historical pre-UTC dates use proleptic POSIX UTC |
| Leap seconds | Not representable in POSIX; no leap-second or historical time-scale tables, and no precision timing claim |
| TT in the solar model | No conversion; a modern 69-second difference changes the Sun by about 0.0008 degrees |
| Polar motion | Not modelled; approximately 0.0001 degrees |
| Geocentric versus geodetic latitude | Sub-solar readout is geocentric, with no ellipsoid; differences can reach 0.19 degrees |

These are educational estimates rather than a precision ephemeris guarantee.
The first two estimates describe different physical quantities and must not
be added into a single orientation number. The sub-solar point is independently
checked against the Sun transformed through the reference-frame chain.

Earth's quaternion carries physical orientation. The UV alignment constants
are in texture space; they are never offsets to GMST or the Sun.
The shader and Sun view receive the same world-space direction each frame.

Tests use JPL Horizons DE441 apparent solar coordinates at an equinox and a
solstice, the published Meeus precession example, exact Julian-date and GMST
anchors, frame type guards, inverse and orthonormality invariants, and GEO
longitude drift over three days. No astronomy dependency or online data is
needed at runtime.
