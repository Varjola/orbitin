# Real Objects: OMM and the published catalogue

The **Real Objects** mode supports two local source paths:

- **Manual TLE / 3LE** - the strict two-line format, also used by the TLE
  inspector.
- **Manual OMM keyed JSON** - one JSON object using the OMM field names. A
  provider array, XML/KVN document, comments and a browser-to-provider request
  are not accepted.

Both formats are identifiable in the selected-object readout. Their fields
are converted once into the application's source-neutral `Sgp4MeanElements`
definition and then use the same scalar SGP4/SDP4 initializer, TEME conversion,
sampled trajectory, Earth-fixed ground track, recorded history and synchronized
2D map. OMM is not converted into synthetic TLE text.

## Educational use only

The catalogue is for learning and visualization. It must not be used for
conjunction assessment, collision avoidance, navigation, tracking or any
operational decision. Element sets are illustrative and may be incomplete or out
of date. An object appearing in the catalogue means only that the provider
published a current element set for it; it does not mean the object is active.
The application shows this warning in the catalogue panel before anything is
loaded.

## Published catalogue

Real Objects mode shows **Enable catalogue** and fetches nothing until it is
chosen. Enabling downloads and verifies the pointer, manifest and search index
only. Search is local; showing an object's details, comparing, or choosing
**Add to scene** or **Add selected to scene** fetches only the distinct
immutable record shards needed, each once.
Search results are not orbital objects and do not allocate a propagator, scene
view, track cache, history, sensor or map object. At most 100 results are
rendered for any query; that is a display limit, not a catalogue size limit,
and the result count says so, for example `Showing 100 of 4,218 matching
objects`.

## Two snapshot profiles

`/catalog/v1/` carries one of two profiles, distinguished exactly by the
manifest:

- **Legacy profile** (no `catalogueProfile` marker). A small reviewed
  selection grouped into teaching catalogues, produced by the selected-id
  retrieval mode. Records carry propagation data, a provider name and a
  designator, nothing more.
- **Automatic profile.** Every current record returned by the adopted
  provider query, with no hand-maintained membership. The manifest, index and
  every shard carry the same `catalogueProfile` marker. A snapshot that carries
  part of the automatic profile without all of it is rejected, and the browser keeps
  the last valid catalogue.

### Source metadata and derived metadata

An automatic record keeps two kinds of metadata apart, in the published data
and in the interface:

- **Source metadata** is what the provider supplied: object type, country or
  source code, launch date and site, decay date, radar cross-section size
  category, the provider's own orbit summary values, and the record's creation
  time. Provider codes are shown as codes. Missing values stay missing.
- **Derived metadata** is calculated by Orbitin from the
  initialized SGP4 elements under a versioned rule set (`orbit-classes/1`):
  recovered period, semimajor axis, perigee and apogee altitude, SGP4
  near-Earth or deep-space regime, altitude band (low, medium, high Earth or
  crossing bands), and the near-polar, near-equatorial, high-eccentricity,
  near-geosynchronous and GEO-like flags. These are educational discovery
  labels, not provider claims or legal orbit definitions.

Result columns are labelled **(provider)** or **(derived)**, and the Details
panel groups provider facts separately from a section headed **Derived by
Orbitin**.

Values that are the same for every record of one retrieval - provider, source
authority, query description, retrieval start and completion time, OMM version,
originator when uniform, and the adapter and derivation rule versions - are
published once in the manifest. An imported object combines them with its own
record provenance, and keeps them when application state is saved and reloaded.

### Search

Search is local and deterministic. Every query word must match some field:

- names, catalogue ids and international designators match anywhere in the
  text;
- object type, country or source code, launch date or year, derived orbit
  class, altitude band, SGP4 regime and orbit flags match at the start of a
  word, for example `rocket body`, `1998`, `polar`, `geo` or `deep space`;
- element epoch is searchable as `epoch-2026-09-12`, so a year does not match
  every epoch.

An exact catalogue id ranks first, then ids starting with the query. Search text
is prepared once while the catalogue loads. Missing metadata creates no search
token.

Quick Search (the search field over the scene, and search on a phone) also
knows **common names**: a short reviewed alias table in the application maps
names such as *ISS*, *Hubble*, *Tiangong*, *GOES-East* or *GLONASS* to their
catalogue numbers, because the published names are often different (Hubble is
`HST`, GLONASS satellites are `COSMOS nnnn`). An exact catalogue id still ranks
first, then alias matches, then whole names and names starting with the query,
then other matches, so `ISS` finds the station before its modules or debris.
The aliases are client-side only and never change the catalogue. The full
Catalogue search keeps its own sorting.

## Exploring the catalogue

