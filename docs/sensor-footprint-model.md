# Instantaneous sensor footprint model

Orbitin adds one source-independent, idealized sensor view to conceptual and
real-world orbital objects. It is a visualization setting authored by the
learner. For TLE, OMM and catalogue objects it is not payload metadata and
does not claim that the spacecraft carries or operates such an instrument.

## Definitions

- **Field of view (FOV):** a circular cone about the current nadir boresight.
  The learner authors its **view half-angle**; the full cone angle is twice it.
  The half-angle is a physical property of the hypothetical sensor. A 10 deg
  sensor is a 10 deg sensor in LEO, MEO, GEO or an eccentric orbit, and no
  orbit changes it.
- **Steering limit:** the largest off-nadir angle the boresight may take in any
  azimuth. It is also a physical angular capability, not a requested surface
  reach.
- **Footprint:** the part of the opaque spherical Earth intersected by the
  current nadir FOV at one simulation instant. It is derived, never authored.
- **Field of regard (FOR):** the union reachable by steering that circular
  cone through every azimuth up to the steering limit. It describes
  reachability, not where the sensor is currently pointed or accumulated area.
- **Accumulated coverage:** observations or reachability combined over an
  interval. It is not implemented by this instantaneous result.
- **Ground reach constraint (minimum ground elevation):** an optional,
  simplified access constraint kept separate from the sensor. It excludes
  surface locations where the spacecraft appears lower than the stated
  elevation above the local horizon. It defaults to 0 deg, which is pure
  geometric visibility.

The current pointing is always nadir. Commanded off-nadir attitude, spacecraft
body frames, scan laws, payload shapes and observer visibility are not modelled.
The FOR is symmetric in every azimuth, so its boundary is another circular
spherical cap centred on the sub-satellite point.

The relationship the tool teaches is:

```text
view half-angle + current orbit
        -> ray/Earth intersection
        -> instantaneous footprint
        -> horizon, or an optional minimum-elevation reach constraint
```

## Educational use

The primary comparison applies the **same sensor to different orbits**. Every
new object starts with the same hypothetical sensor, a 5 deg view half-angle
and 3 deg of steering, with no reach constraint:

| Orbit (circular) | Horizon half-angle | Footprint radius | Earth-central angle | Edge elevation | FOR radius |
| --- | --- | --- | --- | --- | --- |
| 500 km LEO | 68.02 deg | 44 km | 0.39 deg | 84.6 deg | 70 km |
| 26,560 km radius MEO | 13.89 deg | 1,812 km | 16.28 deg | 68.7 deg | 3,052 km |
| GEO | 8.70 deg | 3,360 km | 30.18 deg | 54.8 deg | 6,560 km |

Nothing about the sensor differs between those rows; only the geometry does.
All three are limited by the sensor angle. Near the elliptical example's
apoapsis the horizon half-angle is 7.92 deg, so its 8 deg field-of-regard ray
limit is horizon-limited there, which is a real result rather than a defect.
Widening the GEO sensor past 8.70 deg is likewise allowed: the authored angle is
kept, the footprint stops at the limb, and the view says so.

The **inverse question** - what half-angle would each orbit need for comparable
ground coverage? - is a secondary exercise. It is answered exactly by

```text
theta = atan2(R sin(psi), r - R cos(psi))
```

for a desired Earth-central angle `psi`. A 1,000 km footprint radius
(`psi` = 8.98 deg) needs a 59.86 deg half-angle at 500 km but only 1.59 deg at
GEO. The tool does not author coverage directly; the learner sets an angle and
reads the coverage it produces.

## Spherical geometry

The physical surface is the same sphere rendered by the 3D Earth:

```text
R = 6378.137 km
theta_limit = asin((R / r) cos(eps_min))
psi_limit   = pi/2 - eps_min - theta_limit
```

Here `r` is the current geocentric spacecraft radius, `theta` is an off-nadir
ray angle, `eps_min` is the ground reach constraint's minimum elevation and
`psi` is the Earth-centred angular radius of the surface cap. At `eps_min = 0`
these reduce to the horizon angles `asin(R / r)` and `acos(R / r)`, so the
constraint generalizes the horizon clip rather than sitting beside it. For
either FOV or FOR:

```text
if theta >= theta_limit:
    psi = psi_limit         # minimum-elevation-limited, or horizon-limited at eps_min = 0
else:
    psi = asin((r / R) sin(theta)) - theta
```

