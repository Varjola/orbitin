# Asset Attribution

This project uses derived texture assets based on imagery published by NASA.

The MIT License in this repository applies to the project source code and
original project content. It does not alter the rights or usage terms of
third-party source imagery described below.

## Earth Day Texture

**Source:** Blue Marble: Next Generation  
**Publisher:** NASA Earth Observatory

Original local source:

- `BlueMarble_August_2km.png`

Derived production assets:

- `earth-day-4k.ktx2`
- `earth-day-8k.ktx2` (the optional high-resolution Earth on capable desktops)

Source information:

https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/

## Earth Night Texture

**Source:** Earth at Night / Black Marble  
**Publisher:** NASA Earth Observatory

Original local source:

- `BlackMarble_3km_gray.png`

Derived production asset:

- `earth-night-mask-4k.ktx2` (the city-light mask)

Source information:

https://earthobservatory.nasa.gov/features/NightLights

## Milky Way Band

**Source:** Deep Star Maps 2020, starless Milky Way variant  
**Publisher:** NASA Goddard Space Flight Center, Scientific Visualization Studio

**Credit line requested by the publisher:** NASA/Goddard Space Flight Center
Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC.

Original local source:

- `milkyway_2020_4k.exr`

Derived production asset:

- `band-density.bin`

Source information:

https://svs.gsfc.nasa.gov/4851/

This is the variant the SVS describes as omitting the bright Hipparcos and
Tycho stars, so it carries only the diffuse galactic component. That makes it
the complement of the star catalogue below rather than a duplicate of it.

The image is not displayed. It is reduced to a 512x256 map of relative sky
surface brightness, and the application draws the Milky Way as points sampled
from that distribution, alongside the catalogue stars and through the same
renderer.

**The band's points are statistical, not catalogue objects.** Their number in
any direction follows the real sky's surface brightness, so the band, the
bulge and the dust lanes appear where they belong, but each individual point
is generated rather than observed, and its magnitude and colour are drawn from
plausible distributions rather than measured. Nothing in the application
identifies or labels them. Everything the application presents as a star with
a position - the catalogue below - is real.

The bake is reproducible: `scripts/build-band-density.ts` records the
resampling and the orientation measurements, and fails rather than writing a
map it cannot verify against the galactic plane.

The repository also contains `scripts/build-nebulosity.ts`, which bakes the
same source into a 2K KTX2 background texture (`nebulosity-2k.ktx2`). The
application does not use that texture; the script is kept because it records
the `ktx create` parameters the Earth textures are encoded with.

## Star Catalogue

**Source:** HYG Database, version 4.1 (`hygdata_v41.csv`)
**Publisher:** David Nash / astronexus
**Licence:** Creative Commons Attribution-ShareAlike 4.0 International
(CC BY-SA 4.0)

Original local source:

- `hygdata_v41.csv`

Derived production asset:

- `stars.bin`

Source information:

https://github.com/astronexus/HYG-Database

The HYG database merges the Hipparcos, Yale Bright Star and Gliese catalogues.
It supplies the right ascension, declination, visual magnitude and B-V colour
index of every star the application renders.

`public/assets/starfield/stars.bin` is adapted material under CC BY-SA 4.0: it
is a filtered, reprojected subset of the HYG data, limited to visual magnitude
7.0. It is therefore distributed under the same CC BY-SA 4.0 terms, with
attribution to the source above.

This does not affect the licence of this repository's source code. The MIT
License continues to apply to the application, which reads the data file rather
than incorporating it.

Licence text:

https://creativecommons.org/licenses/by-sa/4.0/

## NASA Media Usage

NASA imagery is generally not subject to copyright in the United States,
subject to NASA's media usage guidelines and any restrictions noted for
individual assets.

NASA source acknowledgement is retained here for provenance and attribution.

NASA media usage guidelines:

https://www.nasa.gov/nasa-brand-center/images-and-media/

## Coastline basemap

**Source:** Natural Earth Vector, `geojson/ne_110m_coastline.geojson` at tag
`v5.1.2`
**Publisher:** Natural Earth (`nvkelso/natural-earth-vector`)
**Terms:** Public domain

Deployed production asset:

- `public/assets/maps/ne_110m_coastline.geojson`

The file ships **unmodified**. Its retrieval date, byte count and SHA-256 are
recorded in `assets-source/maps/README.md`, and the test suite verifies that
hash against the deployed file, so reproducing the asset means downloading that
exact tagged file rather than running a bake script.

Natural Earth places its map data in the public domain and requires no
attribution. This credit is kept for provenance:

*Made with Natural Earth.*

Source information:

- https://github.com/nvkelso/natural-earth-vector/releases/tag/v5.1.2
- https://www.naturalearthdata.com/about/terms-of-use/

The 1:110m coastline is a generalized geographic outline used as context on the
2D ground-track map.

## Land, lakes and country borders

