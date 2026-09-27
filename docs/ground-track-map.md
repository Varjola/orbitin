# 2D ground-track map

The ground-track map is a flat world map that can be opened beside the 3D
globe. It draws the same ground-track data described in
[`ground-track-model.md`](./ground-track-model.md): the same current
sub-satellite points, the same computed windows and the same recorded trails,
published once per frame and consumed by both views.

It is a view, not a second simulation. It has no clock, no propagator, no
sampler, no history recorder and no object list of its own. Nothing you do on
the map changes an orbit, the time or any object's own display settings, and
opening or closing it never clears a recorded trail. Clicking on the map selects
objects with the same rules as the 3D view (see
[`modes-and-scenes.md`](./modes-and-scenes.md)).

## Content and picking

The map draws a current-position marker for every scene object whose body is
visible, whether or not its ground track is on. Ground tracks and sensor areas
are drawn only for objects with those layers on. Every selected object is
named beside its marker, the primary selection first, up to ten names; the
object under the pointer is always named.

The map shows no text below it. Its description for assistive technology - how
many objects are shown and how many have ground tracks or sensor geometry, the
selected and track- or sensor-enabled objects (up to ten, then `+<k> more`),
the line key and the latitude convention - is kept as visually hidden text. The
empty-map prompt and the one non-fatal notice (coastlines or the drawing
surface unavailable) appear over the map only when they apply.

A click within 8 CSS px of a marker, or within 5 px of a visible ground track,
selects that object; an exactly polar position is picked anywhere along its
highlighted edge. Picking uses the geometry the map already drew and never
resamples a track. Map hits have no depth, so when several are equally close
the order falls to the object id, and a click that remains ambiguous opens the
same chooser as the 3D view, anchored inside the map. A right click on the map
clears the selection.

## Maximized map

**Maximize map** turns the map into the alternative main view: it fills the
visualization area while the workspace, inspector, time controls, Scene
Objects list and catalogue launcher stay usable above it. Its width follows
only the workspace and inspector, so it resizes only when one of them opens or
closes. Its height is fixed: it starts below the row of floating tools (Create
orbit or the catalogue launcher, and Scene Objects) and ends above the compact
time bar, beside which **Restore map** and **Close map** sit. Expanded tools -
the time drawer, the Create orbit menu, an expanded Scene Objects list -
overlay the map like any drawer.
While it covers the 3D view, 3D drawing is skipped; the simulation and the map
keep running, and **Restore map** resumes 3D drawing on the next frame.
Maximizing or restoring closes any hover label and chooser that belonged to
the covered or resized view; the selection is never changed.

## Projection

The map uses a fixed Plate Carrée (equirectangular) projection over the whole
world, in a 2:1 frame:

```text
x = (longitude + 180°) / 360°   across the frame
y = (90° − latitude)  / 180°    down the frame
```

Longitude and latitude are the lesson here, so the projection is deliberately
the simplest one that shows them directly. There is no pan, zoom or
recentering, and no alternative projection.

Because it is equirectangular, **area and shape distortion grow towards the
poles**. Two tracks that look equally long near the top of the map cover very
different distances on Earth. The map is for reading latitude limits, longitude
drift and successive-pass spacing, not for measuring area.

## Surface coordinates: geodetic here, geocentric on the globe

The map and the 3D globe use two different, deliberately named surface
coordinate systems for the same Earth-fixed position.

| | 3D globe and Earth-relative readout | 2D map |
| --- | --- | --- |
| Surface | Sphere of radius 6378.137 km | WGS-84 reference ellipsoid |
| Latitude | Geocentric | Geodetic |
| Longitude | East-positive, `[−180°, +180°)` | The same value, unchanged |

The reason is the basemap. Coastlines are geographic data, plotted against
geodetic latitude. Drawing a geocentric latitude against them would place the
track in a subtly different surface coordinate system, and the two definitions
differ by up to about **0.19° near 45° latitude** (roughly 21 km on the
ground), which is visible against a coastline.

The spherical projection, the rendered globe and the **Geocentric latitude**
readout keep the geocentric convention, and the map states its own convention
in its description.

Geodetic latitude is computed from the full Earth-fixed position with Bowring's
closed-form solution on the WGS-84 ellipsoid (`a = 6378.137 km`,
`f = 1/298.257223563`). Across the supported orbital range it recovers the
generating latitude to better than `1e-6` degrees, which is far below every
other error in the pipeline. No geodetic height is computed or displayed.

## What the lines mean

The meanings are identical to the 3D view:

- **Solid**: the track already flown over the previous nominal orbit, computed
  from the selected model. It is a computation, not a recording.
- **Dashed**: the next nominal orbit, predicted by the selected model.
- **Recorded**: while **Record history** is on, the accumulated trail replaces
  both computed sides. It follows the same clearing rules: a date jump, Now,
  Reset, a playback reversal, an element edit or a propagation change discards
  it rather than joining two unrelated pieces.

The selected object is drawn with a heavier line and a ringed marker, and it
is named beside its marker and in the map description, so colour is never the
only source of meaning.