The authored FOV half-angle and steering limit remain unchanged when the
surface result is limited. The view reports that limitation instead of silently
clamping the angle. Surface distance, area and the elevation at the boundary
are analytic:

```text
surface radius = R psi
area           = 2 pi R² (1 - cos(psi))
earth fraction = area / (4 pi R²)
edge elevation = pi/2 - theta_edge - psi
slant range    = sqrt(r² + R² - 2 r R cos(psi))
```

`theta_edge` is the ray angle the boundary actually sits at: the authored angle
while the cap is sensor-limited, and `theta_limit` once it is not. The edge
elevation therefore returns `eps_min` exactly in the limited case.

The implementation evaluates the small-angle area with a stable half-angle
identity. Boundary vertices are a bounded presentation ring; displayed area is
never estimated from that polygon.

## Authoring controls

The learner edits the view half-angle and steering limit in degrees, either by
typing an exact value (such as 5.00, 8.50 or 10.00) or by dragging a slider.
State stores exactly the typed or dragged angle. Surface coverage is always
derived.

The sliders are input devices over those angles, not a second authored
quantity. A slider linear in angle over a fixed 0-80 deg range cannot serve the
catalogue: at GEO only the first 8.70 deg reach additional surface, and one
0.5 deg notch near the limb would move the footprint from 58.9 deg to 69.2 deg
of Earth-central angle. So each slider:

- ends at the useful limit `theta_limit` for the orbit and the active reach
  constraint, which is stated beneath it ("Useful range at this orbit:
  0-8.70°"); and
- paces its travel half by the angle's fraction of that limit and half by the
  resulting Earth-central angle's fraction of `psi_limit`. Coverage pacing keeps
  the steep GEO limb controllable (under 0.15 percent of Earth's area per notch);
  angle pacing keeps the first degrees at LEO fine (about 0.11 deg per notch).
  The mapping is monotonic and is inverted exactly by bisection.

An authored angle past the useful limit pins the thumb at the end and is not
changed; the note beneath the control explains that the footprint is limited
and that widening further adds no surface. The steering slider runs over the
FOR ray limit from the current half-angle to `theta_limit`, because the FOR ray
limit is their sum.

The slider scale uses the orbit's periapsis radius rather than the current
radius. A per-frame scale would move the thumb under a drag, and the useful
limit is widest at periapsis, so an eccentric orbit can always reach every
angle it can use somewhere. Every displayed geometry number still comes from
the instantaneous result.

## Frames and map coordinates

The runtime transforms the already-propagated project-inertial position to
Earth-fixed coordinates using the frame orientation already calculated for
the current frame. No second propagation or Earth-orientation call is made.
The 3D result is attached to the Earth-fixed scene root, and its physical
points have norm `R` before a small rendering-only lift used to avoid
z-fighting.

The map uses east-positive longitude and WGS-84 geodetic latitude for coastline
alignment. That latitude is calculated from the same spherical Cartesian
intersection point; it is an additive display coordinate, not a claim that the
ray was intersected with a WGS-84 ellipsoid. The map unwraps the boundary ring
into continuous longitude, closes a pole-containing cap's fill along the pole
edge while leaving its outline open, and draws translated copies clipped to the
map, so a cap crossing ±180° or covering a pole appears as one continuous
shape. These are presentation paths only and do not change the domain cap or
area.

## Presentation and interpretation limits

The globe shows a translucent current FOV fill, its boundary, a secondary FOR
outline when steering makes it distinct, the nadir boresight and a few
explanatory rays. The readouts publish the authored half-angle, full cone angle
and steering limit; the horizon half-angle; the active reach constraint; and,
per cap, the surface radius, Earth-central angle, area and Earth fraction, the
elevation and slant range at the boundary, the highest geocentric latitude
reached, and what limits it: the sensor angle, the minimum ground elevation or
the horizon. The synchronized map draws the same immutable result on its
current-data foreground layer. A footprint may be shown without a
ground track; a ground-track centreline has no width and is not coverage.

The model omits atmosphere, terrain, clouds, refraction, illumination,
resolution, target detectability, payload performance, scan timing and
accumulation. Geometric reach is not a statement that an observation occurred.

The minimum ground elevation is a single scalar applied in every azimuth. It
can illustrate why a communications link is not usable all the way to the
geometric horizon, but it does not model rain, multipath, terrain, antenna
gain, atmospheric effects or a real station's azimuth-dependent mask, and it is
not a property of a generic imaging sensor.