**Source:** Natural Earth Vector, `geojson/ne_50m_land.geojson`,
`geojson/ne_110m_lakes.geojson` and
`geojson/ne_50m_admin_0_boundary_lines_land.geojson` at tag `v5.1.2`
**Publisher:** Natural Earth (`nvkelso/natural-earth-vector`)
**Terms:** Public domain

Deployed production assets, **unmodified**, with byte counts and SHA-256 in
`assets-source/maps/README.md`:

- `public/assets/maps/ne_50m_land.geojson`
- `public/assets/maps/ne_110m_lakes.geojson`
- `public/assets/maps/ne_50m_admin_0_boundary_lines_land.geojson`

They draw the Map-style Earth and the optional country borders on the globe
and the 2D map. Natural Earth shows de facto boundaries; Orbitin draws
disputed, indefinite and line-of-control segments dashed and takes no position
on any disputed boundary. Borders are shown only with the Map-style Earth.

## three.js and the Basis Universal transcoder

The 3D scene is rendered with [three.js](https://threejs.org/), distributed
under the MIT License (copyright © 2010-2026 three.js authors). The built
application bundles three.js code.

The compressed Earth textures are decoded by the Basis Universal transcoder
(`basis_transcoder.js` and `basis_transcoder.wasm`) that three.js ships with
its `KTX2Loader`. Basis Universal is copyright Binomial LLC and distributed
under the Apache License 2.0; the built application includes the transcoder
unmodified.

Source and licences:

- https://github.com/mrdoob/three.js
- https://github.com/mrdoob/three.js/blob/dev/LICENSE
- https://github.com/BinomialLLC/basis_universal
- https://github.com/BinomialLLC/basis_universal/blob/master/LICENSE

## TLE / OMM / SGP4 propagation

The Real Objects mode uses `satellite.js` version 7.1.0 for scalar SGP4/SDP4
propagation. `satellite.js` is distributed under the MIT License. The project
uses its scalar initializer and `sgp4` APIs through an application-owned
adapter; the application's frame conversion, validation and UI are original
project code.

Source and licence:

- https://github.com/shashwatak/satellite-js
- https://github.com/shashwatak/satellite-js/blob/main/LICENSE.md

## Published orbital catalogue

Orbital data: **USSPACECOM / 18th Space Defense Squadron, accessed via
Space-Track.org.**

The scheduled catalogue pipeline retrieves current GP/OMM mean elements from
Space-Track.org and republishes them as bounded, versioned snapshots behind the
application's own Worker and private R2 bucket. Browsers read only that
same-origin snapshot; they never contact Space-Track, and no Space-Track
credential exists in any published asset.

USSPACECOM has given express blanket approval for transfer and redistribution of
basic SSA data and services accessed via Space-Track.org, conditioned on
appropriate citation. Publications of analysis based on USSPACECOM data also
require appropriate citation. The citation above is carried in this file, in the
public catalogue documentation, in the application's catalogue panel (linked to
Space-Track.org, with the source retrieval time), and in the `provider` block of
every published snapshot manifest.

**Educational use only; not for conjunction assessment or operational
decisions.** The data is republished for education and visualization. It is not
suitable for operational use, and publicly available element sets must not be
used for conjunction assessment; operators requiring that should contact the
18th Space Defense Squadron.

**Derived classifications and calculations are produced by Orbitin.** Orbit
classes, altitude bands, orbit flags, SGP4 regime and the recovered period,
semimajor axis and perigee and apogee altitudes are this project's
deterministic analysis of the Space-Track data. They are published and shown
separately from provider-supplied values, and they are not claims made by
Space-Track or USSPACECOM.

Sources:

- [Space-Track.org](https://www.space-track.org/)
- [Space-Track.org documentation, user agreement and API guidelines](https://www.space-track.org/documentation)
- [CCSDS 502.0-B, Orbit Data Messages](https://ccsds.org/Pubs/502x0b3e1.pdf)

In the legacy catalogue profile (selected-id retrieval), which objects appear
and how they are grouped are this project's own educational definitions, not a
provider taxonomy. The
automatic catalogue has no hand-maintained membership: it contains the records
returned by the documented Space-Track GP query that pass validation.

## Satellite group membership

The official satellite groups (GPS, Galileo, GLONASS, BeiDou, the crewed space
stations, the geostationary weather satellites, the Copernicus Sentinels and
Norway's Arctic HEO satellites) are rosters of NORAD catalogue numbers
reviewed by hand against each system's public status page, named in the
application beside each group: the U.S. Coast Guard Navigation Center, the
European GNSS Service Centre, the Information and Analysis Center for
Positioning, Navigation and Timing, the China Satellite Navigation Office Test
and Assessment Research Center, NASA and the China Manned Space Agency, WMO
OSCAR/Space, ESA and EUMETSAT, and Space Norway. Catalogue numbers were
cross-referenced with the public CelesTrak data. Group membership is a fact
list, not a copy of any of those pages, and it changes only in a new review.
