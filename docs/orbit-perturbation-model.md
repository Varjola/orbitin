# Orbital plane drift, Sun-synchronous orbits and the two Suns

Every object carries an **orbit model**, chosen per object and independent of
where its orbit definition came from:

- **Ideal two-body**: the default for every object and every example except
  the Sun-synchronous one. A fixed conic in a fixed inertial plane. This is the
  correct two-body answer.
- **J2 drift**: secular drift of the orbital plane caused by Earth's
  equatorial bulge, applied to **mean** elements.

Switching between the two never moves an object. At the instant of the switch
the position, the velocity and all six elements are preserved exactly; only
their future evolution changes.

In one line: **this shows how an orbit's own geometry makes its
plane drift, not how a real satellite ages.**

## What the J2 model computes

With `p = a (1 - e²)`, `n = sqrt(mu / a³)` and `k = 1.5 n J2 (Re / p)²`:

```text
dRAAN/dt = -k cos i
dArgP/dt =  (k / 2) (5 cos² i - 1)
dM/dt    =  n + (k / 2) sqrt(1 - e²) (3 cos² i - 1)
```

`a`, `e` and `i` are constant under this model; only those three angles move,
and they move linearly with time.

Three consequences the tool teaches directly:

- Nodal drift vanishes only at 90° inclination, is negative (westward
  regression) for prograde orbits and positive for retrograde ones.
  Sun-synchronous orbits are retrograde because of that sign, not by convention.
- Apsidal drift vanishes at the **critical inclination**, 63.4349488° and
  116.5650512°. The highly elliptical example sits at 63.5° for this reason.
- `dM/dt` differs from `n`, so the Keplerian period and the mean-anomaly period
  are not the same quantity: they are about 0.012% apart at low Earth orbit.

Reference values the implementation reproduces:

| Case | a (km) | e | i (°) | dRAAN/dt (°/day) | dArgP/dt (°/day) |
| --- | --- | --- | --- | --- | --- |
| ISS-like LEO | 6778 | 0 | 51.6 | -5.00268 | +3.74154 |
| Sun-synchronous, 500 km | 6878.137 | 0 | 97.4018 | +0.98565 | -3.50803 |
| Sun-synchronous, 800 km | 7178.137 | 0 | 98.6031 | +0.98565 | -2.92591 |
| Polar, 800 km | 7178.137 | 0 | 90 | 0 | -3.29452 |
| Highly elliptical | 26600 | 0.74 | 63.5 | -0.14664 | -0.00075 |
| Highly elliptical | 26600 | 0.74 | 45 | -0.23239 | +0.24649 |

`EARTH_J2 = 1.08262668e-3`, the unnormalized EGM96 value, matching the EGM96
gravitational parameter and the WGS-84 radius the tool uses. The
original WGS-84 value 1.08262999e-3 differs in the seventh significant figure;
choosing it instead would change the LEO nodal rate by 1.5e-5 °/day, the solved
Sun-synchronous inclination at 800 km by 2.7e-5°, and the attainability bound
below by 0.011 km. Either is defensible; naming the choice is what matters.

## Mean elements are not osculating elements

Under J2 drift the stored elements are **mean** elements at the object's epoch.
A real satellite's osculating elements oscillate around them roughly once per
orbit. That short-period motion is not modelled, and the tool performs **no
conversion in either direction**: it holds no osculating element set to
convert from or to. Mean and osculating elements are different quantities and are not
interchangeable.

These are also not SGP4 mean elements. Those come from a different theory with a
different averaging, with drag and resonance terms built in, and are meaningful
only when fed back through that theory. TLE and OMM objects are propagated
with SGP4 (see [tle-and-sgp4.md](./tle-and-sgp4.md)); nothing converts between
the two element sets.

## The two Suns

Local **mean** solar time is defined against a fictitious *mean Sun* that moves
uniformly along the equator, not against the physical Sun. The two differ by the
**equation of time**, which spans -14.2 to +16.5 minutes across a year: a
30.6-minute peak-to-peak swing on a readout displayed to the minute.

| | Owner | Used for |
| --- | --- | --- |
| Mean Sun | `src/simulation/meanSun.ts` | Local mean solar time, MLTAN, MLTDN, the Sun-synchronous target rate |
| Apparent Sun | `src/simulation/sun.ts` | Sub-solar point, Earth lighting, the Sun marker, beta angle |

The apparent Sun is computed **from** the mean Sun (physically it is the mean
Sun plus an equation of centre), and both are derived once per simulation
instant. Deriving local time from the apparent Sun instead would make a
perfectly Sun-synchronous orbit appear to oscillate by half an hour a year.

## Sun-synchronous orbits are solved, not tabulated

