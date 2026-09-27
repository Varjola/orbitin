# Map basemap source

## `ne_110m_coastline.geojson`

The 2D ground-track map's optional coastline layer.

| Field | Value |
| --- | --- |
| Upstream project | Natural Earth Vector (`nvkelso/natural-earth-vector`) |
| Tag | `v5.1.2` |
| Upstream path | `geojson/ne_110m_coastline.geojson` |
| Retrieval date | 2026-09-09 |
| Bytes | 139,907 |
| SHA-256 | `851f581ff5ffb844deed8ae1a9ce22e3c4bb3d74fa342cadb5d8e39b41ae7c3c` |
| Deployed as | `public/assets/maps/ne_110m_coastline.geojson` |
| Transformation | **None.** The deployed file is a byte-for-byte copy. |

Source URLs, all checked on 2026-09-09:

- https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_coastline.geojson
- https://github.com/nvkelso/natural-earth-vector/releases/tag/v5.1.2
- https://www.naturalearthdata.com/about/terms-of-use/

## Reproducing the asset

There is no bake step. Because the deployed file is unmodified, reproducing it
means downloading that exact tagged file and verifying the hash:

```bash
curl -sSL -o ne_110m_coastline.geojson \
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_coastline.geojson
sha256sum ne_110m_coastline.geojson
```

`src/map/coastlineData.test.ts` re-checks the committed file's SHA-256 against
the value above and decodes it with the real production decoder, so a silently
replaced or corrupted asset fails the test suite rather than the browser.

## Contents

134 `LineString` features and 5,128 coordinate pairs. Coastlines only: no
country borders, no disputed-boundary policy, no labels, no raster imagery.
All coordinates lie within `[-180, 180] x [-90, 90]`; the top-level `bbox`
member contains `180.00000044181`, but no drawn coordinate does, so the strict
range validation in the decoder accepts the file as shipped.

## Terms

Natural Earth places its map data in the public domain and states that no
permission, fee or attribution is required, while asking that the project not
be misrepresented. The application credits **Made with Natural Earth** in
`docs/ground-track-map.md` and `ATTRIBUTION.md` for provenance rather than
obligation. The upstream terms page is linked above.

## `ne_50m_land.geojson`

Land polygons for the Map-style Earth. Loaded only when a learner first turns the layer on.

| Field | Value |
| --- | --- |
| Upstream project | Natural Earth Vector (`nvkelso/natural-earth-vector`) |
| Tag | `v5.1.2` |
| Upstream path | `geojson/ne_50m_land.geojson` |
| Retrieval date | 2026-09-26 |
| Bytes | 1,636,166 |
| SHA-256 | `e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b` |
| Deployed as | `public/assets/maps/ne_50m_land.geojson` |
| Transformation | **None.** The deployed file is a byte-for-byte copy. |

1,420 features (1,419 `Polygon`, 1 `MultiPolygon`), 60,669 positions. Split at the antimeridian; Antarctica closes along the south edge.

## `ne_110m_lakes.geojson`

Large lakes for the Map-style Earth. Loaded only when a learner first turns the layer on.

| Field | Value |
| --- | --- |
| Upstream project | Natural Earth Vector (`nvkelso/natural-earth-vector`) |
| Tag | `v5.1.2` |
| Upstream path | `geojson/ne_110m_lakes.geojson` |
| Retrieval date | 2026-09-26 |
| Bytes | 36,648 |
| SHA-256 | `eb02ecc86c82004fccbf979058bfabbbd6c2d07968c7844d38eb1c9152d2ffc9` |
| Deployed as | `public/assets/maps/ne_110m_lakes.geojson` |
| Transformation | **None.** The deployed file is a byte-for-byte copy. |

24 `Polygon` features, 465 positions.

## `ne_50m_admin_0_boundary_lines_land.geojson`

Country borders on the globe and the 2D map. Loaded only when a learner first turns the layer on.

| Field | Value |
| --- | --- |
| Upstream project | Natural Earth Vector (`nvkelso/natural-earth-vector`) |
| Tag | `v5.1.2` |
| Upstream path | `geojson/ne_50m_admin_0_boundary_lines_land.geojson` |
| Retrieval date | 2026-09-26 |
| Bytes | 760,189 |
| SHA-256 | `2faac4f6b34386f3d21b6e018cf151f241f00e5c936d44dd17d7d9bfb147fa48` |
| Deployed as | `public/assets/maps/ne_50m_admin_0_boundary_lines_land.geojson` |
| Transformation | **None.** The deployed file is a byte-for-byte copy. |

390 features (388 `LineString`, 2 `MultiLineString`), 19,859 positions. `FEATURECLA`: 355 international boundaries, 21 disputed, 7 lines of control, 5 indefinite, 2 indeterminate frontiers.

`src/map/geographyData.test.ts` re-checks all three hashes and decodes the
files with the production decoders. Reproduce them the same way as the
coastline, with the tagged raw URL of each upstream path.

### Boundaries

Natural Earth draws de facto boundaries. Orbitin shows them only when the
learner turns borders on, draws every class other than an international
boundary dashed, and takes no position on any disputed boundary.
