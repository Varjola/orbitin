# Ground-track model

Orbitin's ground track is the Earth-relative locus of an orbital object's sub-satellite point. The instantaneous point is the radial
projection of the object's Earth-fixed position onto the spherical Earth
rendered by the application. It is not a pass for an observer and it is not a
sensor footprint.

## Surface and coordinates

The rendered Earth is a sphere with reference radius `6378.137 km`. This is a
visualization convention using the centralized WGS-84 equatorial radius; it is
not an assertion that Earth is spherical. Latitude is geocentric and
north-positive. Longitude is measured from the Earth-fixed `+X` Greenwich
meridian, is east-positive, and is displayed in `[-180°, +180°)`.

Each sub-satellite point additionally carries a **WGS-84 geodetic latitude**
derived from the same Earth-fixed position. The 3D globe and the
**Geocentric latitude** readout use the geocentric value and the spherical radial projection described above.
The geodetic value exists for the 2D map, which is drawn against geographic
coastline data. The two definitions agree at the equator and the poles and
differ by up to about 0.19° near 45°. See
[`ground-track-map.md`](./ground-track-map.md).

At the exact poles the Cartesian surface point remains defined, but longitude
is geometrically undefined and the UI says **Undefined at pole**. A small
dimensionless horizontal-radius threshold is used only to keep that readout
conditioned.

For every sample, ProjectInertial position is transformed to the mean-of-date
EarthFixed frame using the orientation at that sample's timestamp. The
antimeridian is segmented before rendering so neither the 3D line nor the
2D map has to infer a longitude wrap from scene geometry. A seam point's two
latitudes are interpolated independently at the crossing fraction, and its unit
direction is rebuilt from the geocentric value alone.

## Window and sampling

The selected object displays one nominal orbital period before the current
instant and one after it. Each side uses 256 equal time intervals. The solid
line is a computed trailing track; it is not recorded history. The dashed line
is a prediction under the selected propagation model. The current dot is
calculated from the exact current state used for the orbital body.

The window is source-agnostic: ideal two-body and secular-J2 objects call their
own `stateAt` implementation, and TLE/OMM objects propagated with SGP4 use
the same contract. The nominal period bounds the presentation window; it is not a nodal
or repeat period. UTC is the product's simulation time and approximates UT1,
with the Earth-orientation limits described in
[`environment-model.md`](./environment-model.md).

## Interpretation and limits

A ground-track centreline has no width and does not show area coverage. A
footprint, field of view, field of regard or accumulated coverage requires a
sensor and pointing model, an interval and a surface-intersection policy.
The current instantaneous idealized sensor model is documented in
[`sensor-footprint-model.md`](./sensor-footprint-model.md); accumulated
coverage is not modelled. WGS-84 geodetic conversion and the flat map are
documented in [`ground-track-map.md`](./ground-track-map.md); longer
accumulated traces and repeat-cycle analysis are not modelled.

The visual line is lifted slightly above the sphere and receives a small
renderer depth bias to avoid z-fighting across camera distances. Depth testing
remains enabled, so Earth still occludes the far side of the track. The lift is
not physical altitude and is excluded from all readouts. The track inherits
the selected source model: the ideal two-body and secular-J2 models are
educational models with the limitations recorded in
[`orbit-perturbation-model.md`](./orbit-perturbation-model.md), and an SGP4
track carries the source-age and model qualifications described in
[`tle-and-sgp4.md`](./tle-and-sgp4.md).