A Sun-synchronous orbit is one whose nodal drift matches the mean Sun's eastward
motion, so its plane holds a fixed local mean solar time:

```text
target dRAAN/dt = 0.98564736 °/day = 1.9910639e-7 rad/s
cos i = -targetRate / k
```

No Sun-synchronous inclination appears as a literal anywhere in the product. The
example's inclination is solved from its altitude, and its RAAN is solved from a
target local time **at the instant it is added**, so adding it on a different
date correctly gives a different RAAN.

| Altitude (km) | Solved i (°) |
| --- | --- |
| 400 | 97.0300 |
| 500 | 97.4018 |
| 600 | 97.7877 |
| 800 | 98.6031 |
| 1000 | 99.4793 |
| 1500 | 101.9570 |

For comparison, Sentinel-2 flies a 786 km Sun-synchronous orbit at 98.62°.

**The attainability bound.** A solution exists only while `|target / k| <= 1`.
For a circular orbit that gives a maximum semi-major axis of 12,352.50 km
(5,974.36 km altitude), above which no inclination lets the plane keep up,
because the oblateness torque weakens faster than the required rate falls. The
tool reports that bound and the altitude it applies at, and keeps the value the
learner set, rather than silently clamping. The bound depends on eccentricity through
`p`, so it is computed for the object's own shape.

**Sun-synchronous does not mean constant lighting.** A Sun-synchronous orbit
holds its local mean solar crossing time. Its beta angle still varies
seasonally, because Earth's axial tilt moves the Sun in declination underneath a
plane whose local-time orientation is fixed. The 800 km 10:30 example swings
about 10.6° of beta over a year.

## Node geometry, local solar time and beta

The ascending node is defined relative to a reference equatorial plane. The
stored RAAN is referred to the J2000 mean equator, while local mean solar time
must be evaluated against the mean equator **of date**, which is the plane the
mean Sun's right ascension is measured in. The tool transforms the orbit-plane
normal into mean-of-date and recomputes the node there.

Rotating the J2000 node *vector* into mean-of-date and reading its right
ascension is wrong rather than approximate: the rotated vector does not lie in
the mean-of-date equator. That shortcut reaches 0.77° of error (3.1 minutes of
local time) within the supported 1950 to 2050 range.

```text
MLTAN = 12 h + (node right ascension - mean Sun right ascension) / 15° per hour
MLTDN = MLTAN + 12 h
```

Both are displayed, and both labels carry the word *mean*. The Sun-synchronous
example is named and described by its **descending** node time, because
Earth-observation missions are documented that way: Sentinel-2 and Terra at
10:30, Landsat at about 10:00.

**Beta angle** is the Sun's elevation above the orbital plane, computed from the
**apparent** Sun and the orbit normal with both vectors in the project-inertial
frame. It governs how much of each orbit is sunlit, when eclipses occur and how
long they last. It is defined for every orbit, including equatorial and circular
ones, because it depends only on the plane's normal.

## Elements that cannot be reported, and why

Some classical elements do not exist for some orbits, and some exist but cannot
be reported meaningfully at this model's fidelity. **These are different statements
and the tool never confuses them.**

| Region | Meaning |
| --- | --- |
| True singularity | The direction does not exist at all: RAAN at `i = 0` or `i = 180°`, periapsis at `e = 0` |
| Suppressed readout | The direction exists, but is dominated by effects this model omits or by its own frame accuracy |
| Defined | Everything else |

An orbit at 0.2° inclination **does** have an ascending node, and an orbit at
`e = 0.0005` **does** have a periapsis. The tool says so, and explains that it is
declining to print a number rather than claiming none exists.

| Threshold | Value | Reason |
| --- | --- | --- |
| Node readout suppressed below | 0.5° inclination | The tool's own 0.015° frame-registration error displaces the node by roughly that error divided by sin(i): already about 1.7° of node right ascension, some 7 minutes of MLTAN, at 0.5° |
| Periapsis readout suppressed below | e = 0.001 | Omitted J2 short-period eccentricity variation is itself about 1.3e-3 at 800 km, so the periapsis direction would be set by physics this model does not carry |

Where an element cannot be reported, the tool substitutes the nonsingular
combination that *is* meaningful (argument of latitude, longitude of
periapsis or mean longitude) and names it.

## The geostationary example under J2 drift

A circular equatorial orbit has neither a unique ascending node nor a unique
periapsis, so it has no nodal drift and no apsidal drift to report. What is
meaningful is its **mean longitude**, `RAAN + ArgP + M`, whose rate reduces for
`i = 0, e = 0` to the closed form `n (1 + 3 J2 (Re / a)²)`.