The Catalogue workspace opens over the visualization with its full search field
first after **Close catalogue**. Before anything is typed it shows the first
100 objects and an **Explore** list of broad educational views: low Earth,
medium Earth, geosynchronous and highly elliptical orbits, rocket bodies and
debris. Each view's member count and composition facts come from the loaded
search index; nothing is counted from record shards. Filters and sorting narrow
a view, **Clear filters** stays in it, and **Browse all objects** or typing in
the full search returns to the whole catalogue. Legacy-profile snapshots, which lack
the metadata these views need, list their published groups instead.

Below the broad views, **Satellite groups** lists the official groups: GPS,
Galileo, GLONASS, BeiDou, the crewed space stations, the geostationary weather
satellites, the Copernicus Sentinels and Norway's Arctic HEO satellites. Each
is a reviewed roster of catalogue numbers with its authority, review date and
revision; members absent from the loaded catalogue are reported, never added.
A group's page offers **Add all members to scene** and **About this group**,
a short education page whose live facts (median inclination and period,
altitude range) are computed from the members' records when it opens. On a
phone the groups appear as tiles in the Add sheet with the first sentence of
that page. Membership changes only in a new review; see
[models-and-limitations.md](./models-and-limitations.md).

Object type and orbit class filters are always visible; **All filters** reveals
SGP4 regime, orbit geometry, country or source code, launch year and element
set age. Object type, orbit class, SGP4 regime and country/source code are
alternative choices within their own groups: each displayed count keeps the
other groups applied while leaving that group out of the count. Orbit-geometry
counts are additive: they keep every already selected geometry flag and add the
candidate flag, so checking several flags means that all of them must be
present. Provider country and source values are codes exactly as published by
the provider.

Results can be sorted by relevance, name, catalogue id, launch date or element
epoch, and appear as a table of name and designator, NORAD id, object type,
orbit class, launch date and element epoch. Narrow screens show a compact row
without the two dates. Choosing an object's name, or its row, opens it in the
**Details** tab, which loads that one record. **Compare** keeps up to four
records in insertion order in the **Compare (n/4)** tab; a dash in a comparison
cell means that the value is absent for that record, not zero. Only pressing **Compare**
opens that tab; a fifth object shows **Comparison full** until one is removed.
Each compared record loads on its own: a column that fails shows **Retry**
while the other columns stay usable, and records finishing in the background
never switch tabs or move keyboard focus. Removing a record or **Clear
comparison** changes only the comparison, not Details, the working selection
or the scene.

Each result row also has a checkbox that keeps that one object in the **Working
selection**. Checking loads no record, does not open Details or Compare and does
not change the scene. There is no range or select-all action. The selection
keeps its order and survives searching, filtering, sorting, Explore views,
closing the Catalogue and switching modes, so a small set can be assembled from
several searches. The header button **Working selection (n)** opens its tab,
which lists every checked object, including ones outside the current results,
with **Remove** per object and **Clear working selection**. Before anything
loads, the tab shows how many objects are selected, how many are already in the
scene, how many are new and how many scene slots remain. **Add selected to
scene** adds every new object at once or nothing: if the new objects do not
fit, the button is disabled and the tab says how many to remove, and no record
is fetched. A successful add keeps the Catalogue and the selection open, marks
the objects **In scene** and offers **View scene**, which closes the Catalogue.
Objects are removed only in Scene Objects; removing them there, even all of
them, keeps the catalogue loaded. Adding several objects never moves the
simulation clock to an element epoch; the **Go to element epoch after adding**
option applies only to a single object added from Details or Compare.

Details, comparisons, the working selection and filters are temporary
workspace state: nothing in the catalogue explorer is saved, and loading a
newer catalogue clears the working selection with a notice. Only **Add to
scene**, **Add selected to scene** and an official-group page's **Add all
members to scene** create orbital objects in the Real Objects scene. If a
requested catalogue record is already present, the application fetches nothing
and selects the existing object instead of duplicating it. Each scene holds at
most 100 objects; an add that does not fit is refused as a whole, before any
record is fetched, until objects are removed (see
[`modes-and-scenes.md`](./modes-and-scenes.md)).

## Automatic retrieval: the hourly sweep

The automatic catalogue is retrieved as a persistent keyset crawl of the
Space-Track GP class, one bounded page per hourly run:

```text
GET /basicspacedata/query/class/gp/decay_date/null-val/epoch/%3Enow-10/NORAD_CAT_ID/%3E<cursor>/orderby/norad_cat_id%20asc/limit/4000/format/json
```

- Each run makes at most one GP query (plus login and logout). The cursor
  starts at 0 and advances to the last catalogue id of each full page.