A ground-track line has no width. It is not a footprint, not a swath and not
area coverage. The current instantaneous idealized sensor footprint and
field-of-regard overlay are described in
[`sensor-footprint-model.md`](./sensor-footprint-model.md). Accumulated
coverage is outside this map's scope.

When Sensor geometry is enabled, the map draws the current spherical FOV fill
and, when distinct, the dashed FOR boundary on the same foreground/current-data
Canvas as the sub-satellite markers. It does not create a Canvas per footprint
or redraw stable track canvases. Sensor geometry may be visible independently
of a ground track.

## Seams, poles and gaps

The map consumes the segmentation the ground-track domain already performs and
never re-derives it:

- At the ±180° antimeridian a track is split into two segments with paired
  endpoints, one ending exactly on one border and the next starting exactly on
  the other. No line is ever drawn straight across the map.
- Both the left and right borders are labelled **180°**, because they are the
  same meridian.
- Longitude is undefined at a pole, while the map expands that single physical
  point into an entire top or bottom edge. A polar endpoint inside a line is
  placed using the nearest defined longitude **within its own segment**, so an
  incoming and an outgoing pass leave the pole on their own sides. When the
  current point itself is exactly polar, the map highlights the whole edge and
  the readout continues to say **Undefined at pole** rather than inventing a
  longitude.
- A failed or skipped sample is a break. The map draws valid segments on either
  side of it and never bridges the gap.

## Basemap

The coastline layer is the generalized **Natural Earth 1:110m coastline**,
served from this application with no tile service, CDN, API key or runtime map
library. It provides geographic context only: no labels, no terrain and no
satellite imagery.

**Country borders** come with the *Map-style Earth* (View drawer, *Look*;
Layers on phones), on the globe and on this map alike. They are the Natural
Earth 1:50m admin-0 land boundary lines, loaded on first use and drawn below
the tracks. Natural Earth draws de facto
boundaries; disputed, indefinite and line-of-control segments are dashed, and
Orbitin takes no position on any disputed boundary.

*Made with Natural Earth.* Source: `nvkelso/natural-earth-vector`, tag
`v5.1.2`, file `geojson/ne_110m_coastline.geojson`, deployed unmodified as
`public/assets/maps/ne_110m_coastline.geojson`. Provenance, byte count and
SHA-256 are recorded in `assets-source/maps/README.md`; Natural Earth places
its map data in the public domain. See also [`ATTRIBUTION.md`](../ATTRIBUTION.md).

At 1:110m the coastline is heavily generalized. It is context for reading a
track, not survey geometry, and a track that appears to pass just offshore may
in reality pass just inland.

The basemap is optional and loaded lazily the first time the map is opened. If
it cannot be fetched or fails validation, the map says so once and keeps its
ocean, graticule, labels and every orbital track.

## Accuracy limits

The map combines layers whose accuracy limits are different and are not
interchangeable:

| Layer | What bounds it |
| --- | --- |
| Orbit state | The selected source and model: ideal two-body, educational secular J2, or TLE/SGP4 with its own age and source limits |
| Earth orientation | UTC treated as UT1, plus the precession/GMST budget in [`environment-model.md`](./environment-model.md) |
| Map point | WGS-84 geodetic latitude and east-positive longitude from that Earth-fixed state |
| Track sampling | 256 equal time intervals per nominal-period side, or the fixed recording grid for a trail |
| Seam endpoints | Interpolated between two propagated samples; a seam point is a display coordinate, not a propagated state |
| Coastline | Generalized Natural Earth 1:110m context |
| Projection | Equirectangular: distortion grows towards the poles |

There is no single kilometre figure for "how accurate the map is". A TLE track
that lines up convincingly with a coastline is still limited by the age and
provenance of that TLE, by SGP4, by the Earth-orientation approximation, by the
sampling interval and by the generalized basemap.

## Performance and resources

The map uses a fixed set of four canvases whatever the number of objects, so
its memory does not grow with the number of tracks:

- the background (ocean, graticule, labels and coastline) is redrawn only on
  load, resize or a device-pixel-ratio change;
- one canvas holds every unselected track. It is redrawn at once when a
  track's colour, selection or visibility changes, and at most ten times a
  second when windows or trails are refreshed;
- one canvas holds the selected tracks, redrawn whenever they change;
- a growing recorded trail appends only its new suffix, and falls back to a
  full redraw when the published structure is not a strict extension;
- the overlay - markers, sensor areas, halos, reveal rings and labels - is
  redrawn at frame cadence; and
- a closed map draws nothing and releases its pixel buffers, keeping only small
  references to data the runtime already owns.

The maximized map is several times larger, and rasterizing every track on it
in one frame costs far more than a frame. When one of its track canvases holds
more than four tracks, it is rebuilt four tracks per frame in one extra back
buffer and replaces the visible canvas in a single copy. Window and trail
updates start such a rebuild at most four times a second, and a selection
change starts one at once. A newly selected single track still appears in the
frame of the click. After a resize, or when many tracks change together, the
tracks can therefore take a few frames to complete. Restoring the map releases
the back buffer.

Drawing is deferred entirely until the container has a real size.
