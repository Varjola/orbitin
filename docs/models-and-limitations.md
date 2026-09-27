# Models and limitations

Orbitin is made for learning how orbits work and for seeing where real
satellites are. It is **not suitable for conjunction assessment, collision
avoidance, navigation, pass planning or any operational decision**. This page
says what each model includes, what it leaves out, and how far its numbers can
be trusted. The detailed documents it links to are the authority.

## Two modes, three orbit models

| Mode | Model | Includes | Leaves out |
| --- | --- | --- | --- |
| Orbit Lab | **Ideal two-body** | A Keplerian conic around a point-mass Earth; the orbital plane stays fixed in space | Everything else |
| Orbit Lab | **J2 drift** (secular J2) | The secular drift of the node and the periapsis caused by Earth's oblateness, on mean elements; the Sun-synchronous lock solves the inclination that matches the mean Sun | Drag, Sun and Moon gravity, solar radiation pressure, short-period and long-period variations, higher zonal harmonics |
| Real Objects | **SGP4/SDP4** via [satellite.js](https://github.com/shashwatak/satellite-js) 7.1.0 | The standard analytical propagator for published GP (TLE/OMM) mean elements, including its drag term (B\*) and, for deep-space orbits, the lunar-solar and resonance terms of SDP4 | Anything the GP element set itself does not capture; no covariance or error bound |

Orbit Lab elements are **osculating classical elements** of the educational
conic. Catalogue, TLE and OMM elements are **SGP4 mean elements** at their
epoch. The two are different quantities: Orbitin never converts one into the
other, and a real object cannot be edited as a conic.

Orbit Lab keeps periapsis above 200 km, because drag is outside its models,
and apoapsis below 60,000 km, the framing limit of the view.

Details: [orbit-perturbation-model.md](./orbit-perturbation-model.md) and
[tle-and-sgp4.md](./tle-and-sgp4.md).

## Time and reference frames

- **One clock** drives every orbit, the Sun and Earth: POSIX UTC seconds
  without leap seconds, from 1950 through 2050. At 1× forward playback it
  follows the wall clock, including time spent in a background tab.
- **Real Objects** opens at the current time at 1×, with a **Live** badge while
  the clock follows real time. **Orbit Lab** opens at a fixed teaching instant,
  2026-03-20 12:00 UTC.
- **Earth orientation** uses IAU 1982 GMST and IAU 1976 precession. Earth-fixed
  is the mean-of-date frame rotated by GMST, not ITRF. Nutation is omitted
  for Earth orientation (about 0.005°), UT1 − UTC is taken as zero (at most
  about 0.004°) and polar motion is omitted (about 0.0001°).
- **SGP4 output** is in TEME. Orbitin converts position and velocity to its
  J2000 frame through IAU 1980 nutation and IAU 1976 precession, with UTC
  standing in for UT1; against the published Vanguard 1 example the residual
  of this conversion is under 1.2 m.
- **The Sun** follows the USNO approximate solar formulation, about one
  arcminute of accuracy; its position relative to Earth's surface is good to
  about 0.03°, a few kilometres at the equator.

Details: [environment-model.md](./environment-model.md).

## Earth's shape

The 3D Earth is a sphere with the WGS-84 equatorial radius (6,378.137 km).
Altitude readouts are heights above that sphere, not geodetic heights. The 3D
ground tracks are geocentric on the sphere; the 2D map plots WGS-84 geodetic
latitude. Near the poles the two differ by up to about 0.19°.

Details: [ground-track-model.md](./ground-track-model.md) and
[ground-track-map.md](./ground-track-map.md).

## How accurate are real objects?

A published element set describes an object's orbit around its **epoch**, the
moment it was fitted. SGP4 predictions are most accurate near that epoch and
drift further from the truth the further the clock moves from it. For many
low Earth orbit objects the error is of the order of a kilometre near epoch
and grows by a few kilometres per day; it depends strongly on the object, its
altitude, solar activity and manoeuvres, and no general bound exists. Orbitin
therefore:

- shows each object's **element epoch and age**, and the **publication time**
  of the catalogue snapshot;
- warns qualitatively when the clock is more than about 3 and 14 days from an
  object's epoch;
- makes no accuracy claim and reports no covariance.

The published catalogue is refreshed by an automatic sweep of the Space-Track
GP class (current element sets with an epoch in the last ten days and no decay
date). A full sweep takes several hours, so the snapshot is eventually
current, not real time. It is not a complete list of every human-made object in
orbit, and appearing in it does not mean an object is active.

Details: [catalogue-and-omm.md](./catalogue-and-omm.md).

## Satellite groups

GPS, Galileo, GLONASS, BeiDou, the crewed space stations, the geostationary
weather satellites, the Copernicus Sentinels and Norway's Arctic HEO
satellites are **reviewed rosters** of catalogue numbers, taken by hand from
each system's public status page on the review date shown beside the group.
Membership is not a live health status: a listed satellite may be under test
or marked unusable, and a new launch or a retirement appears only after a new
review. Members missing from the loaded catalogue are reported, never
invented. The live facts on a group's page (median inclination and period,
altitude range) are computed from the members' mean elements.

## Sensor geometry

The sensor view is an idealized circular cone pointed at nadir, set by the
learner, over an opaque spherical Earth. The footprint is instantaneous; the
field of regard is what steering could reach, not accumulated coverage. The
minimum ground elevation is a simplified access limit, not a model of a real
ground station. For real objects the sensor is hypothetical and does not come
from the object's record.

Details: [sensor-footprint-model.md](./sensor-footprint-model.md).

## What is drawn larger or more vividly than life

- **Markers** are enlarged so that satellites stay visible; the orbit paths
  and positions are not.
- **The atmosphere** is drawn about seven times thicker than the real
  scattering layer so that it shows at the scene's scale. Its colours come
  from a simple scattering model (blue sky, reddened sunlight near the
  terminator, Earth's shadow) that is not calibrated. **The Sun's glare and
  lens flare** are illustrative, as a camera would record them. The Sun's
  disc itself is drawn at its true angular size.
- **The Map-style Earth** is an atlas drawn from Natural Earth land and lake
  outlines, with **country borders** from Natural Earth's de facto boundaries
  (disputed segments dashed). Neither is survey geometry.
- **The Lab backdrop** in Orbit Lab is a teaching view: a plain Earth, no Sun
  or stars, and a grid box whose squares are a stated number of Earth radii.
  Object colours that would be too light on it are drawn darker; the chosen
  colours are kept.
- **City lights** are a static night mask. There are **no clouds**: a fixed
  cloud image would show weather that is not there.
- **Day and night on the 2D map** use a spherical Earth, with shading that
  deepens from sunset to 12° of solar depression.
- **Stars** are real catalogue stars (HYG, to magnitude 7); the **Milky Way**
  is drawn as points whose density follows the real sky's brightness, but each
  point is generated, not observed.

## Not supported

Pass prediction, conjunction or collision analysis, re-entry prediction,
manoeuvre planning, antenna pointing, precise timing and any use that needs an
error bound.