- Pages must be JSON arrays of at most 4,000 records with strictly ascending
  ids above the cursor. They are staged privately and never served.
- The first page shorter than 4,000 records completes the sweep. The next
  hourly run makes the curated supplement request below instead of a page,
  and only then is the whole candidate validated and published atomically.
  At the current catalogue size a sweep takes about eight hours and a new
  catalogue appears about every nine; catalogue freshness is intentionally
  eventual.
- After a successful publication the next hourly run starts again from 0.

### Curated member supplement

The official groups and the "Start with" featured picks are the objects
Orbitin points learners to, and some of them are updated by the provider less
often than every ten days. So that a reviewed group does not silently lose a
member, each sweep is followed by one batched request for exactly those
catalogue ids:

```text
GET /basicspacedata/query/class/gp/NORAD_CAT_ID/<curated ids>/decay_date/null-val/epoch/%3Enow-30/orderby/norad_cat_id%20asc/format/json
```

- The ids and the 30-day limit come from one reviewed source file,
  `src/data/curatedCatalogue.ts`, which also defines the frontend's group
  memberships and featured picks. At most 500 ids.
- It is the only provider request of its hour, so requests stay at one per
  hour.
- The sweep's own record wins for any id it already has; the supplement only
  fills curated ids the sweep lacks, so a curated member may be up to 30 days
  old where every other object is at most ten. The element-age warnings shown
  for every object apply to it unchanged.
- A decayed member, or one whose newest element set is older than 30 days,
  stays absent.
- The manifest's `sourceRun.queryDescription` names the supplement when it
  was used. Supplement records have the same shape as sweep records.
- The supplement is requested once per sweep. If it fails, or its response
  cannot be used, the catalogue is published from the sweep alone in the same
  run; publication retries and operator approval reuse the staged response
  and never request it again.

### Failures

| Situation | Behaviour |
| --- | --- |
| Network failure, timeout or provider 5xx | That hour's retrieval is used up. The cursor and public catalogue are unchanged; the same cursor is tried at the next hourly run. No retry in between. |
| Successful response with malformed or out-of-contract data | Fails closed exactly as above; the cursor does not advance. |
| Rejected credentials, 401, 403 or 429 | 24-hour cooldown. The same failure after the cooldown stops retrieval until the operator changes the configuration revision. |
| Configuration fault (redirect, not found, missing secret) | Stops retrieval until the configuration revision changes. |
| Structural candidate failure (broken page chain, digest mismatch, conflicting duplicate ids, mixed OMM versions, no records, count above the index bound, count below half of the previous automatic snapshot) | Candidate discarded; public catalogue unchanged; the next hourly run starts a new sweep. |
| Candidate crosses a policy threshold (first automatic snapshot from a live provider, published count more than 10 percent below the previous automatic snapshot, rejected records above 0.5 percent) | Held privately for operator review. Nothing is published until the operator approves that exact content digest or discards it. |
| Storage or publication failure of a valid candidate | Retried hourly from the staged pages, without contacting the provider, up to three attempts; then marked publication-failed for the operator while the previous catalogue stays public. |
| Curated supplement fails (any provider failure, bad response, or a response that breaks whole-run validation) | The catalogue is published from the sweep alone; the failure is kept for the operator. A refused session or rate limit starts the 24-hour cooldown after that publication, delaying the next sweep. |
| Sweep or candidate older than 48 hours, or provider/configuration change | Discarded; a new sweep starts. |

The thresholds are operating limits and may be tuned.

### Publication

The Worker publishes immutable manifest, index and 128 record shards to private
R2, one part at a time, verifying each part's length and SHA-256 as it is
written and again before the pointer changes. The current pointer is written
last with a conditional update, so a failed or interrupted publication leaves
the previous pointer usable. The current snapshot plus six previous successful
snapshots are retained.

## Selected-id rollback mode

Production uses the automatic hourly sweep. The selected-id retrieval mode
is kept for regression testing and rollback: one batched GP query
for a small reviewed selection, published as a legacy-profile snapshot with
eight shards. `CATALOGUE_RETRIEVAL=selected-ids` (the code default) selects it;
`CATALOGUE_RETRIEVAL=gp-sweep` selects the automatic sweep and requires
the hourly Cron. Changing retrieval mode or schedule is an operator-controlled
deployment action, not a browser or local-development choice.

## Provider isolation

The browser never contacts Space-Track. Provider endpoints, authentication and
wire dialect live entirely in `workers/catalogue/provider/`. Space-Track field
names stop in the provider adapter, which emits provider-neutral source records.
Everything above that boundary - validation, enrichment, snapshot construction,
R2 storage, the public API and the browser - works on provider-neutral types.
Snapshots record which provider produced them for provenance and citation, and
nothing in the browser branches on that value.