```text
two-body mean motion                      360.985643 °/day
J2-secular mean longitude rate            361.012471 °/day
Earth's rotation rate (IAU 1982 GMST)     360.985647 °/day
eastward mean-longitude drift             +0.026823 °/day
                                          = 1° per 37.3 simulated days
J2-synchronous MEAN semi-major axis       42166.26 km  (+2.09 km)
```

An oblate Earth pulls harder than a point mass, so a satellite placed at the
*two-body* synchronous semi-major axis orbits slightly too fast and creeps
eastward. To be synchronous under this model its **mean** semi-major axis must
be about 2.1 km larger.

**This is not a station-keeping model.** A real geostationary satellite's
east-west drift is dominated by the tesseral J22 term, which accelerates it
toward the nearer of two stable longitudes and is not in this model at all, and
its inclination growth of about 0.85°/year comes from luni-solar attraction,
also absent. The tool must not be read as predicting either.

## What is omitted

| Omitted effect | Size, and why |
| --- | --- |
| Short-period (osculating) variation | Order 10 km in radius and hundredths of a degree in the angles at LEO. It oscillates and averages out, so it teaches nothing here while making every readout jitter |
| J2 second order, J4 secular | Order 1e-3 of the J2 rates, about 0.005 °/day at LEO, below display resolution |
| J3 | Drives the frozen-orbit condition through eccentricity; only relevant to a frozen-orbit lesson |
| Atmospheric drag | The dominant real error for low orbits, and the reason real Sun-synchronous missions need maintenance. Needs an atmosphere model and a ballistic coefficient the tool has no source for |
| Luni-solar third body | Dominant at geostationary altitude, where it drives about 0.85°/year of inclination growth. The tool therefore claims nothing about GEO inclination evolution |
| Solar radiation pressure | Needs an area-to-mass ratio that is not available |
| Tesseral resonance (J22) | The real driver of geostationary longitude drift |
| Manoeuvres and station keeping | A separate teaching topic |
| Numerical integration of any kind | The point of a secular model is that it is closed-form and stable at very high playback rates |

## Accuracy

| Quantity | Estimate | Note |
| --- | --- | --- |
| Secular nodal and apsidal drift rate | A few parts in 1e3 of the rate | First-order J2 only |
| J2 constant choice | 1.5e-5 °/day on the LEO nodal rate; 2.7e-5° on the solved inclination; 0.011 km on the bound | Sets the floor for every test tolerance |
| Sun-synchronous inclination | Within about 0.02° of published mission values | Consistent with the rate model and the constant choice |
| Mean-Sun rate | A definition, not a measurement: 360° / 365.2421897 d, reproduced uniformly to 1e-12 °/day | The 1e-12 is round-off, not model error |
| Mean versus apparent Sun | Up to 16.5 minutes of local time | Not an error: this is the equation of time |
| Mean-of-date node geometry | Adds no approximation beyond the precession model | Rotating the J2000 node vector instead would cost 0.04° to 0.77° |
| MLTAN stability of a modelled Sun-synchronous orbit | Under 30 seconds per simulated year; measured 12 seconds | The residual is the node's general precession in right ascension, and is intended |
| Beta angle, vector versus closed form | 6.7e-16 | Both forms in project-inertial |
| Long-duration angle arithmetic | 7.3e-10 rad at the extreme of the supported range | Double precision; no accumulation scheme needed |
| Instantaneous position of a real satellite | Not improved by J2 drift: dominated by the orbit model, potentially hundreds of km within a day | J2 secular drift improves plane orientation over days, not position within an orbit |
| Real orbit evolution | Not modelled at all | Drag dominates at LEO; luni-solar attraction and J22 dominate at GEO |

The distinction the wording preserves throughout: this model is accurate about
**how an oblate Earth turns an orbital plane**, and says nothing about **how a
real satellite's orbit changes over time**.

## High playback rates

Playback reaches 200,000×, at which a simulated day passes in about 0.43 s and a
simulated year in about 2.6 minutes. High rates change **presentation only**:
the physics is never special-cased, no substepping is added, and no position is
ever drawn that the simulation did not evaluate.

At a high enough rate a body advances a long way along its orbit between
rendered frames, and the eye cannot interpolate. The tool measures each
object's own true-anomaly advance between frames and adjusts its marker:

| Band | Advance per frame | Presentation |
| --- | --- | --- |
| Tracking | up to 6° | Marker drawn normally |
| Sampled | 6° to 60° | Marker at full opacity, with a note that successive frames are far apart in the orbit |
| Plane only | above 60° | Marker faded; the orbit path, the plane and the drift readouts are the visualization |

Because the measure is true anomaly rather than mean motion, an eccentric orbit
is judged by how far it actually moves: the highly elliptical example changes
band *within* one orbit, readable across its long apoapsis arc and faded through
the periapsis rush. That is an accurate picture of what an eccentric orbit does.