## Local and preview operation

`CATALOGUE_PROVIDER` selects the ingestion source and defaults to `fixture`
everywhere except production, so an ordinary local run, the test suite and the
preview deployment produce no upstream traffic and need no credentials.

Space-Track credentials are Cloudflare Worker secrets named
`SPACETRACK_IDENTITY` and `SPACETRACK_PASSWORD`. They are never committed, never
bundled into a frontend asset, never written into an R2 snapshot, never returned
by an API and never logged. `.dev.vars.example` carries the variable names and
placeholders only.

The runtime is split into four permanent Workers: `orbitin` and `orbitin-dev`
serve built assets plus the same-origin catalogue allowlist,
`orbitin-catalogue` is the sole scheduled producer, and
`orbitin-catalogue-monitor` watches the producer (see Operator alerts). Frontend
R2 access is read-only by implementation and entry-point design; Cloudflare R2
does not provide a read-only binding in this topology. The frontends and the
producer bind the private production bucket `orbitin-catalogue`, with
`orbitin-catalogue-preview` as the local `wrangler dev` bucket. The monitor
binds only its own bucket, `orbitin-catalogue-monitor`. The fixture
configuration binds only `orbitin-catalogue-preview` and uses the offline
provider.

## Operator alerts

Two optional sources e-mail the operator; both are off unless configured:

- The producer reports what it can see about itself: a live catalogue older
  than 24 hours, a candidate held for review or marked publication-failed, a
  sweep discarded as invalid, provider requests blocked by a cooldown or
  latch, an invalid control state, a failed curated supplement, and a featured
  pick absent from the published catalogue.
- `orbitin-catalogue-monitor` is the producer's
  [Tail Worker](https://developers.cloudflare.com/workers/observability/logs/tail-workers/):
  it receives the outcome of every producer invocation and reports one that
  ended in anything but `ok` (for example killed for CPU or memory, or an
  uncaught exception). On its own hourly Cron it reports a producer that has
  not run for three hours.

Conditions are sent at onset, repeated daily (weekly for featured picks) while
they last, and resolved once when they clear; at most six messages a day per
Worker. Messages are plain text with ids, counts, times and failure classes
only.

Mail goes through a Cloudflare `send_email` binding, `CATALOGUE_ALERT_EMAIL`,
declared by name only. Such a binding can send only to addresses verified in
the Cloudflare account that deploys it, from an address on a domain onboarded
to Cloudflare Email Routing in that account. The recipient and sender are Worker
secrets, `CATALOGUE_ALERT_TO` and `CATALOGUE_ALERT_FROM`; no address is in this
repository, and a test fails if one appears. A Worker sends only when the
binding and both secrets are present (the producer also only with a live
provider); otherwise it logs `alerts: disabled` and nothing else changes.
Deleting either secret silences that Worker.

Run the application checks with:

```text
npm ci
npm run test:run
npx tsc --noEmit
npm run typecheck:worker
npm run build:worker
npm run test:deployment
```

Worker commands must select a complete config explicitly. The root
`wrangler.jsonc` is an undeployable sentinel; use
`wrangler.orbitin.jsonc`, `wrangler.orbitin-dev.jsonc`,
`wrangler.catalogue.jsonc`, `wrangler.catalogue-monitor.jsonc`, or
`wrangler.catalogue-fixture.jsonc` through the provided scripts. Local catalogue ingestion uses
`npm run dev:catalogue-fixture`, and the frontend Worker uses
`npm run dev:frontend-worker`. There is deliberately no local dev script for
the production catalogue config.

The Worker has no public R2 endpoint and exposes only the exact pointer,
manifest, index and declared shard paths under `/catalog/v1/`. Staged sweep
pages, review evidence, operator actions and other control objects are never
served. Unknown paths and non-GET/HEAD methods are rejected. Pointer responses
are short-lived; immutable snapshot parts are long-lived and immutable.

## Model limitations

The catalogue provides GP source data for educational visualization. SGP4/SDP4
does not provide a general covariance or positional error bound here. Source
age, provider provenance, omitted Earth-orientation inputs and model limits
matter. The application does not convert the records to classical
Keplerian/J2 elements or make operational-quality claims. The catalogue is not
complete coverage of every human-made orbiting object.

Publicly available element sets must not be used for conjunction assessment.

## Attribution

Orbital data: USSPACECOM / 18th Space Defense Squadron, accessed via
Space-Track.org. Educational use only; not for conjunction assessment or
operational decisions. Derived classifications and calculations are produced
by Orbitin. See `ATTRIBUTION.md`.
